// Retardos y faltas de un periodo, con aviso de a quién conviene citar.
import { h, clear, spinner, downloadXlsx, guard } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { errMsg, addDays, fmtDate } from '../logic.js';
import { printScreen } from '../printing.js';

const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: state.school?.timezone || 'America/Mexico_City' }).format(new Date());

export function render(root) {
  const school = state.school, hoy = todayLocal();
  const from = h('input', { class: 'input', type: 'date', value: addDays(hoy, -30) });
  const to = h('input', { class: 'input', type: 'date', value: hoy });
  const box = h('div');
  let data = null;
  async function load() {
    clear(box).append(spinner());
    try {
      data = await rpc('citation_suggestions', { p_school: sid(), p_from: from.value, p_to: to.value });
      const flag = a => a.retardos >= school.citation_late_min || a.faltas >= school.citation_absent_min;
      clear(box).append(h('p', { class: 'muted' }, `${data.dias_con_clase} día(s) con clase en el periodo · ${data.alumnos.filter(flag).length} alumno(s) para citar (${school.citation_late_min}+ retardos o ${school.citation_absent_min}+ faltas).`),
        h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/citatorios' }, 'Ir a Citatorios'),
          h('button', { class: 'btn', onclick: ev => guard(ev.currentTarget, () => printScreen(box, 'Retardos y faltas', `${fmtDate(from.value)} al ${fmtDate(to.value)}`)) }, 'Imprimir'),
          h('button', { class: 'btn', onclick: () => downloadXlsx('retardos_y_faltas.xlsx', [{ name: 'Retardos y faltas', columns: [{ header: 'ALUMNO', key: 'nombre', width: 44 }, { header: 'GRADO', key: 'grado' }, { header: 'GRUPO', key: 'grupo' }, { header: 'RETARDOS', key: 'retardos' }, { header: 'FALTAS', key: 'faltas' }], rows: data.alumnos }], [school.name, `Retardos y faltas del ${data.desde} al ${data.hasta}`]) }, 'Descargar Excel')),
        data.alumnos.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['Alumno', 'Grupo', 'Retardos', 'Faltas'].map(t => h('th', null, t)))),
          h('tbody', null, data.alumnos.slice(0, 2000).map(a => h('tr', { class: flag(a) ? 'rowwarn' : '' }, h('td', null, a.nombre), h('td', null, `${a.grado}° ${a.grupo}`), h('td', null, a.retardos), h('td', null, a.faltas)))))) : h('div', { class: 'empty' }, 'Sin retardos ni faltas en el periodo.'));
    } catch (e) { clear(box).append(h('div', { class: 'note bad' }, errMsg(e))); }
  }
  from.addEventListener('change', load); to.addEventListener('change', load);
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Retardos y faltas')),
    h('div', { class: 'filters wrap' }, h('label', { class: 'field' }, h('span', null, 'Del'), from), h('label', { class: 'field' }, h('span', null, 'Al'), to)), box));
  load();
}
