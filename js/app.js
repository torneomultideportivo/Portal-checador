// Arranque, menú y rutas de la aplicación.
import { h, clear, icon, toast, spinner, confirmBox, guard, modal } from './ui.js';
import { state, on, emit, isSuper, isAdmin, canScan, role, sid } from './state.js';
import { sb, rpc, configured, authApi, SCHOOL_COLS } from './api.js';
import { kvGet, kvSet, kvDel, clearStores } from './db.js';
import { loadLocal, refreshRoster, flushQueue, startBackground } from './sync.js';
import { isNetworkError, errMsg } from './logic.js';
import { renderAuth, renderRecovery, renderBlocked, renderSetup } from './views/auth.js';
import { APP_NAME } from './config.js';

const VERSION = '2.2.0';
const root = document.getElementById('app');
let cleanup = null, installEvt = null, shell = null, clockTimer = null;

// Cada pantalla se carga solo cuando se necesita
const V = (title, icon, who, file, extra = {}) => ({ title, icon, who, load: () => import(`./views/${file}.js`), ...extra });
const VIEWS = {
  scan:          V('Escanear',            'scan',   'scan',  'scan'),
  manual:        V('Manual',              'hand',   'scan',  'manual'),
  today:         V('Hoy',                 'list',   'scan',  'today'),
  probar:        V('Probar QR',           'scan',   'admin', 'probar'),
  capacitacion:  V('Capacitación',        'list',   'any',   'capacitacion'),
  retardos:      V('Retardos y faltas',   'chart',  'admin', 'retardos'),
  students:      V('Alumnos',             'users',  'admin', 'students'),
  tutors:        V('Tutores',             'users',  'admin', 'tutors'),
  personal:      V('Personal',            'users',  'admin', 'personal'),
  cards:         V('QR y credenciales',   'card',   'admin', 'cards'),
  citatorios:    V('Citatorios',          'print',  'admin', 'citatorios'),
  felicitaciones:V('Felicitaciones',      'gift',   'admin', 'felicitaciones'),
  reports:       V('Reportes',            'chart',  'admin', 'reports'),
  alarms:        V('Alarmas de QR',       'alarm',  'admin', 'alarms'),
  staff:         V('Usuarios y roles',    'shield', 'admin', 'staff'),
  privacy:       V('Aviso de privacidad', 'lock',   'admin', 'privacy'),
  security:      V('Seguridad',           'lock',   'admin', 'security'),
  settings:      V('Configuración',       'gear',   'admin', 'settings'),
  audit:         V('Bitácora',            'list',   'admin', 'audit'),
  schools:       V('Escuelas',            'school', 'super', 'schools'),
  import:        V('Importar',            'upload', 'admin', 'import', { hidden: true }),
};
const allowed = k => {
  const v = VIEWS[k]; if (!v) return false;
  if (v.who === 'super') return isSuper();
  if (v.who === 'scan') return canScan();
  if (v.who === 'any') return canScan() || isAdmin();
  return isAdmin() && (!isSuper() || !!state.school);
};
const navKeys = () => Object.keys(VIEWS).filter(k => allowed(k) && !VIEWS[k].hidden);
const primaryKeys = () => (isSuper() ? ['schools', 'students', 'reports'] : role() === 'school_admin' ? ['scan', 'manual', 'today', 'students'] : ['scan', 'manual', 'today']).filter(allowed);
const defaultRoute = () => (isSuper() ? (state.school ? 'students' : 'schools') : 'scan');

// ------------------------------------------------------------------ arranque
async function boot() {
  registerSW();
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
  if (!configured) return renderSetup(root);
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') setTimeout(() => renderRecovery(root, { onDone: enter }), 0);
  });
  window.addEventListener('hashchange', route);
  on('school-changed', reloadSchool);
  on('changed', drawStatus);
  await enter();
}

async function enter() {
  clear(root).append(spinner('Abriendo…'));
  state.offlineMode = false;
  let session = null;
  try { session = (await sb.auth.getSession()).data.session; } catch { /* sin conexión */ }
  const cached = await kvGet('ctx');
  const hasStoredLogin = !!localStorage.getItem('checador-auth');

  if (!session) {
    // Sin internet pero con sesión guardada en este celular: se puede seguir registrando
    if (cached && cached.status === 'ACTIVO' && hasStoredLogin && canWork(cached)) {
      state.offlineMode = true;
      return applyContext(cached);
    }
    return renderAuth(root, { onLogged: enter });
  }

  state.user = session.user;
  let ctx;
  try {
    ctx = await rpc('app_context');
    await kvSet('ctx', { ...ctx, user_id: session.user.id });
  } catch (e) {
    if (isNetworkError(e) && cached && cached.user_id === session.user.id) { ctx = cached; state.offlineMode = true; }
    else if (isNetworkError(e)) { clear(root).append(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, h('h2', null, 'Sin conexión'), h('p', null, 'Necesitas internet para entrar por primera vez en este celular.'), h('button', { class: 'btn primary block', onclick: enter }, 'Reintentar')))); return; }
    else { toast(errMsg(e), 'error', 6000); return renderAuth(root, { onLogged: enter }); }
  }
  return applyContext(ctx);
}
const canWork = ctx => ctx?.profile && ['school_admin', 'prefect', 'super_admin'].includes(ctx.profile.role);

