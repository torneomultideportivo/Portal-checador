// Bitácora: quién hizo qué y cuándo.
import { h, clear, spinner } from '../ui.js';
import { state, sid } from '../state.js';
import { sb } from '../api.js';
import { errMsg, fmtDate, fmtTime } from '../logic.js';

const NAMES = {
  ESCUELA_CREADA: 'Escuela creada', AJUSTES_ACTUALIZADOS: 'Ajustes actualizados', ALUMNO_CREADO: 'Alumno creado', ALUMNO_ACTUALIZADO: 'Alumno actualizado',
  IMPORTACION_ALUMNOS: 'Importación de alumnos', QR_REGENERADO: 'QR regenerado', ASISTENCIA_MANUAL: 'Entrada registrada manualmente',
  ASISTENCIA_ELIMINADA: 'Registro de entrada eliminado', ASISTENCIA_REEMPLAZADA_POR_MAS_TEMPRANA: 'Entrada reemplazada por una más temprana (sincronización)',
  ADMINISTRATIVO_ACTIVADO: 'Administrativo activado', PREFECTO_ACTIVADO: 'Prefecto activado', PREFECTO_BAJA: 'Prefecto dado de baja', PREFECTO_REACTIVADO: 'Prefecto reactivado',
  RELEVO_ADMINISTRATIVO: 'Relevo de administrativo', CODIGO_ADMIN_GENERADO: 'Código de administrativo generado', CODIGO_PERSONAL_GENERADO: 'Código de personal generado',
  ESCUELA_ACTIVADA: 'Escuela activada', ESCUELA_DESACTIVADA: 'Escuela desactivada',
};
const LABEL = { alumno: 'Alumno', fecha: 'Fecha', hora: 'Hora', registrado_por: 'Registró', motivo: 'Motivo', nuevos: 'Nuevos', actualizados: 'Actualizados', errores: 'Errores', nombre: 'Nombre', email: 'Correo', nuevo_admin: 'Nuevo administrativo', nuevo_email: 'Correo nuevo', vence: 'Vence', name: 'Escuela', campos: 'Campos' };

export function render(root) {
  const school = state.school;
  const list = h('div', { class: 'list' });
  const sel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todas las acciones'));
  let rows = [];
  const fmtVal = (k, v) => {
    if (v === null || v === undefined || v === '') return null;
    if (k === 'hora' || k === 'vence') return `${fmtDate(String(v).slice(0, 10))} ${fmtTime(v, school.timezone, true)}`;
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  };
  const draw = () => {
    clear(list);
    const f = rows.filter(r => !sel.value || r.action === sel.value);
    if (!f.length) list.append(h('div', { class: 'empty' }, 'Sin movimientos'));
    for (const r of f) {
      const det = Object.entries(r.detail || {}).map(([k, v]) => [LABEL[k] || k, fmtVal(k, v)]).filter(([, v]) => v);
      list.append(h('div', { class: 'row top' },
        h('div', { class: 'time' }, h('b', null, fmtTime(r.created_at, school.timezone)), h('small', null, fmtDate(r.created_at.slice(0, 10)))),
        h('div', { class: 'grow' }, h('b', null, NAMES[r.action] || r.action), h('small', null, `por ${r.user_name || 'sistema'}`),
          det.length ? h('div', { class: 'detail' }, det.map(([k, v]) => h('span', null, h('em', null, k + ': '), v))) : null)));
    }
  };
  sel.addEventListener('input', draw);
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Bitácora')), h('div', { class: 'filters' }, sel), list));
  clear(list).append(spinner());
  sb.from('audit_log').select('id,created_at,user_name,action,detail').eq('school_id', sid()).order('created_at', { ascending: false }).limit(400)
    .then(({ data, error }) => {
      if (error) { clear(list).append(h('div', { class: 'empty' }, errMsg(error))); return; }
      rows = data;
      [...new Set(rows.map(r => r.action))].sort().forEach(a => sel.append(h('option', { value: a }, NAMES[a] || a)));
      draw();
    });
}
