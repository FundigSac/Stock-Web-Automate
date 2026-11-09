import { ArrowDown, ArrowUp, ChevronsUpDown, LayoutGrid, List, Package, Plus, Search, TriangleAlert, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { codigosProvisionales, MarcaProvisional, ProductoStock, TONO_ESTADO } from "../components/ProductoStock";
import { Boton, Chip, Tabla, Vacio, td, th } from "../components/ui";
import { agruparProductos, ESTADO_TEXTO, estadoDe, rangoTalla, resumir } from "../lib/derive";
import { entero, fechaLarga, norm, nombreProducto, nombreTallaEn, titulo } from "../lib/format";
import type { Estado, StockItem } from "../lib/types";
import { cn } from "../lib/utils";
import type { VistaProps } from "./tipos";

type Col = "empresa" | "producto" | "talla" | "queda" | "estado" | "ultimo";

const PRIORIDAD: Record<Estado, number> = { revisar: 0, bajo: 1, sin: 2, ok: 3 };

type Orden = { col: Col; asc: boolean };

/** Botón grande de la pantalla: 56 px y scale(0.98) en 100 ms al presionar. */
const ACCION = "inline-flex min-h-14 items-center gap-2.5 rounded-xl px-4 text-[16px] font-semibold transition-transform duration-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

/** La tabla ordenable solo tiene sentido con pantalla ancha. En el celular se ven filas grandes. */
function useAncho(consulta: string): boolean {
  const [si, setSi] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(consulta).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(consulta);
    const alCambiar = () => setSi(m.matches);
    alCambiar();
    m.addEventListener("change", alCambiar);
    return () => m.removeEventListener("change", alCambiar);
  }, [consulta]);
  return si;
}

function Cabecera({ col, children, derecha, orden, alOrdenar }: { col: Col; children: string; derecha?: boolean; orden: Orden; alOrdenar: (f: (o: Orden) => Orden) => void }) {
  const activo = orden.col === col;
  const Icono = !activo ? ChevronsUpDown : orden.asc ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={cn(th, "py-1", derecha && "text-right")} aria-sort={activo ? (orden.asc ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => alOrdenar((o) => ({ col, asc: o.col === col ? !o.asc : true }))}
        className={cn("inline-flex min-h-14 items-center gap-1.5 transition hover:text-ink", activo && "text-ink")}
      >
        {children}
        <Icono className="size-4" aria-hidden />
      </button>
    </th>
  );
}

