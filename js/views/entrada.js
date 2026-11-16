// Entrada (administración): el administrador general, dentro de una escuela con acceso de soporte,
// registra la entrada de un alumno escaneando su credencial o buscándolo por nombre.
// Solo con internet: no usa la cola sin conexión ni guarda listas en este equipo.
import { h, clear, icon, toast, beep } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc, sb, fetchAll } from '../api.js';
import { QrScanner } from '../scanner.js';
import { parseQr, fmtTime, searchKey, errMsg } from '../logic.js';

export function render(root) {
  const tz = state.school.timezone;
  const video = h('video', { class: 'cam-video', playsInline: true, muted: true });
  const camMsg = h('div', { class: 'cam-msg' });
  const panel = h('div', { class: 'result idle' });
  const recentBox = h('div', { class: 'recent' });
  const recent = [];
  let busy = false, lockUntil = 0, lastCode = '', lastAt = 0, cid = 0;

  const idle = () => { busy = false; lastCode = ''; panel.className = 'result idle';
    clear(panel).append(h('div', { class: 'r-big' }, 'Entrada (administración)'), h('div', { class: 'r-sub' }, 'Escanea la credencial del alumno')); };
  const show = (cls, big, sub, extra) => { panel.className = 'result ' + cls; clear(panel).append(h('div', { class: 'r-big' }, big), h('div', { class: 'r-sub' }, sub), extra || null); };
  const pushRecent = (text, cls) => { recent.unshift({ text, cls, t: new Date() }); recent.length = Math.min(recent.length, 6);
    clear(recentBox).append(...recent.map(r => h('div', { class: 'rc ' + r.cls }, h('span', null, fmtTime(r.t, tz)), h('span', null, r.text)))); };
  const okBtn = () => h('button', { class: 'btn small light', onclick: idle }, 'Entendido');

  async function send(item) {
    if (!navigator.onLine) { beep('bad'); show('bad', 'SIN INTERNET', 'Esta pantalla solo registra en línea.', h('div', null, okBtn())); return; }
    busy = true; show('idle', 'Registrando…', '');
    try {
      const out = await rpc('register_scan_batch', { p_items: [{ cid: 'adm' + (++cid), scanned_at: new Date().toISOString(), device: 'ADMIN-WEB', ...item }], p_school: sid() });
      const r = out[0] || {}, p = r.person || {};
      const who = p.nombre || '', grp = p.grado ? `${p.grado}° ${p.grupo}` : '';
      if (r.result === 'REGISTRADO') {
        const late = r.status !== 'PUNTUAL';
        beep(late ? 'warn' : 'ok'); show(late ? 'warn' : 'ok', late ? 'RETARDO' : 'PUNTUAL', who, h('div', null, h('div', { class: 'r-meta' }, `${grp} · ${fmtTime(r.scanned_at, tz)}${late ? ` · ${r.late_minutes} min` : ''}`), okBtn()));
        pushRecent(`${who} · ${late ? 'retardo' : 'puntual'}`, late ? 'warn' : 'ok');
      } else if (r.result === 'DUPLICADO' || r.result === 'ALARMA') {
        beep('dup'); show('dup', 'YA ESTABA REGISTRADO', who, h('div', null, h('div', { class: 'r-meta' }, `${grp} · ${fmtTime(r.first_scanned_at || r.scanned_at, tz)} · ${r.by || ''}`), okBtn()));
        pushRecent(`${who} · ya registrado`, 'dup');
      } else if (r.result === 'PERSONAL_NO_ACTIVADO') {
        beep('bad'); show('bad', 'PERSONAL', 'El registro del personal no está activado en esta escuela.', h('div', null, okBtn()));
      } else {
        beep('bad'); show('bad', 'NO SE REGISTRÓ', r.error ? errMsg(new Error(r.error)) : 'QR no reconocido.', h('div', null, okBtn()));
      }
    } catch (e) { beep('bad'); show('bad', 'ERROR', errMsg(e), h('div', null, okBtn())); }
  }

  const onCode = text => {
    const now = Date.now(); if (busy || now < lockUntil) return;
    const token = parseQr(text);
    if (!token || (token === lastCode && now - lastAt < 4000)) return;
    lastCode = token; lastAt = now; lockUntil = now + 1000; send({ token, method: 'QR' });
  };
  const scanner = new QrScanner(video, onCode);
  const startCam = async () => {
    camMsg.textContent = 'Iniciando cámara…'; camMsg.hidden = false;
    try { await scanner.start(); camMsg.hidden = true; }
    catch (e) { camMsg.hidden = false; clear(camMsg).append(h('p', null, e.name === 'NotAllowedError' ? 'Permite el acceso a la cámara en tu navegador y vuelve a intentar.' : (e.message || 'No se pudo abrir la cámara.')),
      h('button', { class: 'btn', onclick: startCam }, 'Reintentar'), h('p', { class: 'muted' }, 'Mientras tanto puedes buscar al alumno por nombre.')); }
  };

  // Búsqueda por nombre (la lista se baja solo al abrirla y no se guarda)
  let roster = null;
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Buscar por nombre o apellido…', autocomplete: 'off' });
  const found = h('div', { class: 'list' });
  const draw = () => {
    const words = searchKey(q.value).split(' ').filter(Boolean); clear(found);
    if (!words.length || !roster) return;
    const rows = roster.filter(s => words.every(w => searchKey(s.nombre).includes(w))).slice(0, 8);
    if (!rows.length) { found.append(h('div', { class: 'empty' }, 'Sin resultados')); return; }
    found.append(...rows.map(s => h('button', { class: 'row-btn', onclick: () => { q.value = ''; clear(found); send({ student_id: s.id, method: 'MANUAL' }); } },
      h('div', null, h('b', null, s.nombre), h('small', null, `${s.grado}° ${s.grupo}`)))));
  };
  q.addEventListener('input', async () => {
    if (!roster) { try { roster = await fetchAll(() => sb.from('students').select('id,nombre,grado,grupo').eq('school_id', sid()).eq('active', true).order('id')); } catch (e) { toast(errMsg(e), 'error'); return; } }
    draw();
  });
  const search = h('details', { class: 'install-box' }, h('summary', null, '¿No trae credencial? Buscar por nombre'), q, found);

  idle();
  root.append(h('section', { class: 'view scan-view' },
    h('div', { class: 'note' }, icon('alarm', 16), ' Registra la entrada ahora mismo, con la hora del servidor. Queda a tu nombre en el historial.'),
    h('div', { class: 'cam' }, video, h('div', { class: 'cam-frame' }), camMsg), panel, search, recentBox));
  startCam();
  return () => scanner.stop();
}
