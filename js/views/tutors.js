// Tutores: consulta (solo administrativo). Se dan de alta junto con el alumno.
import { h, clear, spinner, esc, guard, downloadXlsx, slug } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { searchKey, errMsg, PARENTESCOS, parentLists, familias } from '../logic.js';
import { openPrintPages } from '../printing.js';

const FILAS_POR_HOJA = 24;
const longDate = iso => new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));

const up = t => esc(String(t ?? '').toLocaleUpperCase('es-MX'));
const cmpEs = (x, y) => String(x).localeCompare(String(y), 'es', { numeric: true });

// Encabezado de la escuela (logos, instituto, escuela, claves y lugar): el mismo en las tres hojas
async function headHtml() {
  const school = state.school;
  const assets = await rpc('school_assets', { p_school: sid() });
  const logo = (src, side) => src ? `<img class="lp-logo ${side}" src="${src}" alt="">` : `<div class="lp-logo ${side}"></div>`;
  const inst = String(assets.header_line || '').split('\n').map(x => x.trim()).filter(Boolean).map(x => `<div>${up(x)}</div>`).join('');
  const claves = [school.cct, assets.internal_key].filter(Boolean).map(up).join('&nbsp;&nbsp;&nbsp;&nbsp;');
  return `<div class="lp-head">${logo(assets.logo_ieepo, 'l')}
    <div class="lp-inst">${inst}<div>${up(school.name)}</div>${claves ? `<div>${claves}</div>` : ''}${assets.place_line ? `<div>${up(assets.place_line)}</div>` : ''}</div>
    ${logo(assets.logo_school, 'r')}</div>`;
}
const titulo = (t, der = '') => `<div class="lp-titulo"><span>${t}</span><span>${der}</span></div>`;
const hojaN = (i, total) => total > 1 ? `<div class="lp-hoja">Hoja ${i} de ${total}</div>` : '';

// Reparte filas en hojas según su "peso" (líneas de texto) para que ninguna se corte
function paginar(items, peso, max) {
  const pages = []; let cur = [], w = 0;
  for (const it of items) { const p = peso(it); if (cur.length && w + p > max) { pages.push(cur); cur = []; w = 0; } cur.push(it); w += p; }
  if (cur.length) pages.push(cur);
  return pages;
}

// 1 · Alumno → Tutor
async function printAlumnoTutor(tutors, { grado, grupo }) {
  const groups = parentLists(tutors, { grado, grupo });
  if (!groups.length) throw new Error('No hay alumnos con tutor registrado en esa selección.');
  const head = await headHtml();
  const alumnos = groups.flatMap(g => g.alumnos.map(a => ({ ...a, g: `${g.grado}°${g.grupo}` }))).sort((a, b) => cmpEs(a.nombre, b.nombre));   // alfabético por apellidos y nombre
  const pages = paginar(alumnos, a => Math.max(1, a.tutores.length), 30);
  const der = grado || grupo ? `${esc(grado)}${grado && grupo ? '°' : ''}${esc(grupo)}` : 'TODOS LOS GRUPOS';
  openPrintPages(pages.map((chunk, i) => h('div', { class: 'print-page lp-page', html: `${head}${titulo('ALUMNOS Y SUS TUTORES', der)}
    <table class="lp-tabla lp-at"><thead><tr><th>ALUMNO</th><th>GRUPO</th><th>TUTOR</th></tr></thead><tbody>${chunk.map(a => `<tr><td>${up(a.nombre)}</td><td>${esc(a.g)}</td><td class="t">${a.tutores.map(t => `<div>${up(t)}</div>`).join('')}</td></tr>`).join('')}</tbody></table>${hojaN(i + 1, pages.length)}` })),
    `Alumnos y tutores · ${alumnos.length} alumnos`);
}

