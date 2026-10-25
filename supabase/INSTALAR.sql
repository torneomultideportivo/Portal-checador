-- =====================================================================
-- CHECADOR DE ASISTENCIA ESCOLAR  ·  Esquema para Supabase (PostgreSQL)
-- ---------------------------------------------------------------------
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO este
-- archivo → Run. Se puede volver a ejecutar sin romper nada.
--
-- Modelo de seguridad
--   · super_admin  : el desarrollador (Omar). Ve y administra todas las escuelas.
--   · school_admin : UN administrativo activo por escuela.
--   · prefect      : personal de puerta; solo registra entradas.
--   · Cada escuela es independiente (RLS por school_id).
--   · Todo cambio se hace por funciones (RPC); las tablas son de solo lectura
--     para la aplicación.
-- =====================================================================

create schema if not exists app;
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

create table if not exists public.schools (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  cct                   text,                    -- clave de centro de trabajo
  turno                 text,
  zona                  text,
  sector                text,
  locality              text,                    -- localidad / municipio
  school_year           text,                    -- ciclo escolar
  director              text,
  subdirector           text,
  positions             jsonb not null default '[]'::jsonb,   -- otros cargos [{cargo, nombre}]
  entry_time            time not null default '08:00',
  tolerance_min         int  not null default 10 check (tolerance_min between 0 and 120),
  timezone              text not null default 'America/Mexico_City',
  grades                text[] not null default '{1,2,3}',
  groups                text[] not null default '{A,B,C}',
  admin_code            text unique,             -- código para registrar al administrativo (un solo uso)
  admin_code_expires_at timestamptz,
  staff_code            text unique,             -- código para registrar prefectos (reutilizable)
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  school_id      uuid references public.schools(id),
  role           text not null check (role in ('super_admin','school_admin','prefect')),
  full_name      text not null,
  email          text not null,
  active         boolean not null default false,
  code_used      text,
  created_at     timestamptz not null default now(),
  activated_at   timestamptz,
  deactivated_at timestamptz,
  check ((role = 'super_admin' and school_id is null) or (role <> 'super_admin' and school_id is not null))
);
-- Nunca puede haber dos administrativos activos en la misma escuela
create unique index if not exists one_active_admin_per_school
  on public.profiles (school_id) where role = 'school_admin' and active;

create table if not exists public.super_admin_emails (email text primary key);

create table if not exists public.students (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id),
  nombre     text not null,                       -- APELLIDOS NOMBRES, en mayúsculas
  grado      text not null,
  grupo      text not null,
  genero     text check (genero in ('H','M')),    -- vacío si no se conoce
  qr_token   uuid not null unique default gen_random_uuid(),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists students_school_idx on public.students (school_id, grado, grupo);

-- Datos sensibles aparte: solo el administrativo de la escuela puede leerlos
create table if not exists public.student_private (
  student_id uuid primary key references public.students(id) on delete cascade,
  school_id  uuid not null references public.schools(id),
  curp       text not null,
  unique (school_id, curp)
);

create table if not exists public.attendance (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id),
  student_id       uuid not null references public.students(id),
  fecha            date not null,                 -- fecha local de la escuela
  scanned_at       timestamptz not null,          -- hora real del escaneo (reloj del celular)
  status           text not null check (status in ('PUNTUAL','RETARDO')),
  late_minutes     int  not null default 0,
  method           text not null check (method in ('QR','MANUAL')),
  recorded_by      uuid references public.profiles(id),
  recorded_by_name text not null,
  device           text,
  offline          boolean not null default false, -- true si se registró sin conexión
  synced_at        timestamptz not null default now(),
  unique (student_id, fecha)
);
create index if not exists attendance_school_fecha_idx on public.attendance (school_id, fecha);
create index if not exists attendance_user_idx on public.attendance (recorded_by, fecha);

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  school_id  uuid references public.schools(id),
  user_id    uuid,
  user_name  text,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_school_idx on public.audit_log (school_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. FUNCIONES AUXILIARES (esquema app)
-- ---------------------------------------------------------------------

create or replace function app.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() and active $$;

create or replace function app.my_school() returns uuid
language sql stable security definer set search_path = public as
$$ select school_id from public.profiles where id = auth.uid() and active $$;

create or replace function app.is_super() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid() and active), false) $$;

