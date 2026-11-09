import { supabase } from "../supabase";
import type { ItemRespaldo } from "./almacen";
import { estaEnLinea, limiteRed, marcarFalloRed, marcarRedOk } from "./conexion";
import { sincronizar, type ResumenSync } from "./motor";
import { encolar, obtenerItem, type NuevoRegistro } from "./respaldo";
import { crearTransporte } from "./transporte";

export const ETIQUETA_SYNC = "stock-respaldo";
const ESPERA_RESPUESTA_MS = 8_000;
const LIMITE_SESION_MS = 10_000;

const transporte = crearTransporte({
  url: import.meta.env.VITE_SUPABASE_URL as string,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  sesion: async () => {
    const s = (await limiteRed(supabase.auth.getSession(), LIMITE_SESION_MS)).data.session;
    return s ? { usuario: s.user.id, token: s.access_token } : null;
  },
});

// Quién tiene la sesión ahora. Sin red sale de lo recordado, porque la sesión de supabase-js puede no estar disponible.
let dueno: string | null = null;

export function fijarDuenoActual(id: string | null) {
  dueno = id;
}

export const duenoActual = () => dueno;

export async function subirPendientes(forzar = false): Promise<ResumenSync> {
  const r = await sincronizar(transporte, { forzar });
  if (r.sinRed) {
    marcarFalloRed();
    void pedirSyncEnSegundoPlano();
  } else if (r.confirmados > 0) marcarRedOk();
  return r;
}

export const soportaBackgroundSync = (): boolean => "serviceWorker" in navigator && "SyncManager" in window;

type RegistroConSync = ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } };

/** Pide al navegador que avise al service worker cuando vuelva la señal, aunque la app esté cerrada. */
async function pedirSyncEnSegundoPlano() {
  try {
    const reg = (await navigator.serviceWorker?.getRegistration()) as RegistroConSync | undefined;
    await reg?.sync?.register(ETIQUETA_SYNC);
  } catch {
    // Sin soporte o sin permiso: se sube al abrir la app.
  }
}

/**
 * Todo registro pasa por aquí: primero queda guardado en el dispositivo y luego se intenta subir.
 * Devuelve cómo quedó. Si la red falla, el registro ya está a salvo y no se muestra ningún error.
 */
export async function registrarMovimiento(n: NuevoRegistro): Promise<ItemRespaldo> {
  const item = await encolar({ ...n, dueno });
  void pedirSyncEnSegundoPlano();
  if (!estaEnLinea()) return item;
  await Promise.race([subirPendientes().catch(() => null), new Promise((ok) => window.setTimeout(ok, ESPERA_RESPUESTA_MS))]);
  // El registro ya está guardado: un fallo al releerlo no puede decirle a la persona que no se guardó.
  return (await obtenerItem(item.id).catch(() => undefined)) ?? item;
}
