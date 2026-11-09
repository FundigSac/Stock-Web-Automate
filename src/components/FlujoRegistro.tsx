import { ArrowLeft } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { marcarEdicion } from "../lib/offline/recarga";

/** Acción principal del paso: la única de la pantalla, abajo y al alcance del pulgar. */
export const BOTON_PRINCIPAL =
  "inline-flex h-16 w-full items-center justify-center gap-2 rounded-md bg-action px-4 text-[20px] font-semibold text-white transition-transform duration-100 active:scale-[0.98] aria-disabled:opacity-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

/** Acciones de apoyo: 56 px de alto, borde y fondo blanco. */
export const BOTON_SECUNDARIO =
  "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md border-2 border-line bg-surface px-4 py-2 text-[18px] font-semibold leading-6 text-ink transition-transform duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action";

/** Campo de texto del registro, alto para usarlo con guantes. */
export const CAMPO =
  "h-14 w-full rounded-md border border-line bg-surface px-4 text-[18px] text-ink outline-none transition focus:border-action placeholder:text-faint";

export const ETIQUETA = "mb-2 block text-left text-[16px] font-semibold text-muted";

/**
 * Registro a pantalla completa. Queda debajo de la banda de estado, que sigue a la vista y se puede tocar.
 * Lo que hay detrás no recibe foco ni toques mientras está abierto.
 * Nunca hay dos a la vista: la que abre otra encima (trabajador nuevo, Por subir) queda oculta sin perder lo escrito.
 */
export function PantallaFlujo({
  abierta,
  oculta = false,
  etiqueta,
  pasoTexto,
  alAtras,
  atrasDesactivado,
  claveContenido,
  children,
  pie,
}: {
  abierta: boolean;
  /** Otra pantalla completa está encima: esta sigue montada, con lo escrito, pero no se ve ni se anuncia. */
  oculta?: boolean;
  etiqueta: string;
  /** "Paso 2 de 4". Sin texto no se muestra. */
  pasoTexto?: string | null;
  /** Sin función no hay botón Atrás (por ejemplo, después de guardar). */
  alAtras?: () => void;
  atrasDesactivado?: boolean;
  /** Cambia en cada paso: anima la entrada y vuelve el contenido arriba. */
  claveContenido: string;
  children: ReactNode;
  pie?: ReactNode;
}) {
  const capa = useRef<HTMLDivElement>(null);
  const desplazable = useRef<HTMLDivElement>(null);
  // Con el registro abierto, una versión nueva espera: recargar borraría lo que se está llenando.
  const clave = useId();
  useEffect(() => {
    marcarEdicion(clave, abierta);
    return () => marcarEdicion(clave, false);
  }, [clave, abierta]);

  const activa = abierta && !oculta;
  useEffect(() => {
    if (!activa || !capa.current) return;
    // Todo lo que queda detrás se vuelve inerte, menos los avisos de estado (la banda y los mensajes breves).
    const raiz = document.getElementById("root");
    const inertes: HTMLElement[] = [];
    let nodo: HTMLElement | null = capa.current;
    while (nodo && nodo !== raiz && nodo.parentElement) {
      for (const hermano of Array.from(nodo.parentElement.children)) {
        if (hermano === nodo || !(hermano instanceof HTMLElement) || hermano.inert || hermano.getAttribute("role") === "status") continue;
        hermano.inert = true;
        inertes.push(hermano);
      }
      nodo = nodo.parentElement;
    }
    const html = document.documentElement;
    const desborde = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      for (const e of inertes) e.inert = false;
      html.style.overflow = desborde;
    };
  }, [activa]);

  useEffect(() => {
    desplazable.current?.scrollTo({ top: 0 });
  }, [claveContenido]);

  if (!abierta) return null;

  const tecla = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented || !alAtras || atrasDesactivado) return;
    e.preventDefault();
    alAtras();
  };

  return (
    <div ref={capa} role="dialog" aria-label={etiqueta} hidden={oculta} onKeyDown={tecla} className={`fixed inset-x-0 bottom-0 top-14 z-[45] flex-col bg-ground ${oculta ? "hidden" : "flex"}`}>
      {(alAtras || pasoTexto) && (
      <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-line-2 bg-surface px-4">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
          {alAtras && (
            <button
              type="button"
              onClick={alAtras}
              disabled={atrasDesactivado}
              className="-ml-2 inline-flex h-14 min-w-14 items-center gap-2 rounded-md px-3 text-[18px] font-semibold text-action transition-transform duration-100 hover:bg-ground active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-action"
            >
              <ArrowLeft className="size-6" aria-hidden />
              Atrás
            </button>
          )}
          {pasoTexto && <p className="num ml-auto text-right text-[16px] font-semibold text-muted">{pasoTexto}</p>}
        </div>
      </header>
      )}
      <div ref={desplazable} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div key={claveContenido} className="paso-entra mx-auto max-w-2xl px-4 pb-8 pt-6">
          {children}
        </div>
      </div>
      {pie && (
        <footer className="shrink-0 border-t border-line-2 bg-surface px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto max-w-2xl space-y-3">{pie}</div>
        </footer>
      )}
    </div>
  );
}
