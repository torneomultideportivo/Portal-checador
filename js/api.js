// Conexión con Supabase (autenticación + llamadas a la base de datos).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !/TU-PROYECTO|TU-LLAVE/.test(SUPABASE_URL + SUPABASE_ANON_KEY);
export const sb = configured && globalThis.supabase
  ? globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'checador-auth' },
    })
  : null;

// Las columnas de "schools" se piden por nombre: los códigos de acceso no son legibles con SELECT.
export const SCHOOL_COLS = 'id,name,cct,turno,zona,sector,locality,school_year,director,subdirector,positions,entry_time,tolerance_min,timezone,grades,groups,active,address,postal_code,director_phone,subdirector_phone,staff_qr_enabled,staff_tolerance_min,alarm_minutes,citation_late_min,citation_absent_min';

export async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}

// Trae todas las filas por páginas (Supabase entrega máx. 1000 por consulta)
export async function fetchAll(makeQuery, pageSize = 1000) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export const authApi = {
  signIn: async (email, password) => {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  signUp: async ({ email, password, fullName, code }) => {
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, code }, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
    return data;
  },
  signOut: async () => { try { await sb.auth.signOut(); } catch { /* sin conexión: se limpia igual */ } },
  resetPassword: async email => {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw error;
  },
  updatePassword: async password => {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
  },
};
