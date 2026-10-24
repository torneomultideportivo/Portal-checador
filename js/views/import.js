// Alta masiva desde Excel: alumnos (con sus tutores) y personal. Plantilla, vista previa con errores y carga por lotes.
import { h, clear, toast, guard, badge, downloadXlsx, saveBlob, slug, confirmBox } from '../ui.js';
import { state, sid } from '../state.js';
import { rpc } from '../api.js';
import { mapHeaders2, rowFromCells2, validateRows2, toServerRow2, mapHeadersP, rowFromCellsP, validateRowsP, errMsg } from '../logic.js';
import { loadStudents } from './students.js';
import { refreshRoster, refreshStaff } from '../sync.js';

const pad = n => String(n).padStart(2, '0');
const cellText = v => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if ('result' in v) return String(v.result ?? '');
    if ('text' in v) return String(v.text ?? '');
  }
  return String(v);
};
// Las horas de Excel llegan como fecha (1899-12-30 + hora) o como fracción del día
const cellTime = v => {
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === 'number' && v >= 0 && v < 1) { const m = Math.round(v * 1440); return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; }
  if (v && typeof v === 'object' && 'result' in v) return cellTime(v.result);
  return cellText(v);
};
const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F5B' } }, alignment: { horizontal: 'center', wrapText: true } };
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function studentTemplate(school) {
  const wb = new globalThis.ExcelJS.Workbook();
  const ws = wb.addWorksheet('Alumnos');
  const cols = [['CURP', 22], ['APELLIDO PATERNO', 18], ['APELLIDO MATERNO', 18], ['NOMBRES', 22], ['GRADO', 8], ['GRUPO', 8], ['LENGUA INDÍGENA', 18]];
  for (const n of [1, 2]) cols.push([`TUTOR${n}_CURP`, 22], [`TUTOR${n}_APELLIDO PATERNO`, 18], [`TUTOR${n}_APELLIDO MATERNO`, 18], [`TUTOR${n}_NOMBRES`, 22], [`TUTOR${n}_PARENTESCO`, 12]);
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  ws.getRow(1).height = 34;
  ws.getRow(1).eachCell((c, i) => { Object.assign(c, HEAD); c.fill = { ...HEAD.fill, fgColor: { argb: i > 7 ? 'FF6A2A9E' : 'FF1F5F5B' } }; });
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 4 }];
  for (let r = 2; r <= 700; r++) {
    ws.getCell(r, 5).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${school.grades.join(',')}"`] };
    ws.getCell(r, 6).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${school.groups.join(',')}"`] };
    for (const c of [8, 13]) ws.getCell(r, c + 4).dataValidation = { type: 'list', allowBlank: true, formulae: ['"MDR,PDR,TUL"'] };
    for (const c of [1, 8, 13]) ws.getCell(r, c).numFmt = '@';
  }
  const ins = wb.addWorksheet('Instrucciones');
  ins.getColumn(1).width = 120;
  [
    'CÓMO LLENAR LA PLANTILLA',
    '',
    '1. Un alumno por renglón en la hoja "Alumnos". No cambies los títulos de la primera fila.',
    '2. Los tutores van en el MISMO renglón del alumno (TUTOR1_… y TUTOR2_…). No se suben en un archivo aparte.',
    '3. Todo se guarda en MAYÚSCULAS.',
    `4. GRADO: ${school.grades.join(', ')}.   GRUPO: ${school.groups.join(', ')}.   (Si falta alguno, agrégalo en Configuración antes de importar.)`,
    '5. CURP del alumno: 18 caracteres. De ella se toman el género y el cumpleaños. Es opcional, pero si la capturas debe ser correcta y no repetirse.',
    '6. PARENTESCO: MDR = madre · PDR = padre · TUL = tutor(a). Si se deja vacío se toma TUL.',
    '7. LENGUA INDÍGENA: escribe cuál (por ejemplo MIXTECO) o deja vacío si no habla.',
    '8. Si el alumno ya existe (misma CURP, o mismo nombre, grado y grupo) se ACTUALIZA, no se duplica. Los tutores con la misma CURP se reutilizan (hermanos).',
    '9. Dos alumnos con el mismo nombre en el mismo grupo solo se distinguen si cada uno tiene su CURP.',
  ].forEach((t, i) => { ins.getCell(i + 1, 1).value = t; if (i === 0) ins.getCell(1, 1).font = { bold: true, size: 13 }; });
  saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE }), `plantilla_alumnos_${slug(school.name)}.xlsx`);
}

