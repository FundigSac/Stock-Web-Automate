import { esErrorDeRed } from "./offline/conexion";
import { faltaMigracion, mensajeServidor } from "./errores";
import { supabase } from "./supabase";
import { nuevoUuid } from "./uuid";

const AVISO = "No se pudo hacer el pedido. Revisa tu conexión e inténtalo de nuevo.";
const idsDe = (data: unknown) => ((data as { ids?: number[] } | null)?.ids ?? []) as number[];

/** El servidor acepta hasta 40 líneas por pedido. */
export const LINEAS_POR_TANDA = 40;

type Item = { codigo: string; cantidad: number };

/**
 * Crea un pedido con una llave propia: si la respuesta se pierde después de guardar, reintentar no lo duplica.
 * Mientras no se aplique la migración se usa la función de siempre, sin reintento.
 */
export async function crearPedido(quien: string, items: Item[], nota: string, llave: string = nuevoUuid()): Promise<number[]> {
  for (let intento = 1; ; intento++) {
    const { data, error } = await supabase.rpc("crear_pedido_idem", { p_client_id: llave, p_quien: quien, p_items: items, p_nota: nota });
    if (!error) return idsDe(data);
    if (faltaMigracion(error.code)) {
      const previo = await supabase.rpc("crear_pedido", { p_quien: quien, p_items: items, p_nota: nota });
      if (previo.error) throw new Error(mensajeServidor(previo.error, AVISO));
      return idsDe(previo.data);
    }
    if (intento >= 2 || !esErrorDeRed(error.message)) throw new Error(mensajeServidor(error, AVISO));
  }
}

/** Parte del pedido se guardó y otra no. El mensaje dice cuánto y qué hacer. */
export class PedidoParcial extends Error {
  readonly guardadas: number;
  readonly total: number;
  constructor(guardadas: number, total: number, lineasGuardadas: number, lineasTotal: number) {
    super(`Se guardaron ${guardadas} de ${total} tandas (${lineasGuardadas} de ${lineasTotal} productos). Repite el pedido y solo se enviará lo que faltó.`);
    this.name = "PedidoParcial";
    this.guardadas = guardadas;
    this.total = total;
  }
}

/** Cada tanda tiene su propia llave, derivada de la del pedido: la misma tanda siempre usa la misma. */
export const llaveDeTanda = (llave: string, tanda: number) => `${llave.slice(0, -4)}${tanda.toString(16).padStart(4, "0")}`;

type EnCurso = { llave: string; hechas: Map<number, number[]> };
const sinTerminar = new Map<string, EnCurso>();

/** Un pedido largo sale por tandas. Si una falla, repetir el mismo pedido sigue donde quedó y no crea otra vez las anteriores. */
export async function crearPedidoEnTandas(quien: string, items: Item[], nota: string): Promise<number[]> {
  const huella = JSON.stringify([quien, nota, items]);
  const pedido = sinTerminar.get(huella) ?? { llave: nuevoUuid(), hechas: new Map<number, number[]>() };
  sinTerminar.set(huella, pedido);
  const total = Math.ceil(items.length / LINEAS_POR_TANDA);
  for (let n = 0; n < total; n++) {
    if (pedido.hechas.has(n)) continue;
    try {
      pedido.hechas.set(n, await crearPedido(quien, items.slice(n * LINEAS_POR_TANDA, (n + 1) * LINEAS_POR_TANDA), nota, llaveDeTanda(pedido.llave, n)));
    } catch (e) {
      if (pedido.hechas.size === 0) throw e;
      const lineas = Array.from(pedido.hechas.keys()).reduce((a, k) => a + items.slice(k * LINEAS_POR_TANDA, (k + 1) * LINEAS_POR_TANDA).length, 0);
      throw new PedidoParcial(pedido.hechas.size, total, lineas, items.length);
    }
  }
  sinTerminar.delete(huella);
  return Array.from(pedido.hechas.values()).flat();
}
