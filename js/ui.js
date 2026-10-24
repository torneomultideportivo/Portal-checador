// Utilidades de pantalla: construir HTML, avisos, ventanas, íconos, Excel y QR.
import { errMsg } from './logic.js';

// append() nativo escribe "null" si recibe null y no acepta listas; aquí se ignoran los vacíos y se aplanan las listas
const nativeAppend = Element.prototype.append;
Element.prototype.append = function (...kids) { return nativeAppend.apply(this, kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false)); };

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'for') el.htmlFor = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'data') Object.assign(el.dataset, v);
    else {
      try { if (k in el && k !== 'list') el[k] = v; else el.setAttribute(k, v === true ? '' : v); }
      catch { el.setAttribute(k, v === true ? '' : v); }
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- íconos ----------
const ICONS = {
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M4 12h16"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4 14.5a1.6 1.6 0 0 1 2.6-1.8L8 14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  school: '<path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  flash: '<path d="M13 2L3 14h8l-1 8 10-12h-8z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  wifioff: '<path d="M1 1l22 22M16.7 11.1A11 11 0 0 1 21.9 14M2.1 8.8a15 15 0 0 1 5.2-3M8.5 16.1a6 6 0 0 1 7 0M12 20h.01M5 12.9a10 10 0 0 1 5.2-2.7"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  alarm: '<path d="M12 2l10 18H2z"/><path d="M12 9v5M12 17h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M3 21v-5h5M21 3v5h-5"/>',
};
export function icon(name, size = 20) {
  return h('span', { class: 'ico', html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>` });
}

// ---------- avisos y ventanas ----------
let toastBox;
export function toast(msg, type = 'info', ms = 3500) {
  if (!toastBox) { toastBox = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: `toast ${type}` }, msg);
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
export function modal({ title, body, actions = [], wide = false, onClose, locked = false }) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape' && !locked) close(); };
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h3', null, title), locked ? null : h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Cerrar' }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-actions' }, actions) : null);
  back.append(box);
  back.addEventListener('mousedown', e => { if (e.target === back && !locked) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  const first = box.querySelector('input,select,textarea'); if (first) first.focus();
  return { close, box };
}
export function confirmBox(message, { ok = 'Aceptar', cancel = 'Cancelar', danger = false, title = 'Confirmar' } = {}) {
  return new Promise(res => {
    let done = false;
    const finish = v => { if (!done) { done = true; res(v); m.close(); } };
    const m = modal({
      title, body: h('p', { class: 'pre' }, message), onClose: () => { if (!done) { done = true; res(false); } },
      actions: [h('button', { class: 'btn', onclick: () => finish(false) }, cancel),
                h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => finish(true) }, ok)],
    });
  });
}
export function promptBox(message, { label = '', placeholder = '', ok = 'Aceptar', title = 'Escribe' } = {}) {
  return new Promise(res => {
    let done = false;
    const input = h('input', { type: 'text', placeholder, class: 'input', autocomplete: 'off' });
    const finish = v => { if (!done) { done = true; res(v); m.close(); } };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(input.value.trim()); });
    const m = modal({
      title, body: [h('p', null, message), label ? h('label', { class: 'lbl' }, label) : null, input],
      onClose: () => { if (!done) { done = true; res(null); } },
      actions: [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancelar'),
                h('button', { class: 'btn primary', onclick: () => finish(input.value.trim()) }, ok)],
    });
  });
}
// Ejecuta una acción asíncrona deshabilitando el botón y mostrando el error en español
export async function guard(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { console.error(e); toast(errMsg(e), 'error', 6000); }
  finally { if (btn) btn.disabled = false; }
}
export const spinner = (text = 'Cargando…') => h('div', { class: 'spinner-wrap' }, h('div', { class: 'spinner' }), h('span', null, text));
export const empty = text => h('div', { class: 'empty' }, text);
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado', 'ok', 1500); }
  catch { prompt('Copia el texto:', text); }
}
export const badge = (status) => {
  const map = { PUNTUAL: ['ok', 'Puntual'], RETARDO: ['warn', 'Retardo'], PENDIENTE: ['muted', 'Pendiente'], ERROR: ['bad', 'Error'], NUEVO: ['ok', 'Nuevo'], ACTUALIZA: ['info', 'Actualiza'] };
  const [c, t] = map[status] || ['muted', status];
  return h('span', { class: `badge ${c}` }, t);
};

// ---------- sonido y vibración ----------
let actx;
export function beep(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const seq = kind === 'alarm' ? [[880, 0.18], [440, 0.18], [880, 0.18], [440, 0.18], [880, 0.25]] : kind === 'ok' ? [[880, 0.09]] : kind === 'warn' ? [[660, 0.1], [520, 0.14]] : kind === 'dup' ? [[500, 0.08], [500, 0.08]] : [[200, 0.3]];
    let t = actx.currentTime;
    for (const [f, d] of seq) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.type = (kind === 'bad' || kind === 'alarm') ? 'sawtooth' : 'sine';
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d + 0.02);
      t += d + 0.05;
    }
  } catch { /* sin audio */ }
  try { navigator.vibrate && navigator.vibrate(kind === 'ok' ? 60 : kind === 'alarm' ? [300, 100, 300, 100, 300] : kind === 'bad' ? [120, 60, 120] : [80, 40, 80]); } catch { /* */ }
}

// ---------- QR (SVG) ----------
export function qrSvg(text, { margin = 2 } = {}) {
  const qr = globalThis.qrcode(0, 'M');
  qr.addData(text); qr.make();
  const n = qr.getModuleCount(), size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- Excel ----------
export async function downloadXlsx(filename, sheets, titleLines = []) {
  const wb = new globalThis.ExcelJS.Workbook();
  wb.creator = 'Checador de asistencia';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    let row = 1;
    for (const line of titleLines) { ws.getCell(row, 1).value = line; ws.getCell(row, 1).font = { bold: true, size: row === 1 ? 14 : 11 }; row++; }
    if (titleLines.length) row++;
    const headRow = ws.getRow(row);
    s.columns.forEach((c, i) => {
      const cell = headRow.getCell(i + 1);
      cell.value = c.header; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F5B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      ws.getColumn(i + 1).width = c.width || Math.max(12, String(c.header).length + 4);
    });
    s.rows.forEach(r => {
      const rr = ws.addRow(s.columns.map(c => r[c.key] ?? ''));
      rr.eachCell(cell => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFBBBBBB' } } }; });
    });
    ws.views = [{ state: 'frozen', ySplit: row }];
  }
  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename }); document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}
export const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