export async function staffTemplate(school) {
  const wb = new globalThis.ExcelJS.Workbook();
  const ws = wb.addWorksheet('Personal');
  ws.columns = [['CURP', 22], ['APELLIDO PATERNO', 20], ['APELLIDO MATERNO', 20], ['NOMBRES', 24], ['PUESTO', 26], ['HORA DE ENTRADA', 16]].map(([header, width]) => ({ header, width }));
  ws.getRow(1).eachCell(c => Object.assign(c, HEAD));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (let r = 2; r <= 200; r++) { ws.getCell(r, 1).numFmt = '@'; ws.getCell(r, 6).numFmt = '@'; }
  const ins = wb.addWorksheet('Instrucciones');
  ins.getColumn(1).width = 120;
  [
    'CÓMO LLENAR LA PLANTILLA DE PERSONAL',
    '',
    '1. Una persona por renglón. No cambies los títulos de la primera fila.',
    '2. CURP: obligatoria (de ahí sale el cumpleaños para las felicitaciones).',
    '3. PUESTO: libre (Director, Docente, Prefecto, Intendente…).',
    '4. HORA DE ENTRADA: cada persona tiene la suya, en formato HH:MM (por ejemplo 07:30 o 13:50). Puede quedar vacía y completarse después.',
    '5. Si la persona ya existe (misma CURP) se ACTUALIZA, no se duplica.',
  ].forEach((t, i) => { ins.getCell(i + 1, 1).value = t; if (i === 0) ins.getCell(1, 1).font = { bold: true, size: 13 }; });
  saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE }), `plantilla_personal_${slug(school.name)}.xlsx`);
}

async function readSheet(file, sheetRx, mapper, isHeader, needMsg, rowMaker, timeCol) {
  const wb = new globalThis.ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets.find(w => sheetRx.test(w.name)) || wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas.');
  let headerRow = 0, idx = {};
  for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
    const m = mapper(ws.getRow(r).values.slice(1).map(cellText));
    if (isHeader(m)) { headerRow = r; idx = m; break; }
  }
  if (!headerRow) throw new Error(needMsg);
  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const raw = ws.getRow(r).values.slice(1);
    const cells = raw.map((v, i) => (timeCol !== undefined && i === idx[timeCol] ? cellTime(v) : cellText(v)));
    if (cells.every(c => !String(c).trim())) continue;
    rows.push({ row: r, ...rowMaker(cells, idx) });
  }
  return rows;
}

function dropZone(onFile) {
  const file = h('input', { type: 'file', accept: '.xlsx', hidden: true });
  file.addEventListener('change', async () => { const f = file.files[0]; if (f) await onFile(f); file.value = ''; });
  const drop = h('div', { class: 'drop', onclick: () => file.click() }, h('b', null, 'Elegir archivo Excel (.xlsx)'), h('span', null, 'o toca aquí para buscarlo'));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
  return h('div', null, drop, file);
}

const summary = (n, a, e) => h('div', { class: 'sum-cards' },
  h('div', { class: 'cnt ok' }, h('b', null, n), h('span', null, 'Nuevos')),
  h('div', { class: 'cnt' }, h('b', null, a), h('span', null, 'Se actualizan')),
  h('div', { class: 'cnt bad' }, h('b', null, e), h('span', null, 'Con error')));

