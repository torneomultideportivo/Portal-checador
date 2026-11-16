-- =====================================================================
-- Checador QR · parche v8
--   1) Retiro anticipado de alumnos (lo registra el prefecto en la puerta).
--   2) Conexión de solo lectura con el Concentrado de Calificaciones y Asistencias
--      (llave de integración por escuela + función de consulta).
--   3) Aviso de privacidad v2.
-- Para bases YA instaladas: ejecutar solo este archivo (se puede repetir sin riesgo).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. AVISO DE PRIVACIDAD: nueva versión (se les pedirá aceptarlo de nuevo)
-- ---------------------------------------------------------------------
create or replace function app.privacy_version() returns text
language sql immutable as $$ select 'v2'::text $$;

-- ---------------------------------------------------------------------
-- 1. RETIRO ANTICIPADO
--    Solo se registra la salida ANTES de que acabe el horario de clases.
--    La salida normal de fin de día no se registra. La autorización es un
--    documento en papel: el sistema no lo emite ni lo valida.
-- ---------------------------------------------------------------------
create table if not exists public.early_exits (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id),
  student_id       uuid not null references public.students(id) on delete cascade,
  fecha            date not null,                 -- fecha local de la escuela
  exit_at          timestamptz not null,          -- hora del retiro (con zona)
  categoria        text not null check (categoria in ('SALUD', 'CITA_FAMILIAR', 'PERMISO_DIRECCION', 'OTRO')),
  recogio          text,                          -- quién recogió al alumno (opcional, texto corto)
  recorded_by      uuid references public.profiles(id),
  recorded_by_name text not null,
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  edited_by_name   text,
  cancelled_at     timestamptz,
  cancelled_by_name text,
  cancel_reason    text
);
-- Un alumno tiene como máximo UN retiro por día (los cancelados no cuentan)
create unique index if not exists early_exits_one_per_day on public.early_exits (student_id, fecha) where cancelled_at is null;
create index if not exists early_exits_school_fecha_idx on public.early_exits (school_id, fecha);

alter table public.early_exits enable row level security;
revoke all on public.early_exits from anon, authenticated;     -- solo se lee y escribe por funciones

drop trigger if exists zz_license_guard on public.early_exits;
create trigger zz_license_guard before insert or update or delete on public.early_exits
  for each row execute function app.enforce_license();

create or replace function app.exit_label(p text) returns text
language sql immutable as $$
  select case p when 'SALUD' then 'Salud' when 'CITA_FAMILIAR' then 'Cita o asunto familiar'
                when 'PERMISO_DIRECCION' then 'Permiso de dirección' else 'Otro' end $$;

