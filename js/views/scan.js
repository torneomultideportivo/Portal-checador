// Pantalla principal: escanear la credencial QR del alumno.
import { h, clear, icon, toast, beep } from '../ui.js';
import { state, on } from '../state.js';
import { registerScan } from '../sync.js';
import { QrScanner } from '../scanner.js';
import { parseQr, fmtTime } from '../logic.js';

export function counts() {
  let presentes = 0, puntuales = 0, retardos = 0;
  for (const s of state.roster) {
    const r = state.today.get(s.id);
    if (!r) continue;
    presentes++; r.status === 'PUNTUAL' ? puntuales++ : retardos++;
  }
  return { total: state.roster.length, presentes, puntuales, retardos, pendientes: state.roster.length - presentes };
}
export function counterBar() {
  const box = h('div', { class: 'counters' });
  const draw = () => {
    const c = counts();
    clear(box).append(
      h('div', { class: 'cnt' }, h('b', null, c.presentes), h('span', null, 'Ingresaron')),
      h('div', { class: 'cnt ok' }, h('b', null, c.puntuales), h('span', null, 'Puntuales')),
      h('div', { class: 'cnt warn' }, h('b', null, c.retardos), h('span', null, 'Retardos')),
      h('div', { class: 'cnt muted' }, h('b', null, c.pendientes), h('span', null, 'Pendientes')));
  };
  draw();
  return { el: box, draw };
}

