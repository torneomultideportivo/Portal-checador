// Felicitaciones: pantalla dividida en dos mitades (personal y alumnos) con rango de fechas y festejo con Las Mañanitas.
import { h, clear, toast, spinner } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { errMsg, fmtDiaMes, monthRange } from '../logic.js';

const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: state.school?.timezone || 'America/Mexico_City' }).format(new Date());

// ---------- festejo ----------
let audio = null, actx = null;
function boom() {   // estallido de cohete sintetizado: ruido que decae
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const len = actx.sampleRate * 0.5, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0.25;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(actx.destination); src.start();
  } catch { /* sin audio */ }
}

export function celebrate(names, { sub = '' } = {}) {
  const ov = h('div', { class: 'party' });
  const cv = h('canvas', { class: 'party-cv' });
  const close = h('button', { class: 'btn party-close' }, 'Cerrar');
  const deco = [];
  const EMOJI = ['🎈', '🎁', '🤡', '🎉', '🎈', '🎂', '🎈'];
  for (let i = 0; i < 18; i++) deco.push(h('span', { class: 'float', style: { left: `${Math.random() * 94}%`, animationDuration: `${6 + Math.random() * 6}s`, animationDelay: `${Math.random() * 5}s`, fontSize: `${2 + Math.random() * 2}rem` } }, EMOJI[i % EMOJI.length]));
  ov.append(cv, ...deco,
    h('div', { class: 'party-card' }, h('div', { class: 'party-title' }, '¡Feliz cumpleaños!'),
      h('div', { class: 'party-names' }, names.map(n => h('div', null, n))), sub ? h('div', { class: 'party-sub' }, sub) : null), close);
  document.body.append(ov);

  const ctx = cv.getContext('2d');
  const fit = () => { cv.width = innerWidth; cv.height = innerHeight; };
  fit(); addEventListener('resize', fit);
  const COLORS = ['#ff4d6d', '#ffd23f', '#3bceac', '#4cc9f0', '#b388eb', '#ff9f1c'];
  let parts = [], conf = [], run = true, last = 0;
  const burst = () => {
    const x = innerWidth * (0.15 + Math.random() * 0.7), y = innerHeight * (0.12 + Math.random() * 0.4), c = COLORS[Math.floor(Math.random() * COLORS.length)];
    for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 4.5; parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, c }); }
    boom();
  };
  for (let i = 0; i < 160; i++) conf.push({ x: Math.random() * innerWidth, y: -Math.random() * innerHeight, vy: 1.5 + Math.random() * 3, vx: Math.random() * 2 - 1, r: Math.random() * 6, c: COLORS[i % COLORS.length], w: 6 + Math.random() * 6 });
  const tick = t => {
    if (!run) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (t - last > 900) { burst(); last = t; }
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.vx *= 0.99; p.life -= 0.012; ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 4, 4); }
    ctx.globalAlpha = 1;
    for (const c of conf) { c.y += c.vy; c.x += c.vx + Math.sin(c.y / 30); c.r += 0.1; if (c.y > cv.height) { c.y = -10; c.x = Math.random() * cv.width; } ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.fillStyle = c.c; ctx.fillRect(-c.w / 2, -2, c.w, 4); ctx.restore(); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  try { audio = new Audio('./assets/mananitas.mp3'); audio.play().catch(() => {}); } catch { /* sin audio */ }
  const end = () => { run = false; removeEventListener('resize', fit); try { audio?.pause(); } catch { /* */ } ov.remove(); };
  close.onclick = end;
  if (audio) audio.addEventListener('ended', () => setTimeout(end, 2500));
}

// ---------- pantalla ----------
export function render(root) {
  const month = monthRange(todayLocal());
  const from = h('input', { class: 'input', type: 'date', value: month.from });
  const to = h('input', { class: 'input', type: 'date', value: month.to });
  const staffBox = h('div'), kidsBox = h('div');
  let data = { alumnos: [], personal: [] };
  const today = todayLocal();
  const isToday = (dia, mes) => today.slice(5) === `${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

  const draw = () => {
    clear(staffBox).append(h('h3', null, `Personal (${data.personal.length})`),
      data.personal.length ? data.personal.map(p => h('div', { class: 'bday' + (isToday(p.dia, p.mes) ? ' today' : '') },
        h('span', { class: 'bday-ico' }, '🎂'), h('div', { class: 'grow' }, h('b', null, p.nombre), h('small', null, `¡Felicidades! · ${fmtDiaMes(p.dia, p.mes)}`))))
        : h('div', { class: 'empty' }, 'Nadie cumple años en este periodo.'));
    clear(kidsBox).append(h('h3', null, `Alumnos (${data.alumnos.length})`),
      data.alumnos.length ? data.alumnos.map(a => h('div', { class: 'bday' + (isToday(a.dia, a.mes) ? ' today' : '') },
        h('span', { class: 'bday-ico' }, '🎈'), h('div', { class: 'grow' }, h('b', null, a.nombre), h('small', null, `${fmtDiaMes(a.dia, a.mes)} · cumple ${a.edad} años · ${a.grado}° ${a.grupo}`))))
        : h('div', { class: 'empty' }, 'Nadie cumple años en este periodo.'));
  };

  async function load() {
    clear(staffBox).append(spinner()); clear(kidsBox).append(spinner());
    try { data = await rpc('birthdays', { p_school: sid(), p_from: from.value, p_to: to.value }); draw(); }
    catch (e) { clear(staffBox).append(h('div', { class: 'note bad' }, errMsg(e))); clear(kidsBox); }
  }
  const setRange = (a, b) => { from.value = a; to.value = b; load(); };
  const party = () => {
    const hoy = [...data.personal.filter(p => isToday(p.dia, p.mes)).map(p => p.nombre), ...data.alumnos.filter(a => isToday(a.dia, a.mes)).map(a => `${a.nombre} (${a.edad} años)`)];
    if (!hoy.length) { toast('Hoy no cumple años nadie en este periodo. Cambia las fechas para incluir el día.', 'info', 4500); return; }
    celebrate(hoy);
  };
  const week = () => { const d = new Date(today + 'T12:00:00'); const e = new Date(d); e.setDate(d.getDate() + 6); const f = x => x.toISOString().slice(0, 10); setRange(f(d), f(e)); };

  from.addEventListener('change', load); to.addEventListener('change', load);
  root.append(h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('h2', null, 'Felicitaciones'), h('button', { class: 'btn primary', onclick: party }, '🎉 Festejar a los de hoy')),
    h('div', { class: 'filters wrap' }, h('label', { class: 'field' }, h('span', null, 'Del'), from), h('label', { class: 'field' }, h('span', null, 'Al'), to),
      h('button', { class: 'btn small', onclick: () => setRange(today, today) }, 'Hoy'), h('button', { class: 'btn small', onclick: week }, 'Próximos 7 días'),
      h('button', { class: 'btn small', onclick: () => setRange(month.from, month.to) }, 'Mes en curso')),
    h('div', { class: 'two-col' }, h('div', { class: 'card' }, staffBox), h('div', { class: 'card' }, kidsBox))));
  load();
}
