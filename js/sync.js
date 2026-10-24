// Motor de registro: funciona con o sin internet.
//  1) Cada escaneo se guarda PRIMERO en el celular (cola), con su hora exacta.
//  2) Se envía al servidor en cuanto hay conexión; si falla, se reintenta solo.
//  3) El servidor decide puntual/retardo y conserva el registro más temprano si hubo duplicados.
import { state, emit, canScan } from './state.js';
import { sb, rpc, fetchAll } from './api.js';
import { getAll, put, del, replaceAll, count, kvGet, kvSet } from './db.js';
import { classify, classifyStaff, alarmKind, todayLocal, cmpStudent, uuid, isNetworkError, errMsg } from './logic.js';

// ---------- dispositivo ----------
let _device;
export async function deviceLabel() {
  if (_device) return _device;
  let id = await kvGet('deviceId');
  if (!id) { id = uuid().slice(0, 4); await kvSet('deviceId', id); }
  const ua = navigator.userAgent || '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Otro';
  const br = /Edg/i.test(ua) ? 'Edge' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : 'Web';
  return (_device = `${os} · ${br} · ${id}`);
}

// ---------- datos locales ----------
export function setRoster(rows) {
  state.roster = rows;
  state.rosterById = new Map(rows.map(s => [s.id, s]));
  state.rosterByToken = new Map(rows.map(s => [String(s.qr_token).toLowerCase(), s]));
}
export function setStaff(rows, cfg) {
  state.staff = rows || [];
  state.staffById = new Map(state.staff.map(p => [p.id, p]));
  state.staffByToken = new Map(state.staff.map(p => [String(p.token).toLowerCase(), p]));
  if (cfg) state.scanCfg = { ...state.scanCfg, ...cfg };
}
export async function loadLocal() {
  const [students, today, fecha, staff, cfg, stToday] = await Promise.all([getAll('students'), getAll('today'), kvGet('todayFecha'),
    kvGet('staffRoster'), kvGet('scanCfg'), kvGet('staffToday')]);
  students.sort(cmpStudent);
  setRoster(students);
  setStaff(staff || [], cfg || null);
  const f = state.school ? todayLocal(state.school.timezone) : null;
  state.fecha = f;
  state.today = new Map((fecha === f ? today : []).map(r => [r.student_id, r]));
  state.staffToday = new Map(((stToday && stToday.fecha === f) ? stToday.rows : []).map(r => [r.personal_id, r]));
  await refreshCounts();
  emit('changed');
}
export async function refreshCounts() {
  state.pending = await count('queue');
  state.failed = await count('failed');
}

// ---------- descarga desde el servidor ----------
export async function refreshRoster() {
  if (!canScan() || !navigator.onLine) return false;
  const school = state.profile.school_id;
  const rows = await fetchAll(() => sb.from('students').select('id,nombre,grado,grupo,genero,qr_token')
    .eq('school_id', school).eq('active', true).order('id'));
  rows.sort(cmpStudent);
  await replaceAll('students', rows);
  setRoster(rows);
  await refreshToday();
  await kvSet('rosterAt', Date.now());
  return true;
}

// Personal de la escuela: lista mínima para escanear + si el interruptor de la escuela está encendido
export async function refreshStaff() {
  if (!canScan() || !navigator.onLine) return;
  const r = await rpc('scan_roster', { p_school: null });
  const cfg = { staff_qr_enabled: r.staff_qr_enabled, staff_tolerance_min: r.staff_tolerance_min, alarm_minutes: r.alarm_minutes };
  setStaff(r.personal, cfg);
  await kvSet('staffRoster', r.personal); await kvSet('scanCfg', cfg);
  const fecha = todayLocal(state.school.timezone);
  const map = new Map((r.hoy || []).map(x => [x.personal_id, x]));
  for (const it of await getAll('queue')) {   // lo que aún no se envía
    const p = it.token ? state.staffByToken.get(String(it.token).toLowerCase()) : null;
    if (p && it.fecha === fecha && !map.has(p.id)) map.set(p.id, localStaffRecord(p, it));
  }
  state.staffToday = map;
  await kvSet('staffToday', { fecha, rows: [...map.values()] });
}

