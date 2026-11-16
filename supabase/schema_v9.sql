-- Checador QR · parche v9: el super administrador (con acceso de soporte a la escuela elegida)
-- también puede usar "Retiro anticipado". Repetible sin riesgo.
drop function if exists public.early_exit_lookup(uuid, uuid);
drop function if exists public.register_early_exit(uuid, text, text);

create or replace function public.early_exit_lookup(p_token uuid default null, p_student uuid default null, p_school uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles%rowtype; s public.schools%rowtype; st public.students%rowtype;
  a public.attendance%rowtype; e public.early_exits%rowtype; v_fecha date; v_person jsonb; v_sid uuid;
begin
  select * into p from public.profiles where id = auth.uid() and active and role in ('prefect', 'school_admin', 'super_admin');
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  if p.role <> 'super_admin' and p_school is not null and p_school <> p.school_id then raise exception 'NO_AUTORIZADO'; end if;
  v_sid := case when p.role = 'super_admin' then app.target_school(p_school, true) else p.school_id end;
  select * into s from public.schools where id = v_sid and active;
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

create or replace function public.register_early_exit(p_student uuid, p_categoria text, p_recogio text default null, p_school uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles%rowtype; s public.schools%rowtype; st public.students%rowtype; a public.attendance%rowtype;
  v_now timestamptz := now(); v_fecha date; v_rec text; v_id uuid; v_sid uuid;
begin
  select * into p from public.profiles where id = auth.uid() and active and role in ('prefect', 'school_admin', 'super_admin');
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  if p.role <> 'super_admin' and p_school is not null and p_school <> p.school_id then raise exception 'NO_AUTORIZADO'; end if;
  v_sid := case when p.role = 'super_admin' then app.target_school(p_school, true) else p.school_id end;
  select * into s from public.schools where id = v_sid and active;
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

revoke execute on function public.early_exit_lookup(uuid, uuid, uuid), public.register_early_exit(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.early_exit_lookup(uuid, uuid, uuid) to authenticated;
grant execute on function public.register_early_exit(uuid, text, text, uuid) to authenticated;
