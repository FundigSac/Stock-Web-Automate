import { useEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { ESTADO_TEXTO } from "../lib/derive";
import { entero } from "../lib/format";
import type { Estado } from "../lib/types";
import { cn } from "../lib/utils";

/** Mismo corte que la barra lateral (lg): de ahí para arriba es escritorio. */
const CONSULTA_ESCRITORIO = "(min-width: 1024px)";

/** true en escritorio. Los gráficos y el resumen solo se montan ahí: en el celular no se descarga su código. */
export function useEsEscritorio(): boolean {
  const [es, setEs] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(CONSULTA_ESCRITORIO).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(CONSULTA_ESCRITORIO);
    const alCambiar = () => setEs(mq.matches);
    alCambiar();
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, []);
  return es;
}

/** Al presionar: scale(0.98) en 100 ms. Con movimiento reducido, index.css lo vuelve inmediato. */
export const presion = "transition-transform duration-100 ease-out enabled:active:scale-[0.98]";

/** Bloque: 8 px de radio, borde visible a pleno sol, sin sombra. */
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-surface", className)} {...p} />;
}

/** Etiqueta corta sobre un dato. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-left text-[14px] font-semibold leading-5 text-faint", className)}>{children}</p>;
}

const ESTADO_ESTILO: Record<Estado, string> = {
  ok: "bg-ok-soft text-ok",
  bajo: "bg-warn-soft text-warn",
  sin: "bg-line-2 text-muted",
  revisar: "bg-red-soft text-red",
};

/** El estado siempre va escrito: el color solo lo acompaña. */
export function EstadoBadge({ estado, className }: { estado: Estado; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[14px] font-semibold leading-5", ESTADO_ESTILO[estado], className)}>
      <span className="size-2 rounded-full bg-current" aria-hidden />
      {ESTADO_TEXTO[estado]}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "ink" | "claro" | "fantasma" };
/** 56 px de alto como mínimo en cualquier pantalla. "ink" es la acción principal y usa el color de acción. */
export function Boton({ className, variante = "claro", ...p }: BtnProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-14 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-5 text-[16px] font-semibold leading-6",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-50",
        presion,
        variante === "ink" && "bg-action text-white hover:bg-ink-2",
        variante === "claro" && "border border-line bg-surface text-ink hover:bg-ground",
        variante === "fantasma" && "text-muted hover:bg-line-2 hover:text-ink",
        className,
      )}
      {...p}
    />
  );
}

export function Chip({
  activo,
  children,
  onClick,
  className,
}: {
  activo?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        // shrink-0: con min-w-14 el navegador podría encogerla por debajo de su texto en una fila que se desliza.
        "inline-flex min-h-14 min-w-14 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-4 text-[16px] font-semibold leading-6",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
        presion,
        activo ? "border-action bg-action text-white" : "border-line bg-surface text-ink-2 hover:border-faint",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Cifra con dígitos de ancho uniforme. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  return <span className={cn("num", className)}>{entero(value)}</span>;
}

/** Bloque fijo con la altura ya reservada: no parpadea ni se mueve mientras carga. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function Vacio({ icono, titulo, texto }: { icono: ReactNode; titulo: string; texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 grid size-14 place-items-center rounded-lg bg-ground text-muted" aria-hidden>
        {icono}
      </div>
      {/* Es un título: va centrado, no justificado. */}
      <p className="text-center text-[18px] font-semibold leading-[26px] text-ink">{titulo}</p>
      <p className="mt-1 max-w-sm text-[16px] leading-6 text-muted">{texto}</p>
    </div>
  );
}

/** Tabla con cabecera fija y scroll horizontal enfocable. */
export function Tabla({ children, minAncho = 640, etiqueta }: { children: ReactNode; minAncho?: number; etiqueta: string }) {
  return (
    <div role="region" aria-label={etiqueta} tabIndex={0} className="relative overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-action">
      <table className="w-full border-collapse text-left text-[16px] leading-6" style={{ minWidth: minAncho }}>
        {children}
      </table>
    </div>
  );
}

export const th = "whitespace-nowrap px-4 py-3 text-[14px] font-semibold leading-5 text-faint";
export const td = "h-14 px-4 py-3 align-middle";
