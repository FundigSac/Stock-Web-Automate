import { supabase } from "./supabase";

export type LineaIA = { codigo: string; cantidad: number };
export type AccionMov = { tipo: "entrada" | "salida" | "pedido"; trabajador?: string; items: LineaIA[] };
export type AccionIA =
  | AccionMov
  | { tipo: "recibir_pedido" | "cancelar_pedido"; pedido_ids: number[]; cantidad_recibida?: number }
  | { tipo: "anular_movimiento"; movimiento: { tipo: "entrada" | "salida"; id: number } }
  | { tipo: "ver"; ver: "por_agotarse" | "sin_stock" | "pedidos_pendientes" | "resumen" }
  | { tipo: "crear_producto" | "crear_trabajador"; nombre: string };

export type RespuestaIA = {
  mensaje: string;
  acciones: AccionIA[];
  aclarar?: { pregunta: string; opciones: string[] };
  /** Lo que el servidor no pudo incluir: filas del documento que hay que registrar aparte. */
  faltan?: { acciones: number; items: number; truncado: boolean };
};

export type TurnoIA = { rol: "yo" | "asistente"; texto: string };

const ESPERA_MAX_MS = 45_000;
/** Un documento grande tarda más: la respuesta es mucho más larga. */
const ESPERA_DOCUMENTO_MS = 120_000;

/** Le pregunta a Claude Haiku 5.5 (por una funcion del servidor: la clave nunca esta en el navegador). */
export async function consultarIA(p: { texto: string; imagen?: string | null; media?: string; documento?: string | null; historial: TurnoIA[] }): Promise<RespuestaIA> {
  // Al vencer el tiempo se cancela de verdad: si solo se dejara de esperar, la llamada seguiría costando.
  const corte = new AbortController();
  const reloj = window.setTimeout(() => corte.abort(), p.imagen || p.documento ? ESPERA_DOCUMENTO_MS : ESPERA_MAX_MS);
  const { data, error } = await supabase.functions
    .invoke("asistente-ia", {
      body: { texto: p.texto, imagen: p.imagen ?? undefined, media_type: p.media ?? "image/jpeg", documento: p.documento ?? undefined, historial: p.historial },
      signal: corte.signal,
    })
    .finally(() => window.clearTimeout(reloj));
  if (corte.signal.aborted) throw new Error("La IA tardó demasiado.");
  if (error) throw new Error(error.message || "La IA no respondió.");
  const r = data as Partial<RespuestaIA> | null;
  if (!r || typeof r.mensaje !== "string" || !Array.isArray(r.acciones)) throw new Error("La IA devolvió algo que no entiendo.");
  return { mensaje: r.mensaje, acciones: r.acciones, aclarar: r.aclarar?.pregunta ? { pregunta: r.aclarar.pregunta, opciones: r.aclarar.opciones ?? [] } : undefined, faltan: r.faltan };
}

/** Foto -> texto base64 (sin el prefijo data:) para mandarla a la IA. */
export function aBase64(blob: Blob): Promise<string> {
  return new Promise((ok, no) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(",")[1] ?? "");
    lector.onerror = () => no(new Error("No se pudo leer la foto."));
    lector.readAsDataURL(blob);
  });
}