// 2 · Tutor → Hijos: tutor, sus hijos agrupados (alumno · grupo) y columna de firma
async function printTutorHijos(tutors, { solo }) {
  const { lista } = familias(tutors, { soloMultiples: solo });
  if (!lista.length) throw new Error(solo ? 'No hay tutores con 2 o más hijos.' : 'No hay tutores registrados.');
  const head = await headHtml();
  const pages = paginar(lista, t => Math.max(1, t.hijos.length), 24);
  openPrintPages(pages.map((chunk, i) => h('div', { class: 'print-page lp-page', html: `${head}${titulo(solo ? 'TUTORES CON 2 O MÁS HIJOS' : 'TUTORES Y SUS HIJOS', `${lista.length} tutor(es)`)}
    <table class="lp-tabla lp-th"><thead><tr><th>TUTOR</th><th>HIJOS (ALUMNO · GRUPO)</th><th>FIRMA</th></tr></thead><tbody>${chunk.map(t => `<tr><td><b>${up(t.nombre)}</b><div class="small">${t.hijos.length} hijo${t.hijos.length > 1 ? 's' : ''}</div></td><td class="t">${t.hijos.map(a => `<div>${up(a.nombre)} · ${esc(a.grado)}°${esc(a.grupo)}</div>`).join('')}</td><td></td></tr>`).join('')}</tbody></table>${hojaN(i + 1, pages.length)}` })),
    `Tutores con sus hijos · ${lista.length}`);
}

// 3 · Lista de asistencia a reunión de padres de familia: una hoja (o más) por grupo
async function printParentLists(tutors, opts) {
  const school = state.school;
  const groups = parentLists(tutors, opts);
  if (!groups.length) throw new Error('No hay alumnos con tutor registrado en esa selección.');
  const head = await headHtml();
  const pages = [];
  for (const g of groups) {
    const total = Math.ceil(g.alumnos.length / FILAS_POR_HOJA);
    for (let i = 0; i < g.alumnos.length; i += FILAS_POR_HOJA) {
      const chunk = g.alumnos.slice(i, i + FILAS_POR_HOJA);
      const rows = chunk.map(a => `<tr><td>${up(a.nombre)}</td><td class="t">${a.tutores.map(t => `<div>${up(t)}</div>`).join('')}</td><td></td></tr>`).join('')
        + '<tr class="v"><td></td><td></td><td></td></tr>'.repeat(Math.max(0, FILAS_POR_HOJA - chunk.length > 3 ? 3 : FILAS_POR_HOJA - chunk.length));
      pages.push(h('div', { class: 'print-page lp-page', html: `${head}${titulo('LISTA DE ASISTENCIA A REUNIÓN DE PADRES DE FAMILIA', `${esc(g.grado)}°${esc(g.grupo)}`)}
        ${(opts.fecha || opts.hora || opts.asunto) ? `<div class="lp-datos">${[opts.fecha ? `Fecha: ${esc(longDate(opts.fecha))}` : '', opts.hora ? `Hora: ${esc(opts.hora)} h` : '', opts.asunto ? `Asunto: ${esc(opts.asunto)}` : ''].filter(Boolean).join(' · ')}</div>` : ''}
        <table class="lp-tabla"><thead><tr><th>NOMBRE</th><th>TUTOR</th><th>FIRMA</th></tr></thead><tbody>${rows}</tbody></table>${hojaN(Math.floor(i / FILAS_POR_HOJA) + 1, total)}` }));
    }
  }
  openPrintPages(pages, `Lista de padres de familia · ${groups.length} grupo(s)`);
}

