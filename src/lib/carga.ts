import type { Campo } from "./useLiveData";

/**
 * Qué mostrar en una parte de la pantalla. Una tabla que no cargó no es una tabla vacía:
 * "no hay datos" solo se dice cuando los datos llegaron y de verdad no hay nada.
 */
export type EstadoCarga = "cargando" | "error" | "incompleto" | "vacio" | "listo";

export function estadoCarga(p: {
  cargando: boolean;
  /** Tablas que no se pudieron leer ni del servidor ni de la copia del dispositivo. */
  faltan: readonly Campo[];
  /** Tablas que usa esta parte de la pantalla. */
  campos: readonly Campo[];
  /** El servidor respondió con error (no es falta de señal). */
  errorServidor: boolean;
  /** Hay algo que mostrar. */
  hayFilas: boolean;
}): EstadoCarga {
  if (p.cargando) return "cargando";
  if (p.campos.some((c) => p.faltan.includes(c))) return p.errorServidor ? "error" : "incompleto";
  return p.hayFilas ? "listo" : "vacio";
}
