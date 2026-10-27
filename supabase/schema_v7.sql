-- =====================================================================
-- Checador QR · parche v7 — Eliminación definitiva de un alumno (baja con seguro)
-- Para bases YA instaladas: ejecutar solo este archivo (se puede repetir sin riesgo).
-- La función exige: administrador de la escuela, motivo válido y el nombre completo
-- del alumno escrito igual. Borra al alumno, su QR, su asistencia y sus alarmas;
-- si un tutor se queda sin hijos en la escuela, también se borra el tutor.
-- =====================================================================

create or replace function public.delete_student(p_school uuid, p_student uuid, p_motivo text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid := app.target_school(p_school, true);
  s record; v_att int; v_tut int;
  v_norm text := upper(regexp_replace(btrim(coalesce(p_confirm, '')), '\s+', ' ', 'g'));
begin
  if coalesce(p_motivo, '') not in ('CAMBIO_ESCUELA', 'CAMBIO_DOMICILIO', 'ABANDONO', 'OTRO') then raise exception 'MOTIVO_REQUERIDO'; end if;
  select id, nombre, grado, grupo into s from public.students where id = p_student and school_id = v_sid for update;
  if s.id is null then raise exception 'ALUMNO_NO_ENCONTRADO'; end if;
  if v_norm <> upper(regexp_replace(btrim(s.nombre), '\s+', ' ', 'g')) then raise exception 'CONFIRMACION_NO_COINCIDE'; end if;

  delete from public.attendance where student_id = s.id and school_id = v_sid;
  get diagnostics v_att = row_count;
  delete from public.qr_alarms where person_type = 'ALUMNO' and person_id = s.id and school_id = v_sid;
  delete from public.student_tutors where student_id = s.id;                       -- (también caería en cascada)
  delete from public.student_private where student_id = s.id;
  delete from public.students where id = s.id and school_id = v_sid;
  -- tutores que se quedaron sin ningún hijo en la escuela
  delete from public.tutors t where t.school_id = v_sid
    and not exists (select 1 from public.student_tutors x where x.tutor_id = t.id);
  get diagnostics v_tut = row_count;

  -- Bitácora sin nombre del alumno: solo motivo, grupo y cuántos registros se borraron
  perform app.log(v_sid, 'ALUMNO_ELIMINADO', jsonb_build_object('motivo', p_motivo, 'grado', s.grado, 'grupo', s.grupo,
                  'asistencias_borradas', v_att, 'tutores_borrados', v_tut));
  return jsonb_build_object('ok', true, 'asistencias_borradas', v_att, 'tutores_borrados', v_tut);
end $$;
grant execute on function public.delete_student(uuid, uuid, text, text) to authenticated;
