import type { Resumen } from "./derive";
import type { Estado } from "./types";

/**
 * B25-1 StockHealthBar. La regla de cada estado es la que ya usa toda la app (`estadoDe` en derive.ts):
 * - Sin stock (agotado): quedan 0 unidades.
 * - Por agotarse (bajo): quedan entre 1 y el mínimo de Ajustes (`ajustes.stock_minimo`, uno solo para todo el almacén).
 * - Con stock: más que ese mínimo.
 * - Saldo negativo: solo aparece si alguna talla quedó por debajo de 0, para revisarla.
 * No hay mínimos por producto en la base: no se inventan aquí.
 */
export type Segmento = { estado: Estado; cuenta: number; pct: number };

const ORDEN: Estado[] = ["ok", "bajo", "sin", "revisar"];

export function segmentosSalud(r: Pick<Resumen, "ok" | "bajo" | "sin" | "revisar">): Segmento[] {
  const total = r.ok + r.bajo + r.sin + r.revisar;
  if (total <= 0) return [];
  return ORDEN.map((estado) => ({ estado, cuenta: r[estado], pct: (r[estado] / total) * 100 })).filter((s) => s.cuenta > 0);
}

/** "Por agotarse: quedan 2 o menos" (con mínimo 0 no hay estado bajo: se dice). */
export function reglaBajo(minimo: number): string {
  if (minimo <= 0) return "Sin mínimo configurado: ninguna talla cuenta como por agotarse.";
  return `Por agotarse: quedan ${minimo === 1 ? "1 unidad" : `${minimo} unidades o menos`}.`;
}
