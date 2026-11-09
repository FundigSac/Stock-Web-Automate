-- Registro sin conexión: guarda el instante real de la foto y evita duplicados al reintentar.
-- registrar_lote no bloquea el saldo negativo: la fila queda registrada y el motivo se anota en revisar_motivo.

alter table public.salidas
  add column if not exists capturado_en timestamptz,
  add column if not exists capturado_origen text,
  add column if not exists subido_en timestamptz default now(),
  add column if not exists client_id uuid unique,
  add column if not exists reloj_desfase_segundos integer,
  add column if not exists revisar_motivo text;

alter table public.entradas
  add column if not exists capturado_en timestamptz,
  add column if not exists capturado_origen text,
  add column if not exists subido_en timestamptz default now(),
  add column if not exists client_id uuid unique,
  add column if not exists reloj_desfase_segundos integer,
  add column if not exists revisar_motivo text;

-- Lo histórico llegó cuando se creó la fila. Su capturado_en se queda en NULL y sin valor por defecto:
-- esas filas no tienen hora de foto, y el PDF no debe certificar la de inserción como si lo fuera.
update public.salidas set subido_en = created_at where capturado_en is null;
update public.entradas set subido_en = created_at where capturado_en is null;

comment on column public.salidas.capturado_en is 'Instante de la foto o del registro en el dispositivo. Nunca la hora de subida. NULL en las filas históricas.';
comment on column public.entradas.capturado_en is 'Instante de la foto o del registro en el dispositivo. Nunca la hora de subida. NULL en las filas históricas.';
comment on column public.salidas.capturado_origen is 'De dónde salió capturado_en: exif, camara, archivo, ahora o registro.';
comment on column public.entradas.capturado_origen is 'De dónde salió capturado_en: exif, camara, archivo, ahora o registro.';
comment on column public.salidas.reloj_desfase_segundos is 'Reloj del dispositivo menos reloj del servidor al subir, en el primer intento.';
comment on column public.entradas.reloj_desfase_segundos is 'Reloj del dispositivo menos reloj del servidor al subir, en el primer intento.';
comment on column public.salidas.revisar_motivo is 'Por qué esta fila necesita revisión: saldo negativo, reloj desfasado o fecha que no coincide con la foto.';
comment on column public.entradas.revisar_motivo is 'Por qué esta fila necesita revisión: reloj desfasado o fecha que no coincide.';