-- Datos de un alumno para la pantalla de retiro: lo identifica por su credencial (token) o por su id
create or replace function public.early_exit_lookup(p_token uuid default null, p_student uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles%rowtype; s public.schools%rowtype; st public.students%rowtype;
  a public.attendance%rowtype; e public.early_exits%rowtype; v_fecha date; v_person jsonb;
begin
  select * into p from public.profiles where id = auth.uid() and active and role in ('prefect', 'school_admin');
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  select * into s from public.schools where id = p.school_id and active;
  if not found then raise exception 'ESCUELA_INACTIVA'; end if;
  if p_student is not null then
    select * into st from public.students where id = p_student and school_id = s.id;
  elsif p_token is not null then
    select * into st from public.students where qr_token = p_token and school_id = s.id;
  end if;
  if not found then
    if p_token is not null and exists (select 1 from public.retired_tokens where token = p_token and school_id = s.id) then
      return jsonb_build_object('result', 'QR_REEMPLAZADO');
    end if;
    return jsonb_build_object('result', 'NO_ENCONTRADO');
  end if;
  v_person := jsonb_build_object('id', st.id, 'nombre', st.nombre, 'grado', st.grado, 'grupo', st.grupo);
  if not st.active then return jsonb_build_object('result', 'ALUMNO_INACTIVO', 'student', v_person); end if;
  v_fecha := (now() at time zone s.timezone)::date;
  select * into a from public.attendance where student_id = st.id and fecha = v_fecha;
  if not found then return jsonb_build_object('result', 'SIN_ENTRADA', 'student', v_person); end if;
  select * into e from public.early_exits where student_id = st.id and fecha = v_fecha and cancelled_at is null;
  if found then
    return jsonb_build_object('result', 'YA_RETIRADO', 'student', v_person, 'entrada', a.scanned_at,
      'retiro', jsonb_build_object('id', e.id, 'exit_at', e.exit_at, 'categoria', e.categoria, 'by', e.recorded_by_name));
  end if;
  return jsonb_build_object('result', 'LISTO', 'student', v_person, 'entrada', a.scanned_at);
end $$;

-- Registrar el retiro (la hora la pone el servidor, no el reloj del celular)
create or replace function public.register_early_exit(p_student uuid, p_categoria text, p_recogio text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles%rowtype; s public.schools%rowtype; st public.students%rowtype; a public.attendance%rowtype;
  v_now timestamptz := now(); v_fecha date; v_rec text; v_id uuid;
begin
  select * into p from public.profiles where id = auth.uid() and active and role in ('prefect', 'school_admin');
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  select * into s from public.schools where id = p.school_id and active;
  if not found then raise exception 'ESCUELA_INACTIVA'; end if;
  if coalesce(p_categoria, '') not in ('SALUD', 'CITA_FAMILIAR', 'PERMISO_DIRECCION', 'OTRO') then raise exception 'MOTIVO_REQUERIDO'; end if;
  v_rec := left(nullif(btrim(regexp_replace(coalesce(p_recogio, ''), '\s+', ' ', 'g')), ''), 80);
  select * into st from public.students where id = p_student and school_id = s.id;
  if not found then raise exception 'ALUMNO_NO_ENCONTRADO'; end if;
  if not st.active then raise exception 'ALUMNO_INACTIVO'; end if;
  v_fecha := (v_now at time zone s.timezone)::date;
  select * into a from public.attendance where student_id = st.id and fecha = v_fecha;
  if not found then raise exception 'SIN_ENTRADA'; end if;
  if v_now < a.scanned_at then raise exception 'HORA_ANTERIOR_A_ENTRADA'; end if;
  begin
    insert into public.early_exits (school_id, student_id, fecha, exit_at, categoria, recogio, recorded_by, recorded_by_name)
    values (s.id, st.id, v_fecha, v_now, p_categoria, v_rec, p.id, p.full_name) returning id into v_id;
  exception when unique_violation then raise exception 'YA_RETIRADO';
  end;
  perform app.log(s.id, 'RETIRO_REGISTRADO', jsonb_build_object('alumno', st.nombre, 'grado', st.grado, 'grupo', st.grupo,
                  'categoria', p_categoria, 'hora', v_now));
  return jsonb_build_object('ok', true, 'id', v_id, 'exit_at', v_now, 'categoria', p_categoria,
                            'student', jsonb_build_object('id', st.id, 'nombre', st.nombre, 'grado', st.grado, 'grupo', st.grupo));
end $$;

-- Retiros de un día (solo administrativo): incluye los cancelados, marcados como tales
create or replace function public.list_early_exits(p_school uuid default null, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); s public.schools%rowtype; v_date date;
begin
  select * into s from public.schools where id = v_sid;
  v_date := coalesce(p_date, (now() at time zone s.timezone)::date);
  return jsonb_build_object('fecha', v_date, 'retiros', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'student_id', st.id, 'nombre', st.nombre, 'grado', st.grado, 'grupo', st.grupo,
        'exit_at', e.exit_at, 'categoria', e.categoria, 'recogio', e.recogio, 'by', e.recorded_by_name,
        'entrada', a.scanned_at, 'edited_at', e.edited_at, 'edited_by', e.edited_by_name,
        'cancelled_at', e.cancelled_at, 'cancelled_by', e.cancelled_by_name, 'cancel_reason', e.cancel_reason)
      order by e.exit_at)
    from public.early_exits e join public.students st on st.id = e.student_id
    left join public.attendance a on a.student_id = e.student_id and a.fecha = e.fecha
    where e.school_id = v_sid and e.fecha = v_date), '[]'::jsonb));