async function applyContext(ctx) {
  if (ctx.status !== 'ACTIVO') {
    return renderBlocked(root, { status: ctx.status, email: ctx.profile?.email || state.user?.email, onLogout: logout, onRetry: enter });
  }
  state.status = ctx.status; state.profile = ctx.profile;
  state.school = ctx.school || null;

  if (isSuper()) {
    const last = await kvGet('superSchool');
    if (last && navigator.onLine) { try { await selectSchool(last, true); } catch { /* */ } }
  }
  if (canScan()) {
    if ((await kvGet('rosterUser')) !== state.profile.id) { await clearStores(['students', 'today']); await kvSet('rosterUser', state.profile.id); }
    await loadLocal();
    startBackground();
    if (navigator.onLine) {
      if (!state.roster.length) {
        clear(root).append(spinner('Descargando la lista de alumnos…'));
        try { await refreshRoster(); } catch (e) { if (!isNetworkError(e)) toast(errMsg(e), 'error'); }
      } else refreshRoster().catch(() => {});
      flushQueue();
    }
  }
  checkClock();
  if (!clockTimer) clockTimer = setInterval(checkClock, 10 * 60 * 1000);
  buildShell();
  route();
  if (ctx.privacy_accepted === false && navigator.onLine && !state.offlineMode && state.profile.role !== 'prefect') {
    import('./views/privacy.js').then(m => m.showPrivacyGate({ onAccepted: () => {} })).catch(() => {});
  }
}

async function selectSchool(id, silent = false) {
  const { data, error } = await sb.from('schools').select(SCHOOL_COLS).eq('id', id).single();
  if (error) throw error;
  state.school = data; await kvSet('superSchool', id);
  if (!silent) { buildShell(); location.hash = '#/students'; route(); }
}
async function reloadSchool() {
  try {
    if (isSuper()) { if (state.school) await selectSchool(state.school.id, true); }
    else { const ctx = await rpc('app_context'); state.school = ctx.school; await kvSet('ctx', { ...ctx, user_id: state.user?.id }); }
    if (canScan()) refreshRoster().catch(() => {});
    buildShell(); route();
  } catch (e) { toast(errMsg(e), 'error'); }
}

async function logout() {
  if (state.pending && !(await confirmBox(`Hay ${state.pending} registro(s) guardados en este celular que aún no se envían.\n\nSe conservarán y se enviarán cuando vuelvas a entrar con tu cuenta. ¿Cerrar sesión?`, { ok: 'Cerrar sesión', danger: true }))) return;
  await authApi.signOut();
  await kvDel('ctx'); await kvDel('superSchool');
  localStorage.removeItem('checador-auth');
  location.hash = ''; location.reload();
}

// ------------------------------------------------------------------ reloj del celular
async function checkClock() {
  if (!navigator.onLine || !sb) return;
  try {
    const t0 = Date.now();
    const srv = new Date(await rpc('server_time')).getTime();
    const t1 = Date.now();
    state.clockSkew = Math.round(((t0 + t1) / 2 - srv) / 1000);
    drawStatus();
  } catch { /* */ }
}

// ------------------------------------------------------------------ pantalla
function buildShell() {
  clear(root);
  const keys = navKeys(), prim = primaryKeys();
  const link = (k, cls = '') => h('a', { href: '#/' + k, class: 'nav-link ' + cls, data: { k } }, icon(VIEWS[k].icon, 22), h('span', null, VIEWS[k].title));
  const more = keys.filter(k => !prim.includes(k));
  const moreBtn = h('button', { class: 'nav-link', onclick: openMore }, icon('more', 22), h('span', null, 'Más'));
  const status = h('button', { class: 'chip', id: 'status', onclick: () => { if (canScan()) location.hash = '#/today'; } });
  const banner = h('div', { id: 'banner' });
  const title = h('div', { class: 'title' }, h('b', null, state.school?.name || APP_NAME), isSuper() && state.school ? h('a', { href: '#/schools', class: 'small-link' }, ' · cambiar escuela') : null);

  shell = {
    main: h('main', { id: 'view' }),
    status, banner,
  };
  root.append(
    h('header', { class: 'top' }, title, status, h('button', { class: 'icon-btn light', onclick: openAccount, 'aria-label': 'Mi cuenta' }, icon('shield', 22))),
    banner,
    h('div', { class: 'layout' },
      h('nav', { class: 'side' }, keys.map(k => link(k)), h('button', { class: 'nav-link', onclick: openAccount }, icon('logout', 22), h('span', null, 'Mi cuenta'))),
      shell.main),
    h('nav', { class: 'bottom' }, prim.map(k => link(k)), more.length ? moreBtn : h('button', { class: 'nav-link', onclick: openAccount }, icon('shield', 22), h('span', null, 'Cuenta'))));

  function openMore() {
    const m = document.createElement('div');
    m.className = 'sheet-back';
    const close = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.append(h('div', { class: 'sheet' }, h('div', { class: 'sheet-grid' }, more.map(k => h('a', { href: '#/' + k, class: 'sheet-item', onclick: close }, icon(VIEWS[k].icon, 26), h('span', null, VIEWS[k].title))),
      h('button', { class: 'sheet-item', onclick: () => { close(); openAccount(); } }, icon('shield', 26), h('span', null, 'Mi cuenta')))));
    document.body.append(m);
  }
  drawStatus();
}