export function Stock({ datos, minimo, empresa, cambiarEmpresa, abrirProducto, filtroEstado, setFiltroEstado, editor, abrirNuevoProducto, abrirAsistente, abrirPedidos, pedidosPendientes }: VistaProps) {
  const [q, setQ] = useState("");
  const [modo, setModo] = useState<"productos" | "lista">("productos");
  const [orden, setOrden] = useState<Orden>({ col: "producto", asc: true });
  const ancho = useAncho("(min-width: 1024px)");
  const verLista = ancho && modo === "lista";
  // Escribir no espera a que se vuelva a dibujar toda la lista.
  const qDiferida = useDeferredValue(q);

  const r = useMemo(() => resumir(datos.stock, minimo), [datos.stock, minimo]);
  const todosGrupos = useMemo(() => agruparProductos(datos.stock, minimo), [datos.stock, minimo]);
  const porClave = useMemo(() => new Map(todosGrupos.map((g) => [g.clave, g])), [todosGrupos]);
  const provisionales = useMemo(() => codigosProvisionales(datos), [datos]);

  const busca = norm(qDiferida.trim());

  const filtrados = useMemo(
    () =>
      datos.stock.filter((s) => {
        if (filtroEstado !== "todos" && estadoDe(s.queda, minimo) !== filtroEstado) return false;
        if (!busca) return true;
        // Se busca tanto lo que se ve en pantalla ("Pantalón con Fundigsac") como lo guardado ("PANTALON C/F").
        return norm(`${nombreProducto(s.producto, s.empresa)} ${s.producto} ${s.codigo} ${s.talla ?? ""} ${s.empresa}`).includes(busca);
      }),
    [datos.stock, filtroEstado, busca, minimo],
  );

  const gruposVisibles = useMemo(() => {
    const pasan = new Set(filtrados);
    const claves = new Set(filtrados.map((s) => `${s.empresa}||${s.producto}`));
    return todosGrupos
      .filter((g) => claves.has(g.clave))
      .map((g) => ({ g, visibles: g.tallas.filter((t) => pasan.has(t)) }))
      .sort((a, b) => a.g.empresa.localeCompare(b.g.empresa, "es") || a.g.producto.localeCompare(b.g.producto, "es"));
  }, [todosGrupos, filtrados]);

  const lista = useMemo(() => {
    if (!verLista) return [];
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
  }, [verLista, filtrados, orden, minimo]);

  const cuenta = (e: Estado) => (e === "ok" ? r.ok : e === "bajo" ? r.bajo : e === "sin" ? r.sin : r.revisar);
  const cab = { orden, alOrdenar: setOrden };
  const variasEmpresas = new Set(gruposVisibles.map((v) => v.g.empresa)).size > 1;

  let empresaPrevia = "";

  return (
    <div className="space-y-5">
      {/* Buscar es lo principal de esta pantalla: va arriba. La gestión queda debajo de los filtros. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* El campo mide 56 px por dentro; el borde va aparte. */}
          <div className="flex min-w-0 flex-1 basis-72 items-center gap-3 rounded-xl border border-line bg-surface pl-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action">
            <Search className="size-6 shrink-0 text-faint" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Producto, código o talla"
              aria-label="Buscar en el stock"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              className="h-14 min-w-0 flex-1 bg-transparent text-[18px] outline-none placeholder:text-faint"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Borrar la búsqueda" className="grid size-14 shrink-0 place-items-center rounded-xl text-muted transition-transform duration-100 hover:text-ink active:scale-[0.98]">
                <X className="size-6" aria-hidden />
              </button>
            )}
          </div>
          {ancho && (
            <div className="flex gap-1 rounded-md border border-line bg-surface p-1" role="group" aria-label="Forma de ver">
              {([
                ["productos", LayoutGrid, "Por producto"],
                ["lista", List, "Lista"],
              ] as const).map(([m, Icono, etiqueta]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModo(m)}
                  aria-pressed={modo === m}
                  className={cn("inline-flex min-h-14 items-center gap-2 rounded-md px-4 text-[16px] font-semibold transition-transform duration-100 active:scale-[0.98]", modo === m ? "bg-action text-white" : "text-muted hover:text-ink")}
                >
                  <Icono className="size-5" aria-hidden /> {etiqueta}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* En el celular los estados van en una sola fila que se desliza: la búsqueda queda cerca de las cifras. */}
        <div className="sin-barra -mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filtrar por estado">
          <Chip activo={filtroEstado === "todos"} onClick={() => setFiltroEstado("todos")} className="text-[16px]">
            Todos <span className="num font-normal">{entero(r.articulos)}</span>
          </Chip>
          {(["ok", "bajo", "sin", "revisar"] as Estado[])
            .filter((e) => e !== "revisar" || r.revisar > 0)
            .map((e) => (
              <Chip key={e} activo={filtroEstado === e} onClick={() => setFiltroEstado(e)} className="text-[16px]">
                {ESTADO_TEXTO[e]} <span className="num font-normal">{entero(cuenta(e))}</span>
              </Chip>
            ))}
        </div>
      </div>

      {editor && (
        <div className="flex flex-wrap gap-3">
          {r.bajo > 0 && (
            <button type="button" onClick={() => abrirAsistente("¿Qué está por agotarse?")} className={cn(ACCION, "bg-warn-soft text-warn")}>
              <TriangleAlert className="size-5" aria-hidden />
              <span>
                <span className="num">{entero(r.bajo)}</span> por agotarse · Pedir
              </span>
            </button>
          )}
          {pedidosPendientes > 0 && (
            <button type="button" onClick={abrirPedidos} className={cn(ACCION, "border border-line bg-surface text-ink hover:bg-ground")}>
              <Package className="size-5" aria-hidden />
              <span>
                <span className="num">{entero(pedidosPendientes)}</span> {pedidosPendientes === 1 ? "pedido pendiente" : "pedidos pendientes"}
              </span>
            </button>
          )}
          <button type="button" onClick={abrirNuevoProducto} className={cn(ACCION, "border border-line bg-surface text-ink hover:bg-ground")}>
            <Plus className="size-5" aria-hidden /> Producto nuevo
          </button>
        </div>
      )}

      {filtrados.length === 0 ? (
        <div className="rounded-2xl border border-line-2 bg-surface">
          {r.articulos === 0 ? (
            <Vacio icono={<Package className="size-6" aria-hidden />} titulo="Todavía no hay productos" texto="Cuando se agregue un producto, aquí se verá cuánto queda de cada talla." />
          ) : busca && empresa !== "TODAS" ? (
            // Con una empresa elegida, lo buscado puede estar en otra: se dice y se ofrece buscar en todas.
            <>
              <Vacio icono={<Search className="size-6" aria-hidden />} titulo={`Nada coincide con «${qDiferida.trim()}» en ${titulo(empresa)}`} texto="Solo estás viendo una empresa. Busca en todas o prueba con otra palabra." />
              <div className="flex justify-center px-4 pb-8">
                <Boton onClick={() => cambiarEmpresa("TODAS")}>Buscar en todas las empresas</Boton>
              </div>
            </>
          ) : busca ? (
            <Vacio icono={<Search className="size-6" aria-hidden />} titulo={`Nada coincide con «${qDiferida.trim()}»`} texto="Prueba con otra palabra, con el código o con la talla." />
          ) : (
            <Vacio icono={<Package className="size-6" aria-hidden />} titulo="Ninguna talla en ese estado" texto="Elige Todos para ver el stock completo." />
          )}
        </div>
      ) : verLista ? (
        <div className="overflow-hidden rounded-2xl border border-line-2 bg-surface p-2">
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
              {lista.map((s) => {
                const e = estadoDe(s.queda, minimo);
                const prov = provisionales.get(s.codigo);
                return (
                  <tr
                    key={s.codigo}
                    onClick={() => {
                      const g = porClave.get(`${s.empresa}||${s.producto}`);
                      if (g) abrirProducto(g);
                    }}
                    className="cursor-pointer border-b border-line-2 transition-colors last:border-0 hover:bg-ground/70"
                  >
                    <td className={cn(td, "text-[16px] text-muted")}>{titulo(s.empresa)}</td>
                    <td className={td}>
                      {/* El clic sube a la fila; el botón permite abrirla con el teclado. */}
                      <button type="button" className="block text-left text-[16px] font-semibold hover:underline">
                        {nombreProducto(s.producto, s.empresa)}
                      </button>
                      <p className="num text-left text-[14px] text-faint">{s.codigo}</p>
                    </td>
                    <td className={cn(td, "text-[16px]")}>{nombreTallaEn(s.talla, porClave.get(`${s.empresa}||${s.producto}`)?.tallas ?? [s])}</td>
                    <td className={cn(td, "num text-right text-[20px] font-semibold")}>{entero(s.queda)}</td>
                    <td className={td}>
                      <span className="flex flex-col gap-0.5">
                        <span className={cn("text-[16px] font-semibold", TONO_ESTADO[e])}>{ESTADO_TEXTO[e]}</span>
                        {prov && <MarcaProvisional tipo={prov} />}
                      </span>
                    </td>
                    <td className={cn(td, "text-[16px] text-muted")}>{fechaLarga(s.ultimo_movimiento)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Tabla>
        </div>
      ) : (
        <div className="space-y-4">
          {gruposVisibles.map(({ g, visibles }) => {
            const nuevaEmpresa = variasEmpresas && g.empresa !== empresaPrevia;
            empresaPrevia = g.empresa;
            return (
              <div key={g.clave}>
                {nuevaEmpresa && (
                  <h2 className="mb-3 mt-2 flex items-center gap-3 text-[20px] font-semibold leading-7">
                    {titulo(g.empresa)}
                    <span className="h-px flex-1 bg-line" aria-hidden />
                  </h2>
                )}
                <ProductoStock g={g} visibles={visibles} minimo={minimo} provisionales={provisionales} alAbrir={() => abrirProducto(g)} />
              </div>
            );
          })}
        </div>
      )}
      <p className="text-center text-[14px] text-muted">
        Mostrando <span className="num">{entero(filtrados.length)}</span> de <span className="num">{entero(r.articulos)}</span> tallas
        {empresa !== "TODAS" && ` de ${titulo(empresa)}`}
      </p>
    </div>
  );
}
