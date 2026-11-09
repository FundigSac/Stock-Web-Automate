import { AlertTriangle, CheckCircle2, Clock3, UploadCloud, WifiOff, type LucideIcon } from "lucide-react";
import type { ItemRespaldo } from "../lib/offline/almacen";

export type TonoFila = "ok" | "info" | "warn" | "red";
export type EstadoFila = { texto: string; tono: TonoFila; icono: LucideIcon };

/**
 * Texto de estado de un registro de este celular. Lo usan Por subir y los últimos registros de la pantalla inicial,
 * así el mismo estado se dice igual en las dos.
 * "subiendo" también queda escrito si la app se cerró a mitad: solo se dice así mientras de verdad sube.
 * Lo pendiente dice "Esperando conexión" solo sin red. Con red (por ejemplo, si el servidor falló) dice "Por subir",
 * igual que la banda de arriba, para que las dos no se contradigan.
 */
export function estadoPorSubir(i: Pick<ItemRespaldo, "estado">, subiendoAhora: boolean, enLinea: boolean): EstadoFila {
  if (i.estado === "rechazado") return { texto: "No se pudo subir", tono: "red", icono: AlertTriangle };
  if (i.estado === "confirmado") return { texto: "Subido", tono: "ok", icono: CheckCircle2 };
  if (i.estado === "sin_migracion") return { texto: "Esperando actualización del sistema", tono: "warn", icono: Clock3 };
  if (i.estado === "subiendo" && subiendoAhora) return { texto: "Subiendo", tono: "info", icono: UploadCloud };
  if (enLinea) return { texto: "Por subir", tono: "info", icono: Clock3 };
  return { texto: "Esperando conexión", tono: "warn", icono: WifiOff };
}
