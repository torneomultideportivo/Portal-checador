// Citatorios: 3 por hoja carta. Datos fijos de la configuración de la escuela; fecha, hora y asunto se capturan aquí.
import { h, clear, toast, guard, spinner, esc } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { errMsg, groupFamilies, tutorLine, searchKey } from '../logic.js';
import { openPrintPages } from '../printing.js';

const longDate = iso => new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: state.school?.timezone || 'America/Mexico_City' }).format(new Date());

const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dmy = iso => { const [y, m, d] = iso.split('-').map(Number); return { y, m: MES[m - 1], d }; };
const TEXTO_ESTANDAR = 'Por medio del presente se le cita a usted, en esta institución educativa, el día {fecha_cita} a las {hora} horas para tratar asuntos relacionados con la educación de su hijo(a) o tutorado.';

export function missingGeneral(s) {
  return s.director ? [] : ['nombre del director(a)'];
}
export function missingData(s) {
  const m = [];
  if (!s.director) m.push('nombre del director(a)'); if (!s.subdirector) m.push('nombre del subdirector(a)');
  if (!s.director_phone) m.push('teléfono del director(a)'); if (!s.subdirector_phone) m.push('teléfono del subdirector(a)');
  return m;
}

function citatorioHtml(c, school, assets) {
  const logo = (src, side) => src ? `<img class="ct-logo ${side}" src="${src}" alt="">` : `<div class="ct-logo ${side}"></div>`;
  const hijos = c.hijos.map(s => `<b>${esc(s.nombre)}</b> (${esc(s.grado)}° &quot;${esc(s.grupo)}&quot;)`).join(', ');
  const dir = [school.address, school.postal_code ? 'C.P. ' + school.postal_code : ''].filter(Boolean).join(', ');
  return `<div class="citatorio">
    <div class="ct-head">${logo(assets.logo_ieepo, 'l')}
      <div class="ct-title"><div>INSTITUTO ESTATAL DE EDUCACIÓN PÚBLICA DE OAXACA</div><b>${esc(school.name)}</b>
        <div>C.C.T. ${esc(school.cct || '')}${school.turno ? ' · Turno ' + esc(school.turno) : ''}</div>${dir ? `<div>${esc(dir)}</div>` : ''}</div>
      ${logo(assets.logo_school, 'r')}</div>
    <div class="ct-name">CITATORIO</div>
    <p>C. <b>${esc(tutorLine(c.tutores))}</b>, padre, madre o tutor de ${hijos}.</p>
    <p>Se le solicita presentarse el <b>${esc(longDate(c.fecha))}</b> a las <b>${esc(c.hora)}</b> horas en la dirección de esta escuela para tratar el siguiente asunto:</p>
    <p class="ct-asunto">${esc(c.asunto)}</p>
    <p class="ct-note">Su presencia es importante para el buen desempeño de su hijo(a).</p>
    <div class="ct-sign"><div><span></span><b>${esc(school.director)}</b><small>Director(a) · Tel. ${esc(school.director_phone)}</small></div>
      <div><span></span><b>${esc(school.subdirector)}</b><small>Subdirector(a) · Tel. ${esc(school.subdirector_phone)}</small></div></div>
  </div>`;
}

