import { Minus, Plus, Search, TriangleAlert, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { GrupoProducto } from "../lib/derive";
import { entero, etiquetaTalla, norm, nombreProducto, nombreTallaEn, titulo } from "../lib/format";
import type { StockItem } from "../lib/types";
import { cn } from "../lib/utils";
import { BOTON_SECUNDARIO, CAMPO, ETIQUETA } from "./FlujoRegistro";
import { Chip } from "./ui";

/** Producto elegido y las unidades puestas en cada talla (por codigo). */
export type Sel = { clave: string | null; cants: Record<string, string> };
export const SEL_VACIA: Sel = { clave: null, cants: {} };

/** El mismo tope que aplica el servidor por línea. */
export const MAX_UNIDADES = 100_000;
/** Desde esta cantidad por talla se pide una confirmación: suele ser un número mal escrito. */
export const CANTIDAD_INUSUAL = 1000;

/** Deja solo dígitos y no permite pasar del tope. */
export function limpiarCantidad(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 6);
  return d === "" ? "" : String(Math.min(MAX_UNIDADES, Number(d)));
}

export type Linea = { t: StockItem; n: number; quedaria: number };

/** Tallas con al menos 1 unidad, y cuanto quedaria despues (suma o resta). */
export function lineasDe(grupos: GrupoProducto[], sel: Sel, suma: boolean): Linea[] {
  const g = grupos.find((x) => x.clave === sel.clave);
  return (g?.tallas ?? [])
    .map((t) => ({ t, n: Number.parseInt(sel.cants[t.codigo] ?? "", 10) || 0 }))
    .filter((l) => l.n > 0)
    .map((l) => ({ ...l, quedaria: l.t.queda + (suma ? l.n : -l.n) }));
}

const unidadesTexto = (n: number) => `${entero(n)} ${n === 1 ? "unidad" : "unidades"}`;

/** Cifra con el signo menos tipográfico, igual que el "−2" de las salidas. */
export const conSigno = (n: number) => (n < 0 ? `−${entero(-n)}` : entero(n));

/** Filtro por género de quien recibe: solo salen sus productos y los equipos de seguridad. */
export type FiltroGenero = { valor: "HOMBRE" | "MUJER"; verTodo: boolean; alVerTodo: () => void } | null;

