// Ajustes de la escuela: datos, cargos, hora de entrada, tolerancia, grados y grupos.
import { h, clear, toast, guard } from '../ui.js';
import { state, sid, emit, isSuper } from '../state.js';
import { rpc } from '../api.js';
import { errMsg, LOGO_MAX_BYTES } from '../logic.js';

const TZ = [['America/Mexico_City', 'Centro (CDMX, Oaxaca, Puebla, Jalisco…)'], ['America/Cancun', 'Sureste (Quintana Roo)'], ['America/Monterrey', 'Centro (Monterrey)'],
  ['America/Merida', 'Centro (Mérida)'], ['America/Chihuahua', 'Chihuahua'], ['America/Ciudad_Juarez', 'Ciudad Juárez'], ['America/Hermosillo', 'Sonora'],
  ['America/Mazatlan', 'Pacífico (Sinaloa, Nayarit, BCS)'], ['America/Tijuana', 'Noroeste (Baja California)'], ['America/Matamoros', 'Matamoros'], ['America/Bahia_Banderas', 'Bahía de Banderas']];

export function buildSchoolForm(s, { creating = false } = {}) {
  const f = (label, el, hint) => h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', { class: 'muted' }, hint) : null);
  const inp = (v, props = {}) => h('input', { class: 'input', value: v ?? '', ...props });
  const name = inp(s.name, { required: true });
  const cct = inp(s.cct, { placeholder: 'Ej. 20DES0000X', style: { textTransform: 'uppercase' } });
  const turno = inp(s.turno, { placeholder: 'Matutino / Vespertino' });
  const zona = inp(s.zona); const sector = inp(s.sector);
  const locality = inp(s.locality, { placeholder: 'Localidad, municipio' });
  const year = inp(s.school_year, { placeholder: '2026-2027' });
  const director = inp(s.director); const subdirector = inp(s.subdirector);
  const entry = inp((s.entry_time || '08:00').slice(0, 5), { type: 'time', required: true });
  const tol = inp(s.tolerance_min ?? 10, { type: 'number', min: 0, max: 120, step: 1 });
  const tzSel = h('select', { class: 'input' }, (TZ.some(t => t[0] === s.timezone) ? TZ : [[s.timezone, s.timezone], ...TZ]).map(([k, t]) => h('option', { value: k, selected: k === s.timezone }, t)));
  const grades = inp((s.grades || ['1', '2', '3']).join(', '));
  const groups = inp((s.groups || ['A', 'B', 'C']).join(', '));
  const posBox = h('div', { class: 'pos-list' });
  let positions = (s.positions || []).map(p => ({ ...p }));
  const drawPos = () => {
    clear(posBox);
    positions.forEach((p, i) => posBox.append(h('div', { class: 'grid2 pos' },
      h('input', { class: 'input', placeholder: 'Cargo (ej. Coordinador)', value: p.cargo || '', oninput: e => { p.cargo = e.target.value; } }),
      h('div', { class: 'inline' }, h('input', { class: 'input', placeholder: 'Nombre', value: p.nombre || '', oninput: e => { p.nombre = e.target.value; } }),
        h('button', { type: 'button', class: 'icon-btn', onclick: () => { positions.splice(i, 1); drawPos(); } }, '✕')))));
    posBox.append(h('button', { type: 'button', class: 'btn small', onclick: () => { positions.push({ cargo: '', nombre: '' }); drawPos(); } }, '+ Agregar cargo'));
  };
  drawPos();
  const list = v => v.split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
  const el = h('div', { class: 'form' },
    h('h3', null, 'Datos de la escuela'),
    f('Nombre de la escuela', name),
    h('div', { class: 'grid2' }, f('Clave (CCT)', cct), f('Turno', turno)),
    h('div', { class: 'grid2' }, f('Zona escolar', zona), f('Sector', sector)),
    h('div', { class: 'grid2' }, f('Localidad / municipio', locality), f('Ciclo escolar', year)),
    h('h3', null, 'Personal directivo'),
    h('div', { class: 'grid2' }, f('Director(a)', director), f('Subdirector(a)', subdirector)),
    f('Otros cargos', posBox),
    h('h3', null, 'Horario de entrada'),
    h('div', { class: 'grid2' }, f('Hora de entrada', entry), f('Tolerancia (minutos)', tol, 'Hasta esa hora + tolerancia se marca PUNTUAL; después, RETARDO.')),
    f('Zona horaria', tzSel),
    h('h3', null, 'Grados y grupos'),
    h('div', { class: 'grid2' }, f('Grados', grades, 'Separados por coma. Ej. 1, 2, 3'), f('Grupos', groups, 'Separados por coma. Ej. A, B, C')));
  const values = () => ({
    name: name.value, cct: cct.value, turno: turno.value, zona: zona.value, sector: sector.value, locality: locality.value, school_year: year.value,
    director: director.value, subdirector: subdirector.value, entry_time: entry.value, tolerance_min: Number(tol.value || 0), timezone: tzSel.value,
    grades: list(grades.value), groups: list(groups.value), positions: positions.filter(p => (p.cargo || '').trim() || (p.nombre || '').trim()),
  });
  return { el, values };
}