create or replace function app.norm(t text) returns text
language sql immutable as
$$ select nullif(upper(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')), '') $$;

create or replace function app.new_code(p_prefix text) returns text
language sql volatile as
$$ select p_prefix || '-' || upper(substr(h,1,4)) || '-' || upper(substr(h,5,4)) || '-' || upper(substr(h,9,4))
   from (select replace(gen_random_uuid()::text, '-', '') as h) x $$;

-- Escuela sobre la que opera quien llama (super_admin debe indicarla)
create or replace function app.target_school(p_school uuid, p_need_admin boolean default true) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_role text := app.my_role(); v_sch uuid := app.my_school();
begin
  if v_role is null then raise exception 'NO_AUTORIZADO'; end if;
  if v_role = 'super_admin' then
    if p_school is null then raise exception 'ESCUELA_REQUERIDA'; end if;
    if not exists (select 1 from public.schools where id = p_school) then raise exception 'ESCUELA_NO_EXISTE'; end if;
    return p_school;
  end if;
  if p_need_admin and v_role <> 'school_admin' then raise exception 'NO_AUTORIZADO'; end if;
  if p_school is not null and p_school <> v_sch then raise exception 'NO_AUTORIZADO'; end if;
  return v_sch;
end $$;

create or replace function app.log(p_school uuid, p_action text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as
$$ insert into public.audit_log (school_id, user_id, user_name, action, detail)
   values (p_school, auth.uid(), (select full_name from public.profiles where id = auth.uid()), p_action, coalesce(p_detail, '{}'::jsonb)) $$;

create or replace function app.touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists students_touch on public.students;
create trigger students_touch before update on public.students
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. REGISTRO DE CUENTAS (por código de escuela + correo confirmado)
-- ---------------------------------------------------------------------

-- Activa la cuenta cuando el correo ya fue confirmado.
-- Si es el relevo del administrativo, da de baja al anterior en el mismo paso.
create or replace function app.activate_profile(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; s public.schools%rowtype; v_old uuid;
begin
  select * into p from public.profiles where id = p_uid for update;
  if not found or p.active then return; end if;

  if p.role = 'school_admin' then
    select * into s from public.schools where id = p.school_id for update;
    -- el código ya se usó, cambió o venció: la cuenta queda pendiente
    if s.admin_code is distinct from p.code_used or s.admin_code_expires_at is null or s.admin_code_expires_at < now() then
      return;
    end if;
    select id into v_old from public.profiles
      where school_id = p.school_id and role = 'school_admin' and active and id <> p.id;
    if v_old is not null then
      update public.profiles set active = false, deactivated_at = now() where id = v_old;
    end if;
    update public.schools set admin_code = null, admin_code_expires_at = null where id = p.school_id;
  elsif p.role = 'prefect' then
    if not exists (select 1 from public.schools where id = p.school_id and active) then return; end if;
  end if;

  update public.profiles set active = true, activated_at = now(), code_used = null where id = p.id;
  insert into public.audit_log (school_id, user_id, user_name, action, detail)
  values (p.school_id, p.id, p.full_name,
          case p.role when 'school_admin' then 'ADMINISTRATIVO_ACTIVADO' when 'prefect' then 'PREFECTO_ACTIVADO' else 'SUPERADMIN_ACTIVADO' end,
          jsonb_build_object('email', p.email, 'reemplaza_a', v_old));
end $$;

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(btrim(coalesce(new.raw_user_meta_data->>'code', '')));
  v_name text := btrim(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', ''), '\s+', ' ', 'g'));
  s public.schools%rowtype;
begin
  if length(v_name) < 3 then raise exception 'NOMBRE_REQUERIDO'; end if;

  if exists (select 1 from public.super_admin_emails where lower(email) = lower(new.email)) then
    insert into public.profiles (id, school_id, role, full_name, email)
    values (new.id, null, 'super_admin', v_name, new.email);
  else
    select * into s from public.schools
      where active and admin_code = v_code and admin_code_expires_at > now();
    if found then
      insert into public.profiles (id, school_id, role, full_name, email, code_used)
      values (new.id, s.id, 'school_admin', v_name, new.email, v_code);
    else
      select * into s from public.schools where active and staff_code = v_code;
      if found then
        insert into public.profiles (id, school_id, role, full_name, email)
        values (new.id, s.id, 'prefect', v_name, new.email);
      else
        raise exception 'CODIGO_INVALIDO';
      end if;
    end if;
  end if;

  if new.email_confirmed_at is not null then perform app.activate_profile(new.id); end if;
  return new;
end $$;

create or replace function app.on_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform app.activate_profile(new.id);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function app.on_user_confirmed();

-- Pantalla de registro: verifica el código antes de crear la cuenta
create or replace function public.validate_signup(p_email text, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); s public.schools%rowtype;
begin
  if exists (select 1 from public.super_admin_emails where lower(email) = lower(btrim(coalesce(p_email, '')))) then
    return jsonb_build_object('valid', true, 'role', 'super_admin', 'school', null);
  end if;
  select * into s from public.schools where active and admin_code = v_code and admin_code_expires_at > now();
  if found then return jsonb_build_object('valid', true, 'role', 'school_admin', 'school', s.name); end if;
  select * into s from public.schools where active and staff_code = v_code;
  if found then return jsonb_build_object('valid', true, 'role', 'prefect', 'school', s.name); end if;
  return jsonb_build_object('valid', false);
end $$;

-- Contexto de la sesión (perfil + escuela). Responde aunque la cuenta esté pendiente o de baja.
create or replace function public.app_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles%rowtype; v_status text; v_school jsonb;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('status', 'SIN_PERFIL'); end if;
  v_status := case when p.active then 'ACTIVO' when p.activated_at is null then 'PENDIENTE' else 'BAJA' end;
  select to_jsonb(x) into v_school from (
    select id, name, cct, turno, zona, sector, locality, school_year, director, subdirector, positions,
           entry_time, tolerance_min, timezone, grades, groups, active
    from public.schools where id = p.school_id) x;
  return jsonb_build_object('status', v_status,
    'profile', jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role, 'school_id', p.school_id),
    'school', v_school);
end $$;

-- ---------------------------------------------------------------------
-- 4. ESCUELAS Y ACCESO
-- ---------------------------------------------------------------------

create or replace function public.save_school(p_school uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := app.my_role();
  s public.schools%rowtype;
  v_creating boolean := (p_school is null);
  v_arr text[];
  v_code text;
begin
  if v_role is null then raise exception 'NO_AUTORIZADO'; end if;
  if v_creating then
    if v_role <> 'super_admin' then raise exception 'NO_AUTORIZADO'; end if;
    s.entry_time := '08:00'; s.tolerance_min := 10; s.timezone := 'America/Mexico_City';
    s.grades := '{1,2,3}'; s.groups := '{A,B,C}'; s.positions := '[]'::jsonb;
  else
    select * into s from public.schools where id = app.target_school(p_school, true);
  end if;

  if p ? 'name'          then s.name        := nullif(btrim(p->>'name'), ''); end if;
  if p ? 'cct'           then s.cct         := app.norm(p->>'cct'); end if;
  if p ? 'turno'         then s.turno       := nullif(btrim(p->>'turno'), ''); end if;
  if p ? 'zona'          then s.zona        := nullif(btrim(p->>'zona'), ''); end if;
  if p ? 'sector'        then s.sector      := nullif(btrim(p->>'sector'), ''); end if;
  if p ? 'locality'      then s.locality    := nullif(btrim(p->>'locality'), ''); end if;
  if p ? 'school_year'   then s.school_year := nullif(btrim(p->>'school_year'), ''); end if;
  if p ? 'director'      then s.director    := nullif(btrim(p->>'director'), ''); end if;
  if p ? 'subdirector'   then s.subdirector := nullif(btrim(p->>'subdirector'), ''); end if;
  if p ? 'entry_time'    then s.entry_time  := (p->>'entry_time')::time; end if;
  if p ? 'tolerance_min' then s.tolerance_min := (p->>'tolerance_min')::int; end if;
  if p ? 'timezone'      then s.timezone    := btrim(p->>'timezone'); end if;

  if p ? 'positions' then
    if jsonb_typeof(p->'positions') <> 'array' then raise exception 'FORMATO_INVALIDO'; end if;
    s.positions := p->'positions';
  end if;
  if p ? 'grades' then
    select coalesce(array_agg(g order by n), '{}') into v_arr from (
      select distinct on (g) g, n from (
        select app.norm(x) as g, n from jsonb_array_elements_text(p->'grades') with ordinality t(x, n)) a
      where g is not null order by g, n) b;
    s.grades := v_arr;
  end if;
  if p ? 'groups' then
    select coalesce(array_agg(g order by n), '{}') into v_arr from (
      select distinct on (g) g, n from (
        select app.norm(x) as g, n from jsonb_array_elements_text(p->'groups') with ordinality t(x, n)) a
      where g is not null order by g, n) b;
    s.groups := v_arr;
  end if;

  if s.name is null then raise exception 'NOMBRE_REQUERIDO'; end if;
  if s.tolerance_min is null or s.tolerance_min < 0 or s.tolerance_min > 120 then raise exception 'TOLERANCIA_INVALIDA'; end if;
  if coalesce(array_length(s.grades, 1), 0) = 0 then raise exception 'GRADOS_REQUERIDOS'; end if;
  if coalesce(array_length(s.groups, 1), 0) = 0 then raise exception 'GRUPOS_REQUERIDOS'; end if;
  begin
    perform now() at time zone s.timezone;
  exception when others then
    raise exception 'ZONA_HORARIA_INVALIDA';
  end;

  if v_creating then
    v_code := app.new_code('ADM');
    insert into public.schools (name, cct, turno, zona, sector, locality, school_year, director, subdirector, positions,
                                entry_time, tolerance_min, timezone, grades, groups, admin_code, admin_code_expires_at)
    values (s.name, s.cct, s.turno, s.zona, s.sector, s.locality, s.school_year, s.director, s.subdirector, s.positions,
            s.entry_time, s.tolerance_min, s.timezone, s.grades, s.groups, v_code, now() + interval '30 days')
    returning id into s.id;
    perform app.log(s.id, 'ESCUELA_CREADA', jsonb_build_object('name', s.name));
    return jsonb_build_object('school_id', s.id, 'admin_code', v_code);
  else
    update public.schools set name = s.name, cct = s.cct, turno = s.turno, zona = s.zona, sector = s.sector,
      locality = s.locality, school_year = s.school_year, director = s.director, subdirector = s.subdirector,
      positions = s.positions, entry_time = s.entry_time, tolerance_min = s.tolerance_min, timezone = s.timezone,
      grades = s.grades, groups = s.groups
    where id = s.id;
    perform app.log(s.id, 'AJUSTES_ACTUALIZADOS', jsonb_build_object('campos', (select jsonb_agg(k) from jsonb_object_keys(p) k)));
    return jsonb_build_object('school_id', s.id);
  end if;
end $$;

create or replace function public.set_school_active(p_school uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  update public.schools set active = p_active where id = p_school;
  perform app.log(p_school, case when p_active then 'ESCUELA_ACTIVADA' else 'ESCUELA_DESACTIVADA' end);
end $$;

-- Código para registrar a un nuevo administrativo (relevo o emergencia). Vence en 7 días.
create or replace function public.generate_admin_code(p_school uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_code text := app.new_code('ADM'); v_exp timestamptz := now() + interval '7 days';
begin
  update public.schools set admin_code = v_code, admin_code_expires_at = v_exp where id = v_sid;
  perform app.log(v_sid, 'CODIGO_ADMIN_GENERADO', jsonb_build_object('vence', v_exp));
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end $$;

-- Código del personal de puerta (reutilizable). p_regenerate invalida el anterior.
create or replace function public.get_staff_code(p_school uuid default null, p_regenerate boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_code text;
begin
  select staff_code into v_code from public.schools where id = v_sid;
  if v_code is null or p_regenerate then
    v_code := app.new_code('PRE');
    update public.schools set staff_code = v_code where id = v_sid;
    perform app.log(v_sid, 'CODIGO_PERSONAL_GENERADO', '{}'::jsonb);
  end if;
  return v_code;
end $$;

-- Relevo inmediato: el administrativo actual asciende a un prefecto y se da de baja.
create or replace function public.promote_to_admin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me public.profiles%rowtype; v_t public.profiles%rowtype;
begin
  select * into v_me from public.profiles where id = auth.uid() and active and role = 'school_admin';
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  select * into v_t from public.profiles where id = p_user and school_id = v_me.school_id and active and role = 'prefect';
  if not found then raise exception 'PREFECTO_NO_ENCONTRADO'; end if;
  update public.profiles set active = false, deactivated_at = now() where id = v_me.id;
  update public.profiles set role = 'school_admin' where id = v_t.id;
  update public.schools set admin_code = null, admin_code_expires_at = null where id = v_me.school_id;
  insert into public.audit_log (school_id, user_id, user_name, action, detail)
  values (v_me.school_id, v_me.id, v_me.full_name, 'RELEVO_ADMINISTRATIVO',
          jsonb_build_object('nuevo_admin', v_t.full_name, 'nuevo_email', v_t.email));
end $$;

create or replace function public.set_staff_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_t public.profiles%rowtype; v_sid uuid;
begin
  select * into v_t from public.profiles where id = p_user;
  if not found then raise exception 'PREFECTO_NO_ENCONTRADO'; end if;
  v_sid := app.target_school(v_t.school_id, true);
  if v_t.role <> 'prefect' then raise exception 'SOLO_PREFECTOS'; end if;
  if v_t.activated_at is null then raise exception 'CUENTA_PENDIENTE'; end if;
  update public.profiles set active = p_active,
    deactivated_at = case when p_active then null else now() end where id = p_user;
  perform app.log(v_sid, case when p_active then 'PREFECTO_REACTIVADO' else 'PREFECTO_BAJA' end,
                  jsonb_build_object('nombre', v_t.full_name, 'email', v_t.email));
end $$;

create or replace function public.list_schools_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  return coalesce((select jsonb_agg(x order by x->>'name') from (
    select jsonb_build_object(
      'id', s.id, 'name', s.name, 'cct', s.cct, 'active', s.active,
      'entry_time', s.entry_time, 'tolerance_min', s.tolerance_min,
      'alumnos', (select count(*) from public.students st where st.school_id = s.id and st.active),
      'personal', (select count(*) from public.profiles p where p.school_id = s.id and p.active),
      'hoy', (select count(*) from public.attendance a where a.school_id = s.id and a.fecha = (now() at time zone s.timezone)::date),
      'admin_name', (select full_name from public.profiles p where p.school_id = s.id and p.role = 'school_admin' and p.active),
      'admin_email', (select email from public.profiles p where p.school_id = s.id and p.role = 'school_admin' and p.active),
      'admin_code', s.admin_code, 'admin_code_expires_at', s.admin_code_expires_at,
      'staff_code', s.staff_code) as x
    from public.schools s) t), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 5. ALUMNOS
-- ---------------------------------------------------------------------

create or replace function app.student_apply(p_sid uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.schools%rowtype; st public.students%rowtype;
  v_nombre text; v_grado text; v_grupo text; v_gen text; v_curp text; v_id uuid := p_id;
begin
  select * into s from public.schools where id = p_sid;
  v_nombre := app.norm(p->>'nombre');
  v_grado  := app.norm(p->>'grado');
  v_grupo  := app.norm(p->>'grupo');
  v_gen    := app.norm(p->>'genero');
  v_curp   := app.norm(p->>'curp');

  if v_nombre is null then raise exception 'NOMBRE_REQUERIDO'; end if;
  if v_grado is null or not (v_grado = any (s.grades)) then raise exception 'GRADO_INVALIDO'; end if;
  if v_grupo is null or not (v_grupo = any (s.groups)) then raise exception 'GRUPO_INVALIDO'; end if;
  if v_gen is not null and v_gen not in ('H','M') then raise exception 'GENERO_INVALIDO'; end if;
  if v_curp is not null and v_curp !~ '^[A-Z]{4}[0-9]{6}[A-Z]{6}[A-Z0-9]{2}$' then raise exception 'CURP_INVALIDA'; end if;

  if v_id is null then
    if v_curp is not null and exists (select 1 from public.student_private where school_id = p_sid and curp = v_curp) then
      raise exception 'CURP_DUPLICADA';
    end if;
    if exists (select 1 from public.students x where x.school_id = p_sid and x.nombre = v_nombre
               and x.grado = v_grado and x.grupo = v_grupo) and v_curp is null then
      raise exception 'ALUMNO_DUPLICADO';
    end if;
    insert into public.students (school_id, nombre, grado, grupo, genero, active)
    values (p_sid, v_nombre, v_grado, v_grupo, v_gen,
            case when p ? 'active' then (p->>'active')::boolean else true end)
    returning id into v_id;
  else
    select * into st from public.students where id = v_id and school_id = p_sid;
    if not found then raise exception 'ALUMNO_NO_ENCONTRADO'; end if;
    update public.students set nombre = v_nombre, grado = v_grado, grupo = v_grupo, genero = v_gen,
      active = case when p ? 'active' then (p->>'active')::boolean else active end
    where id = v_id;
  end if;

  if v_curp is not null then
    begin
      insert into public.student_private (student_id, school_id, curp) values (v_id, p_sid, v_curp)
      on conflict (student_id) do update set curp = excluded.curp;
    exception when unique_violation then
      raise exception 'CURP_DUPLICADA';
    end;
  elsif p ? 'curp' then
    delete from public.student_private where student_id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.save_student(p_school uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_id uuid;
begin
  v_id := app.student_apply(v_sid, p_id, p);
  perform app.log(v_sid, case when p_id is null then 'ALUMNO_CREADO' else 'ALUMNO_ACTUALIZADO' end,
                  jsonb_build_object('alumno', app.norm(p->>'nombre'), 'id', v_id,
                                     'activo', case when p ? 'active' then p->'active' else null end));
  return v_id;
end $$;

-- Alta masiva. Cada fila: {row, curp, nombre, grado, grupo, genero}
create or replace function public.import_students(p_school uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid := app.target_school(p_school, true);
  r jsonb; n bigint; v_id uuid; v_new boolean; v_row jsonb; v_curp text;
  v_ins int := 0; v_upd int := 0; v_errs jsonb := '[]'::jsonb; v_seen text[] := '{}'; v_key text;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'FORMATO_INVALIDO'; end if;
  if jsonb_array_length(p_rows) > 1500 then raise exception 'DEMASIADAS_FILAS'; end if;

  for r, n in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    begin
      v_curp := app.norm(r->>'curp');
      v_id := null;
      -- una misma persona no puede venir dos veces en el mismo archivo
      v_key := coalesce('C:' || v_curp, 'N:' || app.norm(r->>'nombre') || '|' || app.norm(r->>'grado') || '|' || app.norm(r->>'grupo'));
      if v_key = any (v_seen) then raise exception 'FILA_REPETIDA'; end if;
      v_seen := v_seen || v_key;
      if v_curp is not null then
        select student_id into v_id from public.student_private where school_id = v_sid and curp = v_curp;
      end if;
      if v_id is null then
        select st.id into v_id from public.students st
        where st.school_id = v_sid and st.nombre = app.norm(r->>'nombre')
          and st.grado = app.norm(r->>'grado') and st.grupo = app.norm(r->>'grupo')
          and (v_curp is null or not exists (select 1 from public.student_private sp where sp.student_id = st.id))
        order by st.active desc, st.created_at limit 1;
      end if;
      v_new := (v_id is null);
      v_row := (r - 'row') || '{"active": true}'::jsonb;
      if not v_new and v_curp is null then v_row := v_row - 'curp'; end if;   -- no borrar un CURP existente
      perform app.student_apply(v_sid, v_id, v_row);
      if v_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    exception when others then
      v_errs := v_errs || jsonb_build_array(jsonb_build_object(
        'row', coalesce(r->'row', to_jsonb(n)),
        'error', case when sqlstate = '23505' then 'CURP_DUPLICADA' else sqlerrm end));
    end;
  end loop;

  perform app.log(v_sid, 'IMPORTACION_ALUMNOS',
    jsonb_build_object('nuevos', v_ins, 'actualizados', v_upd, 'errores', jsonb_array_length(v_errs)));
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'errors', v_errs);
end $$;

-- Reemplaza el QR de un alumno (credencial perdida). El anterior deja de servir.
create or replace function public.regenerate_qr(p_school uuid, p_student uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_tok uuid := gen_random_uuid(); v_name text;
begin
  update public.students set qr_token = v_tok where id = p_student and school_id = v_sid returning nombre into v_name;
  if v_name is null then raise exception 'ALUMNO_NO_ENCONTRADO'; end if;
  perform app.log(v_sid, 'QR_REGENERADO', jsonb_build_object('alumno', v_name));
  return v_tok;
end $$;

-- ---------------------------------------------------------------------
-- 6. ASISTENCIA
-- ---------------------------------------------------------------------

-- Recibe uno o varios registros (en línea o sincronizados después de estar sin conexión).
-- Cada item: {cid, token | student_id, scanned_at, method, device, offline}
-- Regla de duplicados: se conserva el registro MÁS TEMPRANO del día.
create or replace function public.register_attendance_batch(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles%rowtype; s public.schools%rowtype; st public.students%rowtype; v_att public.attendance%rowtype;
  it jsonb; v_out jsonb := '[]'::jsonb; v_cid text;
  v_ts timestamptz; v_local timestamp; v_fecha date; v_t time; v_dead time; v_status text; v_late int;
  v_method text; v_dev text; v_off boolean; v_result text; v_replaced boolean;
begin
  select * into p from public.profiles where id = v_uid and active and role in ('prefect','school_admin');
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  select * into s from public.schools where id = p.school_id and active;
  if not found then raise exception 'ESCUELA_INACTIVA'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then raise exception 'FORMATO_INVALIDO'; end if;

  for it in select value from jsonb_array_elements(p_items) loop
    v_cid := it->>'cid';
    begin
      v_method := coalesce(it->>'method', 'QR');
      if v_method not in ('QR','MANUAL') then raise exception 'METODO_INVALIDO'; end if;
      v_ts := (it->>'scanned_at')::timestamptz;
      if v_ts is null then raise exception 'HORA_REQUERIDA'; end if;
      if v_ts > now() + interval '5 minutes' then raise exception 'HORA_FUTURA'; end if;
      if v_ts < now() - interval '45 days' then raise exception 'HORA_MUY_ANTIGUA'; end if;
      v_dev := left(nullif(btrim(coalesce(it->>'device', '')), ''), 120);
      v_off := coalesce((it->>'offline')::boolean, false);

      if nullif(it->>'student_id', '') is not null then
        select * into st from public.students where id = (it->>'student_id')::uuid and school_id = s.id;
      else
        select * into st from public.students where qr_token = (it->>'token')::uuid and school_id = s.id;
      end if;
      if not found then raise exception 'QR_NO_VALIDO'; end if;
      if not st.active then raise exception 'ALUMNO_INACTIVO'; end if;

      v_local := v_ts at time zone s.timezone;
      v_fecha := v_local::date;
      v_t     := v_local::time;
      v_dead  := s.entry_time + (s.tolerance_min * interval '1 minute');
      if v_t <= v_dead then v_status := 'PUNTUAL'; v_late := 0;
      else v_status := 'RETARDO'; v_late := floor(extract(epoch from (v_t - s.entry_time)) / 60)::int; end if;

      v_replaced := false;
      insert into public.attendance (school_id, student_id, fecha, scanned_at, status, late_minutes, method,
                                     recorded_by, recorded_by_name, device, offline)
      values (s.id, st.id, v_fecha, v_ts, v_status, v_late, v_method, p.id, p.full_name, v_dev, v_off)
      on conflict (student_id, fecha) do nothing
      returning * into v_att;

      if found then
        v_result := 'REGISTRADO';
        if v_method = 'MANUAL' then
          perform app.log(s.id, 'ASISTENCIA_MANUAL', jsonb_build_object('alumno', st.nombre, 'fecha', v_fecha, 'hora', v_ts));
        end if;
      else
        v_result := 'DUPLICADO';
        select * into v_att from public.attendance where student_id = st.id and fecha = v_fecha;
        if v_ts < v_att.scanned_at then
          update public.attendance set scanned_at = v_ts, status = v_status, late_minutes = v_late, method = v_method,
            recorded_by = p.id, recorded_by_name = p.full_name, device = v_dev, offline = v_off, synced_at = now()
          where id = v_att.id returning * into v_att;
          v_replaced := true;
          perform app.log(s.id, 'ASISTENCIA_REEMPLAZADA_POR_MAS_TEMPRANA', jsonb_build_object('alumno', st.nombre, 'fecha', v_fecha, 'hora', v_ts));
        end if;
      end if;

      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'cid', v_cid, 'result', v_result, 'replaced', v_replaced,
        'status', v_att.status, 'late_minutes', v_att.late_minutes, 'scanned_at', v_att.scanned_at,
        'by', v_att.recorded_by_name,
        'student', jsonb_build_object('id', st.id, 'nombre', st.nombre, 'grado', st.grado, 'grupo', st.grupo, 'genero', st.genero)));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'cid', v_cid, 'result', 'ERROR',
        'error', case when sqlstate = '22P02' then 'QR_NO_VALIDO' else sqlerrm end));
    end;
  end loop;
  return v_out;
end $$;

create or replace function public.delete_attendance(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.attendance%rowtype; v_sid uuid; v_name text;
begin
  select * into a from public.attendance where id = p_id;
  if not found then raise exception 'REGISTRO_NO_ENCONTRADO'; end if;
  v_sid := app.target_school(a.school_id, true);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'MOTIVO_REQUERIDO'; end if;
  select nombre into v_name from public.students where id = a.student_id;
  delete from public.attendance where id = p_id;
  perform app.log(v_sid, 'ASISTENCIA_ELIMINADA', jsonb_build_object(
    'alumno', v_name, 'fecha', a.fecha, 'hora', a.scanned_at, 'registrado_por', a.recorded_by_name, 'motivo', btrim(p_reason)));
end $$;

-- ---------------------------------------------------------------------
-- 7. REPORTES
-- ---------------------------------------------------------------------

create or replace function public.day_summary(p_school uuid default null, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, false); v_tz text; v_date date; v_tot jsonb; v_grp jsonb;
begin
  select timezone into v_tz from public.schools where id = v_sid;
  v_date := coalesce(p_date, (now() at time zone v_tz)::date);
  select jsonb_build_object('total', count(*), 'presentes', count(a.id),
           'puntuales', count(*) filter (where a.status = 'PUNTUAL'),
           'retardos',  count(*) filter (where a.status = 'RETARDO'),
           'pendientes', count(*) filter (where a.id is null))
    into v_tot
    from public.students st left join public.attendance a on a.student_id = st.id and a.fecha = v_date
    where st.school_id = v_sid and st.active;
  select coalesce(jsonb_agg(g order by g->>'grado', g->>'grupo'), '[]'::jsonb) into v_grp from (
    select jsonb_build_object('grado', st.grado, 'grupo', st.grupo, 'total', count(*), 'presentes', count(a.id),
             'puntuales', count(*) filter (where a.status = 'PUNTUAL'),
             'retardos',  count(*) filter (where a.status = 'RETARDO'),
             'pendientes', count(*) filter (where a.id is null)) as g
    from public.students st left join public.attendance a on a.student_id = st.id and a.fecha = v_date
    where st.school_id = v_sid and st.active group by st.grado, st.grupo) t;
  return jsonb_build_object('fecha', v_date) || v_tot || jsonb_build_object('por_grupo', v_grp);
end $$;

create or replace function public.pending_students(p_school uuid default null, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_tz text; v_date date;
begin
  select timezone into v_tz from public.schools where id = v_sid;
  v_date := coalesce(p_date, (now() at time zone v_tz)::date);
  return coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'nombre', st.nombre, 'grado', st.grado,
                    'grupo', st.grupo, 'genero', st.genero) order by st.grado, st.grupo, st.nombre)
    from public.students st
    where st.school_id = v_sid and st.active
      and not exists (select 1 from public.attendance a where a.student_id = st.id and a.fecha = v_date)), '[]'::jsonb);
end $$;

-- "¿Quién estuvo en la puerta?"
create or replace function public.door_report(p_school uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_tz text;
begin
  select timezone into v_tz from public.schools where id = v_sid;
  p_from := coalesce(p_from, (now() at time zone v_tz)::date);
  p_to   := coalesce(p_to, p_from);
  return coalesce((select jsonb_agg(x order by x->>'fecha' desc, x->>'user_name') from (
    select jsonb_build_object('fecha', a.fecha, 'user_id', a.recorded_by, 'user_name', a.recorded_by_name,
      'total', count(*), 'puntuales', count(*) filter (where a.status = 'PUNTUAL'),
      'retardos', count(*) filter (where a.status = 'RETARDO'),
      'manuales', count(*) filter (where a.method = 'MANUAL'),
      'sin_conexion', count(*) filter (where a.offline),
      'primero', min(a.scanned_at), 'ultimo', max(a.scanned_at)) as x
    from public.attendance a
    where a.school_id = v_sid and a.fecha between p_from and p_to
    group by a.fecha, a.recorded_by, a.recorded_by_name) t), '[]'::jsonb);
end $$;

create or replace function public.student_history(p_school uuid, p_student uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_days int; v_pres int; v_punt int; v_ret int; v_rows jsonb; v_st jsonb;
begin
  select jsonb_build_object('id', id, 'nombre', nombre, 'grado', grado, 'grupo', grupo, 'genero', genero)
    into v_st from public.students where id = p_student and school_id = v_sid;
  if v_st is null then raise exception 'ALUMNO_NO_ENCONTRADO'; end if;
  select count(distinct fecha) into v_days from public.attendance where school_id = v_sid and fecha between p_from and p_to;
  select count(*), count(*) filter (where status = 'PUNTUAL'), count(*) filter (where status = 'RETARDO')
    into v_pres, v_punt, v_ret from public.attendance
    where student_id = p_student and fecha between p_from and p_to;
  select coalesce(jsonb_agg(jsonb_build_object('fecha', fecha, 'scanned_at', scanned_at, 'status', status,
           'late_minutes', late_minutes, 'method', method, 'by', recorded_by_name, 'offline', offline) order by fecha), '[]'::jsonb)
    into v_rows from public.attendance where student_id = p_student and fecha between p_from and p_to;
  return jsonb_build_object('student', v_st, 'dias_con_clase', v_days, 'asistencias', v_pres,
    'puntuales', v_punt, 'retardos', v_ret, 'faltas', greatest(v_days - v_pres, 0), 'registros', v_rows);
end $$;

-- Hora del servidor: la app la usa para avisar si el reloj del celular está desfasado
create or replace function public.server_time() returns timestamptz
language sql stable as $$ select now() $$;

-- ---------------------------------------------------------------------
-- 8. SEGURIDAD (RLS y permisos)
-- ---------------------------------------------------------------------

alter table public.schools            enable row level security;
alter table public.profiles           enable row level security;
alter table public.super_admin_emails enable row level security;
alter table public.students           enable row level security;
alter table public.student_private    enable row level security;
alter table public.attendance         enable row level security;
alter table public.audit_log          enable row level security;

drop policy if exists schools_select on public.schools;
create policy schools_select on public.schools for select to authenticated
  using (app.is_super() or id = app.my_school());

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.is_super() or (app.my_role() = 'school_admin' and school_id = app.my_school()));

drop policy if exists students_select on public.students;
create policy students_select on public.students for select to authenticated
  using (app.is_super() or school_id = app.my_school());

drop policy if exists student_private_select on public.student_private;
create policy student_private_select on public.student_private for select to authenticated
  using (app.is_super() or (app.my_role() = 'school_admin' and school_id = app.my_school()));

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (app.is_super() or school_id = app.my_school());

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (app.is_super() or (app.my_role() = 'school_admin' and school_id = app.my_school()));

-- La aplicación solo lee; todo cambio pasa por funciones.
revoke all on public.schools, public.profiles, public.super_admin_emails, public.students,
              public.student_private, public.attendance, public.audit_log from anon, authenticated;

-- Los códigos de acceso NO se pueden leer con SELECT (se piden por función).
grant select (id, name, cct, turno, zona, sector, locality, school_year, director, subdirector, positions,
              entry_time, tolerance_min, timezone, grades, groups, active, created_at)
  on public.schools to authenticated;
grant select (id, school_id, role, full_name, email, active, created_at, activated_at, deactivated_at)
  on public.profiles to authenticated;
grant select on public.students, public.student_private, public.attendance, public.audit_log to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app    from public, anon, authenticated;

grant execute on function app.my_role(), app.my_school(), app.is_super() to authenticated;

grant execute on function public.validate_signup(text, text) to anon, authenticated;
grant execute on function public.app_context()                          to authenticated;
grant execute on function public.server_time()                          to authenticated;
grant execute on function public.save_school(uuid, jsonb)               to authenticated;
grant execute on function public.set_school_active(uuid, boolean)       to authenticated;
grant execute on function public.generate_admin_code(uuid)              to authenticated;
grant execute on function public.get_staff_code(uuid, boolean)          to authenticated;
grant execute on function public.promote_to_admin(uuid)                 to authenticated;
grant execute on function public.set_staff_active(uuid, boolean)        to authenticated;
grant execute on function public.list_schools_summary()                 to authenticated;
grant execute on function public.save_student(uuid, uuid, jsonb)        to authenticated;
grant execute on function public.import_students(uuid, jsonb)           to authenticated;
grant execute on function public.regenerate_qr(uuid, uuid)              to authenticated;
grant execute on function public.register_attendance_batch(jsonb)       to authenticated;
grant execute on function public.delete_attendance(uuid, text)          to authenticated;
grant execute on function public.day_summary(uuid, date)                to authenticated;
grant execute on function public.pending_students(uuid, date)          to authenticated;
grant execute on function public.door_report(uuid, date, date)          to authenticated;
grant execute on function public.student_history(uuid, uuid, date, date) to authenticated;

-- Por si el servicio de autenticación necesita ejecutar los disparadores de registro
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema app to supabase_auth_admin;
    grant execute on function app.handle_new_user(), app.on_user_confirmed() to supabase_auth_admin;
  end if;
end $$;
-- =====================================================================
-- CHECADOR · EXTENSIÓN v2
--   Apellidos separados, lengua indígena, tutores, personal de la escuela
--   (con QR y horario propio), alarma de QR sospechoso, felicitaciones,
--   citatorios, aviso de privacidad, respaldo y mantenimiento de Supabase.
-- Se ejecuta DESPUÉS de schema.sql (el archivo INSTALAR.sql ya los une).
-- Se puede volver a ejecutar sin romper nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. COLUMNAS NUEVAS
-- ---------------------------------------------------------------------

alter table public.schools
  add column if not exists address            text,
  add column if not exists postal_code        text,
  add column if not exists director_phone     text,
  add column if not exists subdirector_phone  text,
  add column if not exists logo_ieepo         text,
  add column if not exists logo_school        text,
  add column if not exists staff_qr_enabled   boolean not null default false,
  add column if not exists staff_tolerance_min int not null default 5,
  add column if not exists alarm_minutes      int not null default 10,
  add column if not exists citation_late_min  int not null default 3,
  add column if not exists citation_absent_min int not null default 3;

alter table public.students
  add column if not exists apellido_paterno text,
  add column if not exists apellido_materno text,
  add column if not exists nombres          text;

alter table public.student_private alter column curp drop not null;
alter table public.student_private
  add column if not exists lengua_indigena  text,
  add column if not exists privacy_notice_at date;

-- ---------------------------------------------------------------------
-- 2. TABLAS NUEVAS
-- ---------------------------------------------------------------------

create table if not exists public.tutors (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id),
  curp             text,
  apellido_paterno text,
  apellido_materno text,
  nombres          text not null,
  nombre           text not null,
  created_at       timestamptz not null default now(),
  unique (school_id, curp)
);

create table if not exists public.student_tutors (
  student_id uuid not null references public.students(id) on delete cascade,
  tutor_id   uuid not null references public.tutors(id) on delete cascade,
  school_id  uuid not null references public.schools(id),
  parentesco text not null check (parentesco in ('MDR','PDR','TUL')),
  orden      int  not null default 1,
  primary key (student_id, tutor_id)
);
create index if not exists student_tutors_tutor_idx on public.student_tutors (tutor_id);

-- Personal de la escuela (no inicia sesión)
create table if not exists public.personal (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id),
  curp             text not null,
  apellido_paterno text,
  apellido_materno text,
  nombres          text not null,
  nombre           text not null,
  puesto           text,
  entry_time       time not null default '07:30',
  qr_token         uuid not null unique default gen_random_uuid(),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (school_id, curp)
);

create table if not exists public.personal_attendance (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id),
  personal_id      uuid not null references public.personal(id),
  fecha            date not null,
  scanned_at       timestamptz not null,
  status           text not null check (status in ('PUNTUAL','RETARDO')),
  late_minutes     int  not null default 0,
  recorded_by      uuid references public.profiles(id),
  recorded_by_name text not null,
  device           text,
  offline          boolean not null default false,
  synced_at        timestamptz not null default now(),
  unique (personal_id, fecha)
);
create index if not exists personal_att_school_idx on public.personal_attendance (school_id, fecha);

-- QR que dejaron de servir por una reposición
create table if not exists public.retired_tokens (
  token       uuid primary key,
  school_id   uuid not null references public.schools(id),
  person_type text not null check (person_type in ('ALUMNO','PERSONAL')),
  person_id   uuid not null,
  retired_at  timestamptz not null default now()
);

create table if not exists public.qr_alarms (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id),
  person_type      text check (person_type in ('ALUMNO','PERSONAL')),
  person_id        uuid,
  person_name      text,
  kind             text not null check (kind in ('OTRO_TELEFONO','REPETIDO_TARDE','QR_REEMPLAZADO','QR_NO_RECONOCIDO')),
  fecha            date not null,
  detail           jsonb not null default '{}'::jsonb,
  device           text,
  scanned_by       uuid,
  scanned_by_name  text,
  scanned_at       timestamptz,
  status           text not null default 'PENDIENTE' check (status in ('PENDIENTE','REVISADO')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists qr_alarms_school_idx on public.qr_alarms (school_id, fecha desc);

create table if not exists public.privacy_acceptances (
  user_id     uuid not null,
  version     text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

create table if not exists public.heartbeat (
  id        int primary key default 1 check (id = 1),
  last_ping timestamptz not null default now(),
  pings     bigint not null default 0
);
insert into public.heartbeat (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. AUXILIARES
-- ---------------------------------------------------------------------

create or replace function app.privacy_version() returns text
language sql immutable as $$ select 'v1'::text $$;

create or replace function app.full_name(p_ap text, p_am text, p_nom text) returns text
language sql immutable as
$$ select app.norm(concat_ws(' ', app.norm(p_ap), app.norm(p_am), app.norm(p_nom))) $$;

-- Fecha de nacimiento tomada de la CURP (null si no se puede leer)
create or replace function app.curp_birth(p text) returns date
language plpgsql immutable as $$
declare y int;
begin
  if p is null or p !~ '^[A-Z]{4}[0-9]{6}' then return null; end if;
  y := substr(p, 5, 2)::int + case when substr(p, 17, 1) ~ '[0-9]' then 1900 else 2000 end;
  return make_date(y, substr(p, 7, 2)::int, substr(p, 9, 2)::int);
exception when others then
  return null;
end $$;

create or replace function app.norm_parentesco(t text) returns text
language plpgsql immutable as $$
declare v text := app.norm(t);
begin
  if v is null then return 'TUL'; end if;
  if v in ('MDR','MADRE') then return 'MDR'; end if;
  if v in ('PDR','PADRE') then return 'PDR'; end if;
  if v in ('TUL','TUTOR','TUTORA') then return 'TUL'; end if;
  raise exception 'PARENTESCO_INVALIDO';
end $$;

create or replace function app.norm_time(t text, p_default time) returns time
language plpgsql immutable as $$
begin
  if nullif(btrim(coalesce(t, '')), '') is null then return p_default; end if;
  if btrim(t) !~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$' then raise exception 'HORA_INVALIDA'; end if;
  return btrim(t)::time;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'HORA_INVALIDA';
end $$;

create or replace function app.raise_alarm(p_school uuid, p_type text, p_person uuid, p_name text, p_kind text,
    p_fecha date, p_detail jsonb, p_device text, p_uid uuid, p_uname text, p_ts timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.qr_alarms where school_id = p_school and kind = p_kind and fecha = p_fecha
             and device is not distinct from p_device and person_id is not distinct from p_person) then
    return;
  end if;
  insert into public.qr_alarms (school_id, person_type, person_id, person_name, kind, fecha, detail, device,
                                scanned_by, scanned_by_name, scanned_at)
  values (p_school, p_type, p_person, p_name, p_kind, p_fecha, coalesce(p_detail, '{}'::jsonb), p_device, p_uid, p_uname, p_ts);
end $$;

-- Tutor: se busca por CURP (o por nombre si no tiene) y se crea o actualiza
create or replace function app.tutor_upsert(p_sid uuid, t jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_curp text; v_ap text; v_am text; v_nom text; v_full text; v_id uuid;
begin
  v_curp := app.norm(t->>'curp');
  v_ap := app.norm(t->>'apellido_paterno');
  v_am := app.norm(t->>'apellido_materno');
  v_nom := app.norm(t->>'nombres');
  if v_curp is null and v_ap is null and v_am is null and v_nom is null then return null; end if;
  if v_nom is null or (v_ap is null and v_am is null) then raise exception 'TUTOR_NOMBRE_REQUERIDO'; end if;
  if v_curp is not null and v_curp !~ '^[A-Z]{4}[0-9]{6}[A-Z]{6}[A-Z0-9]{2}$' then raise exception 'TUTOR_CURP_INVALIDA'; end if;
  v_full := app.full_name(v_ap, v_am, v_nom);
  if v_curp is not null then
    select id into v_id from public.tutors where school_id = p_sid and curp = v_curp;
  else
    select id into v_id from public.tutors where school_id = p_sid and curp is null and nombre = v_full limit 1;
  end if;
  if v_id is null then
    insert into public.tutors (school_id, curp, apellido_paterno, apellido_materno, nombres, nombre)
    values (p_sid, v_curp, v_ap, v_am, v_nom, v_full) returning id into v_id;
  else
    update public.tutors set apellido_paterno = v_ap, apellido_materno = v_am, nombres = v_nom, nombre = v_full where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 4. ALUMNOS v2 (apellidos, lengua, tutores)
-- ---------------------------------------------------------------------

create or replace function app.student_apply2(p_sid uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.schools%rowtype;
  v_ap text; v_am text; v_nom text; v_full text; v_grado text; v_grupo text; v_gen text; v_curp text; v_len text;
  v_id uuid := p_id; t jsonb; v_tid uuid; v_n int := 0; v_par text;
begin
  select * into s from public.schools where id = p_sid;
  v_ap := app.norm(p->>'apellido_paterno');
  v_am := app.norm(p->>'apellido_materno');
  v_nom := app.norm(p->>'nombres');
  v_grado := app.norm(p->>'grado');
  v_grupo := app.norm(p->>'grupo');
  v_curp := app.norm(p->>'curp');
  if v_nom is null or (v_ap is null and v_am is null) then raise exception 'NOMBRE_REQUERIDO'; end if;
  v_full := app.full_name(v_ap, v_am, v_nom);
  if v_grado is null or not (v_grado = any (s.grades)) then raise exception 'GRADO_INVALIDO'; end if;
  if v_grupo is null or not (v_grupo = any (s.groups)) then raise exception 'GRUPO_INVALIDO'; end if;
  if v_curp is not null and v_curp !~ '^[A-Z]{4}[0-9]{6}[A-Z]{6}[A-Z0-9]{2}$' then raise exception 'CURP_INVALIDA'; end if;
  v_gen := app.norm(p->>'genero');
  if v_gen is null and v_curp is not null and substr(v_curp, 11, 1) in ('H','M') then v_gen := substr(v_curp, 11, 1); end if;
  if v_gen is not null and v_gen not in ('H','M') then raise exception 'GENERO_INVALIDO'; end if;
  v_len := app.norm(p->>'lengua_indigena');
  if v_len is not null and v_len ~ '^(NO|NINGUNA|NINGUNO|N/?A|SIN LENGUA|-)$' then v_len := null; end if;

  if v_id is null then
    if v_curp is not null and exists (select 1 from public.student_private where school_id = p_sid and curp = v_curp) then
      raise exception 'CURP_DUPLICADA';
    end if;
    if v_curp is null and exists (select 1 from public.students x where x.school_id = p_sid and x.nombre = v_full
                                  and x.grado = v_grado and x.grupo = v_grupo) then
      raise exception 'ALUMNO_DUPLICADO';
    end if;
    insert into public.students (school_id, nombre, apellido_paterno, apellido_materno, nombres, grado, grupo, genero, active)
    values (p_sid, v_full, v_ap, v_am, v_nom, v_grado, v_grupo, v_gen,
            case when p ? 'active' then (p->>'active')::boolean else true end)
    returning id into v_id;
  else
    if not exists (select 1 from public.students where id = v_id and school_id = p_sid) then raise exception 'ALUMNO_NO_ENCONTRADO'; end if;
    update public.students set nombre = v_full, apellido_paterno = v_ap, apellido_materno = v_am, nombres = v_nom,
      grado = v_grado, grupo = v_grupo, genero = v_gen,
      active = case when p ? 'active' then (p->>'active')::boolean else active end
    where id = v_id;
  end if;

  begin
    insert into public.student_private (student_id, school_id, curp, lengua_indigena)
    values (v_id, p_sid, v_curp, v_len)
    on conflict (student_id) do update set
      curp = case when p ? 'curp' then excluded.curp else public.student_private.curp end,
      lengua_indigena = case when p ? 'lengua_indigena' then excluded.lengua_indigena else public.student_private.lengua_indigena end;
  exception when unique_violation then
    raise exception 'CURP_DUPLICADA';
  end;

  if p ? 'tutores' and jsonb_typeof(p->'tutores') = 'array' then
    if jsonb_array_length(p->'tutores') > 4 then raise exception 'DEMASIADOS_TUTORES'; end if;
    delete from public.student_tutors where student_id = v_id;
    for t in select value from jsonb_array_elements(p->'tutores') loop
      v_tid := app.tutor_upsert(p_sid, t);
      if v_tid is not null then
        v_n := v_n + 1;
        v_par := app.norm_parentesco(t->>'parentesco');
        insert into public.student_tutors (student_id, tutor_id, school_id, parentesco, orden)
        values (v_id, v_tid, p_sid, v_par, v_n)
        on conflict (student_id, tutor_id) do update set parentesco = excluded.parentesco, orden = excluded.orden;
      end if;
    end loop;
    delete from public.tutors tt where tt.school_id = p_sid
      and not exists (select 1 from public.student_tutors x where x.tutor_id = tt.id);
  end if;
  return v_id;
end $$;

create or replace function public.save_student2(p_school uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_id uuid;
begin
  v_id := app.student_apply2(v_sid, p_id, p);
  perform app.log(v_sid, case when p_id is null then 'ALUMNO_CREADO' else 'ALUMNO_ACTUALIZADO' end,
                  jsonb_build_object('id', v_id, 'alumno', app.full_name(p->>'apellido_paterno', p->>'apellido_materno', p->>'nombres')));
  return v_id;
end $$;

-- Alta masiva v2. Cada fila: {row, curp, apellido_paterno, apellido_materno, nombres, grado, grupo,
--                             lengua_indigena, tutores:[{curp, apellido_paterno, apellido_materno, nombres, parentesco}]}
create or replace function public.import_students2(p_school uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid := app.target_school(p_school, true);
  r jsonb; n bigint; v_id uuid; v_new boolean; v_row jsonb; v_curp text; v_full text;
  v_ins int := 0; v_upd int := 0; v_errs jsonb := '[]'::jsonb; v_seen text[] := '{}'; v_key text;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'FORMATO_INVALIDO'; end if;
  if jsonb_array_length(p_rows) > 1500 then raise exception 'DEMASIADAS_FILAS'; end if;

  for r, n in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    begin
      v_curp := app.norm(r->>'curp');
      v_full := app.full_name(r->>'apellido_paterno', r->>'apellido_materno', r->>'nombres');
      v_id := null;
      v_key := coalesce('C:' || v_curp, 'N:' || v_full || '|' || app.norm(r->>'grado') || '|' || app.norm(r->>'grupo'));
      if v_key = any (v_seen) then raise exception 'FILA_REPETIDA'; end if;
      v_seen := v_seen || v_key;
      if v_curp is not null then
        select student_id into v_id from public.student_private where school_id = v_sid and curp = v_curp;
      end if;
      if v_id is null then
        select st.id into v_id from public.students st
        where st.school_id = v_sid and st.nombre = v_full
          and st.grado = app.norm(r->>'grado') and st.grupo = app.norm(r->>'grupo')
          and (v_curp is null or not exists (select 1 from public.student_private sp where sp.student_id = st.id and sp.curp is not null))
        order by st.active desc, st.created_at limit 1;
      end if;
      v_new := (v_id is null);
      v_row := (r - 'row') || '{"active": true}'::jsonb;
      if not v_new and v_curp is null then v_row := v_row - 'curp'; end if;     -- no borrar un CURP existente
      perform app.student_apply2(v_sid, v_id, v_row);
      if v_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    exception when others then
      v_errs := v_errs || jsonb_build_array(jsonb_build_object(
        'row', coalesce(r->'row', to_jsonb(n)),
        'error', case when sqlstate = '23505' then 'CURP_DUPLICADA' else sqlerrm end));
    end;
  end loop;

  perform app.log(v_sid, 'IMPORTACION_ALUMNOS',
    jsonb_build_object('nuevos', v_ins, 'actualizados', v_upd, 'errores', jsonb_array_length(v_errs)));
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'errors', v_errs);
end $$;

-- Lista completa para la pantalla de alumnos (solo administrativo): incluye CURP, lengua y tutores
create or replace function public.list_students_full(p_school uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true);
begin
  return coalesce((select jsonb_agg(x order by x->>'grado', x->>'grupo', x->>'nombre') from (
    select jsonb_build_object('id', st.id, 'nombre', st.nombre, 'apellido_paterno', st.apellido_paterno,
      'apellido_materno', st.apellido_materno, 'nombres', st.nombres, 'grado', st.grado, 'grupo', st.grupo,
      'genero', st.genero, 'active', st.active, 'curp', sp.curp, 'lengua_indigena', sp.lengua_indigena,
      'privacy_notice_at', sp.privacy_notice_at,
      'tutores', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'curp', t.curp,
                    'parentesco', x.parentesco, 'apellido_paterno', t.apellido_paterno,
                    'apellido_materno', t.apellido_materno, 'nombres', t.nombres) order by x.orden)
                  from public.student_tutors x join public.tutors t on t.id = x.tutor_id where x.student_id = st.id), '[]'::jsonb)
    ) as x
    from public.students st left join public.student_private sp on sp.student_id = st.id
    where st.school_id = v_sid) q), '[]'::jsonb);
end $$;

-- Tutores con sus hijos (solo administrativo)
create or replace function public.list_tutors(p_school uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true);
begin
  return coalesce((select jsonb_agg(x order by x->>'nombre') from (
    select jsonb_build_object('id', t.id, 'nombre', t.nombre, 'curp', t.curp,
      'hijos', coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'nombre', st.nombre, 'grado', st.grado,
                    'grupo', st.grupo, 'parentesco', x.parentesco) order by st.grado, st.grupo, st.nombre)
                  from public.student_tutors x join public.students st on st.id = x.student_id
                  where x.tutor_id = t.id), '[]'::jsonb)) as x
    from public.tutors t where t.school_id = v_sid) q), '[]'::jsonb);
end $$;

-- Reposición de QR: el anterior queda registrado como "reemplazado" y dispara alarma si se presenta
create or replace function public.regenerate_qr(p_school uuid, p_student uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_tok uuid := gen_random_uuid(); v_old uuid; v_name text;
begin
  select qr_token, nombre into v_old, v_name from public.students where id = p_student and school_id = v_sid for update;
  if v_name is null then raise exception 'ALUMNO_NO_ENCONTRADO'; end if;
  insert into public.retired_tokens (token, school_id, person_type, person_id) values (v_old, v_sid, 'ALUMNO', p_student)
    on conflict do nothing;
  update public.students set qr_token = v_tok where id = p_student;
  perform app.log(v_sid, 'QR_REGENERADO', jsonb_build_object('alumno', v_name));
  return v_tok;
end $$;

create or replace function public.regenerate_personal_qr(p_school uuid, p_personal uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_tok uuid := gen_random_uuid(); v_old uuid; v_name text;
begin
  select qr_token, nombre into v_old, v_name from public.personal where id = p_personal and school_id = v_sid for update;
  if v_name is null then raise exception 'PERSONAL_NO_ENCONTRADO'; end if;
  insert into public.retired_tokens (token, school_id, person_type, person_id) values (v_old, v_sid, 'PERSONAL', p_personal)
    on conflict do nothing;
  update public.personal set qr_token = v_tok where id = p_personal;
  perform app.log(v_sid, 'QR_PERSONAL_REGENERADO', jsonb_build_object('personal', v_name));
  return v_tok;
end $$;

-- ---------------------------------------------------------------------
-- 5. PERSONAL DE LA ESCUELA
-- ---------------------------------------------------------------------

create or replace function app.personal_apply(p_sid uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ap text; v_am text; v_nom text; v_full text; v_curp text; v_puesto text; v_time time; v_id uuid := p_id; v_old time;
begin
  v_ap := app.norm(p->>'apellido_paterno');
  v_am := app.norm(p->>'apellido_materno');
  v_nom := app.norm(p->>'nombres');
  v_curp := app.norm(p->>'curp');
  v_puesto := nullif(btrim(coalesce(p->>'puesto', '')), '');
  if v_nom is null or (v_ap is null and v_am is null) then raise exception 'NOMBRE_REQUERIDO'; end if;
  if v_curp is null or v_curp !~ '^[A-Z]{4}[0-9]{6}[A-Z]{6}[A-Z0-9]{2}$' then raise exception 'CURP_INVALIDA'; end if;
  if app.curp_birth(v_curp) is null then raise exception 'CURP_FECHA_INVALIDA'; end if;
  v_full := app.full_name(v_ap, v_am, v_nom);

  if v_id is null then
    v_time := app.norm_time(p->>'entry_time', '07:30');
    begin
      insert into public.personal (school_id, curp, apellido_paterno, apellido_materno, nombres, nombre, puesto, entry_time, active)
      values (p_sid, v_curp, v_ap, v_am, v_nom, v_full, v_puesto, v_time,
              case when p ? 'active' then (p->>'active')::boolean else true end)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'CURP_DUPLICADA';
    end;
  else
    select entry_time into v_old from public.personal where id = v_id and school_id = p_sid;
    if not found then raise exception 'PERSONAL_NO_ENCONTRADO'; end if;
    v_time := app.norm_time(p->>'entry_time', v_old);
    begin
      update public.personal set curp = v_curp, apellido_paterno = v_ap, apellido_materno = v_am, nombres = v_nom,
        nombre = v_full, puesto = v_puesto, entry_time = v_time,
        active = case when p ? 'active' then (p->>'active')::boolean else active end
      where id = v_id;
    exception when unique_violation then
      raise exception 'CURP_DUPLICADA';
    end;
  end if;
  return v_id;
end $$;

create or replace function public.save_personal(p_school uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_id uuid;
begin
  v_id := app.personal_apply(v_sid, p_id, p);
  perform app.log(v_sid, case when p_id is null then 'PERSONAL_CREADO' else 'PERSONAL_ACTUALIZADO' end,
                  jsonb_build_object('id', v_id, 'personal', app.full_name(p->>'apellido_paterno', p->>'apellido_materno', p->>'nombres')));
  return v_id;
end $$;

create or replace function public.import_personal(p_school uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid := app.target_school(p_school, true);
  r jsonb; n bigint; v_id uuid; v_curp text; v_ins int := 0; v_upd int := 0; v_errs jsonb := '[]'::jsonb; v_seen text[] := '{}';
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'FORMATO_INVALIDO'; end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'DEMASIADAS_FILAS'; end if;
  for r, n in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    begin
      v_curp := app.norm(r->>'curp');
      if v_curp is not null and v_curp = any (v_seen) then raise exception 'FILA_REPETIDA'; end if;
      v_seen := v_seen || coalesce(v_curp, '');
      select id into v_id from public.personal where school_id = v_sid and curp = v_curp;
      perform app.personal_apply(v_sid, v_id, (r - 'row') || '{"active": true}'::jsonb);
      if v_id is null then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;
    exception when others then
      v_errs := v_errs || jsonb_build_array(jsonb_build_object('row', coalesce(r->'row', to_jsonb(n)),
        'error', case when sqlstate = '23505' then 'CURP_DUPLICADA' else sqlerrm end));
    end;
  end loop;
  perform app.log(v_sid, 'IMPORTACION_PERSONAL',
    jsonb_build_object('nuevos', v_ins, 'actualizados', v_upd, 'errores', jsonb_array_length(v_errs)));
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'errors', v_errs);
end $$;

create or replace function public.list_personal(p_school uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'apellido_paterno', x.apellido_paterno,
      'apellido_materno', x.apellido_materno, 'nombres', x.nombres, 'curp', x.curp, 'puesto', x.puesto,
      'entry_time', to_char(x.entry_time, 'HH24:MI'), 'active', x.active, 'qr_token', x.qr_token,
      'cumple_dia', extract(day from app.curp_birth(x.curp))::int, 'cumple_mes', extract(month from app.curp_birth(x.curp))::int)
      order by x.nombre) from public.personal x where x.school_id = v_sid), '[]'::jsonb);
end $$;

-- Lista para el escáner (prefecto o administrativo): solo lo necesario para identificar a quien escanea
create or replace function public.scan_roster(p_school uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, false); s public.schools%rowtype;
begin
  select * into s from public.schools where id = v_sid;
  return jsonb_build_object('staff_qr_enabled', s.staff_qr_enabled, 'staff_tolerance_min', s.staff_tolerance_min,
    'alarm_minutes', s.alarm_minutes,
    'personal', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'puesto', x.puesto,
        'entry_time', to_char(x.entry_time, 'HH24:MI'), 'token', x.qr_token) order by x.nombre)
      from public.personal x where x.school_id = v_sid and x.active), '[]'::jsonb),
    'hoy', coalesce((select jsonb_agg(jsonb_build_object('personal_id', a.personal_id, 'scanned_at', a.scanned_at,
        'status', a.status, 'late_minutes', a.late_minutes, 'device', a.device, 'by', a.recorded_by_name, 'offline', a.offline))
      from public.personal_attendance a
      where a.school_id = v_sid and a.fecha = (now() at time zone s.timezone)::date), '[]'::jsonb));