// ---------- alumnos ----------
function studentsPane(school) {
  const out = h('div');
  let validated = [], errorsOnly = false;
  const draw = () => {
    clear(out);
    const count = a => validated.filter(r => r.action === a).length;
    const err = count('ERROR'), good = validated.filter(r => r.action !== 'ERROR');
    const tutN = good.reduce((s, r) => s + r.tutores.length, 0);
    const go = h('button', { class: 'btn primary', disabled: !good.length }, `Importar ${good.length} alumno(s)`);
    go.onclick = () => guard(go, async () => {
      if (err && !(await confirmBox(`Hay ${err} fila(s) con error que NO se importarán. ¿Continuar con las ${good.length} válidas?`, { ok: 'Importar válidas' }))) return;
      let ins = 0, upd = 0, serverErr = [];
      for (let i = 0; i < good.length; i += 300) {
        const r = await rpc('import_students2', { p_school: sid(), p_rows: good.slice(i, i + 300).map(toServerRow2) });
        ins += r.inserted; upd += r.updated; serverErr = serverErr.concat(r.errors);
        go.textContent = `Importando… ${Math.min(i + 300, good.length)}/${good.length}`;
      }
      refreshRoster().catch(() => {});
      clear(out).append(h('div', { class: 'note ok' }, h('b', null, 'Importación terminada. '), `${ins} nuevos · ${upd} actualizados · ${serverErr.length + err} con error.`),
        serverErr.length ? h('div', { class: 'note bad' }, serverErr.slice(0, 30).map(e => h('div', null, `Fila ${e.row}: ${errMsg({ message: e.error })}`))) : null,
        h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/students' }, 'Ver alumnos'), h('a', { class: 'btn', href: '#/cards' }, 'Imprimir QR')));
    });
    out.append(summary(count('NUEVO'), count('ACTUALIZA'), err),
      h('p', { class: 'muted' }, `${tutN} tutor(es) en las filas válidas.`),
      h('div', { class: 'btn-row' }, go,
        err ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: errorsOnly, onchange: e => { errorsOnly = e.target.checked; draw(); } }), ' Ver solo errores') : null,
        err ? h('button', { class: 'btn small', onclick: () => downloadXlsx('filas_con_error.xlsx', [{ name: 'Errores', columns: [{ header: 'Fila', key: 'row', width: 7 }, { header: 'ALUMNO', key: 'nombre', width: 40 }, { header: 'GRADO', key: 'grado' }, { header: 'GRUPO', key: 'grupo' }, { header: 'Problema', key: 'p', width: 70 }],
          rows: validated.filter(r => r.errors.length).map(r => ({ ...r, p: r.errors.join('; ') })) }]) }, 'Descargar errores') : null),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Fila', 'Estado', 'Alumno', 'Grado', 'Grupo', 'CURP', 'Tutores', 'Observación'].map(t => h('th', null, t)))),
        h('tbody', null, validated.filter(r => !errorsOnly || r.action === 'ERROR').slice(0, 400).map(r => h('tr', { class: r.action === 'ERROR' ? 'rowbad' : '' },
          h('td', null, r.row), h('td', null, badge(r.action)), h('td', null, r.nombre), h('td', null, r.grado), h('td', null, r.grupo), h('td', { class: 'mono' }, r.curp),
          h('td', null, r.tutores.map(t => h('div', { class: 'small' }, `${t._par || 'TUL'} ${[t.apellido_paterno, t.apellido_materno, t.nombres].filter(Boolean).join(' ')}`))),
          h('td', null, r.errors.join('; '))))))),
      validated.length > 400 ? h('p', { class: 'muted' }, `Se muestran las primeras 400 de ${validated.length} filas.`) : null);
  };
  const zone = dropZone(async f => {
    clear(out).append(h('p', null, 'Leyendo archivo…'));
    try {
      const rows = await readSheet(f, /alumn/i, mapHeaders2, m => (m.nombres !== undefined) && m.grado !== undefined && m.grupo !== undefined,
        'No encontré los títulos NOMBRES, GRADO y GRUPO. Usa la plantilla (los nombres ya no van en una sola columna).', rowFromCells2);
      if (!rows.length) throw new Error('El archivo no tiene alumnos.');
      const existing = (await loadStudents(true)).map(s => ({ nombre: s.nombre, grado: s.grado, grupo: s.grupo, curp: s.curp }));
      validated = validateRows2(rows, school, existing); errorsOnly = false; draw();
    } catch (e) { clear(out).append(h('div', { class: 'note bad' }, errMsg(e))); }
  });
  return h('div', null,
    h('ol', { class: 'steps' },
      h('li', null, 'Descarga la plantilla y llénala: ', h('button', { class: 'btn small', onclick: () => studentTemplate(school) }, 'Descargar plantilla de alumnos')),
      h('li', null, 'Cada renglón es un alumno con sus apellidos, nombre(s), grado, grupo, lengua indígena y hasta dos tutores (madre, padre o tutor).'),
      h('li', null, 'Sube el archivo: verás una vista previa con los errores marcados antes de guardar nada.')),
    zone, out);
}