/** Buscador y lista de productos en filas de 64 px. */
export function ListaProductos({
  idCampo,
  grupos,
  genero,
  alElegir,
  nuevoProducto,
}: {
  idCampo: string;
  grupos: GrupoProducto[];
  genero: FiltroGenero;
  alElegir: (g: GrupoProducto) => void;
  nuevoProducto?: (i: { nombre?: string; empresa?: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [empresaF, setEmpresaF] = useState("TODAS");
  const empresas = useMemo(() => Array.from(new Set(grupos.map((g) => g.empresa))).sort((a, b) => a.localeCompare(b, "es")), [grupos]);
  const filtraGenero = genero !== null && !genero.verTodo;

  // Cada palabra escrita debe aparecer en el nombre, la empresa o el codigo (sin importar tildes ni mayusculas).
  const resultados = useMemo(() => {
    const palabras = norm(q).split(/\s+/).filter(Boolean);
    return grupos
      .filter((g) => empresaF === "TODAS" || g.empresa === empresaF)
      .filter((g) => !filtraGenero || g.genero === genero!.valor || !g.genero || g.genero === "UNISEX" || norm(g.empresa).includes("seguridad"))
      .filter((g) => {
        const texto = norm(`${nombreProducto(g.producto, g.empresa)} ${g.empresa} ${g.genero ?? ""} ${g.tallas.map((t) => `${t.codigo} ${t.talla ?? ""}`).join(" ")}`);
        return palabras.every((p) => texto.includes(p));
      })
      .sort((a, b) => a.producto.localeCompare(b.producto, "es"));
  }, [q, grupos, empresaF, filtraGenero, genero]);

  return (
    <div>
      <label htmlFor={idCampo} className={ETIQUETA}>
        Busca por nombre, talla o código
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
        <input id={idCampo} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Por ejemplo: casaca, botas, 42" autoComplete="off" className={cn(CAMPO, "pl-12", q && "pr-14")} />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Borrar búsqueda" className="absolute right-0 top-0 grid size-14 place-items-center rounded-md text-faint hover:text-ink">
            <X className="size-5" aria-hidden />
          </button>
        )}
      </div>

      {empresas.length > 1 && (
        <div className="sin-barra -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1">
          {["TODAS", ...empresas].map((e) => (
            <Chip key={e} activo={empresaF === e} onClick={() => setEmpresaF(e)} className="text-[16px]">
              {e === "TODAS" ? "Todas las empresas" : titulo(e)}
            </Chip>
          ))}
        </div>
      )}

      <p className="num mt-3 text-left text-[16px] text-muted">
        {resultados.length === 0 ? "Sin resultados" : `${entero(resultados.length)} ${resultados.length === 1 ? "producto" : "productos"}`}
        {filtraGenero && ` para ${genero!.valor === "MUJER" ? "mujer" : "hombre"} y equipos de seguridad`}
      </p>

      {resultados.length === 0 ? (
        <p className="mt-2 rounded-lg bg-surface px-4 py-3 text-[16px] text-muted">No encontré ese producto. Prueba con otra palabra o cambia la empresa.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-2 overflow-hidden rounded-lg border border-line bg-surface">
          {resultados.map((g) => (
            <li key={g.clave}>
              <button
                type="button"
                onClick={() => {
                  alElegir(g);
                  setQ("");
                }}
                className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-ground active:bg-ground"
              >
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[18px] font-semibold leading-6 [overflow-wrap:anywhere]">{nombreProducto(g.producto, g.empresa)}</span>
                  <span className="block truncate text-[16px] leading-6 text-muted">
                    {titulo(g.empresa)}
                    {g.genero ? ` · ${titulo(g.genero)}` : ""} · {g.tallas.length} {g.tallas.length === 1 ? "talla" : "tallas"}
                  </span>
                </span>
                <span className="num shrink-0 text-right text-[16px] text-muted">{entero(g.unidades)} uds</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {filtraGenero && (
        <button type="button" onClick={genero!.alVerTodo} className={cn(BOTON_SECUNDARIO, "mt-3")}>
          Ver todos los productos
        </button>
      )}
      {nuevoProducto && (
        <button type="button" onClick={() => nuevoProducto({ nombre: q.trim(), empresa: empresaF })} className={cn(BOTON_SECUNDARIO, "mt-3 border-dashed")}>
          <Plus className="size-5" aria-hidden /> ¿No está? Crear producto nuevo
        </button>
      )}
    </div>
  );
}

/** El producto ya elegido, con la opción de cambiarlo. */
export function ProductoElegido({ grupo, alCambiar }: { grupo: GrupoProducto; alCambiar: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface py-2 pl-4 pr-2">
      <div className="min-w-0 flex-1">
        <p className="text-left text-[18px] font-semibold leading-6">{nombreProducto(grupo.producto, grupo.empresa)}</p>
        <p className="text-left text-[16px] leading-6 text-muted">
          {titulo(grupo.empresa)}
          {grupo.genero ? ` · ${titulo(grupo.genero)}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={alCambiar}
        aria-label="Elegir otro producto"
        className="inline-flex min-h-14 shrink-0 items-center rounded-md px-3 text-[16px] font-semibold text-action underline underline-offset-4 hover:bg-ground"
      >
        Cambiar
      </button>
    </div>
  );
}

/**
 * Talla en botones de 56 px y cantidad con − y + de 64 px. Cada talla guarda su propia cantidad,
 * así un mismo registro puede llevar varias tallas.
 */
export function CantidadPorTalla({ grupo, valor, onChange, suma }: { grupo: GrupoProducto; valor: Sel; onChange: (v: Sel) => void; suma: boolean }) {
  const tallas = grupo.tallas;
  const cuantas = (codigo: string) => Number.parseInt(valor.cants[codigo] ?? "", 10) || 0;
  const [activa, setActiva] = useState<string | null>(() => (tallas.length === 1 ? tallas[0].codigo : (tallas.find((t) => cuantas(t.codigo) > 0)?.codigo ?? null)));
  const idTalla = useId();
  const t = tallas.find((x) => x.codigo === activa) ?? null;

  const poner = (codigo: string, v: string) => onChange({ ...valor, cants: { ...valor.cants, [codigo]: limpiarCantidad(v) } });
  const sumar = (codigo: string, d: number) => poner(codigo, String(Math.max(0, cuantas(codigo) + d)));

  const conUnidades = tallas.filter((x) => cuantas(x.codigo) > 0);
  const total = conUnidades.reduce((a, x) => a + cuantas(x.codigo), 0);
  const n = t ? cuantas(t.codigo) : 0;
  const quedaria = t ? t.queda + (suma ? n : -n) : 0;

  return (
    <div>
      {tallas.length > 1 && (
        <>
          <p id={idTalla} className="text-left text-[18px] font-semibold">
            Talla
          </p>
          <div role="radiogroup" aria-labelledby={idTalla} className="mt-2 flex flex-wrap gap-3">
            {tallas.map((x) => {
              const c = cuantas(x.codigo);
              const elegida = x.codigo === activa;
              return (
                <button
                  key={x.codigo}
                  type="button"
                  role="radio"
                  aria-checked={elegida}
                  aria-label={`${etiquetaTalla(nombreTallaEn(x.talla, tallas))}${c > 0 ? `, ${unidadesTexto(c)}` : ""}${x.queda <= 0 ? ", sin stock" : ""}`}
                  onClick={() => setActiva(x.codigo)}
                  className={cn(
                    "flex h-14 min-w-14 flex-col items-center justify-center rounded-md border-2 px-3 text-[18px] font-semibold leading-5 transition-transform duration-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
                    elegida ? "border-action bg-action text-white" : c > 0 ? "border-action bg-surface text-action" : "border-line bg-surface text-ink",
                  )}
                >
                  <span>{nombreTallaEn(x.talla, tallas)}</span>
                  {c > 0 && (
                    <span className="num text-[14px] leading-4">
                      {suma ? "+" : "−"}
                      {entero(c)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {t ? (
        <div className={tallas.length > 1 ? "mt-6" : undefined}>
          <p className="text-left text-[18px] font-semibold">{etiquetaTalla(nombreTallaEn(t.talla, tallas))}</p>
          <p className={cn("num text-left text-[16px]", t.queda <= 0 ? "text-red" : "text-muted")}>{t.queda <= 0 ? "No hay stock" : `Hay ${entero(t.queda)}`}</p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              aria-label={`Quitar una unidad (${etiquetaTalla(t.talla)})`}
              onClick={() => sumar(t.codigo, -1)}
              className="grid size-16 shrink-0 place-items-center rounded-md border-2 border-line bg-surface text-ink transition-transform duration-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-action"
            >
              <Minus className="size-7" aria-hidden />
            </button>
            <input
              inputMode="numeric"
              aria-label={`Unidades (${etiquetaTalla(t.talla)})`}
              value={valor.cants[t.codigo] ?? ""}
              placeholder="0"
              onChange={(e) => poner(t.codigo, e.target.value)}
              className="num h-16 w-full min-w-0 flex-1 rounded-md border border-line bg-surface text-center text-[40px]! font-semibold leading-none text-ink outline-none focus:border-action"
            />
            <button
              type="button"
              aria-label={`Agregar una unidad (${etiquetaTalla(t.talla)})`}
              onClick={() => sumar(t.codigo, 1)}
              className="grid size-16 shrink-0 place-items-center rounded-md border-2 border-action bg-surface text-action transition-transform duration-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-action"
            >
              <Plus className="size-7" aria-hidden />
            </button>
          </div>
          {n > 0 &&
            (quedaria < 0 ? (
              <p className="mt-3 flex items-start gap-2 text-left text-[16px] font-semibold text-red">
                <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span className="num">Quedarían {conSigno(quedaria)}. Es más de lo que hay en stock.</span>
              </p>
            ) : (
              <p className="num mt-3 text-left text-[16px] text-muted">
                {quedaria === 1 ? "Quedará 1" : `Quedarán ${entero(quedaria)}`} en stock.
              </p>
            ))}
          {n >= CANTIDAD_INUSUAL && (
            <p className="mt-2 flex items-start gap-2 text-left text-[16px] font-semibold text-warn">
              <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>Son muchas unidades para una talla. Revisa el número.</span>
            </p>
          )}
        </div>
      ) : (
        <p className="mt-6 text-left text-[16px] text-muted">Elige la talla.</p>
      )}

      {tallas.length > 1 && conUnidades.length > 1 && (
        <p className="num mt-5 border-t border-line-2 pt-4 text-left text-[16px] text-muted">
          En total: {unidadesTexto(total)} en {conUnidades.length} tallas.
        </p>
      )}
    </div>
  );
}
