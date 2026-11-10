import { ESTADO_TEXTO } from "../lib/derive";
import { entero } from "../lib/format";
import { reglaBajo, segmentosSalud } from "../lib/salud";
import type { Estado } from "../lib/types";
import { cn } from "../lib/utils";
import type { FiltroEstado } from "../views/tipos";
import { ESTADO_ICONO } from "./ui";

// Los mismos tonos que EstadoBadge: suaves, con el texto del color del estado (contraste AA).
const TONO: Record<Estado, string> = {
  ok: "bg-ok-soft text-ok",
  bajo: "bg-warn-soft text-warn",
  sin: "bg-line-2 text-muted",
  revisar: "bg-red-soft text-red",
};

/**
 * B25-1 StockHealthBar: una barra partida en Con stock / Por agotarse / Sin stock (y Saldo negativo si lo hay).
 * Cada tramo mide lo que pesa en el total y, al tocarlo, filtra la lista de abajo. Tocar el activo quita el filtro.
 */
export function BarraSalud({ r, minimo, filtro, alFiltrar }: { r: { ok: number; bajo: number; sin: number; revisar: number }; minimo: number; filtro: FiltroEstado; alFiltrar: (f: FiltroEstado) => void }) {
  const segmentos = segmentosSalud(r);
  if (segmentos.length === 0) return null;
  const total = r.ok + r.bajo + r.sin + r.revisar;
  return (
    <div>
      <div role="group" aria-label="Salud del stock: toca un tramo para filtrar" className="flex w-full gap-1 overflow-hidden rounded-xl" data-testid="barra-salud">
        {segmentos.map((s) => {
          const Icono = ESTADO_ICONO[s.estado];
          const activo = filtro === s.estado;
          return (
            <button
              key={s.estado}
              type="button"
              data-estado={s.estado}
              aria-pressed={activo}
              aria-label={`${ESTADO_TEXTO[s.estado]}: ${entero(s.cuenta)} de ${entero(total)} tallas`}
              title={`${ESTADO_TEXTO[s.estado]}: ${entero(s.cuenta)} de ${entero(total)} tallas`}
              onClick={() => alFiltrar(activo ? "todos" : s.estado)}
              // El ancho sigue a la cuenta; un mínimo deja tocar hasta el tramo más chico.
              style={{ flexGrow: s.cuenta, flexBasis: 0 }}
              className={cn(
                "relative inline-flex h-11 min-w-12 items-center justify-center gap-1.5 overflow-hidden rounded-lg px-2 text-[13px] font-semibold transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                TONO[s.estado],
                activo && "ring-2 ring-inset ring-ink",
              )}
            >
              <Icono className="size-3.5 shrink-0" aria-hidden />
              <span className="num">{entero(s.cuenta)}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-justify text-[12px] text-muted">{reglaBajo(minimo)} Sin stock: quedan 0.</p>
    </div>
  );
}