// Citatorio general: se arma solo con los datos de la escuela; solo se captura fecha y hora de la cita.
function citatorioGeneralHtml(c, school, assets) {
  const logo = (src, side) => src ? `<img class="ct-logo ${side}" src="${src}" alt="">` : `<div class="ct-logo ${side}"></div>`;
  const up = t => esc(String(t ?? '').toLocaleUpperCase('es-MX'));
  const e = dmy(c.elaboracion), q = dmy(c.fecha);
  const lugar = assets.place_line || school.locality || '';
  const cuerpo = (assets.citation_text || TEXTO_ESTANDAR).replace(/\{fecha_cita\}/g, `${q.d} de ${q.m}`).replace(/\{hora\}/g, c.hora);
  const alumnos = c.hijos.map(s => s.nombre).join(" / "), grupos = [...new Set(c.hijos.map(s => `${s.grado}° ${s.grupo}`))].join(" / ");
  return `<div class="citatorio ctg">
    <div class="ct-head">${logo(assets.logo_ieepo, 'l')}
      <div class="ct-title">${assets.header_line ? `<div>${up(assets.header_line)}</div>` : ''}<b>${up(school.name)}</b>${school.cct ? `<div>CCT. ${up(school.cct)}</div>` : ''}</div>
      ${logo(assets.logo_school, 'r')}</div>
    <div class="ctg-asunto"><b>ASUNTO: CITATORIO</b></div>
    <div class="ctg-fecha">${lugar ? up(lugar) + ', A ' : 'A '}${e.d} DE ${up(e.m)} DEL ${e.y}.</div>
    <p>C. <b>${up(tutorLine(c.tutores))}</b> PADRE DE FAMILIA O TUTOR</p>
    <p>DEL ALUMNO (A): <b>${up(alumnos)}</b> DEL: <b>${esc(grupos)}</b></p>
    <p class="ctg-cuerpo">${up(cuerpo)}</p>
    <div class="ctg-firma"><div>ATENTAMENTE</div><span></span><b>${up(school.director)}</b><div>${up(assets.director_title || 'DIRECTOR(A) DE LA ESCUELA')}</div></div>
  </div>`;
}

export async function printCitatorios(items, school) {
  const assets = await rpc('school_assets', { p_school: sid() });
  const pages = [];
  for (let i = 0; i < items.length; i += 3) pages.push(h('div', { class: 'print-page ct-page', html: items.slice(i, i + 3).map(c => (c.general ? citatorioGeneralHtml : citatorioHtml)(c, school, assets)).join('') }));
  openPrintPages(pages, `${items.length} citatorio(s)`);
}

