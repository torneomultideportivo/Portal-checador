// Probar QR (administrativo): lee la credencial como el prefecto, pero NO registra asistencia ni genera alarmas.
import { h, clear, icon, toast, beep } from '../ui.js';
import { state } from '../state.js';
import { QrScanner } from '../scanner.js';
import { parseQr, classify, classifyStaff, errMsg, fmtTime } from '../logic.js';
import { loadStudents } from './students.js';
import { loadPersonal } from './personal.js';

export function render(root) {
  const school = state.school;
  const byToken = new Map();
  const video = h('video', { class: 'cam-video', playsInline: true, muted: true });
  const camMsg = h('div', { class: 'cam-msg' });
  const result = h('div', { class: 'result idle' }, h('div', { class: 'r-big' }, 'Cargando lista…'));
  const recentBox = h('div', { class: 'recent' });
  const recent = [];
  let ready = false;

  const idle = () => { result.className = 'result idle'; clear(result).append(h('div', { class: 'r-big' }, 'Listo para probar'), h('div', { class: 'r-sub' }, 'Acerca una credencial al cuadro')); };
  const show = (cls, big, sub, meta) => {
    result.className = 'result ' + cls;
    clear(result).append(h('div', { class: 'r-big' }, big), h('div', { class: 'r-sub' }, sub),
      h('div', { class: 'r-meta' }, meta, h('span', { class: 'tag' }, 'PRUEBA: no se registró nada')));
  };
  const push = (text, cls) => {
    recent.unshift({ text, cls, t: new Date() }); recent.length = Math.min(recent.length, 8);
    clear(recentBox).append(...recent.map(r => h('div', { class: 'rc ' + r.cls }, h('span', null, fmtTime(r.t, school.timezone, true)), h('span', null, r.text))));
  };

  let lastCode = '', lastAt = 0;
  const onCode = text => {
    if (!ready) return;
    const now = Date.now();
    if (text === lastCode && now - lastAt < 3000) return;
    lastCode = text; lastAt = now;
    const token = parseQr(text);
    if (!token) { beep('bad'); show('bad', 'QR NO RECONOCIDO', 'Esta credencial no pertenece al checador.', ''); push('QR ajeno al checador', 'bad'); return; }
    const p = byToken.get(String(token).toLowerCase());
    if (!p) { beep('bad'); show('bad', 'QR NO VÁLIDO', 'No está en la lista de esta escuela (o es una credencial reemplazada).', 'Un prefecto vería una ALARMA roja.'); push('QR no válido', 'bad'); return; }
    if (!p.active) { beep('dup'); show('inactive', 'DE BAJA', p.nombre, 'Esta persona está dada de baja.'); push(`${p.nombre} · de baja`, 'dup'); return; }
    const staff = p.kind === 'PERSONAL';
    const c = staff ? classifyStaff(new Date(), school, p) : classify(new Date(), school);
    const retardo = c.status === 'RETARDO';
    const where = staff ? (p.puesto || 'Personal') : `${p.grado}° ${p.grupo}`;
    beep(retardo ? 'warn' : 'ok');
    show(retardo ? 'warn' : 'ok', retardo ? `RETARDO · +${c.late_minutes} min` : 'PUNTUAL', p.nombre,
      `${where}${staff && !school.staff_qr_enabled ? ' · (entrada del personal apagada: el prefecto vería "sin registro")' : ''} · `);
    push(`${p.nombre} · ${retardo ? 'retardo' : 'puntual'}`, retardo ? 'warn' : 'ok');
  };

  const scanner = new QrScanner(video, onCode);
  const startCam = async () => {
    camMsg.textContent = 'Iniciando cámara…'; camMsg.hidden = false;
    try { await scanner.start(); camMsg.hidden = true; }
    catch (e) {
      camMsg.hidden = false;
      clear(camMsg).append(h('p', null, e.name === 'NotAllowedError' ? 'Permite el acceso a la cámara en tu navegador y vuelve a intentar.' : (e.message || 'No se pudo abrir la cámara.')), h('button', { class: 'btn', onclick: startCam }, 'Reintentar'));
    }
  };

  let buf = '', bufTimer;
  const onKey = e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'Enter') { if (buf.startsWith('AST1:')) onCode(buf); buf = ''; return; }
    if (e.key.length === 1) { buf += e.key; clearTimeout(bufTimer); bufTimer = setTimeout(() => { buf = ''; }, 400); }
  };
  document.addEventListener('keydown', onKey);

  root.append(h('section', { class: 'view scan-view' },
    h('div', { class: 'view-head' }, h('h2', null, 'Probar QR')),
    h('div', { class: 'note' }, 'Funciona igual que la pantalla del prefecto, pero es solo una prueba: ', h('b', null, 'no guarda asistencia ni genera alarmas.')),
    h('div', { class: 'cam' }, video, h('div', { class: 'cam-frame' }), camMsg), result, recentBox));

  Promise.all([loadStudents(true), loadPersonal()]).then(([al, pe]) => {
    al.forEach(a => byToken.set(String(a.qr_token).toLowerCase(), { ...a, kind: 'ALUMNO' }));
    pe.forEach(x => byToken.set(String(x.qr_token).toLowerCase(), { ...x, kind: 'PERSONAL' }));
    ready = true; idle(); startCam();
  }).catch(e => { clear(result).append(h('div', { class: 'r-big' }, 'Error'), h('div', { class: 'r-sub' }, errMsg(e))); toast(errMsg(e), 'bad'); });

  return () => { scanner.stop(); document.removeEventListener('keydown', onKey); clearTimeout(bufTimer); };
}