end $$;

-- Asistencia del personal de un día (solo administrativo)
create or replace function public.personal_day(p_school uuid default null, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_tz text; v_date date;
begin
  select timezone into v_tz from public.schools where id = v_sid;
  v_date := coalesce(p_date, (now() at time zone v_tz)::date);
  return jsonb_build_object('fecha', v_date, 'registros', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'puesto', x.puesto,
      'entry_time', to_char(x.entry_time, 'HH24:MI'), 'status', a.status, 'late_minutes', a.late_minutes,
      'scanned_at', a.scanned_at, 'by', a.recorded_by_name, 'offline', a.offline) order by x.nombre)
    from public.personal x left join public.personal_attendance a on a.personal_id = x.id and a.fecha = v_date
    where x.school_id = v_sid and x.active), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 6. ESCANEO GENERAL (alumnos y personal) con alarma
-- ---------------------------------------------------------------------
-- Cada item: {cid, token | student_id, scanned_at, method, device, offline}
-- Resultados: REGISTRADO · DUPLICADO · ALARMA · PERSONAL_NO_ACTIVADO · ERROR
create or replace function public.register_scan_batch(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles%rowtype; s public.schools%rowtype;
  st public.students%rowtype; pe public.personal%rowtype; rt public.retired_tokens%rowtype;
  v_att public.attendance%rowtype; v_patt public.personal_attendance%rowtype;
  it jsonb; v_out jsonb := '[]'::jsonb; v_cid text; v_tok uuid; v_type text;
  v_ts timestamptz; v_local timestamp; v_fecha date; v_t time; v_dead time; v_status text; v_late int;
  v_method text; v_dev text; v_off boolean; v_result text; v_replaced boolean; v_kind text; v_gap numeric;
  v_prev_ts timestamptz; v_prev_dev text; v_prev_by text; v_person jsonb; v_name text;
begin
  select * into p from public.profiles where id = v_uid and active and role in ('prefect','school_admin');
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  select * into s from public.schools where id = p.school_id and active;
  if not found then raise exception 'ESCUELA_INACTIVA'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then raise exception 'FORMATO_INVALIDO'; end if;

  for it in select value from jsonb_array_elements(p_items) loop
    v_cid := it->>'cid';
    begin
      v_method := coalesce(it->>'method', 'QR');
      if v_method not in ('QR','MANUAL') then raise exception 'METODO_INVALIDO'; end if;
      v_ts := (it->>'scanned_at')::timestamptz;
      if v_ts is null then raise exception 'HORA_REQUERIDA'; end if;
      if v_ts > now() + interval '5 minutes' then raise exception 'HORA_FUTURA'; end if;
      if v_ts < now() - interval '45 days' then raise exception 'HORA_MUY_ANTIGUA'; end if;
      v_dev := left(nullif(btrim(coalesce(it->>'device', '')), ''), 120);
      v_off := coalesce((it->>'offline')::boolean, false);
      v_local := v_ts at time zone s.timezone;
      v_fecha := v_local::date;
      v_t := v_local::time;
      v_type := null; v_tok := null; v_kind := null; v_replaced := false;

      if nullif(it->>'student_id', '') is not null then
        select * into st from public.students where id = (it->>'student_id')::uuid and school_id = s.id;
        if found then v_type := 'ALUMNO'; end if;
      elsif nullif(it->>'token', '') is not null then
        v_tok := (it->>'token')::uuid;
        select * into st from public.students where qr_token = v_tok and school_id = s.id;
        if found then
          v_type := 'ALUMNO';
        else
          select * into pe from public.personal where qr_token = v_tok and school_id = s.id;
          if found then v_type := 'PERSONAL'; end if;
        end if;
      end if;

      if v_type is null then
        select * into rt from public.retired_tokens where token = v_tok and school_id = s.id;
        if found then
          if rt.person_type = 'ALUMNO' then select nombre into v_name from public.students where id = rt.person_id;
          else select nombre into v_name from public.personal where id = rt.person_id; end if;
          perform app.raise_alarm(s.id, rt.person_type, rt.person_id, v_name, 'QR_REEMPLAZADO', v_fecha,
            jsonb_build_object('retirado', rt.retired_at), v_dev, p.id, p.full_name, v_ts);
          v_out := v_out || jsonb_build_array(jsonb_build_object('cid', v_cid, 'result', 'ALARMA', 'kind', 'QR_REEMPLAZADO',
            'person', jsonb_build_object('type', rt.person_type, 'nombre', v_name)));
        else
          perform app.raise_alarm(s.id, null, null, null, 'QR_NO_RECONOCIDO', v_fecha, '{}'::jsonb, v_dev, p.id, p.full_name, v_ts);
          v_out := v_out || jsonb_build_array(jsonb_build_object('cid', v_cid, 'result', 'ERROR', 'error', 'QR_NO_VALIDO'));
        end if;
        continue;
      end if;

      if v_type = 'ALUMNO' then
        if not st.active then raise exception 'ALUMNO_INACTIVO'; end if;
        v_dead := s.entry_time + (s.tolerance_min * interval '1 minute');
        if v_t <= v_dead then v_status := 'PUNTUAL'; v_late := 0;
        else v_status := 'RETARDO'; v_late := floor(extract(epoch from (v_t - s.entry_time)) / 60)::int; end if;

        insert into public.attendance (school_id, student_id, fecha, scanned_at, status, late_minutes, method,
                                       recorded_by, recorded_by_name, device, offline)
        values (s.id, st.id, v_fecha, v_ts, v_status, v_late, v_method, p.id, p.full_name, v_dev, v_off)
        on conflict (student_id, fecha) do nothing
        returning * into v_att;

        if found then
          v_result := 'REGISTRADO';
          if v_method = 'MANUAL' then
            perform app.log(s.id, 'ASISTENCIA_MANUAL', jsonb_build_object('alumno', st.nombre, 'fecha', v_fecha, 'hora', v_ts));
          end if;
        else
          v_result := 'DUPLICADO';
          select * into v_att from public.attendance where student_id = st.id and fecha = v_fecha;
          v_prev_ts := v_att.scanned_at; v_prev_dev := v_att.device; v_prev_by := v_att.recorded_by_name;
          if v_method = 'QR' then
            v_gap := abs(extract(epoch from (v_ts - v_prev_ts)));
            if v_prev_dev is not null and v_dev is not null and v_prev_dev <> v_dev then v_kind := 'OTRO_TELEFONO';
            elsif v_gap > s.alarm_minutes * 60 then v_kind := 'REPETIDO_TARDE'; end if;
          end if;
          if v_ts < v_prev_ts then
            update public.attendance set scanned_at = v_ts, status = v_status, late_minutes = v_late, method = v_method,
              recorded_by = p.id, recorded_by_name = p.full_name, device = v_dev, offline = v_off, synced_at = now()
            where id = v_att.id returning * into v_att;
            v_replaced := true;
            perform app.log(s.id, 'ASISTENCIA_REEMPLAZADA_POR_MAS_TEMPRANA', jsonb_build_object('alumno', st.nombre, 'fecha', v_fecha, 'hora', v_ts));
          end if;
          if v_kind is not null then
            v_result := 'ALARMA';
            perform app.raise_alarm(s.id, 'ALUMNO', st.id, st.nombre, v_kind, v_fecha,
              jsonb_build_object('primero', v_prev_ts, 'primero_por', v_prev_by, 'primero_device', v_prev_dev,
                                 'minutos', round(v_gap / 60)), v_dev, p.id, p.full_name, v_ts);
          end if;
        end if;
        v_person := jsonb_build_object('type', 'ALUMNO', 'id', st.id, 'nombre', st.nombre, 'grado', st.grado,
                                       'grupo', st.grupo, 'genero', st.genero);
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'cid', v_cid, 'result', v_result, 'kind', v_kind, 'replaced', v_replaced,
          'status', v_att.status, 'late_minutes', v_att.late_minutes, 'scanned_at', v_att.scanned_at,
          'first_scanned_at', v_prev_ts, 'by', v_att.recorded_by_name, 'person', v_person, 'student', v_person));
        v_prev_ts := null; v_prev_dev := null; v_prev_by := null;

      else  -- PERSONAL
        v_person := jsonb_build_object('type', 'PERSONAL', 'id', pe.id, 'nombre', pe.nombre, 'puesto', pe.puesto);
        if not s.staff_qr_enabled then
          v_out := v_out || jsonb_build_array(jsonb_build_object('cid', v_cid, 'result', 'PERSONAL_NO_ACTIVADO', 'person', v_person));
          continue;
        end if;
        if not pe.active then raise exception 'PERSONAL_INACTIVO'; end if;
        v_dead := pe.entry_time + (s.staff_tolerance_min * interval '1 minute');
        if v_t <= v_dead then v_status := 'PUNTUAL'; v_late := 0;
        else v_status := 'RETARDO'; v_late := floor(extract(epoch from (v_t - pe.entry_time)) / 60)::int; end if;

        insert into public.personal_attendance (school_id, personal_id, fecha, scanned_at, status, late_minutes,
                                                recorded_by, recorded_by_name, device, offline)
        values (s.id, pe.id, v_fecha, v_ts, v_status, v_late, p.id, p.full_name, v_dev, v_off)
        on conflict (personal_id, fecha) do nothing
        returning * into v_patt;

        if found then
          v_result := 'REGISTRADO';
        else
          v_result := 'DUPLICADO';
          select * into v_patt from public.personal_attendance where personal_id = pe.id and fecha = v_fecha;
          v_prev_ts := v_patt.scanned_at; v_prev_dev := v_patt.device; v_prev_by := v_patt.recorded_by_name;
          v_gap := abs(extract(epoch from (v_ts - v_prev_ts)));
          if v_prev_dev is not null and v_dev is not null and v_prev_dev <> v_dev then v_kind := 'OTRO_TELEFONO';
          elsif v_gap > s.alarm_minutes * 60 then v_kind := 'REPETIDO_TARDE'; end if;
          if v_ts < v_prev_ts then
            update public.personal_attendance set scanned_at = v_ts, status = v_status, late_minutes = v_late,
              recorded_by = p.id, recorded_by_name = p.full_name, device = v_dev, offline = v_off, synced_at = now()
            where id = v_patt.id returning * into v_patt;
            v_replaced := true;
          end if;
          if v_kind is not null then
            v_result := 'ALARMA';
            perform app.raise_alarm(s.id, 'PERSONAL', pe.id, pe.nombre, v_kind, v_fecha,
              jsonb_build_object('primero', v_prev_ts, 'primero_por', v_prev_by, 'primero_device', v_prev_dev,
                                 'minutos', round(v_gap / 60)), v_dev, p.id, p.full_name, v_ts);
          end if;
        end if;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'cid', v_cid, 'result', v_result, 'kind', v_kind, 'replaced', v_replaced,
          'status', v_patt.status, 'late_minutes', v_patt.late_minutes, 'scanned_at', v_patt.scanned_at,
          'first_scanned_at', v_prev_ts, 'by', v_patt.recorded_by_name, 'person', v_person));
        v_prev_ts := null; v_prev_dev := null; v_prev_by := null;
      end if;
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'cid', v_cid, 'result', 'ERROR',
        'error', case when sqlstate = '22P02' then 'QR_NO_VALIDO' else sqlerrm end));
    end;
  end loop;
  return v_out;