export async function refreshToday() {
  if (!canScan() || !navigator.onLine) return;
  try { await refreshStaff(); } catch (e) { if (isNetworkError(e)) throw e; }
  const school = state.profile.school_id;
  const fecha = todayLocal(state.school.timezone);
  const rows = await fetchAll(() => sb.from('attendance')
    .select('id,student_id,fecha,scanned_at,status,late_minutes,method,recorded_by_name,offline,device')
    .eq('school_id', school).eq('fecha', fecha).order('id'));
  const map = new Map(rows.map(r => [r.student_id, { ...r, by: r.recorded_by_name }]));
  // registros que todavía no se han enviado se muestran como "pendientes"
  for (const it of await getAll('queue')) {
    const st = it.student_id ? state.rosterById.get(it.student_id) : state.rosterByToken.get(String(it.token).toLowerCase());
    if (st && it.fecha === fecha && !map.has(st.id)) map.set(st.id, localRecord(st.id, it));
  }
  state.fecha = fecha;
  state.today = map;
  await replaceAll('today', [...map.values()]);
  await kvSet('todayFecha', fecha);
  state.netFail = false;
  state.lastSync = Date.now();
  emit('changed');
}

function localRecord(studentId, it) {
  const c = classify(new Date(it.scanned_at), state.school);
  return { student_id: studentId, fecha: it.fecha, scanned_at: it.scanned_at, status: c.status, late_minutes: c.late_minutes,
    method: it.method, by: state.profile.full_name, offline: it.offline, device: it.device, pending: true, cid: it.cid };
}
function localStaffRecord(p, it) {
  const c = classifyStaff(new Date(it.scanned_at), { ...state.school, ...state.scanCfg }, p);
  return { personal_id: p.id, fecha: it.fecha, scanned_at: it.scanned_at, status: c.status, late_minutes: c.late_minutes,
    by: state.profile.full_name, offline: it.offline, device: it.device, pending: true, cid: it.cid };
}

// ---------- registrar ----------
// Devuelve {kind, type: 'ALUMNO'|'PERSONAL', student|person, record, alarm}
//   kind: REGISTRADO · DUPLICADO · ALARMA · PERSONAL_NO_ACTIVADO · DESCONOCIDO · ERROR
export async function registerScan({ token, student_id, method = 'QR' }) {
  const school = state.school;
  const now = new Date();
  const tk = token ? String(token).toLowerCase() : null;
  const device = await deviceLabel();
  const alarmMin = state.scanCfg.alarm_minutes || 10;
  let st = student_id ? state.rosterById.get(student_id) : (tk ? state.rosterByToken.get(tk) : null);
  const pe = (!st && tk) ? state.staffByToken.get(tk) : null;
  const queueItem = async (cls, offlineFlag) => {
    const item = {
      cid: uuid(), token: token || null, student_id: st ? st.id : (student_id || null),
      scanned_at: now.toISOString(), fecha: cls.fecha, method, device, offline: offlineFlag, user_id: state.profile.id,
    };
    await put('queue', item);
    return item;
  };
  const offlineNow = !navigator.onLine || state.netFail;

  // ----- personal de la escuela -----
  if (pe) {
    if (!state.scanCfg.staff_qr_enabled) return { kind: 'PERSONAL_NO_ACTIVADO', type: 'PERSONAL', person: pe };
    const ex = state.staffToday.get(pe.id);
    if (ex) {
      const ak = method === 'QR' ? alarmKind(ex, now.toISOString(), device, alarmMin) : null;
      if (!ak) return { kind: 'DUPLICADO', type: 'PERSONAL', person: pe, record: ex };
      await queueItem(classifyStaff(now, { ...school, ...state.scanCfg }, pe), offlineNow);   // se envía para que el servidor deje constancia
      await refreshCounts(); emit('changed'); flushQueue();
      return { kind: 'ALARMA', alarm: ak, type: 'PERSONAL', person: pe, record: ex };
    }
    const item = await queueItem(classifyStaff(now, { ...school, ...state.scanCfg }, pe), offlineNow);
    const rec = localStaffRecord(pe, item);
    state.staffToday.set(pe.id, rec);
    await kvSet('staffToday', { fecha: item.fecha, rows: [...state.staffToday.values()] });
    await refreshCounts(); emit('changed'); flushQueue();
    return { kind: 'REGISTRADO', type: 'PERSONAL', person: pe, record: rec };
  }

  // ----- alumnos -----
  if (st) {
    const ex = state.today.get(st.id);
    if (ex) {
      const ak = method === 'QR' ? alarmKind(ex, now.toISOString(), device, alarmMin) : null;
      if (!ak) return { kind: 'DUPLICADO', type: 'ALUMNO', student: st, person: st, record: ex };
      await queueItem(classify(now, school), offlineNow);
      await refreshCounts(); emit('changed'); flushQueue();
      return { kind: 'ALARMA', alarm: ak, type: 'ALUMNO', student: st, person: st, record: ex };
    }
  }
  const cls = classify(now, school);
  const item = await queueItem(cls, offlineNow);
  let rec = null;
  if (st) {
    rec = localRecord(st.id, item);
    state.today.set(st.id, rec);
    await put('today', rec);
  }
  await refreshCounts();
  emit('changed');
  if (st) { flushQueue(); return { kind: 'REGISTRADO', type: 'ALUMNO', student: st, person: st, record: rec }; }   // envío en segundo plano

  // QR que no está en la lista local: con internet se valida de inmediato; sin internet queda guardado
  if (navigator.onLine && !state.netFail) {
    const out = await flushQueue({ returnResults: item.cid });
    if (out && out.mine) {
      const r = out.mine;
      if (r.result === 'ERROR') { await del('failed', item.cid); await refreshCounts(); emit('changed'); return { kind: 'ERROR', message: errMsg({ message: r.error }) }; }
      if (r.result === 'ALARMA' && r.kind === 'QR_REEMPLAZADO') return { kind: 'ALARMA', alarm: 'QR_REEMPLAZADO', type: r.person?.type, person: r.person, record: null };
      if (r.result === 'PERSONAL_NO_ACTIVADO') return { kind: 'PERSONAL_NO_ACTIVADO', type: 'PERSONAL', person: r.person };
    }
    try { await refreshRoster(); } catch { /* */ }
    const s2 = state.rosterByToken.get(tk);
    if (s2) return { kind: 'REGISTRADO', type: 'ALUMNO', student: s2, person: s2, record: state.today.get(s2.id) };
    const p2 = state.staffByToken.get(tk);
    if (p2) return { kind: 'REGISTRADO', type: 'PERSONAL', person: p2, record: state.staffToday.get(p2.id) };
  }
  return { kind: 'DESCONOCIDO', student: null, record: null };
}