// ---------- personal ----------
function staffPane(school) {
  const out = h('div');
  let validated = [], errorsOnly = false;
  const draw = () => {
    clear(out);
    const count = a => validated.filter(r => r.action === a).length;
    const err = count('ERROR'), good = validated.filter(r => r.action !== 'ERROR');
    const go = h('button', { class: 'btn primary', disabled: !good.length }, `Importar ${good.length} persona(s)`);
    go.onclick = () => guard(go, async () => {
      if (err && !(await confirmBox(`Hay ${err} fila(s) con error que NO se importarán. ¿Continuar con las ${good.length} válidas?`, { ok: 'Importar válidas' }))) return;
      const rows = good.map(({ row, curp, apellido_paterno, apellido_materno, nombres, puesto, entry_time }) => ({ row, curp, apellido_paterno, apellido_materno, nombres, puesto, entry_time: entry_time || null }));
      const r = await rpc('import_personal', { p_school: sid(), p_rows: rows });
      refreshStaff().catch(() => {});
      clear(out).append(h('div', { class: 'note ok' }, h('b', null, 'Importación terminada. '), `${r.inserted} nuevos · ${r.updated} actualizados · ${r.errors.length + err} con error.`),
        r.errors.length ? h('div', { class: 'note bad' }, r.errors.slice(0, 30).map(e => h('div', null, `Fila ${e.row}: ${errMsg({ message: e.error })}`))) : null,
        h('a', { class: 'btn primary', href: '#/personal' }, 'Ver personal'));
    });
    out.append(summary(count('NUEVO'), count('ACTUALIZA'), err),
      h('div', { class: 'btn-row' }, go, err ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: errorsOnly, onchange: e => { errorsOnly = e.target.checked; draw(); } }), ' Ver solo errores') : null),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Fila', 'Estado', 'Nombre', 'Puesto', 'Entrada', 'CURP', 'Observación'].map(t => h('th', null, t)))),
        h('tbody', null, validated.filter(r => !errorsOnly || r.action === 'ERROR').slice(0, 300).map(r => h('tr', { class: r.action === 'ERROR' ? 'rowbad' : '' },
          h('td', null, r.row), h('td', null, badge(r.action)), h('td', null, r.nombre), h('td', null, r.puesto), h('td', null, r.entry_time || '—'), h('td', { class: 'mono' }, r.curp), h('td', null, r.errors.join('; '))))))));
  };
  const zone = dropZone(async f => {
    clear(out).append(h('p', null, 'Leyendo archivo…'));
    try {
      const rows = await readSheet(f, /person/i, mapHeadersP, m => m.nombres !== undefined && m.curp !== undefined,
        'No encontré los títulos CURP y NOMBRES. Usa la plantilla de personal.', rowFromCellsP, 'hora');
      if (!rows.length) throw new Error('El archivo no tiene personal.');
      const existing = await rpc('list_personal', { p_school: sid() });
      validated = validateRowsP(rows, existing); errorsOnly = false; draw();
    } catch (e) { clear(out).append(h('div', { class: 'note bad' }, errMsg(e))); }
  });
  return h('div', null,
    h('ol', { class: 'steps' },
      h('li', null, 'Descarga la plantilla: ', h('button', { class: 'btn small', onclick: () => staffTemplate(school) }, 'Descargar plantilla de personal')),
      h('li', null, 'Columnas: CURP · APELLIDO PATERNO · APELLIDO MATERNO · NOMBRES · PUESTO · HORA DE ENTRADA (cada quien la suya, HH:MM).'),
      h('li', null, 'Si te falta alguien después, lo agregas con "+ Persona" en la pantalla Personal.')),
    zone, out);
}

export function render(root) {
  const school = state.school;
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  const show = which => {
    clear(tabs).append(
      h('button', { class: which === 'a' ? 'on' : '', onclick: () => show('a') }, 'Alumnos y tutores'),
      h('button', { class: which === 'p' ? 'on' : '', onclick: () => show('p') }, 'Personal'));
    clear(body).append(which === 'a' ? studentsPane(school) : staffPane(school));
  };
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Importar desde Excel')), tabs, body));
  show(location.hash.includes('personal') ? 'p' : 'a');
}
