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