function drawStatus() {
  const s = document.getElementById('status'), b = document.getElementById('banner');
  if (!s) return;
  const offline = !state.online || state.netFail;
  const n = state.pending, f = state.failed;
  s.className = 'chip ' + (f ? 'bad' : offline ? 'warn' : n ? 'info' : 'ok');
  clear(s);
  if (!canScan()) { s.hidden = true; } else {
    s.hidden = false;
    s.append(icon(offline ? 'wifioff' : n ? 'sync' : 'check', 16), ' ', f ? `${f} con error` : offline ? (n ? `Sin conexión · ${n} por enviar` : 'Sin conexión') : n ? `Enviando ${n}…` : 'En línea');
  }
  clear(b);
  if (state.clockSkew !== undefined && Math.abs(state.clockSkew) > 120) {
    b.append(h('div', { class: 'banner bad' }, `⚠ La hora de este celular está ${state.clockSkew > 0 ? 'adelantada' : 'atrasada'} ${Math.round(Math.abs(state.clockSkew) / 60)} min. Actívala en automático (Ajustes del teléfono → Fecha y hora) o los retardos saldrán mal.`));
  } else if (state.offlineMode) {
    b.append(h('div', { class: 'banner warn' }, 'Abierto sin conexión: los registros se guardan en este celular y se envían al volver el internet.'));
  }
}

function openAccount() {
  const m = modal({ title: 'Mi cuenta', body: h('div', { class: 'account' },
    h('p', null, h('b', null, state.profile.full_name), h('br'), state.profile.email),
    h('p', { class: 'muted' }, { super_admin: 'Administrador general', school_admin: 'Administrativo de la escuela', prefect: 'Prefecto / personal de puerta' }[role()], state.school ? ` · ${state.school.name}` : ''),
    canScan() ? h('p', { class: 'muted' }, `En este celular: ${state.roster.length} alumnos · ${state.pending} por enviar`) : null,
    h('div', { class: 'btn-col' },
      canScan() ? h('button', { class: 'btn', onclick: ev => guard(ev.currentTarget, async () => { await refreshRoster(); await flushQueue(); toast('Lista actualizada', 'ok'); m.close(); }) }, 'Actualizar lista de alumnos y enviar pendientes') : null,
      installEvt ? h('button', { class: 'btn', onclick: async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; m.close(); } }, 'Instalar la aplicación en este dispositivo') : null,
      h('button', { class: 'btn danger', onclick: () => { m.close(); logout(); } }, icon('logout', 18), ' Cerrar sesión')),
    h('p', { class: 'muted small' }, `${APP_NAME} · versión ${VERSION}`)) });
}

// ------------------------------------------------------------------ rutas
async function route() {
  if (!shell || !state.profile) return;
  let k = (location.hash.replace(/^#\/?/, '') || '').split('?')[0];
  if (!allowed(k)) { k = defaultRoute(); if (location.hash !== '#/' + k) { history.replaceState(null, '', '#/' + k); } }
  document.querySelectorAll('.nav-link[data-k]').forEach(a => a.classList.toggle('active', a.dataset.k === k));
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  const main = shell.main;
  clear(main).append(spinner());
  try {
    const mod = await VIEWS[k].load();
    if ((location.hash.replace(/^#\/?/, '') || defaultRoute()).split('?')[0] !== k) return;   // el usuario ya cambió de pantalla
    clear(main);
    cleanup = mod.render(main, { onSelect: id => selectSchool(id).catch(e => toast(errMsg(e), 'error')) }) || null;
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    clear(main).append(h('div', { class: 'empty' }, 'No se pudo abrir esta pantalla. ', isNetworkError(e) ? 'Necesita conexión la primera vez.' : errMsg(e)));
  }
}

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW', err));
  }
}

boot();