export function render(root) {
  let rows = [], vista = 'alumno';
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Buscar tutor, CURP o alumno…' });
  const info = h('div', { class: 'muted' });
  const list = h('div', { class: 'table-wrap' });
  const solo = h('input', { type: 'checkbox', checked: true, onchange: () => draw() });
  const tiles = h('div', { class: 'sum-cards' });
  const fam = () => familias(rows, { soloMultiples: solo.checked });
  const drawFam = () => {
    const words = searchKey(q.value).split(' ').filter(Boolean);
    const { lista, resumen } = fam();
    const f = lista.filter(t => words.every(w => searchKey(`${t.nombre} ${t.curp} ${t.hijos.map(a => a.nombre).join(' ')}`).includes(w)));
    clear(tiles).append(...[['Tutores', resumen.total, ''], ['Con 1 hijo', resumen.uno, ''], ['Con 2 o más hijos', resumen.multiples, 'warn']].map(([t, n, c]) => h('div', { class: 'cnt ' + c }, h('b', null, String(n)), h('span', null, t))));
    info.textContent = `${f.length} tutor(es)`;
    clear(list);
    if (!f.length) { list.append(h('div', { class: 'empty' }, rows.length ? 'Sin resultados' : 'Aún no hay tutores.')); return; }
    list.append(...f.slice(0, 300).map(t => h('div', { class: 'card' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '.5rem' } }, h('b', null, t.nombre), h('span', { class: 'badge' }, `${t.hijos.length} hijo${t.hijos.length > 1 ? 's' : ''}`)),
      ...t.hijos.map(a => h('div', { class: 'small' }, `${a.nombre} · ${a.grado}° ${a.grupo} · ${PARENTESCOS[a.parentesco] || 'Tutor(a)'}`)))));
  };
  const draw = () => {
    if (vista === 'familia') { drawFam(); return; }
    clear(tiles);
    const words = searchKey(q.value).split(' ').filter(Boolean);
    const f = rows.filter(t => words.every(w => searchKey(`${t.nombre} ${t.curp || ''} ${(t.hijos || []).map(a => a.nombre).join(' ')}`).includes(w)));
    info.textContent = `${f.length} tutor(es)`;
    clear(list);
    if (!f.length) { list.append(h('div', { class: 'empty' }, rows.length ? 'Sin resultados' : 'Aún no hay tutores. Se registran al importar o dar de alta a los alumnos.')); return; }
    list.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Tutor', 'CURP', 'Hijos en la escuela'].map(t => h('th', null, t)))),
      h('tbody', null, f.slice(0, 400).map(t => h('tr', null, h('td', null, t.nombre), h('td', { class: 'mono' }, t.curp || ''),
        h('td', null, (t.hijos || []).map(a => h('div', { class: 'small' }, `${a.nombre} · ${a.grado}° ${a.grupo} · ${PARENTESCOS[a.parentesco] || 'Tutor(a)'}`))))))));
  };
  q.addEventListener('input', draw);
  const gSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los grados'), state.school.grades.map(g => h('option', { value: g }, `${g}°`)));
  const pSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los grupos'), state.school.groups.map(g => h('option', { value: g }, g)));
  const fecha = h('input', { class: 'input', type: 'date' }), hora = h('input', { class: 'input', type: 'time' });
  const asunto = h('input', { class: 'input', placeholder: 'Asunto de la reunión (opcional)' });
  const solo2 = h('input', { type: 'checkbox', checked: true });
  const OPC = [['1', 'Alumno → Tutor', 'Lista con cada alumno, su grupo y su tutor.'], ['2', 'Tutor → Hijos', 'Cada tutor con sus hijos agrupados y columna de firma.'], ['3', 'Lista de padres de familia', 'Hoja de asistencia con firma, por grupo.']];
  let opc = '1';
  const opcBtns = OPC.map(([k, t, d]) => h('button', { class: 'opt-card', type: 'button', onclick: () => { opc = k; paint(); } }, h('b', null, `${k} · ${t}`), h('span', null, d)));
  const f12 = h('div', { class: 'filters' }, gSel, pSel);
  const f2 = h('div', { class: 'filters' }, h('label', { class: 'chk' }, solo2, ' Solo tutores con 2 o más hijos'));
  const f3 = h('div', { class: 'grid3' }, h('label', { class: 'field' }, h('span', null, 'Fecha de la reunión'), fecha), h('label', { class: 'field' }, h('span', null, 'Hora'), hora), h('label', { class: 'field' }, h('span', null, 'Asunto'), asunto));
  const go = h('button', { class: 'btn primary' }, 'Imprimir / guardar PDF');
  const xl2 = h('button', { class: 'btn' }, 'Descargar Excel');
  function paint() {
    opcBtns.forEach((b, i) => b.classList.toggle('on', OPC[i][0] === opc));
    f12.hidden = opc === '2'; f2.hidden = opc !== '2'; f3.hidden = opc !== '3'; xl2.hidden = opc === '3';
  }
  go.onclick = () => guard(go, () => opc === '1' ? printAlumnoTutor(rows, { grado: gSel.value, grupo: pSel.value })
    : opc === '2' ? printTutorHijos(rows, { solo: solo2.checked })
    : printParentLists(rows, { grado: gSel.value, grupo: pSel.value, fecha: fecha.value, hora: hora.value, asunto: asunto.value.trim() }));
  xl2.onclick = () => guard(xl2, async () => {
    if (opc === '2') {
      await downloadXlsx(`tutores_con_hijos_${slug(state.school.name)}.xlsx`, [{ name: 'Tutores', columns: [{ header: 'Tutor', key: 't', width: 34 }, { header: 'Hijos', key: 'n', width: 7 }, { header: 'Alumno', key: 'a', width: 36 }, { header: 'Grupo', key: 'g', width: 9 }],
        rows: familias(rows, { soloMultiples: solo2.checked }).lista.flatMap(t => t.hijos.map((a, i) => ({ t: i ? '' : t.nombre, n: i ? '' : t.hijos.length, a: a.nombre, g: `${a.grado}° ${a.grupo}` }))) }], [state.school.name, 'Tutores con sus hijos']);
    } else {
      const g = parentLists(rows, { grado: gSel.value, grupo: pSel.value });
      await downloadXlsx(`alumnos_y_tutores_${slug(state.school.name)}.xlsx`, [{ name: 'Alumnos', columns: [{ header: 'Alumno', key: 'a', width: 36 }, { header: 'Grupo', key: 'g', width: 9 }, { header: 'Tutor', key: 't', width: 40 }],
        rows: g.flatMap(x => x.alumnos.map(a => ({ a: a.nombre, g: `${x.grado}° ${x.grupo}`, t: a.tutores.join(' / ') }))) }], [state.school.name, 'Alumnos y sus tutores']);
    }
  });
  const panel = h('div', { class: 'card', hidden: true }, h('div', { class: 'opt-cards' }, ...opcBtns), f12, f2, f3, h('div', { class: 'btn-row' }, go, xl2));
  paint();
  const segA = h('button', { class: 'btn primary', onclick: () => setV('alumno') }, 'Alumno → Tutor'), segF = h('button', { class: 'btn', onclick: () => setV('familia') }, 'Tutor → Hijos');
  const famBar = h('div', { class: 'filters', hidden: true }, h('label', { class: 'chk' }, solo, ' Solo tutores con 2 o más hijos'));
  function setV(v) { vista = v; segA.className = 'btn' + (v === 'alumno' ? ' primary' : ''); segF.className = 'btn' + (v === 'familia' ? ' primary' : ''); famBar.hidden = v !== 'familia'; draw(); }
  const toggle = h('button', { class: 'btn', onclick: () => { panel.hidden = !panel.hidden; } }, 'Imprimir ▾');
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Tutores'), segA, segF, toggle, h('a', { class: 'btn', href: '#/students' }, 'Ir a Alumnos')), panel,
    h('p', { class: 'muted' }, 'Solo consulta. Los tutores se agregan o corrigen desde el alumno (o en el Excel de alumnos).'), h('div', { class: 'filters' }, q), famBar, tiles, info, list));
  clear(list).append(spinner());
  rpc('list_tutors', { p_school: sid() }).then(r => { rows = r; draw(); }).catch(e => clear(list).append(h('div', { class: 'empty' }, errMsg(e))));
}
