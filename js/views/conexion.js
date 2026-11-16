// Conexión con el Concentrado de Calificaciones y Asistencias (solo lectura).
import { h, clear, spinner, toast, modal, confirmBox, guard, copyText } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { fmtTime, errMsg } from '../logic.js';
import { SUPABASE_URL } from '../config.js';

export function render(root) {
  const tz = state.school.timezone;
  const box = h('div');

  async function load() {
    clear(box).append(spinner());
    try { draw(await rpc('integration_status', { p_school: sid() })); }
    catch (e) { clear(box).append(h('div', { class: 'note bad' }, errMsg(e))); }
  }

  function showKey(key) {
    const m = modal({ title: 'Llave de conexión', locked: true, body: h('div', { class: 'form' },
      h('div', { class: 'note bad' }, 'Cópiala AHORA y pégala en el Concentrado. Por seguridad no se vuelve a mostrar; si la pierdes, se genera otra y la anterior deja de servir.'),
      h('input', { class: 'input mono', readOnly: true, value: key, onfocus: e => e.target.select() }),
      h('button', { class: 'btn', onclick: () => copyText(key) }, 'Copiar llave')),
      actions: [h('button', { class: 'btn primary', onclick: () => { m.close(); load(); } }, 'Ya la copié')] });
  }

  function draw(s) {
    const sw = h('input', { type: 'checkbox', checked: !!s.enabled, disabled: !s.has_key });
    sw.onchange = () => guard(sw, async () => {
      try { await rpc('integration_set_enabled', { p_school: sid(), p_enabled: sw.checked }); toast(sw.checked ? 'Conexión activada' : 'Conexión desactivada', 'ok'); }
      catch (e) { toast(errMsg(e), 'error'); }
      await load();
    });
    const gen = h('button', { class: 'btn primary' }, s.has_key ? 'Generar llave nueva' : 'Generar llave');
    gen.onclick = () => guard(gen, async () => {
      if (s.has_key && !(await confirmBox('Se generará una llave nueva y la anterior dejará de funcionar. Tendrás que pegar la nueva en el Concentrado.', { ok: 'Generar', danger: true, title: 'Llave nueva' }))) return;
      try { showKey((await rpc('integration_generate_key', { p_school: sid() })).key); } catch (e) { toast(errMsg(e), 'error'); }
    });
    const rev = h('button', { class: 'btn danger' }, 'Revocar llave');
    rev.onclick = () => guard(rev, async () => {
      if (!(await confirmBox('La llave dejará de servir y la conexión se apagará. El Concentrado ya no podrá consultar esta escuela.', { ok: 'Revocar', danger: true, title: 'Revocar llave' }))) return;
      try { await rpc('integration_revoke', { p_school: sid() }); toast('Llave revocada', 'ok'); } catch (e) { toast(errMsg(e), 'error'); }
      await load();
    });
    clear(box).append(
      h('div', { class: 'card' },
        h('label', { class: 'chk' }, sw, h('b', null, ' Conexión con el Concentrado activada')),
        h('p', { class: 'muted small' }, s.has_key ? (s.enabled ? 'El Concentrado puede consultar a esta escuela.' : 'Apagada: el Concentrado no puede consultar.') : 'Primero genera una llave. La conexión nace apagada.'),
        s.has_key ? h('p', { class: 'small' }, `Llave: ${s.key_prefix}… · generada ${s.key_created_at ? new Date(s.key_created_at).toLocaleString('es-MX', { timeZone: tz }) : ''}`, h('br'),
          `Último uso: ${s.last_used_at ? new Date(s.last_used_at).toLocaleString('es-MX', { timeZone: tz }) : 'nunca'}`, s.fallos_recientes ? ` · ${s.fallos_recientes} consulta(s) rechazada(s) en 24 h` : '') : null,
        h('div', { class: 'btn-row' }, gen, s.has_key ? rev : null)),
      h('div', { class: 'card' }, h('b', null, 'Qué comparte esta conexión'),
        h('p', { class: 'small' }, 'Solo lectura. Por cada alumno que tuvo entrada o retiro el día consultado: su CURP, la hora de entrada y, si se retiró antes de terminar el horario, la hora y la categoría del retiro. No comparte nombres, tutores, teléfonos, fotos ni textos libres.')),
      h('div', { class: 'card' }, h('b', null, 'Para el Concentrado'),
        h('p', { class: 'small' }, 'Dirección: ', h('span', { class: 'mono' }, `${SUPABASE_URL}/rest/v1/rpc/concentrado_consulta`)),
        h('p', { class: 'small muted' }, 'La llave se pega en el Concentrado (configuración de esta escuela), nunca en el código ni en la página.')));
  }

  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Conexión con el Concentrado')), box));
  load();
}
