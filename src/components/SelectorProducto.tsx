import { Minus, Plus, Search, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { GrupoProducto } from "../lib/derive";
import { entero, etiquetaTalla, nombreProducto, titulo } from "../lib/format";
import type { StockItem } from "../lib/types";
import { cn } from "../lib/utils";
import { estiloCampo, etiquetaCampo } from "./CampoAutor";
import { Chip } from "./ui";

/** Producto elegido y las unidades puestas en cada talla (por codigo). */
export type Sel = { clave: string | null; cants: Record<string, string> };
export const SEL_VACIA: Sel = { clave: null, cants: {} };

export type Linea = { t: StockItem; n: number; quedaria: number };

/** Tallas con al menos 1 unidad, y cuanto quedaria despues (suma o resta). */
export function lineasDe(grupos: GrupoProducto[], sel: Sel, suma: boolean): Linea[] {
  const g = grupos.find((x) => x.clave === sel.clave);
  return (g?.tallas ?? [])
    .map((t) => ({ t, n: Number.parseInt(sel.cants[t.codigo] ?? "", 10) || 0 }))
    .filter((l) => l.n > 0)
    .map((l) => ({ ...l, quedaria: l.t.queda + (suma ? l.n : -l.n) }));
}

export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function SelectorProducto({
  titulo: encabezado,
  ayuda,
  suma,
  grupos,
  genero,
  valor,
  onChange,
  nuevoProducto,
  idCampo,
}: {
  titulo: string;
  ayuda: string;
  /** true: las unidades se suman al stock (entrada); false: se restan (salida). */
  suma: boolean;
  grupos: GrupoProducto[];
  /** Si hay, solo salen productos de ese genero (y los equipos de seguridad). */
  genero: { valor: "HOMBRE" | "MUJER"; verTodo: boolean; alVerTodo: () => void } | null;
  valor: Sel;
  onChange: (v: Sel) => void;
  nuevoProducto?: (i: { nombre?: string; empresa?: string }) => void;
  idCampo: string;
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

  const grupo = grupos.find((g) => g.clave === valor.clave) ?? null;
  const poner = (codigo: string, v: string) => onChange({ ...valor, cants: { ...valor.cants, [codigo]: v.replace(/[^\d]/g, "").slice(0, 6) } });
  const sumar = (codigo: string, d: number) => poner(codigo, String(Math.max(0, (Number.parseInt(valor.cants[codigo] ?? "", 10) || 0) + d)));

  if (grupo) {
    return (
      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{encabezado}</p>
            <p className="mt-1 text-[14.5px] font-semibold leading-snug">{nombreProducto(grupo.producto, grupo.empresa)}</p>
            <p className="mt-0.5 text-[12px] text-muted">
              {titulo(grupo.empresa)}
              {grupo.genero ? ` · ${titulo(grupo.genero)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(SEL_VACIA)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-muted transition hover:bg-ground hover:text-ink"
          >
            <Undo2 className="size-3.5" /> Cambiar
          </button>
        </div>

        <p className={cn(etiquetaCampo, "mb-2 mt-5")}>{ayuda}</p>
        <ul className="divide-y divide-line-2 overflow-hidden rounded-2xl border border-line">
          {grupo.tallas.map((t) => {
            const n = Number.parseInt(valor.cants[t.codigo] ?? "", 10) || 0;
            return (
              <li key={t.codigo} className={cn("flex items-center gap-3 px-3.5 py-2.5 transition", n > 0 && "bg-ground/70")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{etiquetaTalla(t.talla)}</p>
                  <p className={cn("num text-[11.5px]", t.queda <= 0 ? "text-red" : "text-muted")}>{t.queda <= 0 ? "No hay stock" : `Hay ${entero(t.queda)}`}</p>
                </div>
                <div className="flex h-11 items-stretch overflow-hidden rounded-xl border border-line bg-surface focus-within:border-ink">
                  <button
                    type="button"
                    aria-label={`Quitar una unidad (${etiquetaTalla(t.talla)})`}
                    onClick={() => sumar(t.codigo, -1)}
                    className="grid w-11 place-items-center text-muted transition hover:bg-ground hover:text-ink active:bg-ground"
                  >
                    <Minus className="size-4" />
                  </button>
                  <input
                    inputMode="numeric"
                    aria-label={`Unidades (${etiquetaTalla(t.talla)})`}
                    value={valor.cants[t.codigo] ?? ""}
                    placeholder="0"
                    onChange={(e) => poner(t.codigo, e.target.value)}
                    className="num w-12 min-w-0 bg-transparent text-center text-[16px] font-semibold outline-none"
                  />
                  <button
                    type="button"
                    aria-label={`Agregar una unidad (${etiquetaTalla(t.talla)})`}
                    onClick={() => sumar(t.codigo, 1)}
                    className="grid w-11 place-items-center text-muted transition hover:bg-ground hover:text-ink active:bg-ground"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11.5px] text-faint">{suma ? "Estas unidades se suman al stock." : "Estas unidades se restan del stock."}</p>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={idCampo} className={etiquetaCampo}>
        {encabezado}
      </label>
      <div className="sin-barra -mx-1 mb-2.5 flex gap-2 overflow-x-auto px-1 pb-1">
        {["TODAS", ...empresas].map((e) => (
          <Chip key={e} activo={empresaF === e} onClick={() => setEmpresaF(e)}>
            {e === "TODAS" ? "Todas" : titulo(e)}
          </Chip>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          id={idCampo}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ej: casaca, polo, botas, 42…"
          autoComplete="off"
          className={cn(estiloCampo, "pl-10", q && "pr-10")}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Borrar búsqueda"
            className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-faint transition hover:bg-ground hover:text-ink"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <p className="mb-1 mt-2 text-[11.5px] text-faint">
        {resultados.length === 0 ? "Sin resultados" : `${entero(resultados.length)} ${resultados.length === 1 ? "producto" : "productos"}`}
        {filtraGenero && (
          <>
            {" "}· para {genero!.valor === "MUJER" ? "mujer" : "hombre"} y equipos de seguridad ·{" "}
            <button type="button" onClick={genero!.alVerTodo} className="font-semibold text-ink underline-offset-2 hover:underline">
              ver todos
            </button>
          </>
        )}
      </p>
      {resultados.length === 0 ? (
        <p className="rounded-xl bg-ground px-3.5 py-3 text-[13px] text-muted">No encontré ese producto. Prueba con otra palabra o cambia la empresa.</p>
      ) : (
        <ul className="max-h-60 divide-y divide-line-2 overflow-y-auto overscroll-contain rounded-2xl border border-line">
          {resultados.map((g) => (
            <li key={g.clave}>
              <button
                type="button"
                onClick={() => {
                  onChange({ clave: g.clave, cants: {} });
                  setQ("");
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-ground active:bg-ground"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold">{nombreProducto(g.producto, g.empresa)}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {titulo(g.empresa)}
                    {g.genero ? ` · ${titulo(g.genero)}` : ""} · {g.tallas.length} {g.tallas.length === 1 ? "talla" : "tallas"}
                  </span>
                </span>
                <span className="num shrink-0 text-[12px] text-muted">{entero(g.unidades)} uds</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {nuevoProducto && (
        <button
          type="button"
          onClick={() => nuevoProducto({ nombre: q.trim(), empresa: empresaF })}
          className="mt-2.5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-faint/70 text-[13px] font-semibold text-ink transition hover:bg-ground"
        >
          <Plus className="size-4" /> ¿No está? Crear producto nuevo
        </button>
      )}
    </div>
  );
}
