import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronsUpDown, LayoutGrid, List, Package, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, Chip, EstadoBadge, Tabla, Vacio, td, th } from "../components/ui";
import { agruparProductos, ESTADO_TEXTO, estadoDe, rangoTalla, resumir } from "../lib/derive";
import { entero, fechaLarga, norm, nombreProducto, nombreTallaEn, titulo } from "../lib/format";
import type { Estado, StockItem } from "../lib/types";
import { cn } from "../lib/utils";
import type { VistaProps } from "./tipos";

type Col = "empresa" | "producto" | "talla" | "queda" | "estado" | "ultimo";

const PRIORIDAD: Record<Estado, number> = { revisar: 0, bajo: 1, sin: 2, ok: 3 };

const CHIP_TALLA: Record<Estado, string> = {
  ok: "bg-ink text-white",
  bajo: "bg-warn-soft text-warn ring-1 ring-warn/25",
  sin: "bg-ground text-faint",
  revisar: "bg-red-soft text-red ring-1 ring-red/25",
};

type Orden = { col: Col; asc: boolean };

function Cabecera({ col, children, derecha, orden, alOrdenar }: { col: Col; children: string; derecha?: boolean; orden: Orden; alOrdenar: (f: (o: Orden) => Orden) => void }) {
  const activo = orden.col === col;
  const Icono = !activo ? ChevronsUpDown : orden.asc ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={cn(th, derecha && "text-right")} aria-sort={activo ? (orden.asc ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => alOrdenar((o) => ({ col, asc: o.col === col ? !o.asc : true }))}
        className={cn("inline-flex items-center gap-1.5 uppercase tracking-[0.12em] transition hover:text-ink", activo && "text-ink")}
      >
        {children}
        <Icono className="size-3" />
      </button>
    </th>
  );
}

