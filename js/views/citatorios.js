// Citatorios: 3 por hoja carta. Datos fijos de la configuración de la escuela; fecha, hora y asunto se capturan aquí.
import { h, clear, toast, guard, spinner, esc } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { errMsg, groupFamilies, tutorLine, searchKey, CITA_TIPOS, fechaLarga, fechaCorta, suscribe, llenar } from '../logic.js';
import { openPrintPages } from '../printing.js';

const longDate = iso => new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: state.school?.timezone || 'America/Mexico_City' }).format(new Date());


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

// Citatorio / aviso por tipo: encabezado, texto y firmas se arman solos con los datos de la escuela; el texto se puede ajustar al imprimir.
const spaced = t => esc(String(t).split('').join(' '));
function citatorioTipoHtml(c, school, assets) {
  const logo = (src, side) => src ? `<img class="ct-logo ${side}" src="${src}" alt="">` : `<div class="ct-logo ${side}"></div>`;
  const tp = c.tipo, up = t => esc(String(t ?? '').toLocaleUpperCase('es-MX'));
  const claves = [assets.internal_key, school.cct].filter(Boolean).join(' Y ');
  const alumnos = c.hijos.length ? c.hijos.map(a => a.nombre).join(' / ') : '____________________';
  const grupos = c.hijos.length ? [...new Set(c.hijos.map(a => `${a.grado}° “${a.grupo}”`))].join(' / ') : '______';
  const cuerpo = llenar(c.cuerpo, { suscribe: suscribe(school, assets), alumno: alumnos, grupo: grupos });
  const lugar = assets.place_line ? `${esc(assets.place_line)}, a ` : 'A ';
  const firma = (nombre, cargo) => `<div><span></span><b>${up(nombre)}</b><small>${up(cargo)}</small></div>`;
  const firmas = firma(school.director, assets.director_title || 'DIRECTOR(A) DE LA ESCUELA') + (tp.firmas === 2 ? firma(assets.second_signer || '', assets.second_signer_title || '') : '');
  return `<div class="citatorio ctn">
    <div class="ct-head">${logo(assets.logo_ieepo, 'l')}
      <div class="ct-title"><b class="ctn-name">${esc(school.name)}</b>${claves ? `<div>CLAVES: ${esc(claves)}</div>` : ''}${school.school_year ? `<div>CICLO ESCOLAR: ${esc(school.school_year)}</div>` : ''}</div>
      ${logo(assets.logo_school, 'r')}</div>
    <div class="ctn-asunto">ASUNTO: <b>${spaced(tp.asunto)}</b></div>
    <div class="ctn-fecha">${lugar}${esc(fechaCorta(c.elaboracion))}.</div>
    <div class="ctn-dest">C. ${c.tutores.length ? `<b>${up(tutorLine(c.tutores))}</b>` : '<span class="ctn-blank"></span>'}${tp.dest.map(x => `<div><b>${up(x)}</b></div>`).join('')}<div class="ctn-pres"><b>${spaced('PRESENTE.')}</b></div></div>
    <p class="ctn-cuerpo">${esc(cuerpo)}</p>
    <div class="ctn-aten"><b>ATENTAMENTE</b></div>
    <div class="ct-sign ctn-firmas ${tp.firmas === 2 ? 'dos' : ''}">${firmas}</div>
  </div>`;
}

