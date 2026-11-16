// Retiros del día (administrativo): revisar contra los documentos en papel, corregir o cancelar.
import { h, clear, spinner, toast, modal, guard, esc } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { fmtTime, fmtDate, errMsg } from '../logic.js';
import { printScreen } from '../printing.js';
import { MOTIVOS, motivoTxt } from './retiro.js';

const hoyLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: state.school?.timezone || 'America/Mexico_City' }).format(new Date());

export function render(root) {
  const tz = state.school.timezone;
  const date = h('input', { class: 'input', type: 'date', value: hoyLocal() });
  const box = h('div');
  let data = null;

  async function load() {
    clear(box).append(spinner());
    try {
      data = await rpc('list_early_exits', { p_school: sid(), p_date: date.value || null });
      draw();
    } catch (e) { clear(box).append(h('div', { class: 'note bad' }, errMsg(e))); }
  }

  function draw() {
    const vivos = data.retiros.filter(r => !r.cancelled_at);
    const porMotivo = MOTIVOS.map(([k, t]) => [t, vivos.filter(r => r.categoria === k).length]).filter(x => x[1]);
    clear(box).append(
      h('div', { class: 'sum-cards' },
        h('div', { class: 'cnt' }, h('b', null, vivos.length), h('span', null, 'Retiros')),
        ...porMotivo.map(([t, n]) => h('div', { class: 'cnt muted' }, h('b', null, n), h('span', null, t)))),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: ev => guard(ev.currentTarget, () => printScreen(box, 'Retiros del día', fmtDate(data.fecha))) }, 'Imprimir')),
      data.retiros.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Hora', 'Alumno', 'Grupo', 'Motivo', 'Recogió', 'Registró', ''].map(t => h('th', null, t)))),
        h('tbody', null, data.retiros.map(r => h('tr', { class: r.cancelled_at ? 'rowcancel' : '' },
          h('td', null, fmtTime(r.exit_at, tz)),
          h('td', null, r.nombre, r.cancelled_at ? h('div', { class: 'small' }, `CANCELADO por ${r.cancelled_by}: ${r.cancel_reason}`) : (r.edited_at ? h('div', { class: 'small' }, `Corregido por ${r.edited_by}`) : null)),
          h('td', null, `${r.grado}° ${r.grupo}`), h('td', null, motivoTxt(r.categoria)), h('td', null, r.recogio || ''), h('td', null, r.by),
          h('td', { class: 'no-print' }, r.cancelled_at ? null : h('div', { class: 'btn-row' },
            h('button', { class: 'btn small', onclick: () => edit(r) }, 'Corregir'),
            h('button', { class: 'btn small danger', onclick: () => cancel(r) }, 'Cancelar')))))))
      ) : h('div', { class: 'empty' }, 'No hay retiros registrados ese día.'));
  }

  function edit(r) {
    const sel = h('select', { class: 'input' }, ...MOTIVOS.map(([k, t]) => h('option', { value: k, selected: k === r.categoria }, t)));
    const hora = h('input', { class: 'input', type: 'time', value: fmtTime(r.exit_at, tz) });
    const rec = h('input', { class: 'input', maxLength: 80, value: r.recogio || '', placeholder: 'Quién recogió (opcional)' });
    const save = h('button', { class: 'btn primary' }, 'Guardar');
    const m = modal({ title: `Corregir retiro · ${r.nombre}`, body: h('div', { class: 'form' },
        h('label', { class: 'field' }, h('span', null, 'Motivo'), sel), h('label', { class: 'field' }, h('span', null, 'Hora del retiro'), hora),
        h('label', { class: 'field' }, h('span', null, 'Quién recogió'), rec),
        h('p', { class: 'muted small' }, `Su entrada fue a las ${r.entrada ? fmtTime(r.entrada, tz) : '—'}: la hora del retiro no puede ser anterior.`)),
      actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), save] });
    save.onclick = () => guard(save, async () => {
      try { await rpc('edit_early_exit', { p_id: r.id, p: { categoria: sel.value, hora: hora.value, recogio: rec.value } }); m.close(); toast('Retiro corregido', 'ok'); await load(); }
      catch (e) { toast(errMsg(e), 'error', 5000); }
    });
  }

  function cancel(r) {
    const why = h('input', { class: 'input', maxLength: 200, placeholder: 'Motivo de la cancelación (obligatorio)' });
    const go = h('button', { class: 'btn danger' }, 'Cancelar el retiro');
    const m = modal({ title: 'Cancelar retiro', body: h('div', { class: 'form' },
        h('p', null, `¿Cancelar el retiro de ${r.nombre} (${r.grado}° ${r.grupo}) de las ${fmtTime(r.exit_at, tz)}? El alumno podrá volver a registrarse. Queda anotado en la bitácora.`), why),
      actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Volver'), go] });
    go.onclick = () => guard(go, async () => {
      try { await rpc('cancel_early_exit', { p_id: r.id, p_reason: why.value }); m.close(); toast('Retiro cancelado', 'ok'); await load(); }
      catch (e) { toast(errMsg(e), 'error', 5000); }
    });
  }

  date.addEventListener('change', load);
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Retiros del día'), date),
    h('p', { class: 'muted' }, 'Los retiros los registra el prefecto en la puerta. Aquí se cotejan con los documentos de autorización en papel; si hay un error, se corrige o se cancela.'), box));
  load();
}
