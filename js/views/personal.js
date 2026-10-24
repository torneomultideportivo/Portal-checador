// Personal de la escuela: alta, edición, hora de entrada propia, baja, reposición de QR y cumpleaños.
import { h, clear, toast, modal, confirmBox, guard, spinner } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { searchKey, errMsg, norm, CURP_RE, normHora, fmtDiaMes, curpBirth } from '../logic.js';
import { refreshStaff } from '../sync.js';

export const loadPersonal = () => rpc('list_personal', { p_school: sid() });

export function render(root) {
  const school = state.school;
  let rows = [], showInactive = false;
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Buscar por nombre, puesto o CURP…' });
  const info = h('div', { class: 'muted' });
  const list = h('div', { class: 'table-wrap' });
  const sw = h('div');

  const drawSwitch = () => clear(sw).append(school.staff_qr_enabled
    ? h('div', { class: 'note ok' }, h('b', null, 'Entrada del personal con QR: ACTIVADA. '), `Todo el personal debe escanear su QR al llegar (tolerancia ${school.staff_tolerance_min} min). Se cambia en `, h('a', { href: '#/settings' }, 'Configuración'), '.')
    : h('div', { class: 'note' }, h('b', null, 'Entrada del personal con QR: apagada. '), 'Mientras esté apagada no se registra la entrada del personal. Se enciende en ', h('a', { href: '#/settings' }, 'Configuración'), '.'));

  const draw = () => {
    const words = searchKey(q.value).split(' ').filter(Boolean);
    const f = rows.filter(p => (showInactive || p.active) && words.every(w => searchKey(`${p.nombre} ${p.puesto || ''} ${p.curp}`).includes(w)));
    info.textContent = `${f.length} persona(s)` + (rows.some(p => !p.active) ? ` · ${rows.filter(p => !p.active).length} de baja` : '');
    clear(list);
    if (!f.length) { list.append(h('div', { class: 'empty' }, rows.length ? 'Sin resultados' : 'Aún no hay personal. Usa "Importar Excel" o "+ Persona".')); return; }
    list.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Nombre', 'Puesto', 'Hora de entrada', 'Cumpleaños', 'CURP', ''].map(t => h('th', null, t)))),
      h('tbody', null, f.map(p => h('tr', { class: p.active ? '' : 'inactive', onclick: () => edit(p) },
        h('td', null, p.nombre, p.active ? null : h('span', { class: 'badge muted' }, 'baja')),
        h('td', null, p.puesto || ''), h('td', { class: 'time' }, p.entry_time || '—'),
        h('td', null, p.cumple_dia ? fmtDiaMes(p.cumple_dia, p.cumple_mes) : ''), h('td', { class: 'mono' }, p.curp), h('td', null, '›'))))));
  };

  async function reload() {
    clear(list).append(spinner());
    try { rows = await loadPersonal(); draw(); } catch (e) { clear(list).append(h('div', { class: 'empty' }, errMsg(e))); }
  }

  function edit(p) {
    const isNew = !p;
    const v = p || { apellido_paterno: '', apellido_materno: '', nombres: '', curp: '', puesto: '', entry_time: school.entry_time?.slice(0, 5) || '07:30', active: true };
    const up = (val, ph) => h('input', { class: 'input', value: val || '', placeholder: ph, style: { textTransform: 'uppercase' } });
    const ap = up(v.apellido_paterno, 'Apellido paterno'), am = up(v.apellido_materno, 'Apellido materno'), nom = up(v.nombres, 'Nombre(s)');
    const curp = h('input', { class: 'input mono', value: v.curp, maxLength: 18, placeholder: '18 caracteres', style: { textTransform: 'uppercase' } });
    const puesto = h('input', { class: 'input', value: v.puesto || '', placeholder: 'Docente, Prefecto, Intendente…', list: 'puestos' });
    const dl = h('datalist', { id: 'puestos' }, (school.positions || []).map(x => h('option', { value: x.cargo || x })));
    const hora = h('input', { class: 'input', type: 'time', value: v.entry_time || '' });
    const save = h('button', { class: 'btn primary' }, 'Guardar');
    const m = modal({
      title: isNew ? 'Nueva persona' : 'Editar persona', wide: true,
      body: h('div', { class: 'form' }, dl,
        h('div', { class: 'grid3' }, h('label', { class: 'field' }, h('span', null, 'Apellido paterno'), ap), h('label', { class: 'field' }, h('span', null, 'Apellido materno'), am), h('label', { class: 'field' }, h('span', null, 'Nombre(s)'), nom)),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, 'CURP'), curp, h('small', { class: 'muted' }, 'De la CURP se toma el cumpleaños.')), h('label', { class: 'field' }, h('span', null, 'Puesto'), puesto)),
        h('label', { class: 'field' }, h('span', null, 'Hora de entrada (propia de esta persona)'), hora),
        isNew ? null : h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', onclick: async ev => {
            if (!(await confirmBox(`Se generará un QR nuevo para ${p.nombre}. El anterior dejará de servir y sonará la alarma si alguien lo presenta.`, { ok: 'Generar QR nuevo', danger: true }))) return;
            await guard(ev.currentTarget, async () => { await rpc('regenerate_personal_qr', { p_school: sid(), p_personal: p.id }); toast('QR regenerado. Imprime el nuevo en "QR y credenciales".', 'ok', 5000); refreshStaff().catch(() => {}); });
          } }, 'Reposición de QR'),
          h('button', { class: 'btn small ' + (p.active ? 'danger' : ''), onclick: async ev => {
            if (!(await confirmBox(p.active ? `¿Dar de baja a ${p.nombre}? Conserva su historial.` : `¿Reactivar a ${p.nombre}?`, { ok: p.active ? 'Dar de baja' : 'Reactivar', danger: p.active }))) return;
            await guard(ev.currentTarget, async () => {
              await rpc('save_personal', { p_school: sid(), p_id: p.id, p: { apellido_paterno: p.apellido_paterno, apellido_materno: p.apellido_materno, nombres: p.nombres, curp: p.curp, puesto: p.puesto, entry_time: p.entry_time, active: !p.active } });
              m.close(); toast('Listo', 'ok'); await reload(); refreshStaff().catch(() => {});
            });
          } }, p.active ? 'Dar de baja' : 'Reactivar'))),
      actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), save],
    });
    save.onclick = () => guard(save, async () => {
      const c = norm(curp.value);
      if (!CURP_RE.test(c)) throw new Error('CURP_INVALIDA');
      if (!curpBirth(c)) throw new Error('CURP_FECHA_INVALIDA');
      if (hora.value && normHora(hora.value) === null) throw new Error('HORA_INVALIDA');
      await rpc('save_personal', { p_school: sid(), p_id: p ? p.id : null, p: { apellido_paterno: ap.value, apellido_materno: am.value, nombres: nom.value, curp: c, puesto: puesto.value, entry_time: hora.value || null, active: p ? p.active : true } });
      m.close(); toast('Guardado', 'ok'); await reload(); refreshStaff().catch(() => {});
    });
  }

  q.addEventListener('input', draw);
  root.append(h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('h2', null, 'Personal'),
      h('a', { class: 'btn', href: '#/import?personal' }, 'Importar Excel'), h('button', { class: 'btn primary', onclick: () => edit(null) }, '+ Persona')),
    sw, h('div', { class: 'filters' }, q), h('label', { class: 'chk' }, h('input', { type: 'checkbox', onchange: e => { showInactive = e.target.checked; draw(); } }), ' Mostrar bajas'), info, list));
  drawSwitch(); reload();
}
