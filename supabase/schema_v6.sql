-- =====================================================================
--  Checador QR · Parche v6: formatos de citatorios, avisos, credencial y lista de padres
--  Para una base de datos ya instalada: ejecutar SOLO este archivo (se puede repetir). Requiere haber ejecutado v4.
-- =====================================================================
alter table public.schools add column if not exists internal_key text;          -- clave interna de la escuela: "ES-372-61"
alter table public.schools add column if not exists second_signer text;        -- segundo firmante (p. ej. presidente del comité de padres)
alter table public.schools add column if not exists second_signer_title text;  -- cargo del segundo firmante

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
  if p ? 'header_line'    then s.header_line    := nullif(btrim(p->>'header_line'), ''); end if;
  if p ? 'place_line'     then s.place_line     := nullif(btrim(p->>'place_line'), ''); end if;
  if p ? 'director_title' then s.director_title := nullif(btrim(p->>'director_title'), ''); end if;
  if p ? 'citation_text'  then s.citation_text  := nullif(btrim(p->>'citation_text'), ''); end if;
  if p ? 'internal_key'   then s.internal_key   := nullif(btrim(p->>'internal_key'), ''); end if;
  if p ? 'second_signer'  then s.second_signer  := nullif(btrim(p->>'second_signer'), ''); end if;
  if p ? 'second_signer_title' then s.second_signer_title := nullif(btrim(p->>'second_signer_title'), ''); end if;
  if length(coalesce(s.header_line, '')) > 300 or length(coalesce(s.place_line, '')) > 150 or length(coalesce(s.director_title, '')) > 100
     or length(coalesce(s.internal_key, '')) > 40 or length(coalesce(s.second_signer, '')) > 120 or length(coalesce(s.second_signer_title, '')) > 120
     or length(coalesce(s.citation_text, '')) > 800 then raise exception 'TEXTO_MUY_LARGO'; end if;
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
    logo_ieepo = s.logo_ieepo, logo_school = s.logo_school,
    header_line = s.header_line, place_line = s.place_line, director_title = s.director_title, citation_text = s.citation_text,
    internal_key = s.internal_key, second_signer = s.second_signer, second_signer_title = s.second_signer_title
  where id = v_sid;
  perform app.log(v_sid, 'AJUSTES_EXTRA_ACTUALIZADOS',
    jsonb_build_object('campos', (select jsonb_agg(k) from jsonb_object_keys(p) k where k not like 'logo%')));
end $$;

create or replace function public.school_assets(p_school uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid := app.target_school(p_school, false);
begin
  return (select jsonb_build_object('logo_ieepo', logo_ieepo, 'logo_school', logo_school,
            'header_line', header_line, 'place_line', place_line, 'director_title', director_title, 'citation_text', citation_text,
            'internal_key', internal_key, 'second_signer', second_signer, 'second_signer_title', second_signer_title)
          from public.schools where id = v_sid);
end $$;
grant execute on function public.save_school_extra(uuid, jsonb) to authenticated;
grant execute on function public.school_assets(uuid) to authenticated;
