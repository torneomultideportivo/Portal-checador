// Seguridad y mantenimiento: respaldo en Excel con recordatorio mensual, estado de Supabase y protecciones.
import { h, clear, toast, guard, spinner, downloadXlsx } from '../ui.js';
import { state, sid, isSuper } from '../state.js';
import { rpc } from '../api.js';
import { errMsg, fmtDate } from '../logic.js';

const KEY = () => 'checador_backup_' + sid();
const lastBackup = () => { try { return localStorage.getItem(KEY()) || ''; } catch { return ''; } };
export const backupDue = () => { const l = lastBackup(); return !l || (Date.now() - new Date(l).getTime()) > 31 * 864e5; };

export async function downloadBackup(school) {
  const d = await rpc('export_school_data', { p_school: sid() });
  const hora = x => (x ? new Date(x).toLocaleString('es-MX', { timeZone: school.timezone }) : '');
  const sheets = [
    { name: 'Alumnos', columns: [['nombre', 'ALUMNO', 44], ['grado', 'GRADO'], ['grupo', 'GRUPO'], ['curp', 'CURP', 22], ['lengua_indigena', 'LENGUA INDÍGENA', 18], ['active', 'ACTIVO']].map(([key, header, width]) => ({ key, header, width })),
      rows: d.alumnos.map(a => ({ ...a, active: a.active ? 'SÍ' : 'NO' })) },
    { name: 'Tutores', columns: [['nombre', 'TUTOR', 44], ['curp', 'CURP', 22], ['hijos', 'HIJOS', 70]].map(([key, header, width]) => ({ key, header, width })),
      rows: d.tutores.map(t => ({ ...t, hijos: (t.hijos || []).map(a => `${a.nombre} (${a.grado}° ${a.grupo})`).join('; ') })) },
    { name: 'Personal', columns: [['nombre', 'NOMBRE', 44], ['puesto', 'PUESTO', 24], ['entry_time', 'HORA ENTRADA'], ['curp', 'CURP', 22], ['active', 'ACTIVO']].map(([key, header, width]) => ({ key, header, width })),
      rows: d.personal.map(p => ({ ...p, active: p.active ? 'SÍ' : 'NO' })) },
    { name: 'Asistencia alumnos', columns: [['fecha', 'FECHA'], ['alumno', 'ALUMNO', 44], ['grado', 'GRADO'], ['grupo', 'GRUPO'], ['hora', 'HORA', 20], ['estado', 'ESTADO'], ['min_retardo', 'MIN. RETARDO'], ['registro', 'REGISTRÓ', 28]].map(([key, header, width]) => ({ key, header, width })),
      rows: d.asistencia.map(a => ({ ...a, hora: hora(a.hora) })) },
    { name: 'Asistencia personal', columns: [['fecha', 'FECHA'], ['persona', 'PERSONA', 44], ['hora', 'HORA', 20], ['estado', 'ESTADO'], ['min_retardo', 'MIN. RETARDO'], ['registro', 'REGISTRÓ', 28]].map(([key, header, width]) => ({ key, header, width })),
      rows: d.asistencia_personal.map(a => ({ ...a, hora: hora(a.hora) })) },
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  await downloadXlsx(`respaldo_${stamp}.xlsx`, sheets, [school.name, `Respaldo generado el ${fmtDate(stamp)}`]);
  try { localStorage.setItem(KEY(), new Date().toISOString()); } catch { /* sin almacenamiento */ }
}

const PROTECCIONES = [
  'Cada tabla tiene reglas de acceso: nadie ve datos de otra escuela.',
  'La aplicación no escribe directo en las tablas: todo pasa por funciones controladas.',
  'La CURP, la lengua indígena y los datos de tutores solo los lee el administrativo.',
  'Los códigos de registro son de un solo uso y vencen.',
  'Contraseñas y correos los maneja Supabase Auth, con confirmación por correo.',
  'La conexión es cifrada (HTTPS) y la llave de servicio nunca va en la aplicación.',
  'Los QR no llevan datos personales; una reposición invalida el anterior y suena la alarma si se usa.',
  'Bitácora de movimientos importantes y de quién registró cada entrada.',
];

export function render(root) {
  const school = state.school;
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('b', null, v));
  const backupBox = h('div'), sysBox = h('div');
  const drawBackup = () => {
    const l = lastBackup();
    const btn = h('button', { class: 'btn primary' }, 'Descargar respaldo ahora');
    btn.onclick = () => guard(btn, async () => { await downloadBackup(school); toast('Respaldo descargado. Guárdalo en un lugar seguro.', 'ok', 5000); drawBackup(); });
    clear(backupBox).append(backupDue() ? h('div', { class: 'note bad' }, l ? 'Pasó más de un mes desde el último respaldo.' : 'Aún no has descargado ningún respaldo en este equipo.') : null,
      kv('Último respaldo (en este equipo)', l ? new Date(l).toLocaleDateString('es-MX') : 'Nunca'), kv('Contenido', 'Alumnos, tutores, personal y asistencias (Excel)'),
      h('p', { class: 'muted small' }, 'Hazlo una vez al mes. El archivo contiene datos personales: guárdalo con cuidado y no lo compartas.'), btn);
  };
  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Seguridad y mantenimiento'), h('a', { class: 'btn', href: '#/audit' }, 'Ver bitácora')),
    h('div', { class: 'two-col' },
      h('div', { class: 'card' }, h('h3', null, 'Respaldos'), backupBox),
      h('div', { class: 'card' }, h('h3', null, 'Mantener Supabase activo'),
        h('p', { class: 'muted' }, 'El plan gratuito pausa el proyecto si pasan varios días sin actividad. Un aviso automático (GitHub Actions) lo despierta cada pocos días aunque nadie use la app.'),
        isSuper() ? sysBox : h('p', { class: 'muted small' }, 'El estado del aviso lo consulta el administrador general.')),
      h('div', { class: 'card' }, h('h3', null, 'Protección de la base de datos'),
        PROTECCIONES.map(t => h('div', { class: 'okline' }, h('span', { class: 'okdot' }, '✓'), h('span', null, t)))))));
  drawBackup();
  if (isSuper()) {
    clear(sysBox).append(spinner());
    rpc('system_status').then(s => {
      const stale = !s.last_ping || (Date.now() - new Date(s.last_ping).getTime()) > 5 * 864e5;
      clear(sysBox).append(stale ? h('div', { class: 'note bad' }, 'No hay aviso reciente. Revisa el flujo de GitHub Actions o reactiva el proyecto en Supabase.') : h('div', { class: 'note ok' }, 'Activo'),
        kv('Último aviso', s.last_ping ? new Date(s.last_ping).toLocaleString('es-MX') : 'Ninguno'), kv('Avisos recibidos', s.pings), kv('Escuelas', s.schools), kv('Alumnos', s.alumnos), kv('Personal', s.personal),
        kv('Asistencias guardadas', s.asistencias), kv('Tamaño de la base', (s.db_bytes / 1048576).toFixed(1) + ' MB (límite del plan gratuito: 500 MB)'), kv('Alarmas sin revisar', s.alarmas_pendientes));
    }).catch(e => clear(sysBox).append(h('div', { class: 'note bad' }, errMsg(e))));
  }
}
