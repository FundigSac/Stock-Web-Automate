import type { Datos } from "./types";

/**
 * Los datos de una sola empresa. Vive aparte de derive.ts porque la pantalla inicial lo necesita
 * y derive.ts, con todo lo demás, solo hace falta en las pantallas que se cargan después.
 */
export function filtrarPorEmpresa(d: Datos, empresa: string): Datos {
  if (empresa === "TODAS") return d;
  const stock = d.stock.filter((s) => s.empresa === empresa);
  const codigos = new Set(stock.map((s) => s.codigo));
  return {
    ...d,
    stock,
    entradas: d.entradas.filter((e) => codigos.has(e.codigo)),
    salidas: d.salidas.filter((s) => codigos.has(s.codigo)),
  };
}