export function render(root) {
  const school = state.school;
  let mode = 'general', sugg = null, picked = new Map();
  const fecha = h('input', { class: 'input', type: 'date', value: todayLocal() });
  const hora = h('input', { class: 'input', type: 'time', value: '08:00' });
  const asunto = h('input', { class: 'input', placeholder: 'Asunto (ej. Retardos y faltas reiteradas)' , value: 'Asunto relacionado con la asistencia de su hijo(a)' });
  const family = h('input', { type: 'checkbox', checked: true });
  const gSel = h('select', { class: 'input' }, school.grades.map(g => h('option', { value: g }, `${g}°`)));
  const pSel = h('select', { class: 'input' }, school.groups.map(g => h('option', { value: g }, g)));
  const body = h('div'), tabs = h('div', { class: 'tabs' });
  const go = h('button', { class: 'btn primary' }, 'Preparar citatorios');
  const missingNow = () => (mode === 'individual' ? missingData(school) : missingGeneral(school));
  const warn = h('div'), asuntoBox = h('label', { class: 'field' }, h('span', null, 'Asunto (para grupo y escuela)'), asunto);

  async function loadSugg() {
    clear(body).append(spinner());
    try {
      sugg = await rpc('citation_suggestions', { p_school: sid() });
      const lim = a => a.retardos >= school.citation_late_min || a.faltas >= school.citation_absent_min;
      picked = new Map(sugg.alumnos.filter(lim).map(a => [a.id, `Acumula ${a.retardos} retardo(s) y ${a.faltas} falta(s) del ${sugg.desde.split('-').reverse().join('/')} al ${sugg.hasta.split('-').reverse().join('/')}.`]));
      drawSugg(lim);
    } catch (e) { clear(body).append(h('div', { class: 'note bad' }, errMsg(e))); }
  }
  function drawSugg(lim) {
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Buscar alumno…' });
    const tbl = h('div', { class: 'table-wrap' });
    const paint = () => {
      const w = searchKey(q.value).split(' ').filter(Boolean);
      const rows = sugg.alumnos.filter(a => w.every(x => searchKey(a.nombre).includes(x)));
      clear(tbl).append(rows.length ? h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['', 'Alumno', 'Grupo', 'Retardos', 'Faltas', 'Asunto de este citatorio'].map(t => h('th', null, t)))),
        h('tbody', null, rows.slice(0, 200).map(a => h('tr', { class: lim(a) ? 'rowwarn' : '' },
          h('td', null, h('input', { type: 'checkbox', checked: picked.has(a.id), onchange: e => { e.target.checked ? picked.set(a.id, `Acumula ${a.retardos} retardo(s) y ${a.faltas} falta(s).`) : picked.delete(a.id); paint(); } })),
          h('td', null, a.nombre), h('td', null, `${a.grado}° ${a.grupo}`), h('td', null, a.retardos), h('td', null, a.faltas),
          h('td', null, picked.has(a.id) ? h('input', { class: 'input', value: picked.get(a.id), oninput: e => picked.set(a.id, e.target.value) }) : ''))))) : h('div', { class: 'empty' }, 'Nadie con retardos o faltas en el periodo.'));
    };
    q.addEventListener('input', paint);
    clear(body).append(h('p', { class: 'muted' }, `Periodo ${sugg.desde} a ${sugg.hasta} · ${sugg.dias_con_clase} día(s) con clase. Marcados: ${school.citation_late_min}+ retardos o ${school.citation_absent_min}+ faltas (se cambia en Configuración). Tú decides a quién se cita.`), q, tbl);
    paint();
  }
  function drawMode() {
    clear(tabs).append(...[['general', 'Citatorio general · toda la escuela'], ['grupo', 'General · por grado y grupo'], ['individual', 'Con asunto (individual)']].map(([k, t]) => h('button', { class: mode === k ? 'on' : '', onclick: () => { mode = k; family.checked = k !== 'individual'; drawMode(); } }, t)));
    asuntoBox.hidden = true; paintWarn();
    go.disabled = !!missingNow().length;
    if (mode === 'individual') loadSugg();
    else clear(body).append(mode === 'grupo' ? h('div', { class: 'filters' }, gSel, pSel) : h('p', { class: 'muted' }, 'Un citatorio por familia de toda la escuela, con los datos de la escuela, el tutor y el alumno. Solo indica la fecha y la hora de la cita.'));
  }
  go.onclick = () => guard(go, async () => {
    
    const args = { p_school: sid(), p_ids: null, p_grado: null, p_grupo: null };
    if (mode === 'individual') { if (!picked.size) throw new Error('Marca al menos un alumno.'); args.p_ids = [...picked.keys()]; }
    if (mode === 'grupo') { args.p_grado = gSel.value; args.p_grupo = pSel.value; }
    const data = await rpc('citation_data', args);
    if (!data.length) throw new Error('No hay alumnos para citar.');
    const fam = family.checked ? groupFamilies(data) : data.map(s => ({ tutores: s.tutores, hijos: [s] }));
    const items = fam.map(f => ({ ...f, fecha: fecha.value, hora: hora.value, asunto: mode === 'individual' ? f.hijos.map(s => picked.get(s.id)).filter(Boolean).join(' ') : '', general: mode !== 'individual', elaboracion: todayLocal() }));
    if (!fecha.value || !hora.value) throw new Error('Indica fecha y hora de la cita.');
    await printCitatorios(items, school);
    rpc('log_citations', { p_school: sid(), p_count: items.length, p_modo: mode }).catch(() => {});
  });
  function paintWarn() {
    const m = missingNow(); clear(warn);
    if (m.length) warn.append(h('div', { class: 'note bad' }, h('b', null, 'Faltan datos obligatorios en la escuela: '), m.join(', '), '. Captúralos en ', h('a', { href: '#/settings' }, 'Configuración'), ' para poder imprimir.'));
  }
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Citatorios')), warn,
    tabs, h('div', { class: 'card' }, h('div', { class: 'grid3' }, h('label', { class: 'field' }, h('span', null, 'Fecha de la cita'), fecha), h('label', { class: 'field' }, h('span', null, 'Hora'), hora),
      asuntoBox),
      h('label', { class: 'chk' }, family, ' Un solo citatorio por familia (hermanos juntos)')),
    body, h('div', { class: 'btn-row' }, go)));
  drawMode();
}
