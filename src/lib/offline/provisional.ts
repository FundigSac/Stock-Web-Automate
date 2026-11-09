import type { Datos, Entrada, Salida } from "../types";
import type { ItemRespaldo } from "./almacen";

export type ConProvisional = {
  datos: Datos;
  /** Registros que cambian las cifras y el servidor o la copia local todavía no reflejan. */
  provisionales: number;
  sinSubir: number;
  /** Ya están en el servidor, pero la copia de este dispositivo todavía no los trae. */
  sinCopia: number;
};

/**
 * Datos del servidor más lo que todavía no aparece en ellos. Si el servidor ya tiene una línea, no se cuenta dos veces.
 * Lo rechazado no cuenta: el servidor dijo que no y no va a cambiar solo. Se ve en Respaldo, en "Por revisar".
 */
export function conProvisional(d: Datos, items: ItemRespaldo[]): ConProvisional {
  const enServidor = new Set<string>();
  for (const r of [...d.entradas, ...d.salidas]) if (r.client_id) enServidor.add(r.client_id);

  const vigentes = items.filter((i) => i.estado !== "rechazado");
  if (vigentes.length === 0) return { datos: d, provisionales: 0, sinSubir: 0, sinCopia: 0 };

  const delta = new Map<string, { entro: number; salio: number }>();
  const recibidas = new Map<string, { n: number; fecha: string }>();
  const entradas: Entrada[] = [];
  const salidas: Salida[] = [];
  let id = -1;
  let sinSubir = 0;
  let sinCopia = 0;

  for (const it of vigentes) {
    const lineas = it.lineas.filter((l) => !enServidor.has(l.clientId));
    if (lineas.length === 0) continue;
    const yaSubido = it.estado === "confirmado";
    if (yaSubido) sinCopia++;
    else sinSubir++;
    for (const l of lineas) {
      const m = delta.get(l.codigo) ?? { entro: 0, salio: 0 };
      if (it.tipo === "entrada") m.entro += l.cantidad;
      else m.salio += l.cantidad;
      delta.set(l.codigo, m);

      const base = {
        id: id--,
        fecha: it.fecha,
        codigo: l.codigo,
        producto: l.talla ? `${l.producto}  ·  Talla ${l.talla}` : l.producto,
        cantidad: l.cantidad,
        foto_path: null,
        anulado: false,
        anulado_motivo: null,
        anulado_por: null,
        anulado_at: null,
        creado_por: it.quien,
        created_at: it.capturadoEn,
        capturado_en: it.capturadoEn,
        capturado_origen: it.origenHora,
        etiqueta: null,
        cambio_ref: null,
        client_id: l.clientId,
        revisar_motivo: it.revision,
        pendiente: true as const,
        ...(yaSubido ? { sinCopia: true as const } : {}),
      };
      if (it.tipo === "entrada") entradas.push({ ...base, proveedor_nota: it.nota });
      else {
        salidas.push({ ...base, trabajador_cliente: it.trabajador ?? "", area: it.area, nota: it.nota });
        if (it.trabajador) {
          const r = recibidas.get(it.trabajador) ?? { n: 0, fecha: it.fecha };
          r.n += l.cantidad;
          if (it.fecha > r.fecha) r.fecha = it.fecha;
          recibidas.set(it.trabajador, r);
        }
      }
    }
  }
  const provisionales = sinSubir + sinCopia;
  if (provisionales === 0) return { datos: d, provisionales: 0, sinSubir: 0, sinCopia: 0 };

  return {
    provisionales,
    sinSubir,
    sinCopia,
    datos: {
      ...d,
      stock: d.stock.map((s) => {
        const m = delta.get(s.codigo);
        return m ? { ...s, entro: s.entro + m.entro, salio: s.salio + m.salio, queda: s.queda + m.entro - m.salio } : s;
      }),
      trabajadores: d.trabajadores.map((t) => {
        const r = recibidas.get(t.trabajador);
        if (!r) return t;
        return { ...t, prendas_recibidas: t.prendas_recibidas + r.n, ultima_entrega: !t.ultima_entrega || r.fecha > t.ultima_entrega ? r.fecha : t.ultima_entrega };
      }),
      entradas: [...d.entradas, ...entradas],
      salidas: [...d.salidas, ...salidas],
    },
  };
}