end $$;

create or replace function public.list_alarms(p_school uuid default null, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_tz text;
begin
  select timezone into v_tz from public.schools where id = v_sid;
  p_date := coalesce(p_date, (now() at time zone v_tz)::date);
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'person_type', a.person_type,
      'person_name', a.person_name, 'scanned_at', a.scanned_at, 'scanned_by_name', a.scanned_by_name,
      'device', a.device, 'status', a.status, 'detail', a.detail) order by a.created_at desc)
    from public.qr_alarms a where a.school_id = v_sid and a.fecha = p_date), '[]'::jsonb);
end $$;

create or replace function public.review_alarm(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.qr_alarms%rowtype; v_sid uuid;
begin
  select * into a from public.qr_alarms where id = p_id;
  if not found then raise exception 'ALARMA_NO_ENCONTRADA'; end if;
  v_sid := app.target_school(a.school_id, true);
  update public.qr_alarms set status = 'REVISADO', reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  perform app.log(v_sid, 'ALARMA_REVISADA', jsonb_build_object('tipo', a.kind, 'persona', a.person_name));
end $$;

-- ---------------------------------------------------------------------
-- 7. FELICITACIONES (cumpleaños tomados de la CURP)
-- ---------------------------------------------------------------------
-- Alumnos: nombre completo, edad, grado y grupo. Personal: solo nombre, día y mes (sin edad ni año).
-- Quien nació un 29 de febrero se felicita el 28 en los años que no son bisiestos.
create or replace function public.birthdays(p_school uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_tz text; v_from date; v_to date; v_al jsonb; v_pe jsonb;
begin
  select timezone into v_tz from public.schools where id = v_sid;
  v_from := coalesce(p_from, date_trunc('month', (now() at time zone v_tz)::date)::date);
  v_to := coalesce(p_to, (date_trunc('month', v_from) + interval '1 month - 1 day')::date);
  if v_to < v_from then raise exception 'RANGO_INVALIDO'; end if;
  if v_to - v_from > 400 then raise exception 'RANGO_MUY_GRANDE'; end if;

  with yrs as (select generate_series(extract(year from v_from)::int, extract(year from v_to)::int) as y),
  base as (
    select st.id, st.nombre, st.grado, st.grupo, c.b, yrs.y,
           least(make_date(yrs.y, extract(month from c.b)::int, 1) + (extract(day from c.b)::int - 1),
                 (make_date(yrs.y, extract(month from c.b)::int, 1) + interval '1 month - 1 day')::date) as bd
    from public.students st
    join public.student_private sp on sp.student_id = st.id
    cross join lateral (select app.curp_birth(sp.curp) as b) c
    cross join yrs
    where st.school_id = v_sid and st.active and c.b is not null)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'grado', grado, 'grupo', grupo,
           'edad', y - extract(year from b)::int, 'fecha', bd,
           'dia', extract(day from bd)::int, 'mes', extract(month from bd)::int)
         order by extract(month from bd), extract(day from bd), nombre), '[]'::jsonb)
  into v_al from base where bd between v_from and v_to;

  with yrs as (select generate_series(extract(year from v_from)::int, extract(year from v_to)::int) as y),
  base as (
    select pe.id, pe.nombre, pe.puesto,
           least(make_date(yrs.y, extract(month from c.b)::int, 1) + (extract(day from c.b)::int - 1),
                 (make_date(yrs.y, extract(month from c.b)::int, 1) + interval '1 month - 1 day')::date) as bd
    from public.personal pe
    cross join lateral (select app.curp_birth(pe.curp) as b) c
    cross join yrs
    where pe.school_id = v_sid and pe.active and c.b is not null)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'puesto', puesto,
           'dia', extract(day from bd)::int, 'mes', extract(month from bd)::int)
         order by extract(month from bd), extract(day from bd), nombre), '[]'::jsonb)
  into v_pe from base where bd between v_from and v_to;

  return jsonb_build_object('desde', v_from, 'hasta', v_to, 'alumnos', v_al, 'personal', v_pe);
