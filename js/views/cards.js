// QR y credenciales: hojas de etiquetas QR de 3 × 3 cm con el nombre debajo (30 por hoja carta), para pegar en la credencial.
import { h, clear, toast, guard, spinner, qrSvg, esc } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { cmpStudent, searchKey, qrPayload, errMsg } from '../logic.js';
import { openPrintPages } from '../printing.js';
import { loadStudents } from './students.js';
import { loadPersonal } from './personal.js';

const PER_PAGE = 30;

const stickerHtml = (name, sub, token) => `<div class="sticker"><div class="stk-qr">${qrSvg(qrPayload(token))}</div><div class="stk-name">${esc(name)}</div><div class="stk-sub">${esc(sub)}</div></div>`;

export function openStickers(people) {   // people: [{nombre, sub, token}]
  const pages = [];
  for (let i = 0; i < people.length; i += PER_PAGE) pages.push(h('div', { class: 'print-page stk-page', html: people.slice(i, i + PER_PAGE).map(p => stickerHtml(p.nombre, p.sub, p.token)).join('') }));
  openPrintPages(pages, `${people.length} etiqueta(s) QR`, 'Imprime en hoja de etiquetas o papel adhesivo, tamaño Carta, escala 100 %, sin encabezados ni pies de página. Cada QR mide 3 × 3 cm.');
}


const CARDS_PER_PAGE = 8;
// Credencial completa con el formato de la escuela: encabezado, datos del alumno y un espacio para la fotografía; el QR va a la derecha.
export async function openCredentials(people, kind) {
  const school = state.school;
  const assets = await rpc('school_assets', { p_school: sid() });
  const up = t => esc(String(t ?? '').toLocaleUpperCase('es-MX'));
  const inst = String(assets.header_line || '').split('\n').map(x => x.trim()).filter(Boolean)[0];
  const claves = [assets.internal_key, school.cct].filter(Boolean).map(up).join('&nbsp;&nbsp;&nbsp;');
  const turno = school.turno ? up(school.turno) : '';
  const card = p => `<div class="cred">
    ${assets.logo_school ? `<img class="cred-logo" src="${assets.logo_school}" alt="">` : ''}
    <div class="cred-head">${inst ? `<div>${up(inst)}</div>` : ''}<div>${up(school.name)}</div>${claves ? `<div>CLAVE: ${claves}</div>` : ''}${school.school_year ? `<div>CICLO ESCOLAR ${esc(school.school_year)}</div>` : ''}</div>
    <div class="cred-foto"></div>
    <div class="cred-cuerpo"><div>LA DIRECCIÓN DE LA ESCUELA ACREDITA A:</div><b class="cred-nombre">${up(p.nombre)}</b>
      <div>${kind === 'alumnos' ? `COMO ALUMNO(A) DEL ${esc(p.grado)}° GRADO GRUPO “${esc(p.grupo)}”` : `COMO ${up(p.puesto || 'PERSONAL DE LA ESCUELA')}`}</div>${turno ? `<div>TURNO: ${turno}</div>` : ''}
      <div class="cred-aut">AUTORIZÓ</div></div>
    <div class="cred-qr">${qrSvg(qrPayload(p.qr_token))}</div>
  </div>`;
  const pages = [];
  for (let i = 0; i < people.length; i += CARDS_PER_PAGE) pages.push(h('div', { class: 'print-page cred-page', html: people.slice(i, i + CARDS_PER_PAGE).map(card).join('') }));
  openPrintPages(pages, `${people.length} credencial(es)`, 'Imprime en hoja Carta, escala 100 %, sin encabezados ni pies de página. Pega la fotografía en el recuadro y lamina cada credencial.');
}

