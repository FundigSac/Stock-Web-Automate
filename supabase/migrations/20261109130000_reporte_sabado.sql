-- Reporte semanal: guarda qué sábado cubrió el último reporte y hasta qué subida llegó.

alter table public.ajustes
  add column if not exists reporte_sabado date,
  add column if not exists reporte_ultimo_en timestamptz;

comment on column public.ajustes.reporte_sabado is 'Último sábado cubierto por un reporte semanal.';
comment on column public.ajustes.reporte_ultimo_en is 'Instante del último reporte. Lo que suba después con fecha anterior sale en el reporte siguiente como llegada tarde.';

-- p_corte: la última subida incluida en el PDF. Lo que llegue después tiene que salir en el reporte siguiente, aunque
-- el reporte se marque horas más tarde.
create or replace function public.marcar_reporte_sabado(p_quien text, p_sabado date, p_corte timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.puede_registrar() then
    raise exception 'No tienes permiso para marcar el reporte.' using errcode = '42501';
  end if;
  if p_sabado is null or extract(isodow from p_sabado) <> 6 then
    raise exception 'La fecha del reporte debe ser un sábado.';
  end if;
  -- El sábado lo calcula el dispositivo. Un reloj adelantado no puede dar por hechas semanas que no han pasado.
  if p_sabado > (now() at time zone 'America/Lima')::date + 3 then
    raise exception 'La fecha del reporte queda demasiado adelante. Revisa el reloj de este dispositivo.';
  end if;

  perform public.marcar_reporte(p_quien);

  update public.ajustes
     set reporte_sabado = greatest(coalesce(reporte_sabado, p_sabado), p_sabado),
         reporte_ultimo_en = greatest(reporte_ultimo_en, least(coalesce(p_corte, now()), now()))
   where id = 1;
end;
$$;

revoke all on function public.marcar_reporte_sabado(text, date, timestamptz) from public;
grant execute on function public.marcar_reporte_sabado(text, date, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