end $$;

-- ---------------------------------------------------------------------
-- 8. CITATORIOS
-- ---------------------------------------------------------------------

-- Sugerencias por retardos y faltas en un periodo
create or replace function public.citation_suggestions(p_school uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_tz text; v_days int;
begin
  select timezone into v_tz from public.schools where id = v_sid;
  p_to := coalesce(p_to, (now() at time zone v_tz)::date);
  p_from := coalesce(p_from, p_to - 30);
  select count(distinct fecha) into v_days from public.attendance where school_id = v_sid and fecha between p_from and p_to;
  return jsonb_build_object('desde', p_from, 'hasta', p_to, 'dias_con_clase', v_days, 'alumnos', coalesce((
    select jsonb_agg(x order by (x->>'faltas')::int + (x->>'retardos')::int desc, x->>'nombre') from (
      select jsonb_build_object('id', st.id, 'nombre', st.nombre, 'grado', st.grado, 'grupo', st.grupo,
        'retardos', count(a.id) filter (where a.status = 'RETARDO'),
        'faltas', greatest(v_days - count(a.id), 0)) as x
      from public.students st left join public.attendance a on a.student_id = st.id and a.fecha between p_from and p_to
      where st.school_id = v_sid and st.active
      group by st.id, st.nombre, st.grado, st.grupo) q
    where (x->>'retardos')::int > 0 or (x->>'faltas')::int > 0), '[]'::jsonb));
end $$;

-- Datos para imprimir: alumnos con sus tutores (todos, un grado/grupo, o una lista de ids)
create or replace function public.citation_data(p_school uuid, p_ids uuid[] default null, p_grado text default null, p_grupo text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true);
begin
  return coalesce((select jsonb_agg(x order by x->>'grado', x->>'grupo', x->>'nombre') from (
    select jsonb_build_object('id', st.id, 'nombre', st.nombre, 'grado', st.grado, 'grupo', st.grupo,
      'tutores', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'parentesco', x2.parentesco) order by x2.orden)
                  from public.student_tutors x2 join public.tutors t on t.id = x2.tutor_id where x2.student_id = st.id), '[]'::jsonb)) as x
    from public.students st
    where st.school_id = v_sid and st.active
      and (p_ids is null or st.id = any (p_ids))
      and (p_grado is null or st.grado = app.norm(p_grado))
      and (p_grupo is null or st.grupo = app.norm(p_grupo))) q), '[]'::jsonb);
end $$;

create or replace function public.log_citations(p_school uuid, p_count int, p_modo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true);
begin
  perform app.log(v_sid, 'CITATORIOS_IMPRESOS', jsonb_build_object('cantidad', p_count, 'modo', left(coalesce(p_modo, ''), 30)));
