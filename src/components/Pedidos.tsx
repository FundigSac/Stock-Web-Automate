import { Loader2, PackageCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { mensajeServidor } from "../lib/errores";
import { entero, etiquetaTalla, fechaCorta, nombreProducto, partirMovimiento, titulo } from "../lib/format";
import { useEnLinea } from "../lib/offline/conexion";
import { supabase } from "../lib/supabase";
import type { Pedido, StockItem } from "../lib/types";
import { CampoAutor } from "./CampoAutor";
import { limpiarCantidad } from "./SelectorProducto";
import { Boton, FallaCarga, Vacio, Ventana } from "./ui";

/** Lista simple de lo pedido al proveedor: llegó o se cancela, línea por línea. */
export function PedidosDialog({
  abierto,
  alCerrar,
  pedidos,
  stock,
  autor,
  setAutor,
  pedirAutor,
  avisar,
  recargar,
  falla = null,
}: {
  abierto: boolean;
  alCerrar: () => void;
  pedidos: Pedido[];
  stock: StockItem[];
  autor: string;
  setAutor: (v: string) => void;
  pedirAutor: boolean;
  avisar: (texto: string, error?: boolean) => void;
  recargar: () => void;
  /** Los pedidos no cargaron: no se dice "no hay pedidos". */
  falla?: "error" | "incompleto" | null;
}) {
  const enLinea = useEnLinea();
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [porCancelar, setPorCancelar] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setCantidades({});
    setPorCancelar(null);
    setError(null);
  }, [abierto]);

  const empresaDe = useMemo(() => new Map(stock.map((s) => [s.codigo, s.empresa])), [stock]);
  const pendientes = useMemo(() => pedidos.filter((p) => p.estado === "pendiente").sort((a, b) => b.id - a.id), [pedidos]);
  const sinNombre = pedirAutor && autor.trim().length < 2;
  const bloqueado = !enLinea || sinNombre || ocupado !== null;

  async function llego(p: Pedido) {
    const n = Number.parseInt(cantidades[p.id] ?? String(p.cantidad), 10);
    if (!n || n <= 0) {
      setError("Indica cuántas unidades llegaron.");
      return;
    }
    setOcupado(p.id);
    setError(null);
    const { error: e } = await supabase.rpc("recibir_pedido", { p_quien: autor.trim(), p_id: p.id, p_cantidad: n });
    setOcupado(null);
    if (e) {
      setError(mensajeServidor(e, "No se pudo registrar. Revisa tu conexión e inténtalo de nuevo."));
      return;
    }
    avisar(`Se sumaron ${entero(n)} ${n === 1 ? "unidad" : "unidades"} al stock`);
    recargar();
  }

  async function cancelar(p: Pedido) {
    setOcupado(p.id);
    setError(null);
    const { error: e } = await supabase.rpc("cancelar_pedido", { p_quien: autor.trim(), p_id: p.id });
    setOcupado(null);
    setPorCancelar(null);
    if (e) {
      setError(mensajeServidor(e, "No se pudo cancelar. Revisa tu conexión e inténtalo de nuevo."));
      return;
    }
    avisar("Pedido cancelado");
    recargar();
  }

  return (
    <Ventana abierta={abierto} alCerrar={alCerrar} titulo="Pedidos pendientes" subtitulo="Lo que se pidió al proveedor y todavía no llega.">
      <div className="space-y-4">
        {pedirAutor && <CampoAutor id="pedidos-autor" autor={autor} setAutor={setAutor} />}
        {!enLinea && <p className="rounded-xl bg-warn-soft px-3.5 py-3 text-justify text-[13px] font-medium text-warn">Marcar pedidos necesita conexión. Hazlo cuando vuelva la señal.</p>}
        {error && (
          <p role="alert" className="rounded-xl bg-red-soft px-3.5 py-3 text-justify text-[13px] font-medium text-red">
            {error}
          </p>
        )}
        {falla ? (
          <FallaCarga tipo={falla} que="Los pedidos" reintentar={recargar} />
        ) : pendientes.length === 0 ? (
          <Vacio icono={<PackageCheck className="size-5" />} titulo="No hay pedidos pendientes" texto="Cuando pidas algo al proveedor aparecerá aquí hasta que llegue." />
        ) : (
          <ul className="divide-y divide-line-2 overflow-hidden rounded-2xl border border-line">
            {pendientes.map((p) => {
              const { nombre, talla } = partirMovimiento(p.producto);
              const empresa = empresaDe.get(p.codigo);
              return (
                <li key={p.id} className="space-y-2.5 p-4">
                  <div>
                    <p className="text-[14px] font-semibold leading-snug">{nombreProducto(nombre, empresa)}</p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {talla ? `${etiquetaTalla(talla)} · ` : ""}
                      {empresa ? `${titulo(empresa)} · ` : ""}
                      pediste {entero(p.cantidad)} el {fechaCorta(p.fecha)}
                    </p>
                  </div>
                  {porCancelar === p.id ? (
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 text-[13px] font-semibold text-red">¿Cancelar este pedido?</p>
                      <Boton className="h-10" onClick={() => setPorCancelar(null)}>
                        No
                      </Boton>
                      <button type="button" disabled={bloqueado} onClick={() => void cancelar(p)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-red px-4 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
                        {ocupado === p.id && <Loader2 className="size-4 animate-spin" />} Sí, cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`pedido-${p.id}`}>
                        Unidades que llegaron
                      </label>
                      <input
                        id={`pedido-${p.id}`}
                        inputMode="numeric"
                        value={cantidades[p.id] ?? String(p.cantidad)}
                        onChange={(e) => setCantidades((c) => ({ ...c, [p.id]: limpiarCantidad(e.target.value) }))}
                        className="num h-10 w-20 rounded-xl border border-line bg-surface px-3 text-center text-sm outline-none focus:border-ink"
                      />
                      <Boton variante="ink" className="h-10 flex-1" disabled={bloqueado} onClick={() => void llego(p)}>
                        {ocupado === p.id && <Loader2 className="size-4 animate-spin" />} Llegó
                      </Boton>
                      <Boton className="h-10" disabled={bloqueado} onClick={() => setPorCancelar(p.id)}>
                        Cancelar
                      </Boton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Ventana>
  );
}
