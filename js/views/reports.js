// Reportes: resumen del día, historial, por alumno y "quién estuvo en la puerta".
import { h, clear, toast, guard, spinner, badge, downloadXlsx, slug } from '../ui.js';
import { state, sid } from '../state.js';
import { sb, rpc, fetchAll } from '../api.js';
import { fmtTime, fmtDate, todayLocal, addDays, errMsg, searchKey, cmpStudent } from '../logic.js';
import { loadStudents } from './students.js';

const stLabel = s => (s === 'PUNTUAL' ? 'Puntual' : 'Retardo');
const titleLines = (school, title, range) => [school.name, [school.cct && `CCT ${school.cct}`, school.school_year].filter(Boolean).join(' · '), title, range].filter(Boolean);
const card = (cls, n, t) => h('div', { class: 'cnt ' + cls }, h('b', null, n), h('span', null, t));
const table = (cols, rows, max = 300) => h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
  h('thead', null, h('tr', null, cols.map(c => h('th', null, c[0])))),
  h('tbody', null, rows.slice(0, max).map(r => h('tr', null, cols.map(c => h('td', { class: c[2] || '' }, c[1](r))))))),
  rows.length > max ? h('p', { class: 'muted pad' }, `Se muestran ${max} de ${rows.length}. El Excel incluye todo.`) : null);
const dateInput = v => h('input', { class: 'input', type: 'date', value: v });