export async function printCitatorios(items, school) {
  const assets = await rpc('school_assets', { p_school: sid() });
  const pages = [];
  for (let i = 0; i < items.length; i += 3) pages.push(h('div', { class: 'print-page ct-page', html: items.slice(i, i + 3).map(c => (c.tipo ? citatorioTipoHtml : citatorioHtml)(c, school, assets)).join('') }));
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
  const tipoSel = h('select', { class: 'input' }, CITA_TIPOS.map(t => h('option', { value: t.id }, t.nombre)));
  const lugar = h('input', { class: 'input' }), motivo = h('input', { class: 'input' }), documento = h('input', { class: 'input' });
  const cuerpo = h('textarea', { class: 'input', rows: 6 });
  const destSel = h('select', { class: 'input' }, h('option', { value: 'familias' }, 'Una por familia, con el nombre del tutor'), h('option', { value: 'blanco' }, 'En blanco (el nombre se escribe a mano)'));
  const copias = h('input', { class: 'input', type: 'number', min: 1, max: 300, value: 30 });
  const fLugar = h('label', { class: 'field' }, h('span', null, 'Lugar de la cita'), lugar), fMotivo = h('label', { class: 'field' }, h('span', null, 'Motivo'), motivo), fDoc = h('label', { class: 'field' }, h('span', null, 'Documento que se solicita'), documento);
  const fCopias = h('label', { class: 'field' }, h('span', null, 'Cantidad de copias'), copias);
  const tipoBox = h('div', { class: 'card' },
    h('label', { class: 'field' }, h('span', null, 'Tipo de documento'), tipoSel),
    h('div', { class: 'grid3' }, fLugar, fMotivo, fDoc),
    h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, 'Dirigido a'), destSel), fCopias),
    h('label', { class: 'field' }, h('span', null, 'Texto (puedes ajustarlo antes de imprimir)'), cuerpo,
      h('small', { class: 'muted' }, 'Se llenan solos: {suscribe} (quién firma y la escuela), {fecha_larga}, {hora}, {lugar}, {motivo}, {documento}, {alumno} y {grupo}.')));
  const tipo = () => CITA_TIPOS.find(t => t.id === tipoSel.value);
  function paintTipo(reset) {
    const t = tipo();
    if (reset) { lugar.value = t.lugar || ''; motivo.value = t.motivo || ''; documento.value = t.documento || ''; cuerpo.value = t.texto; }
    fLugar.hidden = !t.campos.includes('lugar'); fMotivo.hidden = !t.campos.includes('motivo'); fDoc.hidden = !t.campos.includes('documento');
    fCopias.hidden = destSel.value !== 'blanco';
  }
  tipoSel.addEventListener('change', () => paintTipo(true)); destSel.addEventListener('change', () => paintTipo(false));
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
    asuntoBox.hidden = true; tipoBox.hidden = mode === 'individual'; paintTipo(!cuerpo.value); paintWarn();
    go.disabled = !!missingNow().length;
    if (mode === 'individual') loadSugg();
    else clear(body).append(mode === 'grupo' ? h('div', { class: 'filters' }, gSel, pSel) : h('p', { class: 'muted' }, 'Elige el tipo de documento: se arma solo con los datos de la escuela, el tutor y el alumno. Solo indicas la fecha y la hora.'));
  }
  go.onclick = () => guard(go, async () => {
    
    if (!fecha.value || !hora.value) throw new Error('Indica fecha y hora de la cita.');
    if (mode !== 'individual') {
      const t = tipo(), elab = todayLocal();
      const texto = llenar(cuerpo.value, { fecha_larga: fechaLarga(fecha.value), fecha_cita: fechaLarga(fecha.value), hora: hora.value, lugar: lugar.value.trim(), motivo: motivo.value.trim(), documento: documento.value.trim() });
      let items;
      if (destSel.value === 'blanco') items = Array.from({ length: Math.max(1, Math.min(300, Number(copias.value) || 1)) }, () => ({ tutores: [], hijos: [], tipo: t, cuerpo: texto, elaboracion: elab }));
      else {
        const data = await rpc('citation_data', { p_school: sid(), p_ids: null, p_grado: mode === 'grupo' ? gSel.value : null, p_grupo: mode === 'grupo' ? pSel.value : null });
        if (!data.length) throw new Error('No hay alumnos para citar.');
        const fam = family.checked ? groupFamilies(data) : data.map(a => ({ tutores: a.tutores, hijos: [a] }));
        items = fam.map(f => ({ ...f, tipo: t, cuerpo: texto, elaboracion: elab }));
      }
      await printCitatorios(items, school);
      rpc('log_citations', { p_school: sid(), p_count: items.length, p_modo: `${mode}:${t.id}` }).catch(() => {});
      return;
    }
    const args = { p_school: sid(), p_ids: null, p_grado: null, p_grupo: null };
    if (!picked.size) throw new Error('Marca al menos un alumno.');
    args.p_ids = [...picked.keys()];
    const data = await rpc('citation_data', args);
    if (!data.length) throw new Error('No hay alumnos para citar.');
    const fam = family.checked ? groupFamilies(data) : data.map(s => ({ tutores: s.tutores, hijos: [s] }));
    const items = fam.map(f => ({ ...f, fecha: fecha.value, hora: hora.value, asunto: f.hijos.map(s => picked.get(s.id)).filter(Boolean).join(' '), elaboracion: todayLocal() }));
    await printCitatorios(items, school);
    rpc('log_citations', { p_school: sid(), p_count: items.length, p_modo: mode }).catch(() => {});
  });
  function paintWarn() {
    const m = missingNow(); clear(warn);
    if (m.length) warn.append(h('div', { class: 'note bad' }, h('b', null, 'Faltan datos obligatorios en la escuela: '), m.join(', '), '. Captúralos en ', h('a', { href: '#/settings' }, 'Configuración'), ' para poder imprimir.'));
  }
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Citatorios y avisos')), warn,
    tabs, tipoBox, h('div', { class: 'card' }, h('div', { class: 'grid3' }, h('label', { class: 'field' }, h('span', null, 'Fecha de la cita'), fecha), h('label', { class: 'field' }, h('span', null, 'Hora'), hora),
      asuntoBox),
      h('label', { class: 'chk' }, family, ' Un solo citatorio por familia (hermanos juntos)')),
    body, h('div', { class: 'btn-row' }, go)));
  drawMode();
}
