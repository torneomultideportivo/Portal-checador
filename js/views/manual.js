// Registro manual (respaldo): buscar al alumno por nombre.
import { h, clear, toast, confirmBox } from '../ui.js';
import { state, on } from '../state.js';
import { registerScan } from '../sync.js';
import { searchKey, fmtTime, errMsg } from '../logic.js';
import { counterBar } from './scan.js';

export function render(root) {
  const school = state.school;
  const bar = counterBar();
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Buscar por nombre o apellido…', autocomplete: 'off' });
  const gSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los grados'), ...school.grades.map(g => h('option', { value: g }, `${g}°`)));
  const pSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los grupos'), ...school.groups.map(g => h('option', { value: g }, g)));
  const list = h('div', { class: 'list' });
  let shown = 60;

  const draw = () => {
    const words = searchKey(q.value).split(' ').filter(Boolean);
    let rows = state.roster.filter(s => (!gSel.value || s.grado === gSel.value) && (!pSel.value || s.grupo === pSel.value) &&
      words.every(w => searchKey(s.nombre).includes(w)));
    // primero quienes aún no llegan
    rows = [...rows.filter(s => !state.today.has(s.id)), ...rows.filter(s => state.today.has(s.id))];
    clear(list);
    if (!state.roster.length) { list.append(h('div', { class: 'empty' }, 'No hay alumnos cargados en este celular. Conéctate a internet para descargar la lista.')); return; }
    if (!rows.length) { list.append(h('div', { class: 'empty' }, 'Sin resultados')); return; }
    for (const s of rows.slice(0, shown)) {
      const r = state.today.get(s.id);
      list.append(h('button', { class: 'row-btn' + (r ? ' done' : ''), disabled: !!r, onclick: () => pick(s) },
        h('div', null, h('b', null, s.nombre), h('small', null, `${s.grado}° ${s.grupo}`)),
        r ? h('span', { class: 'badge ' + (r.status === 'PUNTUAL' ? 'ok' : 'warn') }, `${fmtTime(r.scanned_at, school.timezone)} · ${r.status === 'PUNTUAL' ? 'Puntual' : 'Retardo'}`)
          : h('span', { class: 'badge muted' }, 'Registrar')));
    }
    if (rows.length > shown) list.append(h('button', { class: 'btn block', onclick: () => { shown += 60; draw(); } }, `Mostrar más (${rows.length - shown})`));
  };

  async function pick(s) {
    if (!(await confirmBox(`¿Registrar la entrada de\n${s.nombre} (${s.grado}° ${s.grupo}) ahora?`, { ok: 'Registrar', title: 'Registro manual' }))) return;
    try {
      const res = await registerScan({ student_id: s.id, method: 'MANUAL' });
      if (res.kind === 'REGISTRADO') toast(`${s.nombre}: ${res.record.status === 'PUNTUAL' ? 'puntual' : 'retardo'}`, res.record.status === 'PUNTUAL' ? 'ok' : 'warn');
      else toast('Ya estaba registrado', 'info');
    } catch (e) { toast(errMsg(e), 'error'); }
    draw();
  }

  [q, gSel, pSel].forEach(el => el.addEventListener('input', () => { shown = 60; draw(); }));
  const off = on('changed', () => { bar.draw(); draw(); });
  root.append(h('section', { class: 'view' }, bar.el, h('div', { class: 'filters' }, q, gSel, pSel), list));
  draw();
  return off;
}
