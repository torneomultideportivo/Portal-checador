// "Hoy": quién ya llegó, quién falta y los registros con problemas.
import { h, clear, toast, badge, icon, promptBox, confirmBox, guard } from '../ui.js';
import { state, on, isAdmin, sid } from '../state.js';
import { rpc } from '../api.js';
import { getAll } from '../db.js';
import { refreshToday, retryFailed, discardFailed, flushQueue } from '../sync.js';
import { fmtTime, cmpStudent, errMsg } from '../logic.js';
import { counterBar } from './scan.js';

export function render(root) {
  const school = state.school;
  let tab = 'llegaron', filter = '', grado = '', grupo = '', failedItems = [];
  const bar = counterBar();
  const tabs = h('div', { class: 'tabs' });
  const filters = h('div', { class: 'filters' });
  const list = h('div', { class: 'list' });

  const sel = (opts, val, set) => {
    const s = h('select', { class: 'input', onchange: e => { set(e.target.value); draw(); } }, opts.map(([v, t]) => h('option', { value: v, selected: v === val }, t)));
    return s;
  };

  async function draw() {
    failedItems = await getAll('failed');
    clear(tabs).append(
      h('button', { class: tab === 'llegaron' ? 'on' : '', onclick: () => { tab = 'llegaron'; draw(); } }, 'Llegaron'),
      h('button', { class: tab === 'faltan' ? 'on' : '', onclick: () => { tab = 'faltan'; draw(); } }, 'Faltan'),
      isAdmin() ? h('button', { class: tab === 'personal' ? 'on' : '', onclick: () => { tab = 'personal'; draw(); } }, 'Personal') : null,
      isAdmin() ? h('a', { class: 'tablink', href: '#/alarms' }, 'Alarmas') : null,
      failedItems.length || state.pending ? h('button', { class: (tab === 'problemas' ? 'on ' : '') + 'alert', onclick: () => { tab = 'problemas'; draw(); } },
        `Envío (${state.pending + failedItems.length})`) : null);
    clear(filters);
    if (tab !== 'problemas' && tab !== 'personal') {
      filters.append(
        tab === 'llegaron' ? sel([['', 'Todos'], ['PUNTUAL', 'Puntuales'], ['RETARDO', 'Retardos']], filter, v => { filter = v; }) : null,
        sel([['', 'Todos los grados'], ...school.grades.map(g => [g, `${g}°`])], grado, v => { grado = v; }),
        sel([['', 'Todos los grupos'], ...school.groups.map(g => [g, g])], grupo, v => { grupo = v; }));
    }
    clear(list);
    const match = s => s && (!grado || s.grado === grado) && (!grupo || s.grupo === grupo);

    if (tab === 'llegaron') {
      const rows = [...state.today.values()].map(r => ({ r, s: state.rosterById.get(r.student_id) }))
        .filter(x => match(x.s) && (!filter || x.r.status === filter))
        .sort((a, b) => b.r.scanned_at.localeCompare(a.r.scanned_at));
      if (!rows.length) list.append(h('div', { class: 'empty' }, 'Todavía no hay registros con estos filtros.'));
      for (const { r, s } of rows) {
        list.append(h('div', { class: 'row' },
          h('div', { class: 'time' }, fmtTime(r.scanned_at, school.timezone)),
          h('div', { class: 'grow' }, h('b', null, s.nombre), h('small', null,
            `${s.grado}° ${s.grupo} · ${r.by || ''}${r.method === 'MANUAL' ? ' · manual' : ''}${r.offline ? ' · sin conexión' : ''}`)),
          r.pending ? h('span', { class: 'badge muted' }, 'por enviar') : null,
          badge(r.status),
          isAdmin() && r.id ? h('button', { class: 'icon-btn danger', title: 'Eliminar registro', onclick: ev => remove(ev.currentTarget, r, s) }, icon('x', 18)) : null));
      }
    } else if (tab === 'personal') {
      list.append(h('div', { class: 'muted pad' }, 'Cargando…'));
      try {
        const d = await rpc('personal_day', { p_school: sid() });
        clear(list);
        if (!school.staff_qr_enabled) list.append(h('div', { class: 'note' }, 'La entrada del personal con QR está apagada en esta escuela (se enciende en Configuración).'));
        if (!d.registros.length) list.append(h('div', { class: 'empty' }, 'Aún no hay personal registrado.'));
        for (const p of d.registros) list.append(h('div', { class: 'row' },
          h('div', { class: 'time' }, p.scanned_at ? fmtTime(p.scanned_at, school.timezone) : '—'),
          h('div', { class: 'grow' }, h('b', null, p.nombre), h('small', null, `${p.puesto || 'Personal'} · entra a las ${p.entry_time}${p.late_minutes ? ` · ${p.late_minutes} min tarde` : ''}${p.by ? ' · ' + p.by : ''}`)),
          p.status ? badge(p.status) : h('span', { class: 'badge muted' }, 'Sin entrada')));
      } catch (e) { clear(list).append(h('div', { class: 'note bad' }, errMsg(e))); }
    } else if (tab === 'faltan') {
      const rows = state.roster.filter(s => !state.today.has(s.id) && match(s)).sort(cmpStudent);
      if (!rows.length) list.append(h('div', { class: 'empty' }, 'No falta nadie con estos filtros.'));
      let cur = '';
      for (const s of rows) {
        const g = `${s.grado}° ${s.grupo}`;
        if (g !== cur) { cur = g; list.append(h('h4', { class: 'group-h' }, g)); }
        list.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, s.nombre), h('span', { class: 'badge muted' }, 'Pendiente')));
      }
    } else {
      const bad = failedItems;
      if (state.pending) list.append(h('div', { class: 'note' }, `${state.pending} registro(s) guardados en este celular esperando conexión. Se envían solos.`,
        h('button', { class: 'btn small', onclick: () => guard(null, async () => { const r = await flushQueue(); toast(r && r.sent ? `${r.sent} enviados` : 'Sin cambios', 'info'); draw(); }) }, icon('sync', 16), ' Enviar ahora')));
      for (const f of bad) {
        const s = state.rosterById.get(f.student_id);
        list.append(h('div', { class: 'row bad' },
          h('div', { class: 'time' }, fmtTime(f.scanned_at, school.timezone)),
          h('div', { class: 'grow' }, h('b', null, s ? s.nombre : 'QR desconocido'), h('small', null, f.error)),
          h('button', { class: 'btn small', onclick: () => retryFailed(f.cid).then(draw) }, 'Reintentar'),
          h('button', { class: 'btn small', onclick: () => discardFailed(f.cid).then(draw) }, 'Descartar')));
      }
      if (!bad.length && !state.pending) list.append(h('div', { class: 'empty' }, 'Todo está enviado.'));
    }
  }

  async function remove(btn, r, s) {
    const reason = await promptBox(`Vas a eliminar la entrada de ${s.nombre}. Quedará registrada en la bitácora.`, { label: 'Motivo', placeholder: 'Ej. se escaneó por error', ok: 'Eliminar', title: 'Eliminar registro' });
    if (!reason) return;
    await guard(btn, async () => { await rpc('delete_attendance', { p_id: r.id, p_reason: reason }); await refreshToday(); toast('Registro eliminado', 'ok'); });
  }

  const off = on('changed', () => { bar.draw(); draw(); });
  root.append(h('section', { class: 'view' }, bar.el, tabs, filters, list));
  draw();
  return off;
}