export function render(root) {
  const school = state.school, tz = school.timezone;
  const today = todayLocal(tz);
  let tab = 'dia';
  const tabs = h('div', { class: 'tabs' });
  const body = h('div');
  const TABS = [['dia', 'Resumen del día'], ['hist', 'Historial'], ['alumno', 'Por alumno'], ['puerta', 'Quién estuvo en la puerta']];

  const drawTabs = () => clear(tabs).append(...TABS.map(([k, t]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; go(); } }, t)));
  const go = () => { drawTabs(); clear(body); ({ dia, hist, alumno, puerta }[tab])(body); };

  // ---------------- Resumen del día ----------------
  function dia(box) {
    const date = dateInput(today);
    const out = h('div');
    const load = async () => {
      clear(out).append(spinner());
      try {
        const [sum, pend, ret] = await Promise.all([
          rpc('day_summary', { p_school: sid(), p_date: date.value }),
          rpc('pending_students', { p_school: sid(), p_date: date.value }),
          fetchAll(() => sb.from('attendance').select('scanned_at,late_minutes,recorded_by_name,students!inner(nombre,grado,grupo)').eq('school_id', sid()).eq('fecha', date.value).eq('status', 'RETARDO').order('scanned_at').order('id')),
        ]);
        const btn = h('button', { class: 'btn' }, 'Descargar Excel');
        btn.onclick = () => guard(btn, () => downloadXlsx(`resumen_${date.value}_${slug(school.name)}.xlsx`, [
          { name: 'Por grupo', columns: [{ header: 'Grado', key: 'grado' }, { header: 'Grupo', key: 'grupo' }, { header: 'Alumnos', key: 'total' }, { header: 'Ingresaron', key: 'presentes' }, { header: 'Puntuales', key: 'puntuales' }, { header: 'Retardos', key: 'retardos' }, { header: 'Pendientes', key: 'pendientes' }],
            rows: [...sum.por_grupo, { grado: 'TOTAL', grupo: '', total: sum.total, presentes: sum.presentes, puntuales: sum.puntuales, retardos: sum.retardos, pendientes: sum.pendientes }] },
          { name: 'Retardos', columns: [{ header: 'Hora', key: 'hora' }, { header: 'Alumno', key: 'n', width: 44 }, { header: 'Grado', key: 'g' }, { header: 'Grupo', key: 'p' }, { header: 'Minutos de retardo', key: 'm' }, { header: 'Registró', key: 'by', width: 28 }],
            rows: ret.map(r => ({ hora: fmtTime(r.scanned_at, tz, true), n: r.students.nombre, g: r.students.grado, p: r.students.grupo, m: r.late_minutes, by: r.recorded_by_name })) },
          { name: 'Pendientes', columns: [{ header: 'Alumno', key: 'nombre', width: 44 }, { header: 'Grado', key: 'grado' }, { header: 'Grupo', key: 'grupo' }], rows: pend },
        ], titleLines(school, 'Resumen de asistencia del día', fmtDate(date.value))));
        clear(out).append(
          h('div', { class: 'sum-cards' }, card('', sum.total, 'Alumnos'), card('', sum.presentes, 'Ingresaron'), card('ok', sum.puntuales, 'Puntuales'), card('warn', sum.retardos, 'Retardos'), card('muted', sum.pendientes, 'Sin registro')),
          h('div', { class: 'btn-row' }, btn),
          h('h3', null, 'Por grupo'),
          table([['Grupo', r => `${r.grado}° ${r.grupo}`], ['Alumnos', r => r.total], ['Ingresaron', r => r.presentes], ['Puntuales', r => r.puntuales], ['Retardos', r => r.retardos], ['Sin registro', r => r.pendientes]], sum.por_grupo),
          h('h3', null, `Retardos (${ret.length})`),
          ret.length ? table([['Hora', r => fmtTime(r.scanned_at, tz, true)], ['Alumno', r => r.students.nombre], ['Grupo', r => `${r.students.grado}° ${r.students.grupo}`], ['Min.', r => '+' + r.late_minutes]], ret) : h('p', { class: 'muted' }, 'Sin retardos.'),
          h('h3', null, `Sin registro de entrada (${pend.length})`),
          pend.length ? table([['Alumno', r => r.nombre], ['Grupo', r => `${r.grado}° ${r.grupo}`]], pend) : h('p', { class: 'muted' }, 'Todos registraron entrada.'));
      } catch (e) { clear(out).append(h('div', { class: 'note bad' }, errMsg(e))); }
    };
    date.addEventListener('change', load);
    box.append(h('div', { class: 'filters' }, h('label', { class: 'field inline' }, h('span', null, 'Fecha'), date)), out);
    load();
  }

  // ---------------- Historial ----------------
  function hist(box) {
    const from = dateInput(addDays(today, -6)), to = dateInput(today);
    const gSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los grados'), ...school.grades.map(g => h('option', { value: g }, `${g}°`)));
    const pSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los grupos'), ...school.groups.map(g => h('option', { value: g }, g)));
    const eSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los estados'), h('option', { value: 'PUNTUAL' }, 'Puntuales'), h('option', { value: 'RETARDO' }, 'Retardos'));
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Nombre del alumno…' });
    const out = h('div');
    const go2 = h('button', { class: 'btn primary' }, 'Consultar');
    go2.onclick = () => guard(go2, async () => {
      clear(out).append(spinner());
      let rows = await fetchAll(() => {
        let qy = sb.from('attendance').select('fecha,scanned_at,status,late_minutes,method,recorded_by_name,offline,students!inner(nombre,grado,grupo,genero)')
          .eq('school_id', sid()).gte('fecha', from.value).lte('fecha', to.value);
        if (gSel.value) qy = qy.eq('students.grado', gSel.value);
        if (pSel.value) qy = qy.eq('students.grupo', pSel.value);
        if (eSel.value) qy = qy.eq('status', eSel.value);
        return qy.order('fecha').order('scanned_at').order('id');
      });
      const words = searchKey(q.value).split(' ').filter(Boolean);
      if (words.length) rows = rows.filter(r => words.every(w => searchKey(r.students.nombre).includes(w)));
      const ret = rows.filter(r => r.status === 'RETARDO').length;
      const xl = h('button', { class: 'btn' }, 'Descargar Excel');
      xl.onclick = () => guard(xl, () => downloadXlsx(`historial_${from.value}_a_${to.value}.xlsx`, [{
        name: 'Asistencia', columns: [{ header: 'Fecha', key: 'f', width: 12 }, { header: 'Hora', key: 'h', width: 10 }, { header: 'Alumno', key: 'n', width: 44 }, { header: 'Grado', key: 'g', width: 8 }, { header: 'Grupo', key: 'p', width: 8 }, { header: 'Género', key: 'ge', width: 8 },
          { header: 'Estado', key: 's', width: 11 }, { header: 'Min. retardo', key: 'm', width: 12 }, { header: 'Método', key: 'me', width: 10 }, { header: 'Registró', key: 'by', width: 28 }, { header: 'Sin conexión', key: 'o', width: 12 }],
        rows: rows.map(r => ({ f: fmtDate(r.fecha), h: fmtTime(r.scanned_at, tz, true), n: r.students.nombre, g: r.students.grado, p: r.students.grupo, ge: r.students.genero || '', s: stLabel(r.status), m: r.late_minutes, me: r.method === 'QR' ? 'QR' : 'Manual', by: r.recorded_by_name, o: r.offline ? 'Sí' : '' })),
      }], titleLines(school, 'Historial de asistencia', `${fmtDate(from.value)} al ${fmtDate(to.value)}`)));
      clear(out).append(h('div', { class: 'sum-cards' }, card('', rows.length, 'Registros'), card('ok', rows.length - ret, 'Puntuales'), card('warn', ret, 'Retardos')), h('div', { class: 'btn-row' }, xl),
        rows.length ? table([['Fecha', r => fmtDate(r.fecha)], ['Hora', r => fmtTime(r.scanned_at, tz)], ['Alumno', r => r.students.nombre], ['Grupo', r => `${r.students.grado}° ${r.students.grupo}`], ['Estado', r => badge(r.status)], ['Registró', r => r.recorded_by_name]], rows)
          : h('div', { class: 'empty' }, 'Sin registros con esos filtros.'));
    });
    box.append(h('div', { class: 'filters wrap' }, h('label', { class: 'field inline' }, h('span', null, 'Del'), from), h('label', { class: 'field inline' }, h('span', null, 'Al'), to), gSel, pSel, eSel, q, go2), out);
  }

  // ---------------- Por alumno ----------------
  function alumno(box) {
    const from = dateInput(today.slice(0, 8) + '01'), to = dateInput(today);
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Escribe el nombre del alumno…' });
    const pick = h('div', { class: 'list pick-list' });
    const out = h('div');
    let students = [], chosen = null;
    const drawPick = () => {
      clear(pick);
      const words = searchKey(q.value).split(' ').filter(Boolean);
      if (!words.length) return;
      students.filter(s => words.every(w => searchKey(s.nombre).includes(w))).slice(0, 8).forEach(s =>
        pick.append(h('button', { class: 'row-btn', onclick: () => { chosen = s; q.value = s.nombre; clear(pick); load(); } }, h('div', null, h('b', null, s.nombre), h('small', null, `${s.grado}° ${s.grupo}`)))));
    };
    const load = async () => {
      if (!chosen) return;
      clear(out).append(spinner());
      try {
        const r = await rpc('student_history', { p_school: sid(), p_student: chosen.id, p_from: from.value, p_to: to.value });
        const xl = h('button', { class: 'btn' }, 'Descargar Excel');
        xl.onclick = () => guard(xl, () => downloadXlsx(`alumno_${slug(chosen.nombre)}.xlsx`, [{
          name: 'Registros', columns: [{ header: 'Fecha', key: 'f', width: 12 }, { header: 'Hora', key: 'h', width: 10 }, { header: 'Estado', key: 's', width: 11 }, { header: 'Min. retardo', key: 'm', width: 12 }, { header: 'Método', key: 'me', width: 10 }, { header: 'Registró', key: 'by', width: 28 }],
          rows: r.registros.map(x => ({ f: fmtDate(x.fecha), h: fmtTime(x.scanned_at, tz, true), s: stLabel(x.status), m: x.late_minutes, me: x.method === 'QR' ? 'QR' : 'Manual', by: x.by })) }],
        titleLines(school, `Asistencia de ${chosen.nombre} (${chosen.grado}° ${chosen.grupo})`, `${fmtDate(from.value)} al ${fmtDate(to.value)} · Faltas = días con clase sin registro de entrada`)));
        clear(out).append(h('div', { class: 'sum-cards' }, card('', r.dias_con_clase, 'Días con clase'), card('', r.asistencias, 'Asistencias'), card('ok', r.puntuales, 'Puntuales'), card('warn', r.retardos, 'Retardos'), card('bad', r.faltas, 'Faltas')),
          h('p', { class: 'muted' }, '"Días con clase" son los días en que la escuela registró al menos una entrada.'), h('div', { class: 'btn-row' }, xl),
          r.registros.length ? table([['Fecha', x => fmtDate(x.fecha)], ['Hora', x => fmtTime(x.scanned_at, tz)], ['Estado', x => badge(x.status)], ['Min.', x => x.late_minutes ? '+' + x.late_minutes : ''], ['Registró', x => x.by]], r.registros) : h('div', { class: 'empty' }, 'Sin registros en el periodo.'));
      } catch (e) { clear(out).append(h('div', { class: 'note bad' }, errMsg(e))); }
    };
    q.addEventListener('input', () => { chosen = null; drawPick(); });
    [from, to].forEach(i => i.addEventListener('change', load));
    box.append(h('div', { class: 'filters wrap' }, q, h('label', { class: 'field inline' }, h('span', null, 'Del'), from), h('label', { class: 'field inline' }, h('span', null, 'Al'), to)), pick, out);
    loadStudents(true).then(r => { students = r; });
  }

  // ---------------- Puerta ----------------
  function puerta(box) {
    const from = dateInput(addDays(today, -6)), to = dateInput(today);
    const out = h('div');
    const load = async () => {
      clear(out).append(spinner());
      try {
        const rows = await rpc('door_report', { p_school: sid(), p_from: from.value, p_to: to.value });
        const xl = h('button', { class: 'btn' }, 'Descargar Excel');
        xl.onclick = () => guard(xl, () => downloadXlsx(`puerta_${from.value}_a_${to.value}.xlsx`, [{
          name: 'Puerta', columns: [{ header: 'Fecha', key: 'f', width: 12 }, { header: 'Persona', key: 'u', width: 32 }, { header: 'Alumnos registrados', key: 't', width: 18 }, { header: 'Puntuales', key: 'p', width: 11 }, { header: 'Retardos', key: 'r', width: 10 }, { header: 'Manuales', key: 'm', width: 10 }, { header: 'Sin conexión', key: 'o', width: 12 }, { header: 'Primer registro', key: 'a', width: 14 }, { header: 'Último registro', key: 'b', width: 14 }],
          rows: rows.map(r => ({ f: fmtDate(r.fecha), u: r.user_name, t: r.total, p: r.puntuales, r: r.retardos, m: r.manuales, o: r.sin_conexion, a: fmtTime(r.primero, tz, true), b: fmtTime(r.ultimo, tz, true) })) }],
        titleLines(school, '¿Quién estuvo en la puerta?', `${fmtDate(from.value)} al ${fmtDate(to.value)}`)));
        clear(out).append(h('div', { class: 'btn-row' }, xl), rows.length ? table([['Fecha', r => fmtDate(r.fecha)], ['Persona', r => r.user_name], ['Registró', r => r.total], ['Puntuales', r => r.puntuales], ['Retardos', r => r.retardos], ['Manuales', r => r.manuales], ['Sin conexión', r => r.sin_conexion], ['De', r => fmtTime(r.primero, tz)], ['A', r => fmtTime(r.ultimo, tz)]], rows) : h('div', { class: 'empty' }, 'Sin registros en el periodo.'));
      } catch (e) { clear(out).append(h('div', { class: 'note bad' }, errMsg(e))); }
    };
    [from, to].forEach(i => i.addEventListener('change', load));
    box.append(h('div', { class: 'filters wrap' }, h('label', { class: 'field inline' }, h('span', null, 'Del'), from), h('label', { class: 'field inline' }, h('span', null, 'Al'), to)),
      h('p', { class: 'muted' }, 'Cada entrada guarda quién escaneó, a qué hora y desde qué dispositivo.'), out);
    load();
  }

  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Reportes')), tabs, body));
  go();
}
