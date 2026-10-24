// Tutores: consulta (solo administrativo). Se dan de alta junto con el alumno.
import { h, clear, spinner } from '../ui.js';
import { sid } from '../state.js';
import { rpc } from '../api.js';
import { searchKey, errMsg, PARENTESCOS } from '../logic.js';

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
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Tutores'), h('a', { class: 'btn', href: '#/students' }, 'Ir a Alumnos')),
    h('p', { class: 'muted' }, 'Solo consulta. Los tutores se agregan o corrigen desde el alumno (o en el Excel de alumnos).'), h('div', { class: 'filters' }, q), info, list));
  clear(list).append(spinner());
  rpc('list_tutors', { p_school: sid() }).then(r => { rows = r; draw(); }).catch(e => clear(list).append(h('div', { class: 'empty' }, errMsg(e))));
}
