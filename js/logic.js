// Lógica pura (sin pantalla ni red): se puede probar con Node.
// Todo lo que decide "puntual / retardo" y valida archivos vive aquí.

export const QR_PREFIX = 'AST1:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CURP_RE = /^[A-Z]{4}[0-9]{6}[A-Z]{6}[A-Z0-9]{2}$/;

export const uuid = () =>
  (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

// ---------- texto ----------
// Quita acentos pero respeta la Ñ
export function noAccents(s) {
  return String(s ?? '')
    .replace(/ñ/g, '\u0001').replace(/Ñ/g, '\u0002')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ').replace(/\u0002/g, 'Ñ');
}
export const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
export const searchKey = s => noAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
const collator = new Intl.Collator('es', { sensitivity: 'variant' });
export const cmpEs = (a, b) => collator.compare(a, b);
export const cmpStudent = (a, b) =>
  cmpEs(String(a.grado), String(b.grado)) || cmpEs(String(a.grupo), String(b.grupo)) || cmpEs(a.nombre, b.nombre);

// ---------- QR ----------
export const qrPayload = token => QR_PREFIX + token;
export function parseQr(text) {
  const t = String(text ?? '').trim();
  if (!t.startsWith(QR_PREFIX)) return null;
  const tok = t.slice(QR_PREFIX.length).trim();
  return UUID_RE.test(tok) ? tok.toLowerCase() : null;
}

// ---------- hora local de la escuela ----------
const fmtCache = new Map();
function parts(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}
export function localParts(date, tz) {
  const o = {};
  for (const p of parts(tz).formatToParts(date)) o[p.type] = p.value;
  const h = +o.hour % 24, m = +o.minute, s = +o.second;
  return { fecha: `${o.year}-${o.month}-${o.day}`, h, m, s, secs: h * 3600 + m * 60 + s };
}
export const todayLocal = (tz, now = new Date()) => localParts(now, tz).fecha;
export function timeToSecs(t) {
  const [h = 0, m = 0, s = 0] = String(t).split(':').map(Number);
  return h * 3600 + m * 60 + s;
}
export function fmtTime(iso, tz, seconds = false) {
  const d = iso instanceof Date ? iso : new Date(iso);
  const p = localParts(d, tz);
  const z = n => String(n).padStart(2, '0');
  return seconds ? `${z(p.h)}:${z(p.m)}:${z(p.s)}` : `${z(p.h)}:${z(p.m)}`;
}
export function fmtDate(fecha) { // 'YYYY-MM-DD' -> 'DD/MM/YYYY'
  const [y, m, d] = String(fecha).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
// Misma regla que la base de datos: puntual hasta hora de entrada + tolerancia (inclusive)
export function classifyAt(date, tz, entryTime, tolerance) {
  const p = localParts(date, tz);
  const entry = timeToSecs(entryTime);
  const dead = entry + (tolerance || 0) * 60;
  if (p.secs <= dead) return { status: 'PUNTUAL', late_minutes: 0, fecha: p.fecha };
  return { status: 'RETARDO', late_minutes: Math.floor((p.secs - entry) / 60), fecha: p.fecha };
}
export const classify = (date, school) => classifyAt(date, school.timezone, school.entry_time, school.tolerance_min);
// Personal: cada persona tiene su propia hora de entrada; la tolerancia es de la escuela
export const classifyStaff = (date, school, person) => classifyAt(date, school.timezone, person.entry_time, school.staff_tolerance_min ?? 5);

// Alarma por QR repetido: otro teléfono, o el mismo QR otra vez pasados N minutos.
// prev = registro que ya existe hoy ({scanned_at, device}); null si no hay alarma.
export function alarmKind(prev, nowIso, device, alarmMinutes = 10) {
  if (!prev) return null;
  if (prev.device && device && prev.device !== device) return 'OTRO_TELEFONO';
  const gap = Math.abs(new Date(nowIso).getTime() - new Date(prev.scanned_at).getTime());
  return gap > alarmMinutes * 60000 ? 'REPETIDO_TARDE' : null;
}
export function addDays(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- errores del servidor ----------
const ERR = {
  NO_AUTORIZADO: 'No tienes permiso para hacer esto.',
  ESCUELA_REQUERIDA: 'Elige primero una escuela.',
  ESCUELA_NO_EXISTE: 'La escuela no existe.',
  ESCUELA_INACTIVA: 'La escuela está desactivada.',
  CODIGO_INVALIDO: 'El código no es válido o ya venció.',
  NOMBRE_REQUERIDO: 'Falta el nombre.',
  GRADO_INVALIDO: 'El grado no existe en la configuración de la escuela.',
  GRUPO_INVALIDO: 'El grupo no existe en la configuración de la escuela.',
  GENERO_INVALIDO: 'El género debe ser H o M (o quedar vacío).',
  CURP_INVALIDA: 'La CURP no tiene un formato válido (18 caracteres).',
  CURP_DUPLICADA: 'Esa CURP ya pertenece a otro alumno.',
  ALUMNO_DUPLICADO: 'Ya existe un alumno con ese nombre en ese grado y grupo.',
  ALUMNO_NO_ENCONTRADO: 'No se encontró al alumno.',
  ALUMNO_INACTIVO: 'El alumno está dado de baja.',
  QR_NO_VALIDO: 'QR no válido (o es de otra escuela / fue reemplazado).',
  FILA_REPETIDA: 'La fila está repetida en el archivo.',
  FORMATO_INVALIDO: 'Formato inválido.',
  DEMASIADAS_FILAS: 'Demasiadas filas en una sola carga.',
  HORA_FUTURA: 'La hora del celular está adelantada. Corrige la fecha y hora del teléfono.',
  HORA_MUY_ANTIGUA: 'El registro es demasiado antiguo para sincronizarse.',
  HORA_REQUERIDA: 'Falta la hora del registro.',
  METODO_INVALIDO: 'Método de registro inválido.',
  MOTIVO_REQUERIDO: 'Escribe el motivo (mínimo 3 letras).',
  REGISTRO_NO_ENCONTRADO: 'No se encontró el registro.',
  PREFECTO_NO_ENCONTRADO: 'No se encontró a la persona.',
  SOLO_PREFECTOS: 'Solo se pueden dar de baja prefectos.',
  CUENTA_PENDIENTE: 'La cuenta aún no confirma su correo.',
  ZONA_HORARIA_INVALIDA: 'La zona horaria no es válida.',
  TOLERANCIA_INVALIDA: 'La tolerancia debe estar entre 0 y 120 minutos.',
  GRADOS_REQUERIDOS: 'Escribe al menos un grado.',
  GRUPOS_REQUERIDOS: 'Escribe al menos un grupo.',
  CURP_FECHA_INVALIDA: 'La CURP tiene una fecha de nacimiento imposible.',
  HORA_INVALIDA: 'La hora no es válida (usa HH:MM).',
  PARENTESCO_INVALIDO: 'El parentesco debe ser MDR (madre), PDR (padre) o TUL (tutor).',
  TUTOR_NOMBRE_REQUERIDO: 'A un tutor le falta el nombre o el apellido.',
  TUTOR_CURP_INVALIDA: 'La CURP de un tutor no tiene un formato válido.',
  DEMASIADOS_TUTORES: 'Máximo 4 tutores por alumno.',
  PERSONAL_NO_ENCONTRADO: 'No se encontró a la persona.',
  PERSONAL_INACTIVO: 'La persona está dada de baja.',
  ALARMA_NO_ENCONTRADA: 'No se encontró la alarma.',
  LOGO_INVALIDO: 'El logotipo debe ser una imagen PNG, JPG o WEBP pequeña.',
  ALARMA_MINUTOS_INVALIDO: 'Los minutos de la alarma deben estar entre 1 y 240.',
  UMBRAL_INVALIDO: 'Los umbrales deben ser de 1 o más.',
  RANGO_INVALIDO: 'La fecha final es anterior a la inicial.',
  RANGO_MUY_GRANDE: 'El rango de fechas es demasiado grande (máximo 13 meses).',
  VERSION_INVALIDA: 'La versión del aviso de privacidad no coincide. Recarga la aplicación.',
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'Email not confirmed': 'Aún no confirmas tu correo. Revisa tu bandeja de entrada.',
  'User already registered': 'Ese correo ya está registrado.',
  'Database error saving new user': 'No se pudo crear la cuenta: revisa que el código sea correcto y que el nombre esté completo.',
};
export function errMsg(e) {
  const raw = (e && (e.message || e.error_description || e.error)) || String(e || '');
  const key = Object.keys(ERR).find(k => raw === k || raw.includes(k));
  if (key) return ERR[key];
  if (/password/i.test(raw) && /(short|least|weak)/i.test(raw)) return 'La contraseña es muy corta o débil (mínimo 8 caracteres).';
  if (/rate limit|too many/i.test(raw)) return 'Demasiados intentos. Espera unos minutos.';
  return raw;
}
export function isNetworkError(e) {
  const m = String((e && (e.message || e)) || '');
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout/i.test(m) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false);
}

// ---------- alta masiva (Excel) ----------
const WORDS = { PRIMERO: '1', SEGUNDO: '2', TERCERO: '3', CUARTO: '4', QUINTO: '5', SEXTO: '6' };
export function normGrado(v) {
  let s = norm(v).replace(/[°º.]/g, '').replace(/GRADO/g, '').trim();
  return WORDS[s] || s;
}
export const normGrupo = v => norm(v).replace(/["'“”]/g, '').replace(/GRUPO/g, '').trim();
export function normGenero(v) {
  const s = noAccents(norm(v));
  if (!s) return '';
  if (['H', 'HOMBRE', 'MASCULINO', 'VARON', 'NINO'].includes(s)) return 'H';
  if (['M', 'MUJER', 'FEMENINO', 'NINA'].includes(s)) return 'M';
  return null; // inválido
}
const HEADERS = {
  curp: ['curp'],
  nombre: ['nombre', 'nombre completo', 'alumno', 'nombre del alumno'],
  paterno: ['primer apellido', 'apellido paterno', 'paterno'],
  materno: ['segundo apellido', 'apellido materno', 'materno'],
  nombres: ['nombres', 'nombre(s)', 'nombre (s)'],
  grado: ['grado'],
  grupo: ['grupo'],
  genero: ['genero', 'género'],
};
export function mapHeaders(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => {
    const k = searchKey(h);
    for (const [field, names] of Object.entries(HEADERS)) {
      if (names.some(n => searchKey(n) === k) && idx[field] === undefined) idx[field] = i;
    }
  });
  // "nombre" suelto + apellidos separados: el nombre suelto pasa a ser "nombres"
  if (idx.paterno !== undefined && idx.nombre !== undefined && idx.nombres === undefined) {
    idx.nombres = idx.nombre; delete idx.nombre;
  }
  return idx;
}
export function rowFromCells(cells, idx) {
  const c = f => (idx[f] === undefined ? '' : cells[idx[f]]);
  let nombre = idx.nombre !== undefined ? norm(c('nombre')) : norm([c('paterno'), c('materno'), c('nombres')].join(' '));
  return {
    curp: norm(c('curp')),
    nombre,
    grado: normGrado(c('grado')),
    grupo: normGrupo(c('grupo')),
    genero: normGenero(c('genero')),   // null = inválido
    _generoRaw: String(c('genero') ?? ''),
  };
}
const keyOf = r => `${r.nombre}|${r.grado}|${r.grupo}`;

// rows: [{row, curp, nombre, grado, grupo, genero}]; existing: [{nombre, grado, grupo, curp}]
export function validateRows(rows, school, existing = []) {
  const byCurp = new Map(existing.filter(s => s.curp).map(s => [s.curp, s]));
  const byKey = new Map(existing.filter(s => !s.curp).map(s => [keyOf(s), s]));
  const seen = new Set();
  return rows.map(r => {
    const errors = [];
    if (!r.nombre) errors.push('Falta el nombre');
    if (!r.grado) errors.push('Falta el grado');
    else if (!school.grades.includes(r.grado)) errors.push(`Grado "${r.grado}" no existe (${school.grades.join(', ')})`);
    if (!r.grupo) errors.push('Falta el grupo');
    else if (!school.groups.includes(r.grupo)) errors.push(`Grupo "${r.grupo}" no existe (${school.groups.join(', ')})`);
    if (r.genero === null) errors.push(`Género "${r._generoRaw}" no válido (usa H o M)`);
    if (r.curp && !CURP_RE.test(r.curp)) errors.push('CURP con formato inválido');
    const k = r.curp ? 'C:' + r.curp : 'N:' + keyOf(r);
    if (r.nombre && seen.has(k)) errors.push(r.curp ? 'CURP repetida en el archivo' : 'Alumno repetido en el archivo');
    seen.add(k);
    let action = 'NUEVO';
    if ((r.curp && byCurp.has(r.curp)) || byKey.has(keyOf(r)) ||
        existing.some(s => s.nombre === r.nombre && s.grado === r.grado && s.grupo === r.grupo && (!r.curp || !s.curp))) {
      action = 'ACTUALIZA';
    }
    return { ...r, genero: r.genero ?? '', errors, action: errors.length ? 'ERROR' : action };
  });
}


// ---------- CURP: cumpleaños ----------
export function curpBirth(curp) {
  const c = norm(curp);
  if (!/^[A-Z]{4}[0-9]{6}/.test(c)) return null;
  const yy = +c.slice(4, 6), mm = +c.slice(6, 8), dd = +c.slice(8, 10);
  const y = yy + (/[0-9]/.test(c[16] || '') ? 1900 : 2000);
  const d = new Date(Date.UTC(y, mm - 1, dd));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return { y, m: mm, d: dd };
}
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const fmtDiaMes = (dia, mes) => `${dia} de ${MESES[mes - 1]}`;
export function monthRange(fecha) {   // 'YYYY-MM-DD' -> primer y último día de ese mes
  const [y, m] = fecha.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const z = n => String(n).padStart(2, '0');
  return { from: `${y}-${z(m)}-01`, to: `${y}-${z(m)}-${z(last)}` };
}

// ---------- parentesco y tutores ----------
export const PARENTESCOS = { MDR: 'Madre', PDR: 'Padre', TUL: 'Tutor(a)' };
export function normParentesco(v) {   // '' = vacío (se toma TUL) · null = inválido
  const s = noAccents(norm(v));
  if (!s) return '';
  if (['MDR', 'MADRE', 'MAMA'].includes(s)) return 'MDR';
  if (['PDR', 'PADRE', 'PAPA'].includes(s)) return 'PDR';
  if (['TUL', 'TUTOR', 'TUTORA'].includes(s)) return 'TUL';
  return null;
}

// Un citatorio por familia: alumnos que comparten los mismos tutores se agrupan en uno solo
export function groupFamilies(students) {
  const groups = new Map();
  for (const s of students) {
    const ids = (s.tutores || []).map(t => t.id).sort();
    const key = ids.length ? ids.join('+') : 'solo:' + s.id;
    if (!groups.has(key)) groups.set(key, { tutores: s.tutores || [], hijos: [] });
    groups.get(key).hijos.push(s);
  }
  return [...groups.values()];
}
// Texto "Padre: JUAN ROJAS · Madre: ..." para el citatorio
export function tutorLine(tutores) {
  return (tutores || []).map(t => t.nombre).join(' / ') || 'PADRE, MADRE O TUTOR';
}

// ---------- alta masiva v2 (alumnos con apellidos y tutores) ----------
const hk = s => searchKey(s).replace(/[_\-]+/g, ' ');
const HEADERS2 = {
  curp: ['curp', 'curp alumno'],
  paterno: ['apellido paterno', 'primer apellido', 'paterno'],
  materno: ['apellido materno', 'segundo apellido', 'materno'],
  nombres: ['nombres', 'nombre(s)', 'nombre', 'nombre (s)'],
  grado: ['grado'], grupo: ['grupo'],
  lengua: ['lengua indigena', 'lengua indígena', 'habla lengua indigena', 'lengua'],
  genero: ['genero'],
};
for (const n of [1, 2]) {
  HEADERS2[`t${n}curp`] = [`tutor${n} curp`, `tutor ${n} curp`];
  HEADERS2[`t${n}paterno`] = [`tutor${n} apellido paterno`, `tutor ${n} apellido paterno`];
  HEADERS2[`t${n}materno`] = [`tutor${n} apellido materno`, `tutor ${n} apellido materno`];
  HEADERS2[`t${n}nombres`] = [`tutor${n} nombres`, `tutor ${n} nombres`, `tutor${n} nombre`];
  HEADERS2[`t${n}par`] = [`tutor${n} parentesco`, `tutor ${n} parentesco`];
}
export function mapHeaders2(headerRow) {
  const idx = {};
  headerRow.forEach((cell, i) => {
    const k = hk(cell);
    for (const [field, names] of Object.entries(HEADERS2)) {
      if (names.some(n => hk(n) === k) && idx[field] === undefined) idx[field] = i;
    }
  });
  return idx;
}
export function rowFromCells2(cells, idx) {
  const c = f => (idx[f] === undefined ? '' : cells[idx[f]]);
  const tutores = [1, 2].map(n => ({
    curp: norm(c(`t${n}curp`)), apellido_paterno: norm(c(`t${n}paterno`)), apellido_materno: norm(c(`t${n}materno`)),
    nombres: norm(c(`t${n}nombres`)), _par: normParentesco(c(`t${n}par`)), _parRaw: String(c(`t${n}par`) ?? ''),
  })).filter(t => t.curp || t.apellido_paterno || t.apellido_materno || t.nombres);
  return {
    curp: norm(c('curp')), apellido_paterno: norm(c('paterno')), apellido_materno: norm(c('materno')), nombres: norm(c('nombres')),
    grado: normGrado(c('grado')), grupo: normGrupo(c('grupo')), lengua_indigena: norm(c('lengua')),
    genero: normGenero(c('genero')), tutores,
  };
}
export const fullName = r => norm([r.apellido_paterno, r.apellido_materno, r.nombres].filter(Boolean).join(' '));
// existing: [{nombre, grado, grupo, curp}]
export function validateRows2(rows, school, existing = []) {
  const byCurp = new Set(existing.filter(s => s.curp).map(s => s.curp));
  const byKey = new Set(existing.map(s => `${s.nombre}|${s.grado}|${s.grupo}`));
  const seen = new Set();
  return rows.map(r => {
    const errors = [];
    const nombre = fullName(r);
    if (!r.nombres) errors.push('Falta el nombre(s)');
    if (!r.apellido_paterno && !r.apellido_materno) errors.push('Falta el apellido');
    if (!r.grado) errors.push('Falta el grado');
    else if (!school.grades.includes(r.grado)) errors.push(`Grado "${r.grado}" no existe (${school.grades.join(', ')})`);
    if (!r.grupo) errors.push('Falta el grupo');
    else if (!school.groups.includes(r.grupo)) errors.push(`Grupo "${r.grupo}" no existe (${school.groups.join(', ')})`);
    if (r.curp && !CURP_RE.test(r.curp)) errors.push('CURP del alumno con formato inválido');
    r.tutores.forEach((t, i) => {
      const n = i + 1;
      if (!t.nombres || (!t.apellido_paterno && !t.apellido_materno)) errors.push(`Tutor ${n}: falta nombre o apellido`);
      if (t.curp && !CURP_RE.test(t.curp)) errors.push(`Tutor ${n}: CURP con formato inválido`);
      if (t._par === null) errors.push(`Tutor ${n}: parentesco "${t._parRaw}" no válido (MDR, PDR o TUL)`);
    });
    const k = r.curp ? 'C:' + r.curp : `N:${nombre}|${r.grado}|${r.grupo}`;
    if (nombre && seen.has(k)) errors.push(r.curp ? 'CURP repetida en el archivo' : 'Alumno repetido en el archivo');
    seen.add(k);
    const action = (r.curp && byCurp.has(r.curp)) || byKey.has(`${nombre}|${r.grado}|${r.grupo}`) ? 'ACTUALIZA' : 'NUEVO';
    return { ...r, nombre, errors, action: errors.length ? 'ERROR' : action };
  });
}
// Lo que se manda al servidor
export function toServerRow2(r) {
  return {
    row: r.row, curp: r.curp, apellido_paterno: r.apellido_paterno, apellido_materno: r.apellido_materno, nombres: r.nombres,
    grado: r.grado, grupo: r.grupo, lengua_indigena: r.lengua_indigena, genero: r.genero || '',
    tutores: r.tutores.map(t => ({ curp: t.curp, apellido_paterno: t.apellido_paterno, apellido_materno: t.apellido_materno, nombres: t.nombres, parentesco: t._par || 'TUL' })),
  };
}

// ---------- alta masiva del personal ----------
const HEADERS_P = {
  curp: ['curp'], paterno: ['apellido paterno', 'primer apellido'], materno: ['apellido materno', 'segundo apellido'],
  nombres: ['nombres', 'nombre(s)', 'nombre'], puesto: ['puesto', 'cargo'], hora: ['hora de entrada', 'hora entrada', 'entrada'],
};
export function mapHeadersP(headerRow) {
  const idx = {};
  headerRow.forEach((cell, i) => {
    const k = hk(cell);
    for (const [f, names] of Object.entries(HEADERS_P)) if (names.some(n => hk(n) === k) && idx[f] === undefined) idx[f] = i;
  });
  return idx;
}
export function normHora(v) {   // '7:30' -> '07:30' · '' -> '' · inválida -> null
  const s = String(v ?? '').trim();
  if (!s) return '';
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}
export function rowFromCellsP(cells, idx) {
  const c = f => (idx[f] === undefined ? '' : cells[idx[f]]);
  return { curp: norm(c('curp')), apellido_paterno: norm(c('paterno')), apellido_materno: norm(c('materno')), nombres: norm(c('nombres')),
    puesto: String(c('puesto') ?? '').trim(), entry_time: normHora(c('hora')), _horaRaw: String(c('hora') ?? '') };
}
export function validateRowsP(rows, existing = []) {
  const have = new Set(existing.map(p => p.curp));
  const seen = new Set();
  return rows.map(r => {
    const errors = [];
    if (!r.nombres) errors.push('Falta el nombre(s)');
    if (!r.apellido_paterno && !r.apellido_materno) errors.push('Falta el apellido');
    if (!r.curp) errors.push('Falta la CURP (de ahí sale el cumpleaños)');
    else if (!CURP_RE.test(r.curp)) errors.push('CURP con formato inválido');
    else if (!curpBirth(r.curp)) errors.push('La CURP tiene una fecha de nacimiento imposible');
    if (r.entry_time === null) errors.push(`Hora "${r._horaRaw}" no válida (usa HH:MM, por ejemplo 07:30)`);
    if (r.curp && seen.has(r.curp)) errors.push('CURP repetida en el archivo');
    seen.add(r.curp);
    return { ...r, nombre: fullName(r), errors, action: errors.length ? 'ERROR' : have.has(r.curp) ? 'ACTUALIZA' : 'NUEVO' };
  });
}

// ---------- imágenes (logotipos) ----------
export const LOGO_MAX_BYTES = 350 * 1024;
