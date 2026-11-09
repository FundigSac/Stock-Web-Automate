-- Pedidos sin duplicados: si la respuesta se pierde después de guardar, reintentar con la misma llave no crea otro pedido.

alter table public.pedidos add column if not exists client_id uuid;

-- Varias líneas de un mismo pedido comparten la llave, así que el índice no es único: lo protege el candado de abajo.
create index if not exists pedidos_client_id_idx on public.pedidos (client_id) where client_id is not null;

comment on column public.pedidos.client_id is 'UUID generado en el dispositivo por cada envío: llave contra duplicados.';

create or replace function public.crear_pedido_idem(p_client_id uuid, p_quien text, p_items jsonb, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids jsonb;
  v_res jsonb;
begin
  if p_client_id is null then
    raise exception 'Falta el identificador del pedido.';
  end if;
  if not public.puede_registrar() then
    raise exception 'No tienes permiso para hacer pedidos.' using errcode = '42501';
  end if;

  -- El segundo intento espera al primero y luego encuentra lo ya creado.
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));

  select coalesce(jsonb_agg(p.id order by p.id), '[]'::jsonb) into v_ids from public.pedidos p where p.client_id = p_client_id;
  if jsonb_array_length(v_ids) > 0 then
    return jsonb_build_object('ids', v_ids);
  end if;

  v_res := to_jsonb(public.crear_pedido(p_quien, p_items, p_nota));

  update public.pedidos
     set client_id = p_client_id
   where id in (select value::bigint from jsonb_array_elements_text(v_res->'ids'));

  return v_res;
end;
$$;

revoke all on function public.crear_pedido_idem(uuid, text, jsonb, text) from public;
grant execute on function public.crear_pedido_idem(uuid, text, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';
