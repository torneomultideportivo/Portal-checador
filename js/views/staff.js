// Usuarios y roles: cuentas del sistema, código para prefectos, altas/bajas y relevo del administrativo.
import { h, clear, toast, guard, confirmBox, copyText, spinner, icon, modal } from '../ui.js';
import { state, sid, isSuper, role } from '../state.js';
import { sb, rpc } from '../api.js';
import { errMsg, fmtDate } from '../logic.js';

const ROLE = { school_admin: 'Administrativo', prefect: 'Prefecto', super_admin: 'Administrador general' };

const Y = h => h, S = '✓', N = '—';
function rolesTable() {
  const rows = [
    ['Super administrador', 'Todas las escuelas', [N, S, S, S, S, S]],
    ['Administrativo', 'Uno por escuela', [S, S, S, S, S, S]],
    ['Prefecto', 'Solo puerta', [S, N, N, 'Solo su día', N, N]],
  ];
  return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, ['Rol', 'Escanear', 'Alumnos, tutores y personal', 'QR y citatorios', 'Reportes', 'Ver CURP', 'Configurar y usuarios'].map(t => h('th', null, t)))),
    h('tbody', null, rows.map(([r, n, cs]) => h('tr', null, h('td', null, h('b', null, r), h('br'), h('small', { class: 'muted' }, n)), ...cs.map(c => h('td', { style: { textAlign: 'center', fontWeight: 700 } }, c)))))),
    h('p', { class: 'muted small pad' }, 'Alumnos, tutores y personal registrados NO inician sesión: sus datos los administra el administrativo. Cada administrativo o prefecto solo ve su propia escuela.'));
}

export function render(root) {
  const codeBox = h('div', { class: 'codebox' });
  const people = h('div', { class: 'table-wrap' });
  const url = location.origin + location.pathname;

  async function loadCode(regen = false) {
    clear(codeBox).append(spinner(''));
    try {
      const c = await rpc('get_staff_code', { p_school: sid(), p_regenerate: regen });
      clear(codeBox).append(h('div', { class: 'code' }, c), h('button', { class: 'btn', onclick: () => copyText(c) }, icon('copy', 16), ' Copiar'),
        h('button', { class: 'btn danger small', onclick: async () => { if (await confirmBox('Se creará un código nuevo. El anterior dejará de servir para registrar personal nuevo (quien ya tiene cuenta no se afecta).', { ok: 'Generar nuevo', danger: true })) loadCode(true); } }, 'Generar código nuevo'));
    } catch (e) { clear(codeBox).append(h('div', { class: 'note bad' }, errMsg(e))); }
  }

  async function loadPeople() {
    clear(people).append(spinner());
    const { data, error } = await sb.from('profiles').select('id,full_name,email,role,active,created_at,activated_at').eq('school_id', sid()).order('created_at');
    if (error) { clear(people).append(h('div', { class: 'note bad' }, errMsg(error))); return; }
    const status = p => p.active ? ['ok', 'Activo'] : p.activated_at ? ['muted', 'Baja'] : ['warn', 'Pendiente de confirmar correo'];
    clear(people).append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Nombre', 'Correo', 'Puesto', 'Estado', ''].map(t => h('th', null, t)))),
      h('tbody', null, data.map(p => {
        const [c, t] = status(p);
        const acts = [];
        if (p.role === 'prefect' && p.activated_at) {
          acts.push(h('button', { class: 'btn small', onclick: ev => toggle(ev.currentTarget, p) }, p.active ? 'Dar de baja' : 'Reactivar'));
          if (p.active && role() === 'school_admin') acts.push(h('button', { class: 'btn small', onclick: ev => promote(ev.currentTarget, p) }, 'Hacer administrativo'));
        }
        return h('tr', { class: p.active ? '' : 'inactive' }, h('td', null, h('b', null, p.full_name)), h('td', null, p.email), h('td', null, ROLE[p.role]),
          h('td', null, h('span', { class: 'badge ' + c }, t)), h('td', { class: 'acts' }, acts));
      }))));
  }

  async function toggle(btn, p) {
    if (p.active && !(await confirmBox(`¿Dar de baja a ${p.full_name}? Ya no podrá registrar entradas. Su historial se conserva.`, { ok: 'Dar de baja', danger: true }))) return;
    await guard(btn, async () => { await rpc('set_staff_active', { p_user: p.id, p_active: !p.active }); toast('Listo', 'ok'); await loadPeople(); });
  }
  async function promote(btn, p) {
    const ok = await confirmBox(`Vas a dejar como administrativo a ${p.full_name}.\n\nTU cuenta se dará de baja en este mismo momento y saldrás de la aplicación. Solo puede haber un administrativo por escuela.`, { ok: 'Hacer el relevo ahora', danger: true, title: 'Relevo de administrativo' });
    if (!ok) return;
    await guard(btn, async () => { await rpc('promote_to_admin', { p_user: p.id }); toast('Relevo hecho. Se cerrará tu sesión.', 'ok', 4000); setTimeout(() => location.reload(), 1500); });
  }
  async function relevo(btn) {
    await guard(btn, async () => {
      const r = await rpc('generate_admin_code', { p_school: sid() });
      const exp = new Date(r.expires_at).toLocaleString('es-MX');
      const m = modal({ title: 'Código de administrativo', body: [
        h('div', { class: 'code big' }, r.code),
        h('p', null, `Vence el ${exp}. Es de un solo uso.`),
        h('p', null, 'La persona nueva debe registrarse en la aplicación con este código y confirmar su correo. En ese momento el administrativo actual se da de baja automáticamente.'),
      ], actions: [h('button', { class: 'btn', onclick: () => copyText(r.code) }, 'Copiar'), h('button', { class: 'btn primary', onclick: () => m.close() }, 'Listo')] });
    });
  }

  root.append(h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('h2', null, 'Usuarios y roles')),
    h('div', { class: 'card' }, h('h3', null, 'Quién usa el sistema y qué puede hacer'), rolesTable()),
    h('div', { class: 'card' }, h('h3', null, 'Código para prefectos'),
      h('p', null, 'Comparte este código con el personal de puerta. Cada persona entra a ', h('b', null, url), ', toca "Registrarme" y escribe el código con su correo y contraseña.'),
      codeBox),
    h('div', { class: 'card' }, h('h3', null, 'Cuentas de la escuela'), people),
    h('div', { class: 'card' }, h('h3', null, isSuper() ? 'Emergencia: nuevo administrativo' : 'Relevo del administrativo'),
      h('p', null, isSuper()
        ? 'Si la escuela se quedó sin quien la administre, genera un código para registrar al nuevo administrativo (reemplaza al anterior al confirmarse).'
        : 'Si dejas el puesto, genera un código para tu relevo (o usa "Hacer administrativo" en un prefecto). La escuela nunca se queda sin administrativo: tu baja ocurre cuando el relevo ya está activo.'),
      h('button', { class: 'btn', onclick: ev => relevo(ev.currentTarget) }, 'Generar código de administrativo'))));
  loadCode(); loadPeople();
}
