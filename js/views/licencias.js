// Solo administrador general: licencias, cobranza, solicitudes de soporte y accesos.
import { h, clear, toast, guard, spinner, modal, confirmBox, promptBox, copyText, icon } from '../ui.js';
import { state } from '../state.js';
import { rpc } from '../api.js';
import { errMsg, fmtLarga, waLink, phoneDigits } from '../logic.js';
import { buildSchoolForm } from './settings.js';

const ESTADO = {
  ACTIVA: ['ok', 'Activa'], POR_VENCER: ['info', 'Por vencer'], GRACIA: ['warn', 'En gracia'],
  SOLO_LECTURA: ['bad', 'Solo lectura'], SUSPENDIDA: ['bad', 'Suspendida'], PENDIENTE: ['muted', 'Pendiente de pago'],
};
const chip = st => { const [c, t] = ESTADO[st] || ['muted', st]; return h('span', { class: 'badge ' + c }, t); };
const fecha = f => (f ? fmtLarga(f) : '—');
const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dt = v => (v ? new Date(v).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function render(root, { onSelect }) {
  let tab = 'lic', data = null, req = null;
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });

  function showCode(title, code, extra) {
    const m = modal({ title, body: [h('div', { class: 'code big' }, code), extra ? h('p', null, extra) : null],
      actions: [h('button', { class: 'btn', onclick: () => copyText(code) }, icon('copy', 16), ' Copiar'), h('button', { class: 'btn primary', onclick: () => m.close() }, 'Listo')] });
  }

  async function load() {
    clear(body).append(spinner());
    try {
      [data, req] = await Promise.all([rpc('license_overview'), rpc('support_requests_all')]);
      draw();
    } catch (e) { clear(body).append(h('div', { class: 'note bad' }, errMsg(e))); }
  }

  function drawTabs() {
    clear(tabs);
    const nuevas = data?.solicitudes_nuevas || 0;
    for (const [k, t] of [['lic', 'Licencias'], ['sol', 'Solicitudes' + (nuevas ? ` (${nuevas})` : '')], ['acc', 'Accesos']]) {
      tabs.append(h('button', { class: 'tab' + (tab === k ? ' on' : ''), onclick: () => { tab = k; draw(); } }, t));
    }
  }

  function draw() {
    drawTabs(); clear(body);
    if (tab === 'lic') body.append(drawLic()); else if (tab === 'sol') body.append(drawSol()); else body.append(drawAcc());
  }

  // ---------------- cobranza / avisos por WhatsApp (sin precios: eso se trata en persona)
  function msgCobro(s) {
    const venc = s.vigencia_hasta ? `venció o vence el ${fecha(s.vigencia_hasta)}` : 'aún no está activada';
    return `Hola${s.contact_name ? ' ' + s.contact_name : ''}, le escribe el soporte del Checador QR. La licencia de ${s.name} ${venc}. ¿Le ayudo con la renovación? Cualquier duda aquí estoy.`;
  }
  function msgClave(s, code) {
    return `Hola${s.contact_name ? ' ' + s.contact_name : ''}, ya quedó activa la licencia de ${s.name}${s.vigencia_hasta ? ' hasta el ' + fecha(s.vigencia_hasta) : ''}. Su clave de registro (un solo uso) es: ${code}. Con ella se registra en la aplicación como administrativo de la escuela.`;
  }
  const wa = (phone, text) => window.open(waLink(phone, text), '_blank', 'noopener');

  function drawLic() {
    const wrap = h('div');
    const rows = data.escuelas;
    const cont = (st) => rows.filter(s => st.includes(s.state)).length;
    wrap.append(h('div', { class: 'sum-cards' },
      h('div', { class: 'cnt ok' }, h('b', null, cont(['ACTIVA'])), h('span', null, 'Activas')),
      h('div', { class: 'cnt' }, h('b', null, cont(['POR_VENCER', 'GRACIA'])), h('span', null, 'Por vencer / gracia')),
      h('div', { class: 'cnt bad' }, h('b', null, cont(['SOLO_LECTURA', 'SUSPENDIDA'])), h('span', null, 'Sin servicio')),
      h('div', { class: 'cnt' }, h('b', null, cont(['PENDIENTE'])), h('span', null, 'Pendientes'))));
    wrap.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn small', onclick: editWhatsapp }, icon('gear', 16), ' WhatsApp de soporte: ' + (data.whatsapp || 'sin definir'))));
    if (!rows.length) wrap.append(h('div', { class: 'empty' }, 'Todavía no hay escuelas. Crea la primera con "+ Escuela".'));
    const grid = h('div', { class: 'cards-grid' });
    for (const s of rows) {
      const needsCharge = ['POR_VENCER', 'GRACIA', 'SOLO_LECTURA', 'PENDIENTE'].includes(s.state) && !s.gratuita;
      grid.append(h('div', { class: 'card school' + (s.active ? '' : ' inactive') },
        h('div', { class: 'card-head' }, h('h3', null, s.name), chip(s.state), s.gratuita ? h('span', { class: 'badge info' }, 'Gratuita') : null),
        h('small', { class: 'muted' }, [s.cct, s.locality, `${s.alumnos} alumnos`].filter(Boolean).join(' · ')),
        h('p', null, s.gratuita ? 'Licencia permanente.' : `Vigencia: ${fecha(s.vigencia_hasta)}`),
        s.admin_name ? h('p', { class: 'small' }, h('b', null, 'Administrativo: '), s.admin_name) : h('p', { class: 'note warn small' }, 'Sin administrativo registrado.'),
        s.solicitudes_nuevas ? h('p', { class: 'note warn small' }, `${s.solicitudes_nuevas} solicitud(es) de ayuda nueva(s)`) : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary small', onclick: () => detail(s.id) }, 'Licencia'),
          s.soporte_directo ? h('button', { class: 'btn small', onclick: () => onSelect(s.id) }, 'Administrar') : null,
          needsCharge && s.contact_phone ? h('button', { class: 'btn small', onclick: () => wa(s.contact_phone, msgCobro(s)) }, 'Recordar por WhatsApp') : null)));
    }
    wrap.append(grid);
    return wrap;
  }

  function editWhatsapp() {
    const inp = h('input', { type: 'tel', value: data.whatsapp || '', placeholder: '10 dígitos' });
    const save = h('button', { class: 'btn primary' }, 'Guardar');
    const m = modal({ title: 'WhatsApp de soporte', body: [h('p', { class: 'muted' }, 'Es el número al que escriben las escuelas desde "Ayuda".'), h('label', null, 'Número', inp)],
      actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), save] });
    save.onclick = () => guard(save, async () => {
      await rpc('set_support_whatsapp', { p_number: phoneDigits(inp.value) });
      state.supportWhatsapp = phoneDigits(inp.value); m.close(); toast('Guardado', 'ok'); await load();
    });
  }

  // ---------------- nueva licencia = nueva escuela
  function create() {
    const form = buildSchoolForm({ entry_time: '08:00', tolerance_min: 10, timezone: 'America/Mexico_City', grades: ['1', '2', '3'], groups: ['A', 'B', 'C'], positions: [] }, { creating: true });
    const cn = h('input', { placeholder: 'Nombre de quien contrata' }), cp = h('input', { type: 'tel', placeholder: 'WhatsApp (10 dígitos)' });
    const save = h('button', { class: 'btn primary' }, 'Crear escuela');
    const m = modal({ title: 'Nueva escuela (licencia pendiente)', wide: true,
      body: [form.el, h('h4', null, 'Contacto para cobro y soporte'), h('label', null, 'Nombre', cn), h('label', null, 'WhatsApp', cp),
        h('p', { class: 'muted small' }, 'La escuela queda "Pendiente de pago". Al registrar el pago se genera la clave del administrativo.')],
      actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), save] });
    save.onclick = () => guard(save, async () => {
      const r = await rpc('save_school', { p_school: null, p: form.values() });
      const id = r.id || r.school_id;
      if (id && (cn.value || cp.value)) await rpc('license_save', { p_school: id, p: { contact_name: cn.value.trim(), contact_phone: phoneDigits(cp.value) } });
      m.close(); await load(); if (id) detail(id);
    });
  }

  // ---------------- detalle de una licencia
  async function detail(id) {
    let d;
    try { d = await rpc('license_detail', { p_school: id }); } catch (e) { return toast(errMsg(e), 'error'); }
    const L = d.license, sc = { ...d.school, ...L, contact_name: L.contact_name, contact_phone: L.contact_phone, vigencia_hasta: L.vigencia_hasta };
    let m;

    const f = (lbl, el) => h('label', null, lbl, el);
    const cname = h('input', { value: L.contact_name || '' }), cphone = h('input', { type: 'tel', value: L.contact_phone || '' });
    const grace = h('input', { type: 'number', min: 0, max: 60, value: L.grace_days ?? 15 });
    const gratis = h('input', { type: 'checkbox' }); gratis.checked = !!L.gratuita;
    const saveBtn = h('button', { class: 'btn small', onclick: ev => guard(ev.currentTarget, async () => {
      await rpc('license_save', { p_school: id, p: { contact_name: cname.value.trim(), contact_phone: phoneDigits(cphone.value), grace_days: Number(grace.value), gratuita: gratis.checked } });
      toast('Guardado', 'ok'); m.close(); await load(); detail(id);
    }) }, 'Guardar contacto y reglas');

    // registrar pago
    const pf = h('input', { type: 'date', value: hoyIso() }), pm = h('select', null, ['Efectivo', 'Transferencia', 'Depósito', 'Otro'].map(x => h('option', null, x)));
    const pfo = h('input', { placeholder: 'Folio o referencia (opcional)' }), pn = h('input', { placeholder: 'Nota (opcional)' });
    const pv = h('input', { type: 'date' });
    const payBtn = h('button', { class: 'btn primary', onclick: ev => guard(ev.currentTarget, async () => {
      const r = await rpc('license_register_payment', { p_school: id, p: { fecha: pf.value, metodo: pm.value, folio: pfo.value, nota: pn.value, vigencia_hasta: pv.value || null } });
      const s2 = { ...sc, vigencia_hasta: r.vigencia_hasta };
      m.close(); await load();
      const code = r.clave?.code;
      const ex = h('div', null, h('p', null, `Pago registrado. Vigencia hasta el ${fecha(r.vigencia_hasta)}.`),
        code ? [h('div', { class: 'code big' }, code), h('p', { class: 'muted small' }, `La clave vence el ${new Date(r.clave.expires_at).toLocaleDateString('es-MX')} y es de un solo uso.`)] : h('p', { class: 'muted' }, 'La escuela ya tiene administrativo: no se generó clave.'));
      const acts = [h('button', { class: 'btn primary', onclick: () => m2.close() }, 'Listo')];
      if (L.contact_phone) acts.unshift(h('button', { class: 'btn', onclick: () => wa(L.contact_phone, code ? msgClave(s2, code) : `Hola, ya quedó registrado su pago. La licencia de ${s2.name} está vigente hasta el ${fecha(r.vigencia_hasta)}. Gracias.`) }, 'Avisar por WhatsApp'));
      if (code) acts.unshift(h('button', { class: 'btn', onclick: () => copyText(code) }, icon('copy', 16), ' Copiar clave'));
      const m2 = modal({ title: 'Licencia activada', body: ex, actions: acts });
    }) }, 'Registrar pago');

    const susp = h('button', { class: 'btn small ' + (L.suspended ? '' : 'danger'), onclick: async ev => {
      let reason = null;
      if (!L.suspended) {
        if (!(await confirmBox('¿Suspender la licencia? Nadie de esa escuela podrá entrar.', { ok: 'Suspender', danger: true }))) return;
        reason = (await promptBox('Motivo (opcional)', { ok: 'Suspender' })) || null;
      }
      await guard(ev.currentTarget, async () => { await rpc('license_set_suspended', { p_school: id, p_suspended: !L.suspended, p_reason: reason }); m.close(); await load(); detail(id); });
    } }, L.suspended ? 'Reactivar' : 'Suspender');

    const nota = h('input', { placeholder: 'Agregar nota interna' });
    const addNota = h('button', { class: 'btn small', onclick: ev => guard(ev.currentTarget, async () => { await rpc('license_add_note', { p_school: id, p_note: nota.value }); m.close(); detail(id); }) }, 'Agregar nota');

    const codeNow = d.school.admin_code && d.school.admin_code_expires_at && new Date(d.school.admin_code_expires_at) > new Date() ? d.school.admin_code : null;
    const genCode = h('button', { class: 'btn small', onclick: ev => guard(ev.currentTarget, async () => {
      const r = await rpc('generate_admin_code', { p_school: id }); showCode('Clave del administrativo', r.code, `Vence el ${new Date(r.expires_at).toLocaleDateString('es-MX')}. Un solo uso. Reemplaza al administrativo actual al registrarse.`);
    }) }, 'Nueva clave de administrativo');

    const content = h('div', { class: 'lic-detail' },
      h('p', null, chip(L.state), ' ', L.gratuita ? 'Licencia gratuita permanente.' : `Vigencia hasta ${fecha(L.vigencia_hasta)} · gracia ${L.grace_days} días`),
      L.suspended && L.suspended_reason ? h('p', { class: 'note bad' }, 'Suspendida: ' + L.suspended_reason) : null,
      h('p', { class: 'small muted' }, `${d.alumnos} alumnos · Última actividad: ${dt(d.ultima_actividad)} · Administrativo: ${d.admin_name ? d.admin_name + ' (' + d.admin_email + ')' : 'sin registrar'}`),
      codeNow ? h('p', null, h('b', null, 'Clave vigente: '), h('span', { class: 'mono' }, codeNow), ' ', h('button', { class: 'btn small', onclick: () => copyText(codeNow) }, 'Copiar'),
        L.contact_phone ? [' ', h('button', { class: 'btn small', onclick: () => wa(L.contact_phone, msgClave(sc, codeNow)) }, 'Enviar por WhatsApp')] : null) : null,
      h('h4', null, 'Registrar pago'),
      h('p', { class: 'muted small' }, 'Sin vigencia escrita, se renueva al 31 de julio del ciclo que corresponde. No se guarda ningún monto.'),
      h('div', { class: 'form-grid' }, f('Fecha de pago', pf), f('Método', pm), f('Folio', pfo), f('Nota', pn), f('Vigencia hasta (opcional)', pv)), payBtn,
      h('h4', null, 'Contacto y reglas'),
      h('div', { class: 'form-grid' }, f('Nombre', cname), f('WhatsApp', cphone), f('Días de gracia', grace), h('label', { class: 'check' }, gratis, ' Licencia gratuita permanente')), saveBtn,
      h('div', { class: 'btn-row' }, genCode, susp),
      h('h4', null, 'Historial de pagos'),
      d.pagos.length ? h('table', { class: 'tbl small' }, h('tbody', null, d.pagos.map(p => h('tr', null, h('td', null, fecha(p.fecha)), h('td', null, p.metodo || ''), h('td', null, p.folio || ''), h('td', null, 'hasta ' + fecha(p.vigencia_hasta)), h('td', null, p.por || ''))))) : h('p', { class: 'muted' }, 'Sin pagos.'),
      h('h4', null, 'Notas internas'),
      d.notas.map(n => h('p', { class: 'small' }, `${dt(n.at)} · ${n.por || ''}: ${n.nota}`)),
      h('div', { class: 'btn-row' }, nota, addNota));
    m = modal({ title: d.school.name, wide: true, body: content });
  }

  // ---------------- solicitudes de ayuda
  function drawSol() {
    const wrap = h('div', { class: 'cards-grid' });
    if (!req.solicitudes.length) return h('div', { class: 'empty' }, 'No hay solicitudes de ayuda.');
    for (const r of req.solicitudes) {
      const school = data.escuelas.find(s => s.id === r.school_id);
      wrap.append(h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', null, r.school), h('span', { class: 'badge ' + (r.estado === 'NUEVA' ? 'warn' : 'ok') }, r.estado === 'NUEVA' ? 'Nueva' : 'Respondida')),
        h('small', { class: 'muted' }, `${r.user_name || ''} · ${dt(r.created_at)}`),
        h('p', null, r.texto),
        r.respuesta ? h('p', { class: 'note ok small' }, 'Respuesta: ' + r.respuesta) : null,
        r.acceso_vigente ? h('p', { class: 'note info small' }, `La escuela autorizó acceso hasta ${dt(r.autorizado_hasta)}.`) : r.autoriza ? h('p', { class: 'muted small' }, r.revocada ? 'Acceso revocado por la escuela.' : 'La autorización ya venció.') : h('p', { class: 'muted small' }, 'No autorizó acceso a sus datos.'),
        h('div', { class: 'btn-row' },
          r.acceso_vigente ? h('button', { class: 'btn primary small', onclick: ev => guard(ev.currentTarget, async () => { const sid = await rpc('support_enter', { p_id: r.id }); onSelect(sid); }) }, 'Entrar a la escuela') : null,
          h('button', { class: 'btn small', onclick: () => responder(r) }, r.respuesta ? 'Editar respuesta' : 'Responder'),
          school?.contact_phone ? h('button', { class: 'btn small', onclick: () => wa(school.contact_phone, `Hola, recibimos su solicitud de ayuda del Checador QR: "${r.texto.slice(0, 120)}". `) }, 'WhatsApp') : null)));
    }
    return wrap;
  }
  function responder(r) {
    const ta = h('textarea', { rows: 4, maxlength: 1000, placeholder: 'Respuesta para la escuela' }, r.respuesta || '');
    const save = h('button', { class: 'btn primary' }, 'Enviar respuesta');
    const m = modal({ title: 'Responder a ' + r.school, body: [h('p', { class: 'muted' }, r.texto), ta], actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), save] });
    save.onclick = () => guard(save, async () => { await rpc('support_request_reply', { p_id: r.id, p_text: ta.value }); m.close(); toast('Respuesta enviada', 'ok'); await load(); });
  }

  function drawAcc() {
    if (!req.accesos.length) return h('div', { class: 'empty' }, 'Todavía no has entrado a ninguna escuela con autorización de soporte.');
    return h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Fecha', 'Escuela', 'Quién', 'Motivo'].map(x => h('th', null, x)))),
      h('tbody', null, req.accesos.map(a => h('tr', null, h('td', null, dt(a.at)), h('td', null, a.school), h('td', null, a.por || ''), h('td', null, a.motivo || '')))));
  }

  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Licencias y soporte'), h('button', { class: 'btn primary', onclick: create }, '+ Escuela')), tabs, body));
  load();
}