end $$;

-- ---------------------------------------------------------------------
-- 9. CONFIGURACIÓN EXTRA DE LA ESCUELA
-- ---------------------------------------------------------------------

create or replace function public.save_school_extra(p_school uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); s public.schools%rowtype;
begin
  select * into s from public.schools where id = v_sid;
  if p ? 'address'            then s.address            := nullif(btrim(p->>'address'), ''); end if;
  if p ? 'postal_code'        then s.postal_code        := nullif(btrim(p->>'postal_code'), ''); end if;
  if p ? 'director_phone'     then s.director_phone     := nullif(btrim(p->>'director_phone'), ''); end if;
  if p ? 'subdirector_phone'  then s.subdirector_phone  := nullif(btrim(p->>'subdirector_phone'), ''); end if;
  if p ? 'staff_qr_enabled'   then s.staff_qr_enabled   := (p->>'staff_qr_enabled')::boolean; end if;
  if p ? 'staff_tolerance_min' then s.staff_tolerance_min := (p->>'staff_tolerance_min')::int; end if;
  if p ? 'alarm_minutes'      then s.alarm_minutes      := (p->>'alarm_minutes')::int; end if;
  if p ? 'citation_late_min'  then s.citation_late_min  := (p->>'citation_late_min')::int; end if;
  if p ? 'citation_absent_min' then s.citation_absent_min := (p->>'citation_absent_min')::int; end if;
  if p ? 'logo_ieepo' then
    s.logo_ieepo := nullif(p->>'logo_ieepo', '');
    if s.logo_ieepo is not null and (s.logo_ieepo !~ '^data:image/(png|jpeg|webp);base64,' or length(s.logo_ieepo) > 500000) then
      raise exception 'LOGO_INVALIDO'; end if;
  end if;
  if p ? 'logo_school' then
    s.logo_school := nullif(p->>'logo_school', '');
    if s.logo_school is not null and (s.logo_school !~ '^data:image/(png|jpeg|webp);base64,' or length(s.logo_school) > 500000) then
      raise exception 'LOGO_INVALIDO'; end if;
  end if;
  if s.staff_tolerance_min < 0 or s.staff_tolerance_min > 120 then raise exception 'TOLERANCIA_INVALIDA'; end if;
  if s.alarm_minutes < 1 or s.alarm_minutes > 240 then raise exception 'ALARMA_MINUTOS_INVALIDO'; end if;
  if s.citation_late_min < 1 or s.citation_absent_min < 1 then raise exception 'UMBRAL_INVALIDO'; end if;
  update public.schools set address = s.address, postal_code = s.postal_code, director_phone = s.director_phone,
    subdirector_phone = s.subdirector_phone, staff_qr_enabled = s.staff_qr_enabled,
    staff_tolerance_min = s.staff_tolerance_min, alarm_minutes = s.alarm_minutes,
    citation_late_min = s.citation_late_min, citation_absent_min = s.citation_absent_min,
    logo_ieepo = s.logo_ieepo, logo_school = s.logo_school
  where id = v_sid;
  perform app.log(v_sid, 'AJUSTES_EXTRA_ACTUALIZADOS',
    jsonb_build_object('campos', (select jsonb_agg(k) from jsonb_object_keys(p) k where k not like 'logo%')));
end $$;

create or replace function public.school_assets(p_school uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, false);
begin
  return (select jsonb_build_object('logo_ieepo', logo_ieepo, 'logo_school', logo_school) from public.schools where id = v_sid);
end $$;

-- Contexto de la sesión, ahora con los datos nuevos y el estado del aviso de privacidad
create or replace function public.app_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles%rowtype; v_status text; v_school jsonb; v_priv boolean;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('status', 'SIN_PERFIL'); end if;
  v_status := case when p.active then 'ACTIVO' when p.activated_at is null then 'PENDIENTE' else 'BAJA' end;
  select to_jsonb(x) into v_school from (
    select id, name, cct, turno, zona, sector, locality, school_year, director, subdirector, positions,
           entry_time, tolerance_min, timezone, grades, groups, active,
           address, postal_code, director_phone, subdirector_phone,
           staff_qr_enabled, staff_tolerance_min, alarm_minutes, citation_late_min, citation_absent_min,
           (logo_ieepo is not null) as has_logo_ieepo, (logo_school is not null) as has_logo_school
    from public.schools where id = p.school_id) x;
  v_priv := exists (select 1 from public.privacy_acceptances where user_id = p.id and version = app.privacy_version());
  return jsonb_build_object('status', v_status,
    'profile', jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role, 'school_id', p.school_id),
    'school', v_school, 'privacy_version', app.privacy_version(), 'privacy_accepted', v_priv);
end $$;

-- ---------------------------------------------------------------------
-- 10. AVISO DE PRIVACIDAD
-- ---------------------------------------------------------------------

create or replace function public.accept_privacy(p_version text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  if p_version is distinct from app.privacy_version() then raise exception 'VERSION_INVALIDA'; end if;
  insert into public.privacy_acceptances (user_id, version) values (p.id, p_version) on conflict do nothing;
  insert into public.audit_log (school_id, user_id, user_name, action, detail)
  values (p.school_id, p.id, p.full_name, 'AVISO_PRIVACIDAD_ACEPTADO', jsonb_build_object('version', p_version));
end $$;

-- El administrativo anota la fecha en que se entregó el aviso a cada familia
create or replace function public.mark_privacy_notice(p_school uuid, p_ids uuid[], p_date date default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true); v_tz text; v_n int;
begin
  select timezone into v_tz from public.schools where id = v_sid;
  update public.student_private set privacy_notice_at = coalesce(p_date, (now() at time zone v_tz)::date)
  where school_id = v_sid and student_id = any (p_ids);
  get diagnostics v_n = row_count;
  perform app.log(v_sid, 'AVISO_ENTREGADO_FAMILIAS', jsonb_build_object('cantidad', v_n));
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 11. MANTENIMIENTO: mantener Supabase activo, estado y respaldo
-- ---------------------------------------------------------------------

-- Llamada ligera que hace un aviso automático (GitHub Actions) para que el proyecto no se pause
create or replace function public.ping() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  update public.heartbeat set last_ping = now(), pings = pings + 1 where id = 1;
  return jsonb_build_object('ok', true, 'time', now());
end $$;

create or replace function public.system_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  return jsonb_build_object(
    'last_ping', (select last_ping from public.heartbeat where id = 1),
    'pings', (select pings from public.heartbeat where id = 1),
    'db_bytes', pg_database_size(current_database()),
    'schools', (select count(*) from public.schools),
    'alumnos', (select count(*) from public.students),
    'personal', (select count(*) from public.personal),
    'asistencias', (select count(*) from public.attendance),
    'alarmas_pendientes', (select count(*) from public.qr_alarms where status = 'PENDIENTE'));
end $$;

-- Respaldo completo de una escuela (el administrativo lo descarga desde la aplicación)
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
      from public.personal_attendance a join public.personal pe on pe.id = a.personal_id where a.school_id = v_sid), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 12. SEGURIDAD (RLS y permisos)
-- ---------------------------------------------------------------------

alter table public.tutors              enable row level security;
alter table public.student_tutors      enable row level security;
alter table public.personal            enable row level security;
alter table public.personal_attendance enable row level security;
alter table public.retired_tokens      enable row level security;
alter table public.qr_alarms           enable row level security;
alter table public.privacy_acceptances enable row level security;
alter table public.heartbeat           enable row level security;