end $$;

-- Cancelar un retiro (queda en la bitácora con el motivo)
create or replace function public.cancel_early_exit(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(null, true); e public.early_exits%rowtype; st public.students%rowtype;
        v_name text := (select full_name from public.profiles where id = auth.uid()); v_why text;
begin
  v_why := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
  if v_why is null or length(v_why) < 3 then raise exception 'MOTIVO_REQUERIDO'; end if;
  select * into e from public.early_exits where id = p_id and school_id = v_sid for update;
  if not found then raise exception 'RETIRO_NO_ENCONTRADO'; end if;
  if e.cancelled_at is not null then raise exception 'RETIRO_YA_CANCELADO'; end if;
  update public.early_exits set cancelled_at = now(), cancelled_by_name = v_name, cancel_reason = v_why where id = e.id;
  select * into st from public.students where id = e.student_id;
  perform app.log(v_sid, 'RETIRO_CANCELADO', jsonb_build_object('alumno', st.nombre, 'grado', st.grado, 'grupo', st.grupo,
                  'categoria', e.categoria, 'hora', e.exit_at, 'motivo_cancelacion', v_why));
end $$;

-- Corregir un retiro: motivo, hora (HH:MM local) y/o quién recogió
create or replace function public.edit_early_exit(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid := app.target_school(null, true); s public.schools%rowtype; e public.early_exits%rowtype;
  st public.students%rowtype; a public.attendance%rowtype; v_name text := (select full_name from public.profiles where id = auth.uid());
  v_cat text; v_rec text; v_at timestamptz; v_t time;
begin
  select * into s from public.schools where id = v_sid;
  select * into e from public.early_exits where id = p_id and school_id = v_sid for update;
  if not found then raise exception 'RETIRO_NO_ENCONTRADO'; end if;
  if e.cancelled_at is not null then raise exception 'RETIRO_YA_CANCELADO'; end if;
  v_cat := coalesce(nullif(p->>'categoria', ''), e.categoria);
  if v_cat not in ('SALUD', 'CITA_FAMILIAR', 'PERMISO_DIRECCION', 'OTRO') then raise exception 'MOTIVO_REQUERIDO'; end if;
  v_rec := case when p ? 'recogio' then left(nullif(btrim(regexp_replace(coalesce(p->>'recogio', ''), '\s+', ' ', 'g')), ''), 80) else e.recogio end;
  v_at := e.exit_at;
  if nullif(p->>'hora', '') is not null then
    begin v_t := (p->>'hora')::time; exception when others then raise exception 'HORA_INVALIDA'; end;
    v_at := ((e.fecha + v_t) at time zone s.timezone);
    select * into a from public.attendance where student_id = e.student_id and fecha = e.fecha;
    if found and v_at < a.scanned_at then raise exception 'HORA_ANTERIOR_A_ENTRADA'; end if;
    if v_at > now() + interval '5 minutes' then raise exception 'HORA_FUTURA'; end if;
  end if;
  update public.early_exits set categoria = v_cat, recogio = v_rec, exit_at = v_at, edited_at = now(), edited_by_name = v_name where id = e.id;
  select * into st from public.students where id = e.student_id;
  perform app.log(v_sid, 'RETIRO_CORREGIDO', jsonb_build_object('alumno', st.nombre, 'grado', st.grado, 'grupo', st.grupo,
                  'antes', jsonb_build_object('categoria', e.categoria, 'hora', e.exit_at, 'recogio', e.recogio),
                  'despues', jsonb_build_object('categoria', v_cat, 'hora', v_at, 'recogio', v_rec)));
end $$;

-- ---------------------------------------------------------------------
-- 2. CONEXIÓN CON EL CONCENTRADO (solo lectura)
--    · Una llave por escuela, guardada solo como hash (no se puede volver a ver).
--    · Apagada por defecto: la enciende el administrativo.
--    · La consulta no escribe nada, salvo la fecha del último uso y el registro de intentos.
-- ---------------------------------------------------------------------
create table if not exists public.school_integrations (
  school_id      uuid primary key references public.schools(id) on delete cascade,
  enabled        boolean not null default false,
  key_hash       text unique,
  key_prefix     text,                       -- primeros caracteres, solo para reconocer la llave en pantalla
  key_created_at timestamptz,
  last_used_at   timestamptz,
  updated_at     timestamptz not null default now()
);
create table if not exists public.integration_attempts (
  id        bigint generated always as identity primary key,
  school_id uuid,                            -- vacío cuando la llave no existe
  ok        boolean not null,
  reason    text,
  at        timestamptz not null default now()
);
create index if not exists integration_attempts_at_idx on public.integration_attempts (at);
create index if not exists integration_attempts_school_idx on public.integration_attempts (school_id, at);
alter table public.school_integrations enable row level security;
alter table public.integration_attempts enable row level security;
revoke all on public.school_integrations, public.integration_attempts from anon, authenticated;

create or replace function public.integration_status(p_school uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); i public.school_integrations%rowtype;
begin
  select * into i from public.school_integrations where school_id = v_sid;
  if not found then return jsonb_build_object('enabled', false, 'has_key', false); end if;
  return jsonb_build_object('enabled', i.enabled, 'has_key', i.key_hash is not null, 'key_prefix', i.key_prefix,
    'key_created_at', i.key_created_at, 'last_used_at', i.last_used_at,
    'fallos_recientes', (select count(*) from public.integration_attempts where school_id = v_sid and not ok and at > now() - interval '1 day'));
end $$;

create or replace function public.integration_set_enabled(p_school uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); i public.school_integrations%rowtype;
begin
  select * into i from public.school_integrations where school_id = v_sid;
  if p_enabled and (not found or i.key_hash is null) then raise exception 'GENERA_UNA_LLAVE'; end if;
  update public.school_integrations set enabled = coalesce(p_enabled, false), updated_at = now() where school_id = v_sid;
  perform app.log(v_sid, case when p_enabled then 'CONCENTRADO_ACTIVADO' else 'CONCENTRADO_DESACTIVADO' end, '{}'::jsonb);
end $$;

-- Genera (o reemplaza) la llave. Se devuelve UNA sola vez; la anterior deja de servir.
create or replace function public.integration_generate_key(p_school uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_key text;
begin
  v_key := 'CNC-' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.school_integrations (school_id, enabled, key_hash, key_prefix, key_created_at)
  values (v_sid, false, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), left(v_key, 8), now())
  on conflict (school_id) do update
    set key_hash = excluded.key_hash, key_prefix = excluded.key_prefix, key_created_at = now(), last_used_at = null, updated_at = now();
  perform app.log(v_sid, 'CONCENTRADO_LLAVE_GENERADA', '{}'::jsonb);
  return jsonb_build_object('key', v_key, 'prefix', left(v_key, 8));
end $$;

create or replace function public.integration_revoke(p_school uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true);
begin
  update public.school_integrations set enabled = false, key_hash = null, key_prefix = null, updated_at = now() where school_id = v_sid;
  perform app.log(v_sid, 'CONCENTRADO_LLAVE_REVOCADA', '{}'::jsonb);
end $$;

-- La consulta del Concentrado. Se llama desde SU servidor con la llave de la escuela.
--   POST {SUPABASE_URL}/rest/v1/rpc/concentrado_consulta   cuerpo: {"p_key": "...", "p_date": "AAAA-MM-DD"}
-- Siempre responde 200 con un JSON; si algo falla: {"ok": false, "error": "..."}.
-- Llave inválida, revocada o escuela con la conexión apagada responden exactamente igual (NO_AUTORIZADO).
create or replace function public.concentrado_consulta(p_key text, p_date text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_hash text; v_school uuid; s public.schools%rowtype; v_state text; v_date date; v_today date; v_start date;
  v_hay boolean; v_alumnos jsonb;
  c_generic constant jsonb := jsonb_build_object('ok', false, 'error', 'NO_AUTORIZADO');
begin
  delete from public.integration_attempts where at < now() - interval '2 days';
  v_hash := encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
  select i.school_id into v_school from public.school_integrations i where i.key_hash = v_hash and i.enabled;
  if v_school is not null then select * into s from public.schools where id = v_school and active; end if;
  if v_school is null or s.id is null then
    -- se registran los intentos fallidos, con tope para no llenar la tabla si alguien insiste
    if (select count(*) from public.integration_attempts where not ok and at > now() - interval '1 minute') < 200 then
      insert into public.integration_attempts (school_id, ok, reason) values (null, false, 'LLAVE');
    end if;
    return c_generic;
  end if;

  -- límite: 30 consultas por minuto por escuela
  if (select count(*) from public.integration_attempts where school_id = v_school and at > now() - interval '1 minute') >= 30 then
    insert into public.integration_attempts (school_id, ok, reason) values (v_school, false, 'LIMITE');
    return jsonb_build_object('ok', false, 'error', 'LIMITE_EXCEDIDO');
  end if;

  -- licencia: sigue funcionando en los días de gracia; con la licencia vencida o suspendida se corta
  v_state := app.license_state(v_school);
  if v_state not in ('ACTIVA', 'POR_VENCER', 'GRACIA') then
    insert into public.integration_attempts (school_id, ok, reason) values (v_school, false, 'LICENCIA');
    return jsonb_build_object('ok', false, 'error', 'LICENCIA_VENCIDA');
  end if;

  v_today := (now() at time zone s.timezone)::date;
  if p_date is null or p_date !~ '^\d{4}-\d{2}-\d{2}$' then
    insert into public.integration_attempts (school_id, ok, reason) values (v_school, false, 'FECHA');
    return jsonb_build_object('ok', false, 'error', 'FECHA_INVALIDA');
  end if;
  begin v_date := p_date::date;
  exception when others then
    insert into public.integration_attempts (school_id, ok, reason) values (v_school, false, 'FECHA');
    return jsonb_build_object('ok', false, 'error', 'FECHA_INVALIDA');
  end;
  v_start := (app.next_cycle_end(v_today - 1) - interval '1 year' + interval '1 day')::date;   -- 1 de agosto del ciclo actual
  if v_date > v_today then
    insert into public.integration_attempts (school_id, ok, reason) values (v_school, false, 'FECHA');
    return jsonb_build_object('ok', false, 'error', 'FECHA_FUTURA');
  end if;
  if v_date < v_start then
    insert into public.integration_attempts (school_id, ok, reason) values (v_school, false, 'FECHA');
    return jsonb_build_object('ok', false, 'error', 'FECHA_FUERA_DE_CICLO');
  end if;

  v_hay := exists (select 1 from public.attendance where school_id = v_school and fecha = v_date)
        or exists (select 1 from public.personal_attendance where school_id = v_school and fecha = v_date);

  select coalesce(jsonb_agg(jsonb_build_object(
      'curp', sp.curp,
      'entrada', case when a.id is null then null else to_char(a.scanned_at at time zone s.timezone, 'HH24:MI') end,
      'retiro', case when e.id is null then null
                     else jsonb_build_object('hora', to_char(e.exit_at at time zone s.timezone, 'HH24:MI'), 'categoria', app.exit_label(e.categoria)) end)
    order by sp.curp), '[]'::jsonb)
    into v_alumnos
  from public.students st
  join public.student_private sp on sp.student_id = st.id and nullif(btrim(sp.curp), '') is not null
  left join public.attendance a on a.student_id = st.id and a.fecha = v_date
  left join public.early_exits e on e.student_id = st.id and e.fecha = v_date and e.cancelled_at is null
  where st.school_id = v_school and (a.id is not null or e.id is not null);

  update public.school_integrations set last_used_at = now() where school_id = v_school;
  insert into public.integration_attempts (school_id, ok, reason) values (v_school, true, null);
  return jsonb_build_object('ok', true, 'fecha', v_date, 'hay_registros', v_hay, 'alumnos', v_alumnos);
end $$;

-- ---------------------------------------------------------------------
-- 3. RESPALDO: incluye los retiros
-- ---------------------------------------------------------------------
create or replace function public.export_school_data(p_school uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true);
begin
  perform app.log(v_sid, 'RESPALDO_DESCARGADO', '{}'::jsonb);
  return jsonb_build_object(
    'generado', now(),
    'alumnos', public.list_students_full(v_sid),
    'tutores', public.list_tutors(v_sid),
    'personal', public.list_personal(v_sid),
    'asistencia', coalesce((select jsonb_agg(jsonb_build_object('fecha', a.fecha, 'alumno', st.nombre, 'grado', st.grado,
        'grupo', st.grupo, 'hora', a.scanned_at, 'estado', a.status, 'min_retardo', a.late_minutes, 'metodo', a.method,
        'registro', a.recorded_by_name, 'sin_conexion', a.offline) order by a.fecha, st.nombre)
      from public.attendance a join public.students st on st.id = a.student_id where a.school_id = v_sid), '[]'::jsonb),
    'asistencia_personal', coalesce((select jsonb_agg(jsonb_build_object('fecha', a.fecha, 'persona', pe.nombre,
        'hora', a.scanned_at, 'estado', a.status, 'min_retardo', a.late_minutes, 'registro', a.recorded_by_name)
        order by a.fecha, pe.nombre)
      from public.personal_attendance a join public.personal pe on pe.id = a.personal_id where a.school_id = v_sid), '[]'::jsonb),
    'retiros', coalesce((select jsonb_agg(jsonb_build_object('fecha', e.fecha, 'alumno', st.nombre, 'grado', st.grado,
        'grupo', st.grupo, 'hora', e.exit_at, 'motivo', app.exit_label(e.categoria), 'recogio', e.recogio,
        'registro', e.recorded_by_name, 'cancelado', e.cancelled_at is not null, 'motivo_cancelacion', e.cancel_reason)
        order by e.fecha, st.nombre)
      from public.early_exits e join public.students st on st.id = e.student_id where e.school_id = v_sid), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 4. PERMISOS (las funciones nuevas nacen abiertas: se cierran y se abren solo las necesarias)
-- ---------------------------------------------------------------------
revoke execute on function public.early_exit_lookup(uuid, uuid), public.register_early_exit(uuid, text, text),
  public.list_early_exits(uuid, date), public.cancel_early_exit(uuid, text), public.edit_early_exit(uuid, jsonb),
  public.integration_status(uuid), public.integration_set_enabled(uuid, boolean), public.integration_generate_key(uuid),
  public.integration_revoke(uuid), public.concentrado_consulta(text, text), public.export_school_data(uuid),
  public.delete_student(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function app.exit_label(text) from public, anon, authenticated;

grant execute on function public.early_exit_lookup(uuid, uuid)            to authenticated;
grant execute on function public.register_early_exit(uuid, text, text)    to authenticated;
grant execute on function public.list_early_exits(uuid, date)             to authenticated;
grant execute on function public.cancel_early_exit(uuid, text)            to authenticated;
grant execute on function public.edit_early_exit(uuid, jsonb)             to authenticated;
grant execute on function public.integration_status(uuid)                 to authenticated;
grant execute on function public.integration_set_enabled(uuid, boolean)   to authenticated;
grant execute on function public.integration_generate_key(uuid)           to authenticated;
grant execute on function public.integration_revoke(uuid)                 to authenticated;
grant execute on function public.export_school_data(uuid)                 to authenticated;
grant execute on function public.delete_student(uuid, uuid, text, text)   to authenticated;
-- la consulta del Concentrado no tiene sesión de usuario: se autentica con la llave de la escuela
grant execute on function public.concentrado_consulta(text, text)         to anon, authenticated;