// ---------- enviar la cola ----------
let flushing = false;
export async function flushQueue(opts = {}) {
  if (flushing || !state.profile || !canScan() || !navigator.onLine) return;
  flushing = true;
  let sent = 0, problems = 0, mine = null;
  try {
    for (;;) {
      const mine = (await getAll('queue')).filter(i => i.user_id === state.profile.id)
        .sort((a, b) => a.scanned_at.localeCompare(b.scanned_at));
      if (!mine.length) break;
      const batch = mine.slice(0, 50);
      let res;
      try {
        res = await rpc('register_scan_batch', {
          p_items: batch.map(({ cid, token, student_id, scanned_at, method, device, offline }) =>
            ({ cid, token, student_id, scanned_at, method, device, offline })),
        });
        state.netFail = false;
      } catch (e) {
        if (isNetworkError(e)) {
          state.netFail = true;
          for (const it of batch) if (!it.offline) await put('queue', { ...it, offline: true });
          break;
        }
        if (/JWT|token|PGRST30/i.test(e.message || '')) break;   // sesión vencida: se reintenta al volver a entrar
        for (const it of batch) { await put('failed', { ...it, error: errMsg(e) }); await del('queue', it.cid); problems++; }
        continue;
      }
      for (const r of res) {
        const it = batch.find(b => b.cid === r.cid);
        if (!it) continue;
        await del('queue', it.cid);
        if (opts.returnResults && r.cid === opts.returnResults) mine = r;
        if (r.result === 'ERROR') { if (r.cid !== opts.returnResults) await put('failed', { ...it, error: errMsg({ message: r.error }) }); problems++; }
        else sent++;
      }
    }
  } finally {
    flushing = false;
    await refreshCounts();
    if (sent || problems) { try { await refreshToday(); } catch { /* */ } }
    emit('changed');
  }
  return { sent, problems, mine };
}

export async function retryFailed(cid) {
  const all = await getAll('failed');
  const it = all.find(f => f.cid === cid);
  if (!it) return;
  const { error, ...clean } = it;
  await put('queue', clean); await del('failed', cid);
  await refreshCounts(); emit('changed'); flushQueue();
}
export async function discardFailed(cid) { await del('failed', cid); await refreshCounts(); emit('changed'); }

// ---------- procesos en segundo plano ----------
let started = false;
export function startBackground() {
  if (started) return; started = true;
  const tick = async () => {
    if (!state.profile || !canScan()) return;
    if (state.school && state.fecha && todayLocal(state.school.timezone) !== state.fecha) {   // cambió el día
      state.today = new Map(); state.staffToday = new Map(); state.fecha = todayLocal(state.school.timezone);
      await replaceAll('today', []); await kvSet('staffToday', { fecha: state.fecha, rows: [] }); emit('changed');
    }
    if (!navigator.onLine) return;
    try {
      await flushQueue();
      if (!state.pending) await refreshToday();
    } catch (e) { if (isNetworkError(e)) { state.netFail = true; emit('changed'); } }
  };
  window.addEventListener('online', () => { state.online = true; state.netFail = false; emit('changed'); tick(); });
  window.addEventListener('offline', () => { state.online = false; emit('changed'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  setInterval(tick, 20000);
  setInterval(async () => { try { await refreshRoster(); } catch { /* */ } }, 10 * 60 * 1000);
}
