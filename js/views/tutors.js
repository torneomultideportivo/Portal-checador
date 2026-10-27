// Tutores: consulta (solo administrativo). Se dan de alta junto con el alumno.
import { h, clear, spinner, esc, guard, downloadXlsx, slug } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { searchKey, errMsg, PARENTESCOS, parentLists, familias } from '../logic.js';
import { openPrintPages } from '../printing.js';

const FILAS_POR_HOJA = 24;
const longDate = iso => new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));

// Lista de asistencia a reunión de padres de familia: una hoja (o más) por grupo, con el formato de la escuela.
async function printParentLists(tutors, opts) {
  const school = state.school;
  const groups = parentLists(tutors, opts);
  if (!groups.length) throw new Error('No hay alumnos con tutor registrado en esa selección.');
  const assets = await rpc('school_assets', { p_school: sid() });
  const up = t => esc(String(t ?? '').toLocaleUpperCase('es-MX'));
  const logo = (src, side) => src ? `<img class="lp-logo ${side}" src="${src}" alt="">` : `<div class="lp-logo ${side}"></div>`;
  const inst = String(assets.header_line || '').split('\n').map(x => x.trim()).filter(Boolean).map(x => `<div>${up(x)}</div>`).join('');
  const claves = [school.cct, assets.internal_key].filter(Boolean).map(up).join('&nbsp;&nbsp;&nbsp;&nbsp;');
  const pages = [];
  for (const g of groups) {
    const total = Math.ceil(g.alumnos.length / FILAS_POR_HOJA);
    for (let i = 0; i < g.alumnos.length; i += FILAS_POR_HOJA) {
      const chunk = g.alumnos.slice(i, i + FILAS_POR_HOJA);
      const rows = chunk.map(a => `<tr><td>${up(a.nombre)}</td><td class="t">${a.tutores.map(t => `<div>${up(t)}</div>`).join('')}</td><td></td></tr>`).join('')
        + '<tr class="v"><td></td><td></td><td></td></tr>'.repeat(Math.max(0, FILAS_POR_HOJA - chunk.length > 3 ? 3 : FILAS_POR_HOJA - chunk.length));
      pages.push(h('div', { class: 'print-page lp-page', html: `
        <div class="lp-head">${logo(assets.logo_ieepo, 'l')}
          <div class="lp-inst">${inst}<div>${up(school.name)}</div>${claves ? `<div>${claves}</div>` : ''}${assets.place_line ? `<div>${up(assets.place_line)}</div>` : ''}</div>
          ${logo(assets.logo_school, 'r')}</div>
        <div class="lp-titulo"><span>LISTA DE ASISTENCIA A REUNIÓN DE PADRES DE FAMILIA</span><span>${esc(g.grado)}°${esc(g.grupo)}</span></div>
        ${(opts.fecha || opts.hora || opts.asunto) ? `<div class="lp-datos">${[opts.fecha ? `Fecha: ${esc(longDate(opts.fecha))}` : '', opts.hora ? `Hora: ${esc(opts.hora)} h` : '', opts.asunto ? `Asunto: ${esc(opts.asunto)}` : ''].filter(Boolean).join(' · ')}</div>` : ''}
        <table class="lp-tabla"><thead><tr><th>NOMBRE</th><th>TUTOR</th><th>FIRMA</th></tr></thead><tbody>${rows}</tbody></table>
        ${total > 1 ? `<div class="lp-hoja">Hoja ${Math.floor(i / FILAS_POR_HOJA) + 1} de ${total}</div>` : ''}` }));
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
  const go = h('button', { class: 'btn primary' }, 'Imprimir lista');
  go.onclick = () => guard(go, () => printParentLists(rows, { grado: gSel.value, grupo: pSel.value, fecha: fecha.value, hora: hora.value, asunto: asunto.value.trim() }));
  const panel = h('div', { class: 'card', hidden: true }, h('p', { class: 'muted' }, 'Una hoja de asistencia por grupo (24 alumnos por hoja) con el formato de la escuela: nombre, tutor y firma. Fecha, hora y asunto son opcionales: si los dejas vacíos, no se imprimen.'),
    h('div', { class: 'filters' }, gSel, pSel), h('div', { class: 'grid3' }, h('label', { class: 'field' }, h('span', null, 'Fecha de la reunión'), fecha), h('label', { class: 'field' }, h('span', null, 'Hora'), hora), h('label', { class: 'field' }, h('span', null, 'Asunto'), asunto)),
    h('div', { class: 'btn-row' }, go));
  const segA = h('button', { class: 'btn primary', onclick: () => setV('alumno') }, 'Alumno → Tutor'), segF = h('button', { class: 'btn', onclick: () => setV('familia') }, 'Tutor → Hijos');
  const xl = h('button', { class: 'btn' }, 'Descargar Excel'), pr = h('button', { class: 'btn' }, 'Imprimir');
  xl.onclick = () => guard(xl, () => downloadXlsx(`tutores_con_hijos_${slug(state.school.name)}.xlsx`, [{ name: 'Tutores', columns: [{ header: 'Tutor', key: 't', width: 34 }, { header: 'Hijos', key: 'n', width: 7 }, { header: 'Alumno', key: 'a', width: 36 }, { header: 'Grupo', key: 'g', width: 9 }],
    rows: fam().lista.flatMap(t => t.hijos.map((a, i) => ({ t: i ? '' : t.nombre, n: i ? '' : t.hijos.length, a: a.nombre, g: `${a.grado}° ${a.grupo}` }))) }], [state.school.name, 'Tutores con sus hijos']));
  pr.onclick = () => {
    const up = t => esc(String(t ?? '').toLocaleUpperCase('es-MX'));
    const l = fam().lista;
    openPrintPages([h('div', { class: 'print-page', html: `<h3>${up(state.school.name)}</h3><h4>TUTORES CON SUS HIJOS${solo.checked ? ' (2 O MÁS)' : ''}</h4>` + l.map(t => `<div style="break-inside:avoid;margin:0 0 8px"><b>${up(t.nombre)}</b> — ${t.hijos.length} hijo(s)${t.hijos.map(a => `<div style="margin-left:14px">${up(a.nombre)} · ${esc(a.grado)}° ${esc(a.grupo)}</div>`).join('')}</div>`).join('') })], 'Tutores con sus hijos');
  };
  const famBar = h('div', { class: 'filters', hidden: true }, h('label', { class: 'chk' }, solo, ' Solo tutores con 2 o más hijos'), xl, pr);
  function setV(v) { vista = v; segA.className = 'btn' + (v === 'alumno' ? ' primary' : ''); segF.className = 'btn' + (v === 'familia' ? ' primary' : ''); famBar.hidden = v !== 'familia'; draw(); }
  const toggle = h('button', { class: 'btn', onclick: () => { panel.hidden = !panel.hidden; } }, 'Lista de padres de familia');
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Tutores'), segA, segF, toggle, h('a', { class: 'btn', href: '#/students' }, 'Ir a Alumnos')), panel,
    h('p', { class: 'muted' }, 'Solo consulta. Los tutores se agregan o corrigen desde el alumno (o en el Excel de alumnos).'), h('div', { class: 'filters' }, q), famBar, tiles, info, list));
  clear(list).append(spinner());
  rpc('list_tutors', { p_school: sid() }).then(r => { rows = r; draw(); }).catch(e => clear(list).append(h('div', { class: 'empty' }, errMsg(e))));
}