export function render(root) {
  const school = state.school;
  const bar = counterBar();
  const video = h('video', { class: 'cam-video', playsInline: true, muted: true });
  const camMsg = h('div', { class: 'cam-msg' });
  const torchBtn = h('button', { class: 'cam-btn', hidden: true, onclick: async () => { torchOn = !torchOn; try { await scanner.setTorch(torchOn); } catch { toast('Esta cámara no tiene lámpara', 'warn'); } } }, icon('flash'), ' Lámpara');
  let torchOn = false;
  const result = h('div', { class: 'result idle' }, h('div', { class: 'r-big' }, 'Listo para escanear'), h('div', { class: 'r-sub' }, 'Acerca la credencial al cuadro'));
  const recentBox = h('div', { class: 'recent' });
  const recent = [];

  const showResult = (cls, big, sub, extra) => {
    result.className = 'result ' + cls;
    clear(result).append(h('div', { class: 'r-big' }, big), h('div', { class: 'r-sub' }, sub), extra || null);
  };
  const pushRecent = (text, cls) => {
    recent.unshift({ text, cls, t: new Date() });
    recent.length = Math.min(recent.length, 6);
    clear(recentBox).append(...recent.map(r => h('div', { class: 'rc ' + r.cls }, h('span', null, fmtTime(r.t, school.timezone, true)), h('span', null, r.text))));
  };

  const ALARM_TXT = {
    OTRO_TELEFONO: (r, hora) => `Este QR ya se registró${hora ? ' a las ' + hora : ''} en otro teléfono. Revisa a la persona.`,
    REPETIDO_TARDE: (r, hora) => `Este QR ya se registró${hora ? ' a las ' + hora : ''} y se volvió a leer pasados ${state.scanCfg.alarm_minutes} minutos. Revisa a la persona.`,
    QR_REEMPLAZADO: () => 'Es una credencial vieja: ya se hizo una reposición. Pide la nueva.',
  };
  const dismiss = () => { result.className = 'result idle'; clear(result).append(h('div', { class: 'r-big' }, 'Listo para escanear'), h('div', { class: 'r-sub' }, 'Acerca la credencial al cuadro')); };
  const display = res => {
    const person = res.person || res.student;
    const isStaff = res.type === 'PERSONAL';
    const where = person ? (isStaff ? (person.puesto || 'Personal') : `${person.grado}° ${person.grupo}`) : '';
    if (res.kind === 'ALARMA') {
      beep('alarm');
      const hora = res.record ? fmtTime(res.record.scanned_at, school.timezone, true) : '';
      showResult('alarm', '¡ALARMA!', person ? person.nombre : 'QR sospechoso',
        h('div', null, h('div', { class: 'r-meta' }, `${where ? where + ' · ' : ''}${ALARM_TXT[res.alarm](res, hora)}`),
          h('button', { class: 'btn small light', onclick: dismiss }, 'Entendido')));
      pushRecent(`${person ? person.nombre : 'QR'} · ALARMA`, 'bad');
    } else if (res.kind === 'PERSONAL_NO_ACTIVADO') {
      beep('dup');
      showResult('inactive', 'SIN REGISTRO', person.nombre, h('div', { class: 'r-meta' }, 'Entrada con QR no activada en esta escuela.'));
      pushRecent(`${person.nombre} · sin registro (no activado)`, 'dup');
    } else if (res.kind === 'REGISTRADO' || res.kind === 'DUPLICADO') {
      const r = res.record;
      const hora = fmtTime(r.scanned_at, school.timezone, true);
      if (res.kind === 'DUPLICADO') {
        beep('dup');
        showResult('dup', 'YA REGISTRADO', person.nombre, h('div', { class: 'r-meta' }, `${where} · entrada a las ${hora}${r.by ? ' · ' + r.by : ''}`));
        pushRecent(`${person.nombre} · ya estaba (${hora})`, 'dup');
        return;
      }
      const retardo = r.status === 'RETARDO';
      beep(retardo ? 'warn' : 'ok');
      showResult(retardo ? 'warn' : 'ok', retardo ? `RETARDO · +${r.late_minutes} min` : 'PUNTUAL', person.nombre,
        h('div', { class: 'r-meta' }, `${where} · ${hora}`, r.offline ? h('span', { class: 'tag' }, 'sin conexión: se enviará solo') : null));
      pushRecent(`${person.nombre} · ${retardo ? 'retardo' : 'puntual'}`, retardo ? 'warn' : 'ok');
    } else if (res.kind === 'DESCONOCIDO') {
      beep('warn');
      showResult('warn', 'GUARDADO', 'No reconozco este QR en la lista del celular', h('div', { class: 'r-meta' }, 'Se validará al recuperar internet.'));
      pushRecent('QR guardado para validar', 'warn');
    } else {
      beep('bad');
      showResult('bad', 'QR NO VÁLIDO', res.message || 'Error', null);
      pushRecent(res.message || 'Error', 'bad');
    }
  };

  let lockUntil = 0, lastCode = '', lastAt = 0, busy = false;
  const onCode = async text => {
    const now = Date.now();
    if (now < lockUntil || busy) return;
    const token = parseQr(text);
    if (!token) {
      if (text === lastCode && now - lastAt < 4000) return;
      lastCode = text; lastAt = now; lockUntil = now + 1200;
      beep('bad'); showResult('bad', 'QR NO RECONOCIDO', 'Esta credencial no pertenece al checador.', null);
      return;
    }
    if (token === lastCode && now - lastAt < 4000) return;   // la misma credencial sigue frente a la cámara
    lastCode = token; lastAt = now; lockUntil = now + 1000;
    busy = true;
    try { display(await registerScan({ token, method: 'QR' })); }
    catch (e) { console.error(e); beep('bad'); showResult('bad', 'ERROR', e.message || String(e), null); }
    finally { busy = false; }
  };

  const scanner = new QrScanner(video, onCode);
  const startCam = async () => {
    camMsg.textContent = 'Iniciando cámara…'; camMsg.hidden = false;
    try {
      await scanner.start();
      camMsg.hidden = true; torchBtn.hidden = !scanner.torchSupported;
    } catch (e) {
      camMsg.hidden = false;
      clear(camMsg).append(h('p', null, e.name === 'NotAllowedError' ? 'Permite el acceso a la cámara en tu navegador y vuelve a intentar.' : (e.message || 'No se pudo abrir la cámara.')),
        h('button', { class: 'btn', onclick: startCam }, 'Reintentar'), h('p', { class: 'muted' }, 'Mientras tanto puedes usar la pestaña "Manual".'));
    }
  };

  // lectores de código de barras/QR tipo teclado (USB o Bluetooth)
  let buf = '', bufTimer;
  const onKey = e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'Enter') { if (buf.startsWith('AST1:')) onCode(buf); buf = ''; return; }
    if (e.key.length === 1) { buf += e.key; clearTimeout(bufTimer); bufTimer = setTimeout(() => { buf = ''; }, 400); }
  };
  document.addEventListener('keydown', onKey);

  const off = on('changed', bar.draw);
  root.append(h('section', { class: 'view scan-view' }, bar.el,
    h('div', { class: 'cam' }, video, h('div', { class: 'cam-frame' }), camMsg, torchBtn), result, recentBox));
  startCam();
  return () => { off(); scanner.stop(); document.removeEventListener('keydown', onKey); clearTimeout(bufTimer); };
}
