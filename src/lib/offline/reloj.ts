import { guardarMeta, leerMeta } from "./almacen";

// Lo único confiable para saber si el reloj del dispositivo anda bien es la última vez que respondió el servidor.
export type ContactoServidor = { servidorMs: number; localMs: number };

const CLAVE = "reloj_servidor";
const VIGENCIA_MS = 30 * 86_400_000;

export async function anotarHoraServidor(servidorMs: number, localMs: number): Promise<void> {
  if (!Number.isFinite(servidorMs) || !Number.isFinite(localMs)) return;
  try {
    await guardarMeta(CLAVE, { servidorMs, localMs } satisfies ContactoServidor);
  } catch (e) {
    console.error("[respaldo] reloj", e);
  }
}

export async function ultimoContacto(): Promise<ContactoServidor | null> {
  try {
    return (await leerMeta<ContactoServidor>(CLAVE)) ?? null;
  } catch {
    return null;
  }
}

/** Reloj del dispositivo menos reloj del servidor, en segundos, según el último contacto. null si no hay uno reciente. */
export async function desfaseConocido(ahora: number): Promise<number | null> {
  const c = await ultimoContacto();
  if (!c || Math.abs(ahora - c.localMs) > VIGENCIA_MS) return null;
  return Math.round((c.localMs - c.servidorMs) / 1000);
}

/** La hora según el servidor, estimada con el último contacto. Sin un contacto reciente, la del dispositivo. */
export async function ahoraServidor(ahora: number = Date.now()): Promise<number> {
  return ahora - ((await desfaseConocido(ahora)) ?? 0) * 1000;
}
