// Estado global de la aplicación + avisos entre módulos.
export const state = {
  user: null,
  status: null,        // ACTIVO | PENDIENTE | BAJA | SIN_PERFIL
  profile: null,       // {id, full_name, email, role, school_id}
  school: null,        // escuela en uso (la propia, o la que eligió el super admin)
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  netFail: false,
  roster: [], rosterById: new Map(), rosterByToken: new Map(),
  today: new Map(),    // student_id -> registro de hoy
  staff: [], staffById: new Map(), staffByToken: new Map(),   // personal de la escuela (para escanear)
  staffToday: new Map(),   // personal_id -> registro de hoy
  scanCfg: { staff_qr_enabled: false, staff_tolerance_min: 5, alarm_minutes: 10 },
  fecha: null,
  pending: 0, failed: 0, lastSync: null,
  offlineMode: false,  // se abrió sin internet con la sesión guardada
};

const bus = new EventTarget();
export const on = (name, fn) => { bus.addEventListener(name, fn); return () => bus.removeEventListener(name, fn); };
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

export const role = () => state.profile?.role;
export const isSuper = () => role() === 'super_admin';
export const isAdmin = () => role() === 'school_admin' || isSuper();
export const canScan = () => role() === 'school_admin' || role() === 'prefect';
export const sid = () => (isSuper() ? state.school?.id : state.profile?.school_id) || null;
export const isOnline = () => state.online && !state.netFail;
