-- Checador QR · parche v10: el super administrador (con acceso de soporte a la escuela elegida)
-- puede registrar entradas desde la pantalla "Entrada (administración)". Repetible sin riesgo.
drop function if exists public.register_scan_batch(jsonb);

create or replace function public.register_scan_batch(p_items jsonb, p_school uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_sid uuid;
  p public.profiles%rowtype; s public.schools%rowtype;
  st public.students%rowtype; pe public.personal%rowtype; rt public.retired_tokens%rowtype;
  v_att public.attendance%rowtype; v_patt public.personal_attendance%rowtype;
  it jsonb; v_out jsonb := '[]'::jsonb; v_cid text; v_tok uuid; v_type text;
  v_ts timestamptz; v_local timestamp; v_fecha date; v_t time; v_dead time; v_status text; v_late int;
  v_method text; v_dev text; v_off boolean; v_result text; v_replaced boolean; v_kind text; v_gap numeric;
  v_prev_ts timestamptz; v_prev_dev text; v_prev_by text; v_person jsonb; v_name text;
begin
  select * into p from public.profiles where id = v_uid and active and role in ('prefect','school_admin','super_admin');
  if not found then raise exception 'NO_AUTORIZADO'; end if;
  if p.role <> 'super_admin' and p_school is not null and p_school <> p.school_id then raise exception 'NO_AUTORIZADO'; end if;
  v_sid := case when p.role = 'super_admin' then app.target_school(p_school, true) else p.school_id end;
  select * into s from public.schools where id = v_sid and active;
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

revoke execute on function public.register_scan_batch(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.register_scan_batch(jsonb, uuid) to authenticated;
