import { senalConLimite } from "./senal";
import { supabase } from "./supabase";

export type UsoAlmacen = { base_bytes: number; base_limite: number; fotos_bytes: number; fotos_limite: number; fotos: number };

const CLAVE = "stock_uso_almacen_v1";
const LIMITE_LECTURA_MS = 8_000;
const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Desde esta fracción del límite se avisa. */
export const UMBRAL_AVISO = 0.8;

export function esUsoValido(v: unknown): v is UsoAlmacen {
  if (typeof v !== "object" || v === null) return false;
  const u = v as Record<string, unknown>;
  return (["base_bytes", "base_limite", "fotos_bytes", "fotos_limite"] as const).every((k) => typeof u[k] === "number" && Number.isFinite(u[k])) && (u.base_limite as number) > 0 && (u.fotos_limite as number) > 0;
}

function decimales(n: number, cuantos: number): string {
  return n.toLocaleString("es-PE", { maximumFractionDigits: cuantos });
}

/** 1 decimal por debajo de 10 MB: "3,4 MB". Desde ahí, entero: "120 MB". */
export function textoMb(bytes: number): string {
  const mb = bytes / MB;
  return `${decimales(mb, mb < 10 ? 1 : 0)} MB`;
}

export function textoLimite(bytes: number): string {
  return bytes >= GB ? `${decimales(bytes / GB, 1)} GB` : `${decimales(bytes / MB, 0)} MB`;
}

export const fraccionUso = (usado: number, limite: number) => (limite > 0 ? usado / limite : 0);
export const hayQueAvisar = (usado: number, limite: number) => fraccionUso(usado, limite) >= UMBRAL_AVISO;

export function leerUsoGuardado(): UsoAlmacen | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
    return esUsoValido(v) ? v : null;
  } catch {
    return null;
  }
}

function guardarUso(u: UsoAlmacen) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(u));
  } catch {
    /* sin almacenamiento: se vuelve a pedir la próxima vez */
  }
}

/** Devuelve null si no se pudo leer: quien llama se queda con el último valor conocido. */
export async function consultarUso(): Promise<UsoAlmacen | null> {
  try {
    const { data, error } = await supabase.rpc("uso_almacen").abortSignal(senalConLimite(LIMITE_LECTURA_MS));
    if (error || !esUsoValido(data)) return null;
    guardarUso(data);
    return data;
  } catch {
    return null;
  }
}
