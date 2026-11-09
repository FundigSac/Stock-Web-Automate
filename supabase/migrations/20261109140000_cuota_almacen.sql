-- Evita que el almacén de fotos se llene: tope por foto, freno de subidas y lectura del uso real.
-- El plan gratuito de Supabase da 500 MB de base y 1 GB de archivos. La app avisa desde el 80 %.

-- La app comprime a 1280 px y JPEG 0,8; la foto más pesada medida fue de 228 KB.
update storage.buckets set file_size_limit = 1048576 where id = 'evidencias';

-- Una tanda sin conexión sube de una en una y el dispositivo reintenta, así que el freno retrasa la subida sin perderla.
create or replace function public.cupo_fotos()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from storage.objects o where o.bucket_id = 'evidencias' and o.created_at > now() - interval '1 minute') < 40
     and (select count(*) from storage.objects o where o.bucket_id = 'evidencias' and o.created_at > now() - interval '1 day') < 300;
$$;

revoke all on function public.cupo_fotos() from public;
grant execute on function public.cupo_fotos() to anon, authenticated;

alter policy "evidencias subir" on storage.objects
  with check (
    bucket_id = 'evidencias'
    and name ~ '^(salidas|entradas)/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$'
    and public.cupo_fotos()
  );

create or replace function public.uso_almacen()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'base_bytes', pg_database_size(current_database()),
    'base_limite', 524288000,
    'fotos_bytes', (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o where o.bucket_id = 'evidencias'),
    'fotos_limite', 1073741824,
    'fotos', (select count(*) from storage.objects o where o.bucket_id = 'evidencias')
  );
$$;

revoke all on function public.uso_almacen() from public;
grant execute on function public.uso_almacen() to anon, authenticated;

notify pgrst, 'reload schema';
