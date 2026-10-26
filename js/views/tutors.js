// Tutores: consulta (solo administrativo). Se dan de alta junto con el alumno.
import { h, clear, spinner, esc, guard } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { searchKey, errMsg, PARENTESCOS, parentLists } from '../logic.js';
import { openPrintPages } from '../printing.js';

const FILAS_POR_HOJA = 22;
const longDate = iso => new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));

// Lista de asistencia de padres de familia: una o más hojas por grupo, con renglón de firma por alumno.
async function printParentLists(tutors, opts) {
  const school = state.school;
  const groups = parentLists(tutors, opts);
  if (!groups.length) throw new Error('No hay alumnos con tutor registrado en esa selección.');
  const assets = await rpc('school_assets', { p_school: sid() });
  const up = t => esc(String(t ?? '').toLocaleUpperCase('es-MX'));
  const logo = (src, side) => src ? `<img class="ct-logo ${side}" src="${src}" alt="">` : `<div class="ct-logo ${side}"></div>`;
  const pages = [];
  for (const g of groups) {
    for (let i = 0; i < g.alumnos.length; i += FILAS_POR_HOJA) {
      const chunk = g.alumnos.slice(i, i + FILAS_POR_HOJA);
      const rows = chunk.map((a, k) => `<tr><td class="n">${i + k + 1}</td><td>${up(a.nombre)}</td><td>${up(a.tutores.join(' / '))}</td><td class="f"></td></tr>`).join('');
      pages.push(h('div', { class: 'print-page lp-page', html: `
        <div class="ct-head">${logo(assets.logo_ieepo, 'l')}
          <div class="ct-title">${assets.header_line ? `<div>${up(assets.header_line)}</div>` : ''}<b>${up(school.name)}</b>${school.cct ? `<div>CCT. ${up(school.cct)}</div>` : ''}</div>
          ${logo(assets.logo_school, 'r')}</div>
        <div class="lp-titulo">LISTA DE ASISTENCIA · PADRES DE FAMILIA</div>
        <div class="lp-datos"><span><b>Grado y grupo:</b> ${esc(g.grado)}° ${esc(g.grupo)}</span><span><b>Fecha:</b> ${opts.fecha ? esc(longDate(opts.fecha)) : '____________________'}</span>${opts.hora ? `<span><b>Hora:</b> ${esc(opts.hora)} h</span>` : ''}</div>
        <div class="lp-datos"><span><b>Asunto:</b> ${opts.asunto ? esc(opts.asunto) : '______________________________________________'}</span></div>
        <table class="lp-tabla"><thead><tr><th>N.º</th><th>Alumno(a)</th><th>Padre, madre o tutor</th><th>Firma</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="lp-pie">${school.director ? `<span></span><b>${up(school.director)}</b><small>${up(assets.director_title || 'DIRECTOR(A) DE LA ESCUELA')}</small>` : ''}</div>
        <div class="lp-hoja">Hoja ${Math.floor(i / FILAS_POR_HOJA) + 1} de ${Math.ceil(g.alumnos.length / FILAS_POR_HOJA)} · ${esc(g.grado)}° ${esc(g.grupo)}</div>` }));
    }
  }
  openPrintPages(pages, `Lista de padres de familia · ${groups.length} grupo(s)`);
}

export function render(root) {
  let rows = [];
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Buscar tutor, CURP o alumno…' });
  const info = h('div', { class: 'muted' });
  const list = h('div', { class: 'table-wrap' });
  const draw = () => {
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
  const panel = h('div', { class: 'card', hidden: true }, h('p', { class: 'muted' }, 'Una hoja de asistencia por grupo (22 alumnos por hoja), con renglón de firma para cada padre, madre o tutor. Fecha, hora y asunto son opcionales: si los dejas vacíos, se escriben a mano.'),
    h('div', { class: 'filters' }, gSel, pSel), h('div', { class: 'grid3' }, h('label', { class: 'field' }, h('span', null, 'Fecha de la reunión'), fecha), h('label', { class: 'field' }, h('span', null, 'Hora'), hora), h('label', { class: 'field' }, h('span', null, 'Asunto'), asunto)),
    h('div', { class: 'btn-row' }, go));
  const toggle = h('button', { class: 'btn', onclick: () => { panel.hidden = !panel.hidden; } }, 'Lista de padres de familia');
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Tutores'), toggle, h('a', { class: 'btn', href: '#/students' }, 'Ir a Alumnos')), panel,
    h('p', { class: 'muted' }, 'Solo consulta. Los tutores se agregan o corrigen desde el alumno (o en el Excel de alumnos).'), h('div', { class: 'filters' }, q), info, list));
  clear(list).append(spinner());
  rpc('list_tutors', { p_school: sid() }).then(r => { rows = r; draw(); }).catch(e => clear(list).append(h('div', { class: 'empty' }, errMsg(e))));
}