-- Punto de entrada único del dispositivo. Envuelve a registrar_lote para no duplicar su lógica
-- y le añade la llave de idempotencia por línea.
--
-- RLS: es SECURITY DEFINER porque necesita escribir las columnas nuevas después de registrar_lote, y las
-- políticas de las tablas son por fila, así que las columnas nuevas no cambian quién puede leer qué.
-- Al saltarse RLS, repite aquí la regla de la app con public.puede_registrar().
-- La foto no necesita política nueva: el dispositivo sube sin upsert y trata "ya existe" como éxito.
create or replace function public.registrar_offline(
  p_tipo text,
  p_fecha date,
  p_quien text,
  p_items jsonb,
  p_capturado_en timestamptz,
  p_reloj_dispositivo timestamptz,
  p_trabajador text default null,
  p_nota text default null,
  p_foto text default null,
  p_desfase_captura integer default null,
  p_capturado_origen text default null,
  p_hora_dudosa boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linea jsonb;
  v_cid uuid;
  v_codigo text;
  v_id bigint;
  v_queda integer;
  v_res jsonb;
  v_fila jsonb;
  v_salida jsonb := '[]'::jsonb;
  v_motivo text;
  v_desfase integer;
  v_desfase_referencia integer;
  v_reloj_cambio boolean;
  v_desfase_primero integer;
  v_ya_existia boolean;
  v_fecha_foto date;
  v_hoy date;
begin
  if p_tipo not in ('entrada', 'salida') then
    raise exception 'Tipo de movimiento no válido.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'La lista de productos no es válida.';
  end if;
  if p_capturado_en is null or p_reloj_dispositivo is null then
    raise exception 'Falta la hora del registro.';
  end if;
  if p_foto is not null and p_foto !~ '^(salidas|entradas)/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$' then
    raise exception 'La ruta de la foto no es válida.';
  end if;
  if p_capturado_origen is not null and p_capturado_origen not in ('exif', 'camara', 'archivo', 'ahora', 'registro') then
    raise exception 'El origen de la hora no es válido.';
  end if;
  if not public.puede_registrar() then
    raise exception 'No tienes permiso para registrar movimientos.' using errcode = '42501';
  end if;

  v_desfase := round(extract(epoch from (p_reloj_dispositivo - now())))::integer;
  -- p_desfase_captura viene del último contacto con el servidor, que puede ser de hace días. Vale el peor de los dos.
  v_desfase_referencia := case when abs(coalesce(p_desfase_captura, 0)) > abs(v_desfase) then p_desfase_captura else v_desfase end;
  -- Si no coinciden, el reloj cambió en medio y no se puede saber cómo estaba cuando se tomó la foto.
  v_reloj_cambio := p_desfase_captura is not null and abs(p_desfase_captura - v_desfase) > 300;
  v_fecha_foto := (p_capturado_en at time zone 'America/Lima')::date;
  v_hoy := (now() at time zone 'America/Lima')::date;

  -- Orden fijo para que dos reintentos simultáneos no se bloqueen entre sí.
  for v_linea in select value from jsonb_array_elements(p_items) order by value->>'client_id' loop
    v_cid := (v_linea->>'client_id')::uuid;
    v_codigo := v_linea->>'codigo';
    if v_cid is null or v_codigo is null then
      raise exception 'Falta el identificador de una línea.';
    end if;
    v_ya_existia := false;
    v_motivo := null;

    -- El segundo intento espera al primero y luego encuentra la fila ya creada.
    perform pg_advisory_xact_lock(hashtextextended(v_cid::text, 0));

    if p_tipo = 'salida' then
      select s.id into v_id from public.salidas s where s.client_id = v_cid;
    else
      select e.id into v_id from public.entradas e where e.client_id = v_cid;
    end if;

    if v_id is null then
      v_res := to_jsonb(public.registrar_lote(
        p_quien, p_tipo, p_fecha,
        jsonb_build_array(jsonb_build_object('codigo', v_codigo, 'cantidad', (v_linea->>'cantidad')::integer)),
        p_trabajador, p_nota, p_foto
      ));

      v_fila := v_res->'items'->0;
      v_id := (v_fila->>'id')::bigint;
      v_queda := (v_fila->>'queda')::integer;
      if v_id is null then
        raise exception 'registrar_lote no devolvió la fila creada.';
      end if;

      if p_tipo = 'salida' and v_queda < 0 then
        v_motivo := format('Al subir, el saldo de %s quedó en %s.', v_codigo, v_queda);
      end if;
      if v_reloj_cambio then
        v_motivo := concat_ws(' ', v_motivo, format('El reloj del dispositivo cambió desde su último contacto con el servidor (%s min de diferencia).', round(abs(p_desfase_captura - v_desfase) / 60.0)));
      elsif abs(v_desfase_referencia) > 300 then
        v_motivo := concat_ws(' ', v_motivo, format('Reloj del dispositivo desfasado %s min.', round(abs(v_desfase_referencia) / 60.0)));
      end if;
      if p_capturado_en > now() + interval '5 minutes' or p_capturado_en > p_reloj_dispositivo + interval '5 minutes' then
        v_motivo := concat_ws(' ', v_motivo, 'La hora de la foto queda en el futuro.');
      end if;
      -- Sin foto, p_capturado_en es el momento de registrar y no hay nada con qué comparar la fecha elegida.
      if p_fecha > v_hoy + 1 or (p_foto is not null and coalesce(p_capturado_origen, '') <> 'registro' and abs(p_fecha - v_fecha_foto) > 1) then
        v_motivo := concat_ws(' ', v_motivo, format('La fecha del movimiento (%s) no coincide con la de la foto (%s).', p_fecha, v_fecha_foto));
      end if;
      if coalesce(p_hora_dudosa, false) then
        v_motivo := concat_ws(' ', v_motivo, 'La fecha guardada en la foto no es confiable.');
      end if;

      if p_tipo = 'salida' then
        update public.salidas
           set client_id = v_cid, capturado_en = p_capturado_en, capturado_origen = p_capturado_origen, subido_en = now(), reloj_desfase_segundos = v_desfase, revisar_motivo = v_motivo
         where id = v_id;
      else
        update public.entradas
           set client_id = v_cid, capturado_en = p_capturado_en, capturado_origen = p_capturado_origen, subido_en = now(), reloj_desfase_segundos = v_desfase, revisar_motivo = v_motivo
         where id = v_id;
      end if;
    else
      -- Reintento: no se crea nada y la fila existente no se modifica. Se devuelve lo que se decidió la primera vez.
      v_ya_existia := true;
      if p_tipo = 'salida' then
        select s.reloj_desfase_segundos, s.revisar_motivo into v_desfase_primero, v_motivo from public.salidas s where s.id = v_id;
      else
        select e.reloj_desfase_segundos, e.revisar_motivo into v_desfase_primero, v_motivo from public.entradas e where e.id = v_id;
      end if;
      select si.queda into v_queda from public.stock_items si where si.codigo = v_codigo;
    end if;

    v_salida := v_salida || jsonb_build_object('client_id', v_cid, 'codigo', v_codigo, 'id', v_id, 'queda', v_queda, 'ya_existia', v_ya_existia, 'revisar_motivo', v_motivo);
    v_id := null;
  end loop;

  return jsonb_build_object('servidor_ahora', now(), 'reloj_desfase_segundos', coalesce(v_desfase_primero, v_desfase), 'items', v_salida);
end;
$$;

revoke all on function public.registrar_offline(text, date, text, jsonb, timestamptz, timestamptz, text, text, text, integer, text, boolean) from public;
grant execute on function public.registrar_offline(text, date, text, jsonb, timestamptz, timestamptz, text, text, text, integer, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