drop policy if exists tutors_select on public.tutors;
create policy tutors_select on public.tutors for select to authenticated
  using (app.is_super() or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists student_tutors_select on public.student_tutors;
create policy student_tutors_select on public.student_tutors for select to authenticated
  using (app.is_super() or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists personal_select on public.personal;
create policy personal_select on public.personal for select to authenticated
  using (app.is_super() or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists personal_att_select on public.personal_attendance;
create policy personal_att_select on public.personal_attendance for select to authenticated
  using (app.is_super() or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists qr_alarms_select on public.qr_alarms;
create policy qr_alarms_select on public.qr_alarms for select to authenticated
  using (app.is_super() or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists privacy_select on public.privacy_acceptances;
create policy privacy_select on public.privacy_acceptances for select to authenticated
  using (user_id = auth.uid() or app.is_super());

revoke all on public.tutors, public.student_tutors, public.personal, public.personal_attendance,
              public.retired_tokens, public.qr_alarms, public.privacy_acceptances, public.heartbeat
  from anon, authenticated;
grant select on public.tutors, public.student_tutors, public.personal, public.personal_attendance,
                public.qr_alarms, public.privacy_acceptances to authenticated;

-- Los logotipos y datos de contacto pesan o no son para todos: se piden por función
grant select (address, postal_code, director_phone, subdirector_phone, staff_qr_enabled, staff_tolerance_min,
              alarm_minutes, citation_late_min, citation_absent_min)
  on public.schools to authenticated;

-- Solo el administrativo y el super administrador leen los datos privados del alumno
-- (la tabla student_private ya tiene esa regla); el alumno no expone lengua indígena en students.

-- Permisos de funciones (se repite todo el bloque, porque aquí se crean funciones nuevas)
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app    from public, anon, authenticated;

grant execute on function app.my_role(), app.my_school(), app.is_super() to authenticated;

grant execute on function public.validate_signup(text, text) to anon, authenticated;
grant execute on function public.ping()                      to anon, authenticated;
grant execute on function public.app_context()                          to authenticated;
grant execute on function public.server_time()                          to authenticated;
grant execute on function public.save_school(uuid, jsonb)               to authenticated;
grant execute on function public.set_school_active(uuid, boolean)       to authenticated;
grant execute on function public.generate_admin_code(uuid)              to authenticated;
grant execute on function public.get_staff_code(uuid, boolean)          to authenticated;
grant execute on function public.promote_to_admin(uuid)                 to authenticated;
grant execute on function public.set_staff_active(uuid, boolean)        to authenticated;
grant execute on function public.list_schools_summary()                 to authenticated;
grant execute on function public.save_student(uuid, uuid, jsonb)        to authenticated;
grant execute on function public.import_students(uuid, jsonb)           to authenticated;
grant execute on function public.regenerate_qr(uuid, uuid)              to authenticated;
grant execute on function public.register_attendance_batch(jsonb)       to authenticated;
grant execute on function public.delete_attendance(uuid, text)          to authenticated;
grant execute on function public.day_summary(uuid, date)                to authenticated;
grant execute on function public.pending_students(uuid, date)           to authenticated;
grant execute on function public.door_report(uuid, date, date)          to authenticated;
grant execute on function public.student_history(uuid, uuid, date, date) to authenticated;

grant execute on function public.save_student2(uuid, uuid, jsonb)       to authenticated;
grant execute on function public.import_students2(uuid, jsonb)          to authenticated;
grant execute on function public.list_students_full(uuid)               to authenticated;
grant execute on function public.list_tutors(uuid)                      to authenticated;
grant execute on function public.regenerate_personal_qr(uuid, uuid)     to authenticated;
grant execute on function public.save_personal(uuid, uuid, jsonb)       to authenticated;
grant execute on function public.import_personal(uuid, jsonb)           to authenticated;
grant execute on function public.list_personal(uuid)                    to authenticated;
grant execute on function public.scan_roster(uuid)                      to authenticated;
grant execute on function public.personal_day(uuid, date)               to authenticated;
grant execute on function public.register_scan_batch(jsonb)             to authenticated;
grant execute on function public.list_alarms(uuid, date)                to authenticated;
grant execute on function public.review_alarm(uuid)                     to authenticated;
grant execute on function public.birthdays(uuid, date, date)            to authenticated;
grant execute on function public.citation_suggestions(uuid, date, date) to authenticated;
grant execute on function public.citation_data(uuid, uuid[], text, text) to authenticated;
grant execute on function public.log_citations(uuid, int, text)         to authenticated;
grant execute on function public.save_school_extra(uuid, jsonb)         to authenticated;
grant execute on function public.school_assets(uuid)                    to authenticated;
grant execute on function public.accept_privacy(text)                   to authenticated;
grant execute on function public.mark_privacy_notice(uuid, uuid[], date) to authenticated;
grant execute on function public.system_status()                        to authenticated;
grant execute on function public.export_school_data(uuid)               to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema app to supabase_auth_admin;
    grant execute on function app.handle_new_user(), app.on_user_confirmed() to supabase_auth_admin;
  end if;
end $$;
-- =====================================================================
-- CHECADOR QR · v3 · LICENCIAS POR ESCUELA, SOLO LECTURA Y SOPORTE
-- Se ejecuta DESPUÉS de schema.sql y schema_v2.sql (INSTALAR.sql ya los junta).
-- Si ya tienes la base instalada, pega SOLO este archivo en el SQL Editor y ejecútalo.
-- Se puede ejecutar más de una vez sin problema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Una licencia por escuela (una escuela = un CCT)
create table if not exists public.licenses (
  school_id        uuid primary key references public.schools(id) on delete cascade,
  gratuita         boolean not null default false,   -- licencia gratuita permanente (la de la escuela del creador)
  soporte_directo  boolean not null default false,   -- el creador puede ver los datos de esta escuela sin autorización
  vigencia_hasta   date,                             -- null = aún no pagada
  grace_days       int  not null default 15 check (grace_days between 0 and 90),
  suspended        boolean not null default false,
  suspended_reason text,
  contact_name     text,
  contact_phone    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Pagos (el monto se acuerda de forma verbal: no se guarda)
create table if not exists public.license_payments (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  fecha          date not null,
  metodo         text,
  folio          text,
  nota           text,
  vigencia_hasta date not null,
  created_by     text,
  created_at     timestamptz not null default now()
);
create index if not exists license_payments_school_idx on public.license_payments (school_id, fecha desc);

create table if not exists public.license_notes (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  nota       text not null,
  created_by text,
  created_at timestamptz not null default now()
);

-- Solicitudes de ayuda de las escuelas
create table if not exists public.support_requests (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  user_id          uuid,
  user_name        text,
  texto            text not null,
  autoriza         boolean not null default false,   -- la escuela autoriza que soporte entre a sus datos
  autorizado_hasta timestamptz,
  revoked_at       timestamptz,
  estado           text not null default 'NUEVA' check (estado in ('NUEVA','RESPONDIDA')),
  respuesta        text,
  respondida_at    timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists support_requests_school_idx on public.support_requests (school_id, created_at desc);

create table if not exists public.support_access_log (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  request_id uuid references public.support_requests(id) on delete set null,
  super_name text,
  motivo     text,
  entered_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values ('support_whatsapp', '529511494738') on conflict do nothing;

alter table public.licenses           enable row level security;
alter table public.license_payments   enable row level security;
alter table public.license_notes      enable row level security;
alter table public.support_requests   enable row level security;
alter table public.support_access_log enable row level security;
alter table public.app_settings       enable row level security;
revoke all on public.licenses, public.license_payments, public.license_notes, public.support_requests,
              public.support_access_log, public.app_settings from anon, authenticated;

-- Las escuelas que ya existen quedan activas, sin pedir clave, y el creador conserva su acceso
insert into public.licenses (school_id, gratuita, soporte_directo)
select id, true, true from public.schools
on conflict (school_id) do nothing;

-- Toda escuela nueva nace "pendiente de pago"
create or replace function app.new_school_license() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.licenses (school_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists schools_new_license on public.schools;
create trigger schools_new_license after insert on public.schools
  for each row execute function app.new_school_license();

-- ---------------------------------------------------------------------
-- 2. ESTADO DE LA LICENCIA
-- ---------------------------------------------------------------------

-- ACTIVA · POR_VENCER (30 días o menos) · GRACIA · SOLO_LECTURA · SUSPENDIDA · PENDIENTE
create or replace function app.license_state(p_school uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare l public.licenses%rowtype; v_tz text; v_today date;
begin
  select * into l from public.licenses where school_id = p_school;
  if not found then return 'ACTIVA'; end if;
  if l.suspended then return 'SUSPENDIDA'; end if;
  if l.gratuita then return 'ACTIVA'; end if;
  if l.vigencia_hasta is null then return 'PENDIENTE'; end if;
  select coalesce(timezone, 'America/Mexico_City') into v_tz from public.schools where id = p_school;
  v_today := (now() at time zone coalesce(v_tz, 'America/Mexico_City'))::date;
  if v_today <= l.vigencia_hasta - 30 then return 'ACTIVA'; end if;
  if v_today <= l.vigencia_hasta then return 'POR_VENCER'; end if;
  if v_today <= l.vigencia_hasta + l.grace_days then return 'GRACIA'; end if;
  return 'SOLO_LECTURA';
end $$;

-- ¿Se acepta un registro con esta hora de escaneo? (los hechos sin internet antes del vencimiento sí entran,
-- pero solo se aceptan hasta 7 días después del fin de la gracia, para que cambiar la hora del celular no sirva)
create or replace function app.license_allows_ts(p_school uuid, p_ts timestamptz) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare l public.licenses%rowtype; v_tz text; v_cut date;
begin
  select * into l from public.licenses where school_id = p_school;
  if not found then return true; end if;
  if l.suspended then return false; end if;
  if l.gratuita then return true; end if;
  if l.vigencia_hasta is null then return false; end if;
  select coalesce(timezone, 'America/Mexico_City') into v_tz from public.schools where id = p_school;
  v_cut := l.vigencia_hasta + l.grace_days;
  return (p_ts at time zone coalesce(v_tz, 'America/Mexico_City'))::date <= v_cut
     and (now() at time zone coalesce(v_tz, 'America/Mexico_City'))::date <= v_cut + 7;
end $$;

-- Primer 31 de julio estrictamente posterior a la fecha dada (fin del ciclo escolar)
create or replace function app.next_cycle_end(p_base date) returns date
language sql immutable as $$
  select case when p_base < make_date(extract(year from p_base)::int, 7, 31)
              then make_date(extract(year from p_base)::int, 7, 31)
              else make_date(extract(year from p_base)::int + 1, 7, 31) end
$$;

-- Resumen de la licencia para mostrar avisos en la escuela
create or replace function app.license_summary(p_school uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.licenses%rowtype; v_tz text; v_today date;
begin
  select * into l from public.licenses where school_id = p_school;
  if not found then return jsonb_build_object('state', 'ACTIVA'); end if;
  select coalesce(timezone, 'America/Mexico_City') into v_tz from public.schools where id = p_school;
  v_today := (now() at time zone coalesce(v_tz, 'America/Mexico_City'))::date;
  return jsonb_build_object('state', app.license_state(p_school), 'gratuita', l.gratuita,
    'vigencia_hasta', l.vigencia_hasta, 'grace_days', l.grace_days,
    'gracia_hasta', case when l.vigencia_hasta is null then null else l.vigencia_hasta + l.grace_days end,
    'dias_restantes', case when l.vigencia_hasta is null then null else l.vigencia_hasta - v_today end);
end $$;

-- ---------------------------------------------------------------------
-- 3. CANDADO: en solo lectura o suspendida no se escribe (lo aplica la base de datos)
-- ---------------------------------------------------------------------

create or replace function app.enforce_license() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sid uuid; v_ok boolean;
begin
  -- mantenimiento directo en el SQL Editor (sin sesión) o administración general: sin candado
  if auth.uid() is null or app.is_super() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_sid := case when tg_op = 'DELETE' then old.school_id else new.school_id end;
  if tg_table_name in ('attendance', 'personal_attendance') and tg_op <> 'DELETE' then
    v_ok := app.license_allows_ts(v_sid, new.scanned_at);
  else
    v_ok := app.license_state(v_sid) in ('ACTIVA', 'POR_VENCER', 'GRACIA');
  end if;
  if not v_ok then raise exception 'LICENCIA_VENCIDA'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['students', 'student_private', 'tutors', 'student_tutors', 'personal', 'attendance', 'personal_attendance', 'qr_alarms'] loop
    execute format('drop trigger if exists zz_license_guard on public.%I', t);
    execute format('create trigger zz_license_guard before insert or update or delete on public.%I for each row execute function app.enforce_license()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. ACCESO DEL CREADOR: sin datos personales, salvo acceso de soporte autorizado
-- ---------------------------------------------------------------------

create or replace function app.super_sees(p_school uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_super() and (
    exists (select 1 from public.licenses where school_id = p_school and soporte_directo)
    or exists (select 1 from public.support_requests r
               where r.school_id = p_school and r.autoriza and r.revoked_at is null and r.autorizado_hasta > now()));
$$;

-- Una cuenta de escuela suspendida no tiene rol ni escuela: queda sin acceso
create or replace function app.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles p where p.id = auth.uid() and p.active
     and (p.school_id is null or app.license_state(p.school_id) <> 'SUSPENDIDA') $$;

create or replace function app.my_school() returns uuid
language sql stable security definer set search_path = public as
$$ select school_id from public.profiles p where p.id = auth.uid() and p.active
     and (p.school_id is null or app.license_state(p.school_id) <> 'SUSPENDIDA') $$;

-- target_school: el administrador general solo entra a los datos de una escuela con acceso de soporte
-- (p_mgmt = true son las funciones de administración de licencias y claves, que no tocan datos personales)
drop function if exists app.target_school(uuid, boolean);
create or replace function app.target_school(p_school uuid, p_need_admin boolean default true, p_mgmt boolean default false) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_role text := app.my_role(); v_sch uuid := app.my_school();
begin
  if v_role is null then raise exception 'NO_AUTORIZADO'; end if;
  if v_role = 'super_admin' then
    if p_school is null then raise exception 'ESCUELA_REQUERIDA'; end if;
    if not exists (select 1 from public.schools where id = p_school) then raise exception 'ESCUELA_NO_EXISTE'; end if;
    if not p_mgmt and not app.super_sees(p_school) then raise exception 'ACCESO_SOPORTE_REQUERIDO'; end if;
    return p_school;
  end if;
  if p_need_admin and v_role <> 'school_admin' then raise exception 'NO_AUTORIZADO'; end if;
  if p_school is not null and p_school <> v_sch then raise exception 'NO_AUTORIZADO'; end if;
  return v_sch;
end $$;
grant execute on function app.super_sees(uuid) to authenticated;

-- Lectura directa: el creador ya no ve datos de alumnos, tutores, personal ni asistencia sin acceso de soporte
drop policy if exists students_select on public.students;
create policy students_select on public.students for select to authenticated
  using (app.super_sees(school_id) or school_id = app.my_school());
drop policy if exists student_private_select on public.student_private;
create policy student_private_select on public.student_private for select to authenticated
  using (app.super_sees(school_id) or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (app.super_sees(school_id) or school_id = app.my_school());
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (app.super_sees(school_id) or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists tutors_select on public.tutors;
create policy tutors_select on public.tutors for select to authenticated
  using (app.super_sees(school_id) or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists student_tutors_select on public.student_tutors;
create policy student_tutors_select on public.student_tutors for select to authenticated
  using (app.super_sees(school_id) or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists personal_select on public.personal;
create policy personal_select on public.personal for select to authenticated
  using (app.super_sees(school_id) or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists personal_att_select on public.personal_attendance;
create policy personal_att_select on public.personal_attendance for select to authenticated
  using (app.super_sees(school_id) or (app.my_role() = 'school_admin' and school_id = app.my_school()));
drop policy if exists qr_alarms_select on public.qr_alarms;
create policy qr_alarms_select on public.qr_alarms for select to authenticated
  using (app.super_sees(school_id) or (app.my_role() = 'school_admin' and school_id = app.my_school()));

-- Funciones de administración (no tocan datos personales): el creador entra sin acceso de soporte
create or replace function public.save_school(p_school uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := app.my_role();
  s public.schools%rowtype;
  v_creating boolean := (p_school is null);
  v_arr text[];
  v_code text;
begin
  if v_role is null then raise exception 'NO_AUTORIZADO'; end if;
  if v_creating then
    if v_role <> 'super_admin' then raise exception 'NO_AUTORIZADO'; end if;
    s.entry_time := '08:00'; s.tolerance_min := 10; s.timezone := 'America/Mexico_City';
    s.grades := '{1,2,3}'; s.groups := '{A,B,C}'; s.positions := '[]'::jsonb;
  else
    select * into s from public.schools where id = app.target_school(p_school, true, true);
  end if;

  if p ? 'name'          then s.name        := nullif(btrim(p->>'name'), ''); end if;
  if p ? 'cct'           then s.cct         := app.norm(p->>'cct'); end if;
  if p ? 'turno'         then s.turno       := nullif(btrim(p->>'turno'), ''); end if;
  if p ? 'zona'          then s.zona        := nullif(btrim(p->>'zona'), ''); end if;
  if p ? 'sector'        then s.sector      := nullif(btrim(p->>'sector'), ''); end if;
  if p ? 'locality'      then s.locality    := nullif(btrim(p->>'locality'), ''); end if;
  if p ? 'school_year'   then s.school_year := nullif(btrim(p->>'school_year'), ''); end if;
  if p ? 'director'      then s.director    := nullif(btrim(p->>'director'), ''); end if;
  if p ? 'subdirector'   then s.subdirector := nullif(btrim(p->>'subdirector'), ''); end if;
  if p ? 'entry_time'    then s.entry_time  := (p->>'entry_time')::time; end if;
  if p ? 'tolerance_min' then s.tolerance_min := (p->>'tolerance_min')::int; end if;
  if p ? 'timezone'      then s.timezone    := btrim(p->>'timezone'); end if;

  if p ? 'positions' then
    if jsonb_typeof(p->'positions') <> 'array' then raise exception 'FORMATO_INVALIDO'; end if;
    s.positions := p->'positions';
  end if;
  if p ? 'grades' then
    select coalesce(array_agg(g order by n), '{}') into v_arr from (
      select distinct on (g) g, n from (
        select app.norm(x) as g, n from jsonb_array_elements_text(p->'grades') with ordinality t(x, n)) a
      where g is not null order by g, n) b;
    s.grades := v_arr;
  end if;
  if p ? 'groups' then
    select coalesce(array_agg(g order by n), '{}') into v_arr from (
      select distinct on (g) g, n from (
        select app.norm(x) as g, n from jsonb_array_elements_text(p->'groups') with ordinality t(x, n)) a
      where g is not null order by g, n) b;
    s.groups := v_arr;
  end if;

  if s.name is null then raise exception 'NOMBRE_REQUERIDO'; end if;
  if s.tolerance_min is null or s.tolerance_min < 0 or s.tolerance_min > 120 then raise exception 'TOLERANCIA_INVALIDA'; end if;
  if coalesce(array_length(s.grades, 1), 0) = 0 then raise exception 'GRADOS_REQUERIDOS'; end if;
  if coalesce(array_length(s.groups, 1), 0) = 0 then raise exception 'GRUPOS_REQUERIDOS'; end if;
  begin
    perform now() at time zone s.timezone;
  exception when others then
    raise exception 'ZONA_HORARIA_INVALIDA';
  end;

  if v_creating then
    v_code := app.new_code('ADM');
    insert into public.schools (name, cct, turno, zona, sector, locality, school_year, director, subdirector, positions,
                                entry_time, tolerance_min, timezone, grades, groups, admin_code, admin_code_expires_at)
    values (s.name, s.cct, s.turno, s.zona, s.sector, s.locality, s.school_year, s.director, s.subdirector, s.positions,
            s.entry_time, s.tolerance_min, s.timezone, s.grades, s.groups, v_code, now() + interval '30 days')
    returning id into s.id;
    perform app.log(s.id, 'ESCUELA_CREADA', jsonb_build_object('name', s.name));
    return jsonb_build_object('school_id', s.id, 'admin_code', v_code);
  else
    update public.schools set name = s.name, cct = s.cct, turno = s.turno, zona = s.zona, sector = s.sector,
      locality = s.locality, school_year = s.school_year, director = s.director, subdirector = s.subdirector,
      positions = s.positions, entry_time = s.entry_time, tolerance_min = s.tolerance_min, timezone = s.timezone,
      grades = s.grades, groups = s.groups
    where id = s.id;
    perform app.log(s.id, 'AJUSTES_ACTUALIZADOS', jsonb_build_object('campos', (select jsonb_agg(k) from jsonb_object_keys(p) k)));
    return jsonb_build_object('school_id', s.id);
  end if;
end $$;

create or replace function public.get_staff_code(p_school uuid default null, p_regenerate boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true, true); v_code text;
begin
  select staff_code into v_code from public.schools where id = v_sid;
  if v_code is null or p_regenerate then
    v_code := app.new_code('PRE');
    update public.schools set staff_code = v_code where id = v_sid;
    perform app.log(v_sid, 'CODIGO_PERSONAL_GENERADO', '{}'::jsonb);
  end if;
  return v_code;
end $$;

create or replace function public.set_staff_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_t public.profiles%rowtype; v_sid uuid;
begin
  select * into v_t from public.profiles where id = p_user;
  if not found then raise exception 'PREFECTO_NO_ENCONTRADO'; end if;
  v_sid := app.target_school(v_t.school_id, true, true);
  if v_t.role <> 'prefect' then raise exception 'SOLO_PREFECTOS'; end if;
  if v_t.activated_at is null then raise exception 'CUENTA_PENDIENTE'; end if;
  update public.profiles set active = p_active,
    deactivated_at = case when p_active then null else now() end where id = p_user;
  perform app.log(v_sid, case when p_active then 'PREFECTO_REACTIVADO' else 'PREFECTO_BAJA' end,
                  jsonb_build_object('nombre', v_t.full_name, 'email', v_t.email));
end $$;

-- Clave de administrativo: solo si la licencia está pagada y la escuela no está suspendida
create or replace function public.generate_admin_code(p_school uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, true, true); v_code text := app.new_code('ADM'); v_exp timestamptz := now() + interval '7 days';
begin
  if app.license_state(v_sid) in ('PENDIENTE', 'SUSPENDIDA') then raise exception 'LICENCIA_NO_ACTIVA'; end if;
  update public.schools set admin_code = v_code, admin_code_expires_at = v_exp where id = v_sid;
  perform app.log(v_sid, 'CODIGO_ADMIN_GENERADO', jsonb_build_object('vence', v_exp));
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end $$;

-- Registro: la clave solo sirve si la licencia de la escuela está pagada y vigente (no pendiente ni suspendida)
create or replace function public.validate_signup(p_email text, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); s public.schools%rowtype;
begin
  if exists (select 1 from public.super_admin_emails where lower(email) = lower(btrim(coalesce(p_email, '')))) then
    return jsonb_build_object('valid', true, 'role', 'super_admin', 'school', null);
  end if;
  select * into s from public.schools where active and admin_code = v_code and admin_code_expires_at > now()
    and app.license_state(id) not in ('PENDIENTE', 'SUSPENDIDA');
  if found then return jsonb_build_object('valid', true, 'role', 'school_admin', 'school', s.name); end if;
  select * into s from public.schools where active and staff_code = v_code
    and app.license_state(id) not in ('PENDIENTE', 'SUSPENDIDA');
  if found then return jsonb_build_object('valid', true, 'role', 'prefect', 'school', s.name); end if;
  return jsonb_build_object('valid', false);
end $$;

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(btrim(coalesce(new.raw_user_meta_data->>'code', '')));
  v_name text := btrim(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', ''), '\s+', ' ', 'g'));
  s public.schools%rowtype;
begin
  if length(v_name) < 3 then raise exception 'NOMBRE_REQUERIDO'; end if;

  if exists (select 1 from public.super_admin_emails where lower(email) = lower(new.email)) then
    insert into public.profiles (id, school_id, role, full_name, email)
    values (new.id, null, 'super_admin', v_name, new.email);
  else
    select * into s from public.schools
      where active and admin_code = v_code and admin_code_expires_at > now()
        and app.license_state(id) not in ('PENDIENTE', 'SUSPENDIDA');
    if found then
      insert into public.profiles (id, school_id, role, full_name, email, code_used)
      values (new.id, s.id, 'school_admin', v_name, new.email, v_code);
    else
      select * into s from public.schools where active and staff_code = v_code
        and app.license_state(id) not in ('PENDIENTE', 'SUSPENDIDA');
      if found then
        insert into public.profiles (id, school_id, role, full_name, email)
        values (new.id, s.id, 'prefect', v_name, new.email);
      else
        raise exception 'CODIGO_INVALIDO';
      end if;
    end if;
  end if;

  if new.email_confirmed_at is not null then perform app.activate_profile(new.id); end if;
  return new;
end $$;

-- Contexto de la sesión + estado de la licencia + WhatsApp de soporte
create or replace function public.app_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles%rowtype; v_status text; v_school jsonb; v_priv boolean; v_lic jsonb; v_wa text;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('status', 'SIN_PERFIL'); end if;
  v_status := case when p.active then 'ACTIVO' when p.activated_at is null then 'PENDIENTE' else 'BAJA' end;
  select to_jsonb(x) into v_school from (
    select id, name, cct, turno, zona, sector, locality, school_year, director, subdirector, positions,
           entry_time, tolerance_min, timezone, grades, groups, active,
           address, postal_code, director_phone, subdirector_phone,
           staff_qr_enabled, staff_tolerance_min, alarm_minutes, citation_late_min, citation_absent_min,
           (logo_ieepo is not null) as has_logo_ieepo, (logo_school is not null) as has_logo_school
    from public.schools where id = p.school_id) x;
  v_priv := exists (select 1 from public.privacy_acceptances where user_id = p.id and version = app.privacy_version());
  v_lic := case when p.school_id is null then null else app.license_summary(p.school_id) end;
  select value into v_wa from public.app_settings where key = 'support_whatsapp';
  return jsonb_build_object('status', v_status,
    'profile', jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role, 'school_id', p.school_id),
    'school', v_school, 'privacy_version', app.privacy_version(), 'privacy_accepted', v_priv,
    'license', v_lic, 'support_whatsapp', v_wa);
end $$;

-- ---------------------------------------------------------------------
-- 5. PANEL DE LICENCIAS (solo administrador general; no muestra alumnos ni CURP)
-- ---------------------------------------------------------------------

create or replace function public.license_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  return jsonb_build_object(
    'whatsapp', (select value from public.app_settings where key = 'support_whatsapp'),
    'solicitudes_nuevas', (select count(*) from public.support_requests where estado = 'NUEVA'),
    'escuelas', coalesce((select jsonb_agg(x order by x->>'name') from (
      select jsonb_build_object(
        'id', s.id, 'name', s.name, 'cct', s.cct, 'locality', s.locality, 'active', s.active,
        'state', app.license_state(s.id), 'gratuita', l.gratuita, 'soporte_directo', l.soporte_directo,
        'vigencia_hasta', l.vigencia_hasta, 'grace_days', l.grace_days, 'suspended', l.suspended,
        'contact_name', l.contact_name, 'contact_phone', l.contact_phone,
        'alumnos', (select count(*) from public.students st where st.school_id = s.id and st.active),
        'admin_name', (select full_name from public.profiles p where p.school_id = s.id and p.role = 'school_admin' and p.active),
        'admin_email', (select email from public.profiles p where p.school_id = s.id and p.role = 'school_admin' and p.active),
        'admin_code', s.admin_code, 'admin_code_expires_at', s.admin_code_expires_at,
        'ultimo_pago', (select max(fecha) from public.license_payments pg where pg.school_id = s.id),
        'ultima_actividad', (select max(a.scanned_at) from public.attendance a where a.school_id = s.id),
        'solicitudes_nuevas', (select count(*) from public.support_requests r where r.school_id = s.id and r.estado = 'NUEVA'),
        'created_at', s.created_at) as x
      from public.schools s left join public.licenses l on l.school_id = s.id) t), '[]'::jsonb));
end $$;

create or replace function public.license_detail(p_school uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.schools%rowtype; l public.licenses%rowtype;
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  select * into s from public.schools where id = p_school;
  if not found then raise exception 'ESCUELA_NO_EXISTE'; end if;
  select * into l from public.licenses where school_id = p_school;
  return jsonb_build_object(
    'school', jsonb_build_object('id', s.id, 'name', s.name, 'cct', s.cct, 'locality', s.locality, 'active', s.active,
      'admin_code', s.admin_code, 'admin_code_expires_at', s.admin_code_expires_at),
    'license', jsonb_build_object('state', app.license_state(p_school), 'gratuita', l.gratuita, 'soporte_directo', l.soporte_directo,
      'vigencia_hasta', l.vigencia_hasta, 'grace_days', l.grace_days, 'suspended', l.suspended, 'suspended_reason', l.suspended_reason,
      'contact_name', l.contact_name, 'contact_phone', l.contact_phone),
    'admin_name', (select full_name from public.profiles p where p.school_id = p_school and p.role = 'school_admin' and p.active),
    'admin_email', (select email from public.profiles p where p.school_id = p_school and p.role = 'school_admin' and p.active),
    'alumnos', (select count(*) from public.students st where st.school_id = p_school and st.active),
    'ultima_actividad', (select max(a.scanned_at) from public.attendance a where a.school_id = p_school),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'fecha', fecha, 'metodo', metodo, 'folio', folio, 'nota', nota,
        'vigencia_hasta', vigencia_hasta, 'por', created_by) order by fecha desc, created_at desc)
        from public.license_payments where school_id = p_school), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nota', nota, 'por', created_by, 'at', created_at) order by created_at desc)
        from public.license_notes where school_id = p_school), '[]'::jsonb),
    'solicitudes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'estado', estado, 'created_at', created_at)
        order by created_at desc) from public.support_requests where school_id = p_school), '[]'::jsonb));
end $$;

-- Contacto, días de gracia, vigencia y licencia gratuita
create or replace function public.license_save(p_school uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare l public.licenses%rowtype; v_me text;
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  select * into l from public.licenses where school_id = p_school;
  if not found then
    if not exists (select 1 from public.schools where id = p_school) then raise exception 'ESCUELA_NO_EXISTE'; end if;
    insert into public.licenses (school_id) values (p_school) returning * into l;
  end if;
  if p ? 'contact_name'  then l.contact_name  := nullif(btrim(p->>'contact_name'), ''); end if;
  if p ? 'contact_phone' then l.contact_phone := nullif(regexp_replace(coalesce(p->>'contact_phone', ''), '[^0-9+ ]', '', 'g'), ''); end if;
  if p ? 'grace_days'    then l.grace_days    := (p->>'grace_days')::int; end if;
  if p ? 'gratuita'      then l.gratuita      := (p->>'gratuita')::boolean; end if;
  if p ? 'vigencia_hasta' then l.vigencia_hasta := nullif(p->>'vigencia_hasta', '')::date; end if;
  update public.licenses set contact_name = l.contact_name, contact_phone = l.contact_phone, grace_days = l.grace_days,
         gratuita = l.gratuita, vigencia_hasta = l.vigencia_hasta, updated_at = now() where school_id = p_school;
  select full_name into v_me from public.profiles where id = auth.uid();
  perform app.log(p_school, 'LICENCIA_EDITADA', jsonb_build_object('por', v_me));
end $$;

-- Registra el pago, deja la licencia vigente y (si hace falta) genera la clave de alta
create or replace function public.license_register_payment(p_school uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.licenses%rowtype; v_tz text; v_today date; v_fecha date; v_vig date; v_me text; v_code jsonb := null;
  v_gen boolean := coalesce((p->>'generar_clave')::boolean, true);
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  select * into l from public.licenses where school_id = p_school for update;
  if not found then
    if not exists (select 1 from public.schools where id = p_school) then raise exception 'ESCUELA_NO_EXISTE'; end if;
    insert into public.licenses (school_id) values (p_school) returning * into l;
  end if;
  select coalesce(timezone, 'America/Mexico_City') into v_tz from public.schools where id = p_school;
  v_today := (now() at time zone v_tz)::date;
  v_fecha := coalesce(nullif(p->>'fecha', '')::date, v_today);
  v_vig := coalesce(nullif(p->>'vigencia_hasta', '')::date, app.next_cycle_end(greatest(coalesce(l.vigencia_hasta, v_today), v_today)));
  if v_vig <= v_today then raise exception 'VIGENCIA_INVALIDA'; end if;
  select full_name into v_me from public.profiles where id = auth.uid();
  insert into public.license_payments (school_id, fecha, metodo, folio, nota, vigencia_hasta, created_by)
  values (p_school, v_fecha, nullif(btrim(p->>'metodo'), ''), nullif(btrim(p->>'folio'), ''), nullif(btrim(p->>'nota'), ''), v_vig, v_me);
  update public.licenses set vigencia_hasta = v_vig, updated_at = now() where school_id = p_school;
  perform app.log(p_school, 'LICENCIA_PAGO_REGISTRADO', jsonb_build_object('vigencia_hasta', v_vig, 'por', v_me));
  if v_gen and not l.suspended
     and not exists (select 1 from public.profiles where school_id = p_school and role = 'school_admin' and active) then
    v_code := public.generate_admin_code(p_school);
  end if;
  return jsonb_build_object('vigencia_hasta', v_vig, 'clave', v_code);
end $$;

create or replace function public.license_set_suspended(p_school uuid, p_suspended boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me text;
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  if not exists (select 1 from public.schools where id = p_school) then raise exception 'ESCUELA_NO_EXISTE'; end if;
  insert into public.licenses (school_id) values (p_school) on conflict do nothing;
  update public.licenses set suspended = p_suspended,
         suspended_reason = case when p_suspended then nullif(btrim(coalesce(p_reason, '')), '') else null end,
         updated_at = now() where school_id = p_school;
  select full_name into v_me from public.profiles where id = auth.uid();
  perform app.log(p_school, case when p_suspended then 'LICENCIA_SUSPENDIDA' else 'LICENCIA_REACTIVADA' end, jsonb_build_object('por', v_me));
end $$;

create or replace function public.license_add_note(p_school uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_me text;
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'NOTA_VACIA'; end if;
  if not exists (select 1 from public.schools where id = p_school) then raise exception 'ESCUELA_NO_EXISTE'; end if;
  select full_name into v_me from public.profiles where id = auth.uid();
  insert into public.license_notes (school_id, nota, created_by) values (p_school, btrim(p_note), v_me);
end $$;

create or replace function public.set_support_whatsapp(p_number text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g');
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  if length(v) = 10 then v := '52' || v; end if;
  if length(v) < 11 or length(v) > 15 then raise exception 'TELEFONO_INVALIDO'; end if;
  insert into public.app_settings (key, value) values ('support_whatsapp', v)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ---------------------------------------------------------------------
-- 6. SOPORTE: solicitudes de ayuda y acceso autorizado por la escuela
-- ---------------------------------------------------------------------

-- El administrativo pide ayuda. Si autoriza, soporte puede entrar por 3 días (la escuela puede revocarlo antes).
create or replace function public.support_request_create(p_text text, p_autoriza boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; v_id uuid;
begin
  select * into p from public.profiles where id = auth.uid() and active and role = 'school_admin';
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  if nullif(btrim(coalesce(p_text, '')), '') is null then raise exception 'TEXTO_REQUERIDO'; end if;
  if length(p_text) > 1000 then raise exception 'TEXTO_MUY_LARGO'; end if;
  insert into public.support_requests (school_id, user_id, user_name, texto, autoriza, autorizado_hasta)
  values (p.school_id, p.id, p.full_name, btrim(p_text), coalesce(p_autoriza, false),
          case when coalesce(p_autoriza, false) then now() + interval '3 days' end)
  returning id into v_id;
  perform app.log(p.school_id, case when p_autoriza then 'SOPORTE_SOLICITADO_CON_AUTORIZACION' else 'SOPORTE_SOLICITADO' end, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.support_requests_mine() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid() and active and role = 'school_admin';
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  return jsonb_build_object(
    'solicitudes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'estado', estado, 'respuesta', respuesta,
        'respondida_at', respondida_at, 'created_at', created_at, 'autoriza', autoriza, 'autorizado_hasta', autorizado_hasta,
        'revocada', revoked_at is not null,
        'acceso_vigente', (autoriza and revoked_at is null and autorizado_hasta > now())) order by created_at desc)
        from public.support_requests where school_id = p.school_id), '[]'::jsonb),
    'accesos', coalesce((select jsonb_agg(jsonb_build_object('at', entered_at, 'por', super_name, 'motivo', motivo) order by entered_at desc)
        from (select * from public.support_access_log where school_id = p.school_id order by entered_at desc limit 20) z), '[]'::jsonb));
end $$;

create or replace function public.support_request_revoke(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid() and active and role = 'school_admin';
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  update public.support_requests set revoked_at = now() where id = p_id and school_id = p.school_id and revoked_at is null;
  if not found then raise exception 'SOLICITUD_NO_ENCONTRADA'; end if;
  perform app.log(p.school_id, 'SOPORTE_ACCESO_REVOCADO', '{}'::jsonb);
end $$;

create or replace function public.support_requests_all() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  return jsonb_build_object(
    'solicitudes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'school_id', r.school_id, 'school', s.name, 'user_name', r.user_name,
        'texto', r.texto, 'estado', r.estado, 'respuesta', r.respuesta, 'created_at', r.created_at, 'autoriza', r.autoriza,
        'autorizado_hasta', r.autorizado_hasta, 'revocada', r.revoked_at is not null,
        'acceso_vigente', (r.autoriza and r.revoked_at is null and r.autorizado_hasta > now())) order by r.created_at desc)
        from public.support_requests r join public.schools s on s.id = r.school_id), '[]'::jsonb),
    'accesos', coalesce((select jsonb_agg(jsonb_build_object('at', g.entered_at, 'school', s.name, 'por', g.super_name, 'motivo', g.motivo) order by g.entered_at desc)
        from (select * from public.support_access_log order by entered_at desc limit 50) g join public.schools s on s.id = g.school_id), '[]'::jsonb));
end $$;

create or replace function public.support_request_reply(p_id uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  if nullif(btrim(coalesce(p_text, '')), '') is null then raise exception 'TEXTO_REQUERIDO'; end if;
  update public.support_requests set respuesta = btrim(p_text), estado = 'RESPONDIDA', respondida_at = now() where id = p_id;
  if not found then raise exception 'SOLICITUD_NO_ENCONTRADA'; end if;
end $$;

-- Entrar a una escuela con una solicitud autorizada y vigente. Queda anotado en la bitácora de soporte y en la de la escuela.
create or replace function public.support_enter(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.support_requests%rowtype; v_me text;
begin
  if not app.is_super() then raise exception 'NO_AUTORIZADO'; end if;
  select * into r from public.support_requests where id = p_id;
  if not found then raise exception 'SOLICITUD_NO_ENCONTRADA'; end if;
  if not (r.autoriza and r.revoked_at is null and r.autorizado_hasta > now()) then raise exception 'ACCESO_SOPORTE_REQUERIDO'; end if;
  select full_name into v_me from public.profiles where id = auth.uid();
  insert into public.support_access_log (school_id, request_id, super_name, motivo) values (r.school_id, r.id, v_me, left(r.texto, 200));
  perform app.log(r.school_id, 'SOPORTE_ENTRO', jsonb_build_object('por', v_me, 'motivo', left(r.texto, 200)));
  return r.school_id;
end $$;

-- ---------------------------------------------------------------------
-- 7. PERMISOS
-- ---------------------------------------------------------------------
revoke execute on function
  app.new_school_license(), app.license_allows_ts(uuid, timestamptz), app.next_cycle_end(date), app.license_summary(uuid),
  app.enforce_license(), app.target_school(uuid, boolean, boolean),
  public.license_overview(), public.license_detail(uuid), public.license_save(uuid, jsonb), public.license_register_payment(uuid, jsonb),
  public.license_set_suspended(uuid, boolean, text), public.license_add_note(uuid, text), public.set_support_whatsapp(text),
  public.support_request_create(text, boolean), public.support_requests_mine(), public.support_request_revoke(uuid),
  public.support_requests_all(), public.support_request_reply(uuid, text), public.support_enter(uuid)
  from public, anon, authenticated;

grant execute on function
  public.license_overview(), public.license_detail(uuid), public.license_save(uuid, jsonb), public.license_register_payment(uuid, jsonb),
  public.license_set_suspended(uuid, boolean, text), public.license_add_note(uuid, text), public.set_support_whatsapp(text),
  public.support_request_create(text, boolean), public.support_requests_mine(), public.support_request_revoke(uuid),
  public.support_requests_all(), public.support_request_reply(uuid, text), public.support_enter(uuid)
  to authenticated;
-- (validate_signup, app_context, generate_admin_code, save_school, get_staff_code y set_staff_active conservan sus permisos)
