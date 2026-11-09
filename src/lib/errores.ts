type ErrorServidor = { message?: string; code?: string } | null | undefined;

/** Códigos con los que el servidor dice "esa función o columna todavía no existe": falta aplicar una migración. */
export const CODIGOS_SIN_MIGRACION = new Set(["PGRST202", "PGRST204", "42883", "42703", "42P01"]);

export const faltaMigracion = (code: string | undefined | null) => !!code && CODIGOS_SIN_MIGRACION.has(code);

/**
 * Frase para quien usa la app. El detalle técnico se queda en la consola.
 * Solo se muestra el texto del servidor cuando es un aviso escrito por la propia base de datos (P0001).
 */
export function mensajeServidor(e: ErrorServidor, otro: string): string {
  if (e) console.error("[servidor]", e.code, e.message);
  if (e?.code === "P0001" && e.message) return e.message;
  return otro;
}
