// Solo administrador general: alta y control de escuelas.
import { h, clear, toast, guard, spinner, modal, confirmBox, copyText, icon } from '../ui.js';
import { state, emit } from '../state.js';
import { rpc } from '../api.js';
import { errMsg, fmtDate } from '../logic.js';
import { buildSchoolForm } from './settings.js';

export function render(root, { onSelect }) {
  const list = h('div', { class: 'cards-grid' });

  function showCode(title, code, extra) {
    const m = modal({ title, body: [h('div', { class: 'code big' }, code), extra ? h('p', null, extra) : null],
      actions: [h('button', { class: 'btn', onclick: () => copyText(code) }, icon('copy', 16), ' Copiar'), h('button', { class: 'btn primary', onclick: () => m.close() }, 'Listo')] });
  }

  async function load() {
    clear(list).append(spinner());
    try {
      const rows = await rpc('list_schools_summary');
      clear(list);
      if (!rows.length) list.append(h('div', { class: 'empty' }, 'Todavía no hay escuelas. Crea la primera con "+ Escuela".'));
      for (const s of rows) {
        const exp = s.admin_code_expires_at ? new Date(s.admin_code_expires_at) : null;
        list.append(h('div', { class: 'card school' + (s.active ? '' : ' inactive') },
          h('div', { class: 'card-head' }, h('h3', null, s.name), s.active ? null : h('span', { class: 'badge muted' }, 'Desactivada')),
          h('small', { class: 'muted' }, [s.cct, `Entrada ${String(s.entry_time).slice(0, 5)} (+${s.tolerance_min} min)`].filter(Boolean).join(' · ')),
          h('div', { class: 'sum-cards small' }, h('div', { class: 'cnt' }, h('b', null, s.alumnos), h('span', null, 'Alumnos')), h('div', { class: 'cnt' }, h('b', null, s.personal), h('span', null, 'Personal')), h('div', { class: 'cnt ok' }, h('b', null, s.hoy), h('span', null, 'Hoy'))),
          s.admin_name ? h('p', null, h('b', null, 'Administrativo: '), `${s.admin_name} (${s.admin_email})`) : h('p', { class: 'note warn' }, 'Sin administrativo activo.'),
          s.admin_code && exp && exp > new Date() ? h('p', null, h('b', null, 'Código de administrativo vigente: '), h('span', { class: 'mono' }, s.admin_code), ` (vence ${exp.toLocaleDateString('es-MX')})`, ' ', h('button', { class: 'btn small', onclick: () => copyText(s.admin_code) }, 'Copiar')) : null,
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn primary small', onclick: () => onSelect(s.id) }, 'Administrar'),
            h('button', { class: 'btn small', onclick: ev => guard(ev.currentTarget, async () => { const r = await rpc('generate_admin_code', { p_school: s.id }); showCode('Código de administrativo', r.code, `Vence el ${new Date(r.expires_at).toLocaleDateString('es-MX')}. Un solo uso. Al registrarse con él, reemplaza al administrativo actual (si lo hay).`); await load(); }) }, 'Nuevo código de administrativo'),
            h('button', { class: 'btn small ' + (s.active ? 'danger' : ''), onclick: async ev => {
              if (s.active && !(await confirmBox(`¿Desactivar "${s.name}"? Nadie de esa escuela podrá registrar entradas.`, { ok: 'Desactivar', danger: true }))) return;
              await guard(ev.currentTarget, async () => { await rpc('set_school_active', { p_school: s.id, p_active: !s.active }); await load(); });
            } }, s.active ? 'Desactivar' : 'Activar'))));
      }
    } catch (e) { clear(list).append(h('div', { class: 'note bad' }, errMsg(e))); }
  }

  function create() {
    const form = buildSchoolForm({ entry_time: '08:00', tolerance_min: 10, timezone: 'America/Mexico_City', grades: ['1', '2', '3'], groups: ['A', 'B', 'C'], positions: [] }, { creating: true });
    const save = h('button', { class: 'btn primary' }, 'Crear escuela');
    const m = modal({ title: 'Nueva escuela', wide: true, body: form.el, actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), save] });
    save.onclick = () => guard(save, async () => {
      const r = await rpc('save_school', { p_school: null, p: form.values() });
      m.close(); await load();
      showCode('Escuela creada', r.admin_code, 'Entrega este código al administrativo de la escuela (vence en 30 días, un solo uso). Con él se registra en la aplicación y queda como administrativo.');
    });
  }

  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Escuelas'), h('button', { class: 'btn primary', onclick: create }, '+ Escuela')), list));
  load();
}
