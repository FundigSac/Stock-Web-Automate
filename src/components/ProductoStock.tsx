import { ChevronRight, Clock3 } from "lucide-react";
import { ESTADO_TEXTO, estadoDe, type GrupoProducto } from "../lib/derive";
import { entero, nombreProducto, nombreTallaEn, titulo } from "../lib/format";
import type { Datos, Estado, StockItem } from "../lib/types";
import { cn } from "../lib/utils";

/** Por qué una cifra todavía puede cambiar: falta subir algo de este celular, o ya subió y la copia local no lo trae. */
export type Provisional = "sinSubir" | "sinCopia";

/** Códigos cuyas cifras incluyen registros que el servidor o la copia de este celular todavía no reflejan. */
export function codigosProvisionales(d: Pick<Datos, "entradas" | "salidas">): Map<string, Provisional> {
  const m = new Map<string, Provisional>();
  for (const r of [...d.entradas, ...d.salidas]) {
    if (!r.pendiente) continue;
    if (!r.sinCopia) m.set(r.codigo, "sinSubir");
    else if (!m.has(r.codigo)) m.set(r.codigo, "sinCopia");
  }
  return m;
}

const EXPLICA: Record<Provisional, string> = {
  sinSubir: "incluye registros de este celular que faltan subir",
  sinCopia: "incluye registros ya subidos que este celular todavía no trae",
};

export function MarcaProvisional({ tipo, className }: { tipo: Provisional; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[14px] font-semibold leading-5 text-warn", className)} title={`Cifra provisional: ${EXPLICA[tipo]}`}>
      <Clock3 className="size-4 shrink-0" aria-hidden />
      Provisional
      <span className="sr-only">: {EXPLICA[tipo]}</span>
    </span>
  );
}

export const TONO_ESTADO: Record<Estado, string> = { ok: "text-ok", bajo: "text-warn", sin: "text-muted", revisar: "text-red" };
const TONO_CIFRA: Record<Estado, string> = { ok: "text-ink", bajo: "text-warn", sin: "text-muted", revisar: "text-red" };

/** "Talla M", "Talla única", "Sin talla". Conserva la variante C/F o S/F cuando hace falta para distinguirlas. */
function etiqueta(t: StockItem, hermanas: StockItem[]): string {
  const n = nombreTallaEn(t.talla, hermanas);
  if (n === "Sin talla") return n;
  return n === "Única" || n === "Especial" ? `Talla ${n.toLowerCase()}` : `Talla ${n}`;
}

function FilaTalla({ t, hermanas, minimo, provisional }: { t: StockItem; hermanas: StockItem[]; minimo: number; provisional?: Provisional }) {
  const e = estadoDe(t.queda, minimo);
  return (
    <li className="flex min-h-14 items-center gap-3 border-t border-line-2 py-2">
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[18px] font-semibold leading-6">{etiqueta(t, hermanas)}</span>
        {(e !== "ok" || provisional) && (
          <span className="flex flex-wrap items-center gap-x-3 text-[14px] font-semibold leading-5">
            {e !== "ok" && <span className={TONO_ESTADO[e]}>{ESTADO_TEXTO[e]}</span>}
            {provisional && <MarcaProvisional tipo={provisional} />}
          </span>
        )}
      </span>
      <span className="sr-only">Quedan</span>
      <span className={cn("num shrink-0 text-right text-[28px] font-semibold leading-8", TONO_CIFRA[e])}>{entero(t.queda)}</span>
    </li>
  );
}

/**
 * Un producto con lo que queda de cada talla. La cabecera abre la ficha; las filas son para leer de un vistazo.
 * `visibles` son las tallas que pasan la búsqueda. `g` es el producto completo: da el total y nombra bien las variantes.
 */
export function ProductoStock({ g, visibles, minimo, provisionales, alAbrir }: { g: GrupoProducto; visibles: StockItem[]; minimo: number; provisionales: Map<string, Provisional>; alAbrir: () => void }) {
  const todas = g.tallas.length;
  return (
    <div className="overflow-hidden rounded-2xl border border-line-2 bg-surface">
      <button
        type="button"
        onClick={alAbrir}
        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-transform duration-100 hover:bg-ground active:scale-[0.98] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[18px] font-semibold leading-6 [overflow-wrap:anywhere]">{nombreProducto(g.producto, g.empresa)}</span>
          <span className="block text-[16px] leading-6 text-muted">
            {g.genero ? `${titulo(g.genero)} · ` : ""}
            {visibles.length === todas ? `${todas} ${todas === 1 ? "talla" : "tallas"}` : `${visibles.length} de ${todas} tallas`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="num block text-[28px] font-semibold leading-8">{entero(g.unidades)}</span>
          <span className="block text-[14px] leading-5 text-muted">en total</span>
        </span>
        <ChevronRight className="size-6 shrink-0 text-faint" aria-hidden />
        <span className="sr-only">Ver ficha</span>
      </button>
      <ul className="px-4 sm:grid sm:grid-cols-2 sm:gap-x-8 xl:grid-cols-3">
        {visibles.map((t) => (
          <FilaTalla key={t.codigo} t={t} hermanas={g.tallas} minimo={minimo} provisional={provisionales.get(t.codigo)} />
        ))}
      </ul>
    </div>
  );
}