// Reduce una imagen a un PNG pequeño (data URL) para guardarla con la escuela
function toDataUrl(file, maxH = 220) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxH / img.height), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const out = c.toDataURL('image/png');
      out.length * 0.75 > LOGO_MAX_BYTES ? rej(new Error('LOGO_INVALIDO')) : res(out);
    };
    img.onerror = () => rej(new Error('LOGO_INVALIDO'));
    img.src = url;
  });
}

function extraForm(s) {
  const f = (label, el, hint) => h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', { class: 'muted' }, hint) : null);
  const inp = (v, props = {}) => h('input', { class: 'input', value: v ?? '', ...props });
  const address = inp(s.address, { placeholder: 'Calle, número, colonia, municipio' });
  const cp = inp(s.postal_code, { placeholder: 'C.P.', maxLength: 5 });
  const dph = inp(s.director_phone, { type: 'tel' }), sph = inp(s.subdirector_phone, { type: 'tel' });
  const sw = h('input', { type: 'checkbox', checked: !!s.staff_qr_enabled });
  const stol = inp(s.staff_tolerance_min ?? 5, { type: 'number', min: 0, max: 120 });
  const alarm = inp(s.alarm_minutes ?? 10, { type: 'number', min: 1, max: 240 });
  const lateN = inp(s.citation_late_min ?? 3, { type: 'number', min: 1 }), absN = inp(s.citation_absent_min ?? 3, { type: 'number', min: 1 });
  const logos = { logo_ieepo: undefined, logo_school: undefined };
  const logoBox = (key, label) => {
    const prev = h('div', { class: 'logo-prev' }, s['has_' + key] || s[key] ? 'Ya hay un logo guardado' : 'Sin logo');
    const showImg = src => clear(prev).append(h('img', { src, alt: label, style: { maxHeight: '70px' } }));
    if (state.school && !(s['has_' + key] === false)) {
      rpc('school_assets', { p_school: sid() }).then(a => { if (a?.[key] && logos[key] === undefined) showImg(a[key]); }).catch(() => {});
    }
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onchange: async e => {
      const fl = e.target.files[0]; if (!fl) return;
      try { logos[key] = await toDataUrl(fl); showImg(logos[key]); } catch (er) { toast(errMsg(er), 'error'); }
    } });
    return f(label, h('div', null, prev, file), 'PNG con fondo transparente, de preferencia.');
  };
  const el = h('div', { class: 'form' },
    h('h3', null, 'Datos para citatorios y credenciales'),
    f('Domicilio de la escuela', address), h('div', { class: 'grid3' }, f('Código postal', cp), f('Teléfono del director(a)', dph), f('Teléfono del subdirector(a)', sph)),
    h('div', { class: 'grid2' }, logoBox('logo_ieepo', 'Logotipo IEEPO (izquierda)'), logoBox('logo_school', 'Logotipo de la escuela (derecha)')),
    h('h3', null, 'Entrada del personal con QR'),
    h('label', { class: 'chk big' }, sw, ' Activar el registro de entrada del personal con QR en esta escuela'),
    h('p', { class: 'muted small' }, 'Encendido: todo el personal (también el que llegue después) debe escanear su QR al entrar, cada quien contra su propia hora de entrada. Apagado: el QR del personal avisa "no activada" y no registra nada.'),
    f('Tolerancia del personal (minutos)', stol),
    h('h3', null, 'Alarmas y citatorios'),
    f('Minutos para considerar sospechoso un mismo QR leído otra vez', alarm, 'Si el mismo QR se lee de nuevo pasado este tiempo, suena la alarma.'),
    h('div', { class: 'grid2' }, f('Citar a partir de (retardos)', lateN), f('Citar a partir de (faltas)', absN)));
  const values = () => {
    const v = { address: address.value, postal_code: cp.value, director_phone: dph.value, subdirector_phone: sph.value, staff_qr_enabled: sw.checked,
      staff_tolerance_min: Number(stol.value || 0), alarm_minutes: Number(alarm.value || 10), citation_late_min: Number(lateN.value || 3), citation_absent_min: Number(absN.value || 3) };
    for (const k of Object.keys(logos)) if (logos[k]) v[k] = logos[k];
    return v;
  };
  return { el, values };
}

export function render(root) {
  const form = buildSchoolForm(state.school);
  const extra = extraForm(state.school);
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Guardar cambios');
  root.append(h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('h2', null, 'Configuración de la escuela')),
    h('form', { onsubmit: e => { e.preventDefault(); guard(btn, async () => {
      await rpc('save_school', { p_school: sid(), p: form.values() });
      await rpc('save_school_extra', { p_school: sid(), p: extra.values() });
      toast('Configuración guardada', 'ok'); emit('school-changed');
    }); } }, form.el, extra.el, h('div', { class: 'sticky-actions' }, btn)),
    h('p', { class: 'muted' }, 'Los cambios de hora de entrada y tolerancia aplican a los registros nuevos; los ya guardados conservan su clasificación.')));
}
