-- =====================================================================
--  Checador QR · Parche v5: varios administrativos por escuela
--  Para una base de datos ya instalada: ejecutar SOLO este archivo (se puede repetir).
-- =====================================================================
drop index if exists public.one_active_admin_per_school;      -- antes: un solo administrativo activo por escuela

create or replace function app.max_admins() returns int language sql immutable as $$ select 4 $$;

-- Una clave ADM nueva SUMA un administrativo (ya no reemplaza al actual)
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
    -- ya no se reemplaza al administrativo anterior: se suma (tope por escuela)
    if (select count(*) from public.profiles where school_id = p.school_id and role = 'school_admin' and active) >= app.max_admins() then
      return;   -- la cuenta queda pendiente; un administrativo debe dar de baja a otro primero
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

-- Los resúmenes muestran a todos los administrativos, no solo a uno
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
        'admin_name', (select string_agg(full_name, ', ' order by activated_at) from public.profiles p where p.school_id = s.id and p.role = 'school_admin' and p.active),
        'admin_email', (select string_agg(email, ', ' order by activated_at) from public.profiles p where p.school_id = s.id and p.role = 'school_admin' and p.active),
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
    'admin_name', (select string_agg(full_name, ', ' order by activated_at) from public.profiles p where p.school_id = p_school and p.role = 'school_admin' and p.active),
    'admin_email', (select string_agg(email, ', ' order by activated_at) from public.profiles p where p.school_id = p_school and p.role = 'school_admin' and p.active),
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
      'admin_name', (select string_agg(full_name, ', ' order by activated_at) from public.profiles p where p.school_id = s.id and p.role = 'school_admin' and p.active),
      'admin_email', (select string_agg(email, ', ' order by activated_at) from public.profiles p where p.school_id = s.id and p.role = 'school_admin' and p.active),
      'admin_code', s.admin_code, 'admin_code_expires_at', s.admin_code_expires_at,
      'staff_code', s.staff_code) as x
    from public.schools s) t), '[]'::jsonb);
end $$;

-- Sumar a un prefecto como administrativo (el actual conserva su cuenta)
create or replace function public.promote_to_admin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me public.profiles%rowtype; v_t public.profiles%rowtype;
begin
  select * into v_me from public.profiles where id = auth.uid() and active and role = 'school_admin';
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  select * into v_t from public.profiles where id = p_user and school_id = v_me.school_id and active and role = 'prefect';
  if not found then raise exception 'PREFECTO_NO_ENCONTRADO'; end if;
  if (select count(*) from public.profiles where school_id = v_me.school_id and role = 'school_admin' and active) >= app.max_admins() then
    raise exception 'LIMITE_ADMINS'; end if;
  update public.profiles set role = 'school_admin' where id = v_t.id;
  insert into public.audit_log (school_id, user_id, user_name, action, detail)
  values (v_me.school_id, v_me.id, v_me.full_name, 'ADMINISTRATIVO_AGREGADO',
          jsonb_build_object('nuevo_admin', v_t.full_name, 'nuevo_email', v_t.email));
end $$;

-- Dar de baja o reactivar a un administrativo (nunca al último)
create or replace function public.set_admin_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_t public.profiles%rowtype; v_sid uuid;
begin
  select * into v_t from public.profiles where id = p_user;
  if not found or v_t.role <> 'school_admin' then raise exception 'ADMIN_NO_ENCONTRADO'; end if;
  v_sid := app.target_school(v_t.school_id, true, true);
  if v_t.activated_at is null then raise exception 'CUENTA_PENDIENTE'; end if;
  perform 1 from public.schools where id = v_sid for update;
  if p_active then
    if v_t.active then return; end if;
    if (select count(*) from public.profiles where school_id = v_sid and role = 'school_admin' and active) >= app.max_admins() then
      raise exception 'LIMITE_ADMINS'; end if;
  else
    if not v_t.active then return; end if;
    if (select count(*) from public.profiles where school_id = v_sid and role = 'school_admin' and active) <= 1 then
      raise exception 'ULTIMO_ADMIN'; end if;
  end if;
  update public.profiles set active = p_active, deactivated_at = case when p_active then null else now() end where id = p_user;
  perform app.log(v_sid, case when p_active then 'ADMINISTRATIVO_REACTIVADO' else 'ADMINISTRATIVO_BAJA' end,
                  jsonb_build_object('nombre', v_t.full_name, 'email', v_t.email));
end $$;

grant execute on function public.promote_to_admin(uuid) to authenticated;
grant execute on function public.set_admin_active(uuid, boolean) to authenticated;
grant execute on function public.license_overview() to authenticated;
grant execute on function public.license_detail(uuid) to authenticated;
grant execute on function public.list_schools_summary() to authenticated;
