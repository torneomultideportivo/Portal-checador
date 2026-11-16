// Retiro anticipado: el prefecto escanea la credencial del alumno que sale ANTES de que termine el horario
// de clases, elige el motivo y confirma. La salida normal de fin de día NO se registra aquí.
// La autorización es un documento en papel que el prefecto revisa; el sistema no lo emite ni lo valida.
import { h, clear, icon, toast, beep } from '../ui.js';
import { state } from '../state.js';
import { rpc } from '../api.js';
import { QrScanner } from '../scanner.js';
import { parseQr, fmtTime, searchKey, errMsg } from '../logic.js';

export const MOTIVOS = [['SALUD', 'Salud'], ['CITA_FAMILIAR', 'Cita o asunto familiar'], ['PERMISO_DIRECCION', 'Permiso de dirección'], ['OTRO', 'Otro']];
export const motivoTxt = c => (MOTIVOS.find(m => m[0] === c) || [0, c])[1];

export function render(root) {
  const school = state.school, tz = school.timezone;
  const video = h('video', { class: 'cam-video', playsInline: true, muted: true });
  const camMsg = h('div', { class: 'cam-msg' });
  const panel = h('div', { class: 'result idle' });
  const recentBox = h('div', { class: 'recent' });
  const recent = [];
  let busy = false, lockUntil = 0, lastCode = '', lastAt = 0;

  const idle = () => {
    busy = false; lastCode = '';
    panel.className = 'result idle';
    clear(panel).append(h('div', { class: 'r-big' }, 'Retiro anticipado'), h('div', { class: 'r-sub' }, 'Escanea la credencial del alumno que sale'));
  };
  const show = (cls, big, sub, extra) => { panel.className = 'result ' + cls; clear(panel).append(h('div', { class: 'r-big' }, big), h('div', { class: 'r-sub' }, sub), extra || null); };
  const pushRecent = (text, cls) => {
    recent.unshift({ text, cls, t: new Date() }); recent.length = Math.min(recent.length, 6);
    clear(recentBox).append(...recent.map(r => h('div', { class: 'rc ' + r.cls }, h('span', null, fmtTime(r.t, tz)), h('span', null, r.text))));
  };
  const okBtn = () => h('button', { class: 'btn small light', onclick: idle }, 'Entendido');

  async function lookup(arg) {
    if (!navigator.onLine) { beep('bad'); show('bad', 'SIN INTERNET', 'El retiro anticipado se registra en línea.', h('div', null, h('div', { class: 'r-meta' }, 'Conéctate e inténtalo de nuevo.'), okBtn())); return; }
    busy = true;
    show('idle', 'Buscando…', '', null);
    try {
      const r = await rpc('early_exit_lookup', arg);
      const st = r.student;
      const where = st ? `${st.grado}° ${st.grupo}` : '';
      if (r.result === 'LISTO') { beep('ok'); return form(r); }
      if (r.result === 'SIN_ENTRADA') { beep('bad'); show('bad', 'SIN ENTRADA HOY', st.nombre, h('div', null, h('div', { class: 'r-meta' }, `${where} · No se puede registrar su retiro porque hoy no tiene entrada. Avisa a la administración.`), okBtn())); pushRecent(`${st.nombre} · sin entrada`, 'bad'); return; }
      if (r.result === 'YA_RETIRADO') { beep('dup'); show('dup', 'YA SE RETIRÓ', st.nombre, h('div', null, h('div', { class: 'r-meta' }, `${where} · ${fmtTime(r.retiro.exit_at, tz)} · ${motivoTxt(r.retiro.categoria)} · registró ${r.retiro.by}`), okBtn())); pushRecent(`${st.nombre} · ya estaba retirado`, 'dup'); return; }
      if (r.result === 'ALUMNO_INACTIVO') { beep('bad'); show('bad', 'ALUMNO DE BAJA', st.nombre, h('div', null, okBtn())); return; }
      if (r.result === 'QR_REEMPLAZADO') { beep('alarm'); show('alarm', 'CREDENCIAL VIEJA', 'Ya se hizo una reposición de este QR. Pide la credencial nueva.', h('div', null, okBtn())); return; }
      beep('bad'); show('bad', 'QR NO RECONOCIDO', 'Esta credencial no pertenece a esta escuela.', h('div', null, okBtn()));
    } catch (e) { beep('bad'); show('bad', 'ERROR', errMsg(e), h('div', null, okBtn())); }
  }

  // Motivo + quién recogió + confirmar
  function form(r) {
    const st = r.student;
    let motivo = '';
    const recogio = h('input', { class: 'input', maxLength: 80, placeholder: 'Quién recogió al alumno (opcional)', autocomplete: 'off' });
    const go = h('button', { class: 'btn primary block', disabled: true }, 'Registrar retiro');
    const btns = MOTIVOS.map(([k, t]) => h('button', { type: 'button', class: 'btn block', onclick: () => { motivo = k; btns.forEach((b, i) => b.classList.toggle('primary', MOTIVOS[i][0] === k)); go.disabled = false; } }, t));
    go.onclick = async () => {
      go.disabled = true;
      try {
        const res = await rpc('register_early_exit', { p_student: st.id, p_categoria: motivo, p_recogio: recogio.value.trim() || null });
        beep('ok');
        show('ok', 'RETIRO REGISTRADO', st.nombre, h('div', null, h('div', { class: 'r-meta' }, `${st.grado}° ${st.grupo} · ${fmtTime(res.exit_at, tz)} · ${motivoTxt(motivo)}`), okBtn()));
        pushRecent(`${st.nombre} · retiro (${motivoTxt(motivo)})`, 'ok');
        setTimeout(() => { if (panel.classList.contains('ok')) idle(); }, 4000);
      } catch (e) { go.disabled = false; beep('bad'); toast(errMsg(e), 'error', 5000); }
    };
    panel.className = 'result warn';
    clear(panel).append(h('div', { class: 'r-big' }, st.nombre),
      h('div', { class: 'r-sub' }, `${st.grado}° ${st.grupo} · entró a las ${fmtTime(r.entrada, tz)}`),
      h('div', { class: 'form retiro-form' },
        h('p', { class: 'r-meta' }, 'Revisa el documento de autorización y elige el motivo:'), ...btns, recogio, go,
        h('button', { class: 'btn small light', onclick: idle }, 'Cancelar')));
  }

  const onCode = text => {
    const now = Date.now();
    if (busy || now < lockUntil) return;
    const token = parseQr(text);
    if (!token) {
      if (text === lastCode && now - lastAt < 4000) return;
      lastCode = text; lastAt = now; lockUntil = now + 1200;
      beep('bad'); show('bad', 'QR NO RECONOCIDO', 'Esta credencial no pertenece al checador.', h('div', null, okBtn())); busy = true; return;
    }
    if (token === lastCode && now - lastAt < 4000) return;
    lastCode = token; lastAt = now; lockUntil = now + 1000;
    lookup({ p_token: token });
  };

  const scanner = new QrScanner(video, onCode);
  const startCam = async () => {
    camMsg.textContent = 'Iniciando cámara…'; camMsg.hidden = false;
    try { await scanner.start(); camMsg.hidden = true; }
    catch (e) {
      camMsg.hidden = false;
      clear(camMsg).append(h('p', null, e.name === 'NotAllowedError' ? 'Permite el acceso a la cámara en tu navegador y vuelve a intentar.' : (e.message || 'No se pudo abrir la cámara.')),
        h('button', { class: 'btn', onclick: startCam }, 'Reintentar'), h('p', { class: 'muted' }, 'Mientras tanto puedes buscar al alumno por nombre.'));
    }
  };

  // lectores de código tipo teclado (USB o Bluetooth)
  let buf = '', bufTimer;
  const onKey = e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'Enter') { if (buf.startsWith('AST1:')) onCode(buf); buf = ''; return; }
    if (e.key.length === 1) { buf += e.key; clearTimeout(bufTimer); bufTimer = setTimeout(() => { buf = ''; }, 400); }
  };
  document.addEventListener('keydown', onKey);

  // Respaldo: buscar por nombre cuando no trae credencial
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Buscar por nombre o apellido…', autocomplete: 'off' });
  const found = h('div', { class: 'list' });
  q.addEventListener('input', () => {
    const words = searchKey(q.value).split(' ').filter(Boolean);
    clear(found);
    if (!words.length) return;
    const rows = state.roster.filter(s => words.every(w => searchKey(s.nombre).includes(w))).slice(0, 8);
    if (!rows.length) { found.append(h('div', { class: 'empty' }, 'Sin resultados')); return; }
    found.append(...rows.map(s => h('button', { class: 'row-btn', onclick: () => { q.value = ''; clear(found); lookup({ p_student: s.id }); } },
      h('div', null, h('b', null, s.nombre), h('small', null, `${s.grado}° ${s.grupo}`)))));
  });
  const search = h('details', { class: 'install-box' }, h('summary', null, '¿No trae credencial? Buscar por nombre'), q, found);

  idle();
  root.append(h('section', { class: 'view scan-view' },
    h('div', { class: 'note' }, icon('alarm', 16), ' Solo para alumnos que salen ANTES de que termine el horario de clases. La salida normal no se registra.'),
    h('div', { class: 'cam' }, video, h('div', { class: 'cam-frame' }), camMsg), panel, search, recentBox));
  startCam();
  return () => { scanner.stop(); document.removeEventListener('keydown', onKey); clearTimeout(bufTimer); };
}
