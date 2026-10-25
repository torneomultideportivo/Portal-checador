// Administrativo de la escuela: su licencia, pedir ayuda y autorizar (o quitar) el acceso de soporte.
import { h, clear, toast, guard, spinner, copyText } from '../ui.js';
import { state } from '../state.js';
import { rpc } from '../api.js';
import { errMsg, fmtLarga, licenseView, waLink } from '../logic.js';

const dt = v => (v ? new Date(v).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const TXT = {
  ACTIVA: ['ok', 'Activa'], POR_VENCER: ['info', 'Por vencer'], GRACIA: ['warn', 'Vencida, en periodo de gracia'],
  SOLO_LECTURA: ['bad', 'Vencida: solo lectura'], SUSPENDIDA: ['bad', 'Suspendida'], PENDIENTE: ['muted', 'Pendiente'],
};

export function render(root) {
  const lic = licenseView(state.license), [cls, label] = TXT[lic.state] || TXT.ACTIVA;
  const school = state.school?.name || '';
  const wa = state.supportWhatsapp;
  const box = h('div');

  const card = h('div', { class: 'card' }, h('h3', null, 'Mi licencia'),
    h('p', null, h('span', { class: 'badge ' + cls }, label)),
    state.license?.gratuita ? h('p', null, 'Licencia permanente.') : lic.vigencia_hasta ? h('p', null, `Vigente hasta el ${fmtLarga(lic.vigencia_hasta)}.`, lic.state === 'GRACIA' ? ` Gracia hasta el ${fmtLarga(lic.gracia_hasta)}.` : '') : null,
    lic.state === 'SOLO_LECTURA' ? h('p', { class: 'note bad' }, 'Puedes consultar, imprimir y descargar tus datos, pero no registrar entradas ni importar. Se conservan todos tus datos.') : null);

  // pedir ayuda
  const ta = h('textarea', { rows: 4, maxlength: 1000, placeholder: 'Cuéntanos qué necesitas (no escribas CURP ni datos de alumnos).' });
  const aut = h('input', { type: 'checkbox' });
  const send = h('button', { class: 'btn primary' }, 'Enviar solicitud');
  send.onclick = () => guard(send, async () => {
    await rpc('support_request_create', { p_text: ta.value, p_autoriza: aut.checked });
    ta.value = ''; aut.checked = false; toast('Solicitud enviada', 'ok'); await load();
  });
  const waBtn = wa ? h('button', { class: 'btn', onclick: () => window.open(waLink(wa, `Hola, soy ${state.profile.full_name} de ${school}. Necesito ayuda con el Checador QR: ${ta.value.trim() || ''}`), '_blank', 'noopener') }, 'Escribir por WhatsApp') : null;
  const form = h('div', { class: 'card' }, h('h3', null, 'Pedir ayuda'), ta,
    h('label', { class: 'check' }, aut, ' Autorizo al soporte a ver los datos de mi escuela por 3 días, solo para atender esta solicitud. Puedo retirar el permiso cuando quiera.'),
    h('div', { class: 'btn-row' }, send, waBtn));

  async function load() {
    clear(box).append(spinner());
    try {
      const r = await rpc('support_requests_mine');
      clear(box);
      box.append(h('h3', null, 'Mis solicitudes'));
      if (!r.solicitudes.length) box.append(h('p', { class: 'muted' }, 'Todavía no has enviado solicitudes.'));
      for (const s of r.solicitudes) {
        box.append(h('div', { class: 'card' },
          h('small', { class: 'muted' }, `${dt(s.created_at)} · ${s.estado === 'NUEVA' ? 'Enviada' : 'Respondida'}`),
          h('p', null, s.texto),
          s.respuesta ? h('p', { class: 'note ok' }, 'Respuesta: ' + s.respuesta) : null,
          s.acceso_vigente ? h('div', { class: 'note info' }, `El soporte puede ver los datos de tu escuela hasta ${dt(s.autorizado_hasta)}. `,
            h('button', { class: 'btn small danger', onclick: ev => guard(ev.currentTarget, async () => { await rpc('support_request_revoke', { p_id: s.id }); toast('Permiso retirado', 'ok'); await load(); }) }, 'Retirar permiso'))
            : s.autoriza ? h('small', { class: 'muted' }, s.revocada ? 'Retiraste el permiso.' : 'El permiso ya venció.') : null));
      }
      box.append(h('h3', null, 'Accesos de soporte a tu escuela'));
      box.append(r.accesos.length ? h('table', { class: 'tbl small' }, h('tbody', null, r.accesos.map(a => h('tr', null, h('td', null, dt(a.at)), h('td', null, a.por || ''), h('td', null, a.motivo || ''))))) : h('p', { class: 'muted' }, 'Nadie de soporte ha entrado a tus datos.'));
    } catch (e) { clear(box).append(h('div', { class: 'note bad' }, errMsg(e))); }
  }

  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Ayuda y licencia')), card, form, box));
  load();
}
