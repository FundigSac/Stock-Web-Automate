import { WifiOff } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";

/** Lo que de verdad no funciona sin red lo dice claro. No depende de código diferido: tiene que poder abrirse sin señal. */
export function NecesitaConexion({ abierto, alCerrar, que, detalle }: { abierto: boolean; alCerrar: () => void; que: string; detalle: string }) {
  const id = useId();
  const cerrar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement as HTMLElement | null;
    cerrar.current?.focus();
    return () => previo?.focus?.();
  }, [abierto]);

  if (!abierto) return null;

  const teclas = (e: KeyboardEvent) => {
    if (e.key === "Escape") alCerrar();
    // El único control de la ventana es Cerrar: el foco no sale de ella.
    if (e.key === "Tab") e.preventDefault();
  };

  return (
    <div data-state="open" className="ov fixed inset-0 z-50 grid items-end bg-ink/45 sm:place-items-center" onClick={alCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        data-state="open"
        onKeyDown={teclas}
        onClick={(e) => e.stopPropagation()}
        className="sheet w-full rounded-t-3xl bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 sm:w-[min(460px,calc(100vw-24px))] sm:rounded-3xl sm:pb-6"
      >
        <div className="flex flex-col items-center text-center">
          <span className="mb-3 grid size-14 place-items-center rounded-2xl bg-warn-soft text-warn">
            <WifiOff className="size-6" aria-hidden />
          </span>
          <h2 id={id} className="text-[24px] font-semibold leading-8">
            {que} necesita conexión
          </h2>
          <p className="mt-2 max-w-sm text-[16px] text-muted">{detalle}</p>
        </div>
        <button ref={cerrar} type="button" onClick={alCerrar} className="mt-5 flex h-14 w-full items-center justify-center rounded-xl border border-line bg-surface text-[18px] font-semibold">
          Cerrar
        </button>
      </div>
    </div>
  );
}
