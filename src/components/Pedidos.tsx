import { Loader2, PackageCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { mensajeServidor } from "../lib/errores";
import { entero, etiquetaTalla, fechaCorta, nombreProducto, partirMovimiento, titulo } from "../lib/format";
import { useEnLinea } from "../lib/offline/conexion";
import { supabase } from "../lib/supabase";
import type { Pedido, StockItem } from "../lib/types";
import { CampoAutor } from "./CampoAutor";
import { limpiarCantidad } from "./SelectorProducto";
import { cn } from "../lib/utils";
import { Boton, Vacio, presion } from "./ui";
import { Ventana } from "./Ventana";

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
    <Ventana abierta={abierto} alCerrar={alCerrar} titulo="Pedidos pendientes" subtitulo="Marca lo que llegó del proveedor o cancela lo que ya no viene.">
      <div className="space-y-4">
        {pedirAutor && <CampoAutor id="pedidos-autor" autor={autor} setAutor={setAutor} />}
        {!enLinea && <p className="rounded-lg bg-warn-soft px-4 py-3 text-[16px] font-medium leading-6 text-warn">Marcar pedidos necesita conexión. Hazlo cuando vuelva la señal.</p>}
        {error && (
          <p role="alert" className="rounded-lg bg-red-soft px-4 py-3 text-[16px] font-medium leading-6 text-red">
            {error}
          </p>
        )}
        {pendientes.length === 0 ? (
          <Vacio icono={<PackageCheck className="size-6" />} titulo="No hay pedidos pendientes" texto="Cuando pidas algo al proveedor aparecerá aquí hasta que llegue." />
        ) : (
          <ul className="divide-y divide-line-2 overflow-hidden rounded-lg border border-line">
            {pendientes.map((p) => {
              const { nombre, talla } = partirMovimiento(p.producto);
              const empresa = empresaDe.get(p.codigo);
              return (
                <li key={p.id} className="space-y-3 p-4">
                  <div>
                    <p className="text-left text-[18px] font-semibold leading-[26px]">{nombreProducto(nombre, empresa)}</p>
                    <p className="mt-0.5 text-left text-[16px] leading-6 text-muted">
                      {talla ? `${etiquetaTalla(talla)} · ` : ""}
                      {empresa ? `${titulo(empresa)} · ` : ""}
                      pediste {entero(p.cantidad)} el {fechaCorta(p.fecha)}
                    </p>
                  </div>
                  {porCancelar === p.id ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="min-w-0 flex-1 text-left text-[16px] font-semibold text-red">¿Cancelar este pedido?</p>
                      <Boton onClick={() => setPorCancelar(null)}>No</Boton>
                      <button type="button" disabled={bloqueado} onClick={() => void cancelar(p)} className={cn("inline-flex min-h-14 items-center gap-2 rounded-lg bg-red px-5 text-[16px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50", presion)}>
                        {ocupado === p.id && <Loader2 className="size-5 animate-spin" aria-hidden />} Sí, cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <label className="sr-only" htmlFor={`pedido-${p.id}`}>
                        Unidades que llegaron
                      </label>
                      <input
                        id={`pedido-${p.id}`}
                        inputMode="numeric"
                        value={cantidades[p.id] ?? String(p.cantidad)}
                        onChange={(e) => setCantidades((c) => ({ ...c, [p.id]: limpiarCantidad(e.target.value) }))}
                        className="num h-14 w-20 shrink-0 rounded-lg border border-line bg-surface px-2 text-center text-[20px] font-semibold outline-none focus:border-action focus:outline-2 focus:outline-offset-2 focus:outline-action"
                      />
                      <Boton variante="ink" className="flex-1" disabled={bloqueado} onClick={() => void llego(p)}>
                        {ocupado === p.id && <Loader2 className="size-5 animate-spin" aria-hidden />} Llegó
                      </Boton>
                      <Boton disabled={bloqueado} onClick={() => setPorCancelar(p.id)}>
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