export function render(root) {
  const school = state.school;
  let kind = 'alumnos', rows = [], selected = new Set();
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Buscar…' });
  const gSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los grados'), ...school.grades.map(g => h('option', { value: g }, `${g}°`)));
  const pSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los grupos'), ...school.groups.map(g => h('option', { value: g }, g)));
  const list = h('div', { class: 'list' }), info = h('div', { class: 'muted' }), tabs = h('div', { class: 'tabs' });
  const btnAll = h('button', { class: 'btn primary' }), btnSel = h('button', { class: 'btn' });
  const filters = h('div', { class: 'filters' });

  const filtered = () => {
    const words = searchKey(q.value).split(' ').filter(Boolean);
    return rows.filter(s => (kind === 'personal' || ((!gSel.value || s.grado === gSel.value) && (!pSel.value || s.grupo === pSel.value))) && words.every(w => searchKey(s.nombre).includes(w)));
  };
  const toSticker = s => ({ nombre: s.nombre, sub: kind === 'alumnos' ? `${s.grado}° ${s.grupo}` : (s.puesto || 'Personal'), token: s.qr_token });
  const draw = () => {
    const f = filtered();
    btnAll.textContent = `Imprimir los ${f.length} del filtro`; btnAll.disabled = !f.length;
    btnSel.textContent = `Imprimir seleccionados (${selected.size})`; btnSel.disabled = !selected.size;
    info.textContent = `${f.length} en el filtro · ${selected.size} seleccionado(s) · ${Math.ceil(f.length / PER_PAGE)} hoja(s) para el filtro`;
    clear(list);
    for (const s of f.slice(0, 120)) list.append(h('label', { class: 'row pick' }, h('input', { type: 'checkbox', checked: selected.has(s.id), onchange: e => { e.target.checked ? selected.add(s.id) : selected.delete(s.id); draw(); } }),
      h('div', { class: 'grow' }, h('b', null, s.nombre), h('small', null, kind === 'alumnos' ? `${s.grado}° ${s.grupo}` : (s.puesto || '')))));
    if (f.length > 120) list.append(h('div', { class: 'muted pad' }, `Se muestran 120 de ${f.length}. Afina el filtro o imprime todo el filtro.`));
  };
  async function load() {
    selected.clear(); clear(list).append(spinner());
    try {
      rows = kind === 'alumnos' ? (await loadStudents(false)) : (await loadPersonal()).filter(p => p.active);
      clear(filters).append(q, ...(kind === 'alumnos' ? [gSel, pSel] : []));
      draw();
    } catch (e) { clear(list).append(h('div', { class: 'empty' }, errMsg(e))); }
  }
  const drawTabs = () => clear(tabs).append(...[['alumnos', 'Alumnos'], ['personal', 'Personal']].map(([k, t]) => h('button', { class: kind === k ? 'on' : '', onclick: () => { kind = k; drawTabs(); load(); } }, t)));
  btnAll.onclick = () => openStickers(filtered().map(toSticker));
  btnSel.onclick = () => openStickers(rows.filter(s => selected.has(s.id)).map(toSticker));
  [q, gSel, pSel].forEach(el => el.addEventListener('input', draw));

  root.append(h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('h2', null, 'QR y credenciales')), tabs,
    h('p', { class: 'muted' }, 'Etiquetas QR de 3 × 3 cm con el nombre debajo, 30 por hoja carta, para pegar en la credencial ya laminada. El QR no lleva datos personales. Si una credencial se pierde, usa "Reposición de QR" en el alumno o la persona: el QR viejo deja de servir.'),
    filters,
    h('div', { class: 'btn-row' }, btnAll, btnSel, h('button', { class: 'btn small', onclick: () => { filtered().forEach(s => selected.add(s.id)); draw(); } }, 'Marcar el filtro'), h('button', { class: 'btn small', onclick: () => { selected.clear(); draw(); } }, 'Quitar marcas'),
      h('button', { class: 'btn', onclick: e => guard(e.currentTarget, () => openCredentials(filtered(), kind)) }, 'Credenciales completas del filtro'),
      h('button', { class: 'btn small', onclick: e => guard(e.currentTarget, () => openCredentials(rows.filter(s => selected.has(s.id)), kind)) }, 'Credenciales de los seleccionados')),
    info, list));
  drawTabs(); load();
}
