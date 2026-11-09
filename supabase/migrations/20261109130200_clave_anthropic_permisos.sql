-- La función que devuelve la clave de Anthropic solo debe poder llamarla la Edge Function.

revoke execute on function public.clave_anthropic() from public, anon, authenticated;
grant execute on function public.clave_anthropic() to service_role;