export function Stock({ datos, minimo, abrirProducto, filtroEstado, setFiltroEstado, editor, abrirNuevoProducto, abrirAsistente, abrirPedidos, pedidosPendientes }: VistaProps) {
  const [q, setQ] = useState("");
  const [modo, setModo] = useState<"productos" | "lista">("productos");
  const [orden, setOrden] = useState<{ col: Col; asc: boolean }>({ col: "producto", asc: true });

  const r = useMemo(() => resumir(datos.stock, minimo), [datos.stock, minimo]);
  const todosGrupos = useMemo(() => agruparProductos(datos.stock, minimo), [datos.stock, minimo]);
  const porClave = useMemo(() => new Map(todosGrupos.map((g) => [g.clave, g])), [todosGrupos]);

  const busca = norm(q.trim());
  const pasa = (s: StockItem) => {
    if (filtroEstado !== "todos" && estadoDe(s.queda, minimo) !== filtroEstado) return false;
    if (!busca) return true;
    // Se busca tanto lo que se ve en pantalla ("Pantalón con Fundigsac") como lo guardado ("PANTALON C/F").
    return norm(`${nombreProducto(s.producto, s.empresa)} ${s.producto} ${s.codigo} ${s.talla ?? ""} ${s.empresa}`).includes(busca);
  };

  const filtrados = useMemo(() => datos.stock.filter(pasa), [datos.stock, filtroEstado, busca, minimo]); // eslint-disable-line react-hooks/exhaustive-deps

  const gruposVisibles = useMemo(() => {
    const ok = new Set(filtrados.map((s) => `${s.empresa}||${s.producto}`));
    return todosGrupos
      .filter((g) => ok.has(g.clave))
      .map((g) => ({ ...g, tallas: g.tallas.filter((t) => filtrados.includes(t)) }))
      .sort((a, b) => a.empresa.localeCompare(b.empresa, "es") || a.producto.localeCompare(b.producto, "es"));
  }, [todosGrupos, filtrados]);

  const lista = useMemo(() => {
    const dir = orden.asc ? 1 : -1;
    const val = (s: StockItem): string | number => {
      switch (orden.col) {
        case "empresa": return s.empresa;
        case "producto": return s.producto;
        case "talla": return rangoTalla(s.talla);
        case "queda": return s.queda;
        case "estado": return PRIORIDAD[estadoDe(s.queda, minimo)];
        case "ultimo": return s.ultimo_movimiento ?? "";
      }
    };
    return [...filtrados].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es");
      return c * dir || a.codigo.localeCompare(b.codigo);
    });
  }, [filtrados, orden, minimo]);

  const cuenta = (e: Estado) => (e === "ok" ? r.ok : e === "bajo" ? r.bajo : e === "sin" ? r.sin : r.revisar);

  const cab = { orden, alOrdenar: setOrden };

  let empresaPrevia = "";

  return (
    <div className="space-y-5">
      {editor && (
        <button
          type="button"
          onClick={abrirNuevoProducto}
          className="flex w-full items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition hover:border-faint active:scale-[0.99] sm:w-auto sm:min-w-[22rem]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ground">
            <Plus className="size-5" />
          </span>
          <span>
            <span className="block text-[14.5px] font-semibold">Producto nuevo</span>
            <span className="block text-[12px] text-muted">Con sus tallas y cantidades</span>
          </span>
        </button>
      )}
      {editor && (r.bajo > 0 || pedidosPendientes > 0) && (
        <div className="flex flex-wrap gap-2">
          {r.bajo > 0 && (
            <button
              type="button"
              onClick={() => abrirAsistente("¿Qué está por agotarse?")}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-warn-soft px-4 text-[13px] font-semibold text-warn transition active:scale-[0.98]"
            >
              ⚠️ {r.bajo} por agotarse · Pedir
            </button>
          )}
          {pedidosPendientes > 0 && (
            <button
              type="button"
              onClick={abrirPedidos}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13px] font-semibold transition active:scale-[0.98]"
            >
              📦 {pedidosPendientes} {pedidosPendientes === 1 ? "pedido pendiente" : "pedidos pendientes"}
            </button>
          )}
        </div>
      )}
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-11 min-w-[220px] flex-1 items-center gap-3 rounded-xl border border-line bg-ground/60 px-3.5 focus-within:border-ink focus-within:bg-surface">
            <Search className="size-4 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar producto, código o talla…"
              aria-label="Buscar en el stock"
              className="h-full w-full bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>
          <div className="flex rounded-xl border border-line p-1" role="group" aria-label="Forma de ver">
            {([
              ["productos", LayoutGrid, "Por producto"],
              ["lista", List, "Lista"],
            ] as const).map(([m, Icono, etiqueta]) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                aria-pressed={modo === m}
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold transition",
                  modo === m ? "bg-ink text-white" : "text-muted hover:text-ink",
                )}
              >
                <Icono className="size-3.5" /> {etiqueta}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip activo={filtroEstado === "todos"} onClick={() => setFiltroEstado("todos")}>
            Todos <span className="num opacity-70">{entero(r.articulos)}</span>
          </Chip>
          {(["ok", "bajo", "sin", "revisar"] as Estado[])
            .filter((e) => e !== "revisar" || r.revisar > 0)
            .map((e) => (
              <Chip key={e} activo={filtroEstado === e} onClick={() => setFiltroEstado(e)}>
                {ESTADO_TEXTO[e]}{" "}
                <span className="num opacity-70">{entero(cuenta(e))}</span>
              </Chip>
            ))}
        </div>
        {modo === "productos" && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted">
            <span>Cada casilla es una talla con las unidades que quedan:</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded bg-ink" /> con stock
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded bg-warn-soft ring-1 ring-warn/40" /> por agotarse
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded bg-line" /> sin stock
            </span>
          </p>
        )}
      </Card>

      {filtrados.length === 0 ? (
        <Card>
          <Vacio
            icono={<Package className="size-5" />}
            titulo="No hay tallas con ese filtro"
            texto="Prueba con otra búsqueda o cambia el estado de arriba."
          />
        </Card>
      ) : modo === "productos" ? (
        <div className="space-y-6">
          {gruposVisibles.map((g, i) => {
            const nuevaEmpresa = g.empresa !== empresaPrevia;
            empresaPrevia = g.empresa;
            return (
              <div key={g.clave}>
                {nuevaEmpresa && (
                  <h3 className="display mb-3 mt-2 flex items-center gap-3 text-lg font-semibold">
                    {titulo(g.empresa)}
                    <span className="h-px flex-1 bg-line" />
                  </h3>
                )}
                <motion.button
                  type="button"
                  onClick={() => abrirProducto(porClave.get(g.clave) ?? g)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i, 12) * 0.02 }}
                  whileHover={{ y: -2 }}
                  className="flex w-full flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line-2 bg-surface p-4 text-left shadow-card transition-colors hover:border-line focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <div className="min-w-[200px] flex-1">
                    <p className="text-[14.5px] font-semibold leading-snug">{nombreProducto(g.producto, g.empresa)}</p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {g.genero ? `${titulo(g.genero)} · ` : ""}
                      {g.tallas.length} {g.tallas.length === 1 ? "talla" : "tallas"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.tallas.map((t) => {
                      const e = estadoDe(t.queda, minimo);
                      return (
                        <span
                          key={t.codigo}
                          className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px]", CHIP_TALLA[e])}
                          title={`${t.codigo}: quedan ${t.queda}`}
                        >
                          <b className="font-semibold">{nombreTallaEn(t.talla, porClave.get(g.clave)?.tallas ?? g.tallas)}</b>
                          <span className="num font-semibold opacity-90">{entero(t.queda)}</span>
                        </span>
                      );
                    })}
                  </div>
                  <div className="ml-auto text-right">
                    <p className="display num text-2xl font-semibold leading-none">{entero(g.unidades)}</p>
                    <p className="mt-1 text-[11px] text-muted">unidades</p>
                  </div>
                </motion.button>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden p-2">
          <Tabla etiqueta="Lista de tallas en stock" minAncho={760}>
            <thead className="border-b border-line-2">
              <tr>
                <Cabecera {...cab} col="empresa">Empresa</Cabecera>
                <Cabecera {...cab} col="producto">Producto</Cabecera>
                <Cabecera {...cab} col="talla">Talla</Cabecera>
                <Cabecera {...cab} col="queda" derecha>Queda</Cabecera>
                <Cabecera {...cab} col="estado">Estado</Cabecera>
                <Cabecera {...cab} col="ultimo">Último mov.</Cabecera>
              </tr>
            </thead>
            <tbody>
              {lista.map((s) => (
                <tr
                  key={s.codigo}
                  onClick={() => {
                    const g = porClave.get(`${s.empresa}||${s.producto}`);
                    if (g) abrirProducto(g);
                  }}
                  className="cursor-pointer border-b border-line-2 transition-colors last:border-0 hover:bg-ground/70"
                >
                  <td className={cn(td, "text-[13px] text-muted")}>{titulo(s.empresa)}</td>
                  <td className={td}>
                    {/* El clic sube a la fila; el botón permite abrirla con el teclado. */}
                    <button type="button" className="block text-left text-[13.5px] font-semibold hover:underline">
                      {nombreProducto(s.producto, s.empresa)}
                    </button>
                    <p className="num text-[11.5px] text-faint">{s.codigo}</p>
                  </td>
                  <td className={cn(td, "text-[13px]")}>{nombreTallaEn(s.talla, porClave.get(`${s.empresa}||${s.producto}`)?.tallas ?? [s])}</td>
                  <td className={cn(td, "num text-right text-[15px] font-semibold")}>{entero(s.queda)}</td>
                  <td className={td}>
                    <EstadoBadge estado={estadoDe(s.queda, minimo)} />
                  </td>
                  <td className={cn(td, "text-[13px] text-muted")}>{fechaLarga(s.ultimo_movimiento)}</td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </Card>
      )}
      <p className="text-center text-xs text-faint">
        Mostrando {entero(filtrados.length)} de {entero(r.articulos)} tallas
      </p>
    </div>
  );
}
