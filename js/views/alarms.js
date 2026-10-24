// Alarmas de QR sospechoso del día. Nunca modifican ni borran el registro original: solo se revisan.
import { h, clear, toast, guard, spinner } from '../ui.js';
import { sid } from '../state.js';
import { rpc } from '../api.js';
import { errMsg, fmtTime } from '../logic.js';
import { state } from '../state.js';

export const ALARM_LABEL = {
  OTRO_TELEFONO: 'El mismo QR se leyó en otro teléfono',
  REPETIDO_TARDE: 'El mismo QR se volvió a leer pasado el tiempo de tolerancia',
  QR_REEMPLAZADO: 'Se presentó una credencial reemplazada (QR viejo)',
  QR_NO_RECONOCIDO: 'QR que no pertenece a esta escuela',
};

export const loadAlarms = date => rpc('list_alarms', { p_school: sid(), p_date: date || null });

export function render(root) {
  const date = h('input', { class: 'input', type: 'date' });
  const box = h('div');
  async function load() {
    clear(box).append(spinner());
    try {
      const rows = await loadAlarms(date.value || null);
      const pend = rows.filter(a => a.status === 'PENDIENTE');
      clear(box).append(
        h('p', { class: pend.length ? 'note bad' : 'note ok' }, pend.length ? `${pend.length} alarma(s) sin revisar.` : 'Sin alarmas pendientes.'),
        rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['Hora', 'Persona', 'Qué pasó', 'Escaneó', 'Dispositivo', ''].map(t => h('th', null, t)))),
          h('tbody', null, rows.map(a => h('tr', { class: a.status === 'PENDIENTE' ? 'rowbad' : '' },
            h('td', null, a.scanned_at ? fmtTime(new Date(a.scanned_at), state.school.timezone, true) : ''),
            h('td', null, a.person_name || '—', a.person_type ? h('small', { class: 'muted' }, ` · ${a.person_type === 'ALUMNO' ? 'alumno' : 'personal'}`) : null),
            h('td', null, ALARM_LABEL[a.kind] || a.kind), h('td', null, a.scanned_by_name || ''), h('td', { class: 'small' }, a.device || ''),
            h('td', null, a.status === 'PENDIENTE'
              ? h('button', { class: 'btn small', onclick: ev => guard(ev.currentTarget, async () => { await rpc('review_alarm', { p_id: a.id }); toast('Marcada como revisada', 'ok'); load(); }) }, 'Marcar revisada')
              : h('span', { class: 'badge muted' }, 'Revisada'))))))) : h('div', { class: 'empty' }, 'No hubo alarmas ese día.'));
    } catch (e) { clear(box).append(h('div', { class: 'note bad' }, errMsg(e))); }
  }
  date.addEventListener('change', load);
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Alarmas de QR')),
    h('p', { class: 'muted' }, 'Una alarma no cambia ni borra la entrada ya registrada; solo avisa que algo raro pasó para que lo revises con la persona.'),
    h('div', { class: 'filters wrap' }, h('label', { class: 'field' }, h('span', null, 'Día (vacío = hoy)'), date)), box));
  load();
}
