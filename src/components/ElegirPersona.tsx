import { Check, Search, UserPlus, X } from "lucide-react";
import { titulo } from "../lib/format";
import type { Trabajador } from "../lib/types";
import { cn } from "../lib/utils";
import { BOTON_SECUNDARIO, CAMPO, ETIQUETA } from "./FlujoRegistro";

/** Paso "¿Quién recibe?": buscador y filas de 64 px, primero quienes recibieron algo hace poco. */
export function ElegirPersona({
  quien,
  personal,
  personaElegida,
  persona,
  dudaPersona,
  esCliente,
  alEscribir,
  alElegir,
  alMarcarCliente,
  alAgregar,
}: {
  quien: string;
  /** Trabajadores que coinciden con lo escrito, ya ordenados. */
  personal: Trabajador[];
  personaElegida: Trabajador | null;
  /** Lo escrito, sin espacios de sobra. */
  persona: string;
  /** Hay parecidos en la lista: hay que elegir uno o confirmar que es un cliente. */
  dudaPersona: boolean;
  esCliente: boolean;
  alEscribir: (texto: string) => void;
  alElegir: (t: Trabajador) => void;
  alMarcarCliente: () => void;
  alAgregar: () => void;
}) {
  const comoCliente = persona !== "" && !personaElegida && (personal.length === 0 || esCliente);
  return (
    <div>
      <label htmlFor="reg-quien" className={ETIQUETA}>
        Busca por nombre o área, o escribe el nombre de un cliente
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
        <input
          id="reg-quien"
          value={quien}
          onChange={(e) => alEscribir(e.target.value)}
          placeholder="Por ejemplo: Diego o almacén"
          autoComplete="off"
          className={cn(CAMPO, "pl-12", quien && "pr-14")}
        />
        {quien && (
          <button type="button" onClick={() => alEscribir("")} aria-label="Borrar" className="absolute right-0 top-0 grid size-14 place-items-center rounded-md text-faint hover:text-ink">
            <X className="size-5" aria-hidden />
          </button>
        )}
      </div>

      {comoCliente && (
        <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-3 text-[16px] text-muted">
          No está en la lista. Se registrará como cliente: <b className="text-ink">{persona.toUpperCase()}</b>.
        </p>
      )}

      {personal.length > 0 && !(esCliente && !personaElegida) && (
        <>
          {quien.trim() === "" && <p className="mt-4 text-left text-[16px] text-muted">Arriba, quienes recibieron algo hace poco.</p>}
          <ul className="mt-2 divide-y divide-line-2 overflow-hidden rounded-lg border border-line bg-surface">
            {personal.map((t) => {
              const elegido = personaElegida?.trabajador === t.trabajador;
              return (
                <li key={t.trabajador}>
                  <button
                    type="button"
                    aria-pressed={elegido}
                    onClick={() => alElegir(t)}
                    className={cn("flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-ground active:bg-ground", elegido && "bg-ground")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[18px] font-semibold leading-6 [overflow-wrap:anywhere]">{titulo(t.trabajador)}</span>
                      <span className="block truncate text-[16px] leading-6 text-muted">{t.area ? titulo(t.area) : "Sin área"}</span>
                    </span>
                    {elegido && <Check className="size-6 shrink-0 text-action" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {dudaPersona && (
        <button type="button" onClick={alMarcarCliente} className={cn(BOTON_SECUNDARIO, "mt-3")}>
          No está en la lista: es un cliente
        </button>
      )}
      {!personaElegida && (
        <button type="button" onClick={alAgregar} className={cn(BOTON_SECUNDARIO, "mt-3 border-dashed")}>
          <UserPlus className="size-5 shrink-0" aria-hidden />
          {persona ? `Agregar «${persona}» como trabajador nuevo` : "¿No está? Agregar trabajador nuevo"}
        </button>
      )}
    </div>
  );
}
