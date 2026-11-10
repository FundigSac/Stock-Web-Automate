import * as Dialog from "@radix-ui/react-dialog";
import { animate } from "framer-motion";
import { AlertOctagon, AlertTriangle, ArrowDown, ArrowUp, Ban, CheckCircle2, CircleSlash, RefreshCw, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { ESTADO_TEXTO, signoMovimiento } from "../lib/derive";
import { entero } from "../lib/format";
import { marcarEdicion } from "../lib/offline/recarga";
import type { Estado } from "../lib/types";
import { cn } from "../lib/utils";

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-3xl border border-line-2 bg-surface shadow-card", className)} {...p} />;
}

/** Etiqueta pequena en mayusculas, como en los tableros de referencia. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint", className)}>{children}</p>
  );
}

const ESTADO_ESTILO: Record<Estado, string> = {
  ok: "bg-ok-soft text-ok",
  bajo: "bg-warn-soft text-warn",
  sin: "bg-line-2 text-muted",
  revisar: "bg-red-soft text-red",
};

/** Cada estado lleva su propio icono: el color nunca es la única señal. */
export const ESTADO_ICONO: Record<Estado, LucideIcon> = {
  ok: CheckCircle2,
  bajo: AlertTriangle,
  sin: CircleSlash,
  revisar: AlertOctagon,
};

/** Estado con icono y texto. `texto` permite decir más ("Sin stock · 1 de 3 tallas"). */
export function EstadoBadge({ estado, texto, className }: { estado: Estado; texto?: string; className?: string }) {
  const Icono = ESTADO_ICONO[estado];
  return (
    <span
      data-estado={estado}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold",
        ESTADO_ESTILO[estado],
        className,
      )}
    >
      <Icono className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
      {texto ?? ESTADO_TEXTO[estado]}
    </span>
  );
}

/** Cantidad de un movimiento con signo y flecha (+12 ↑ entrada, −3 ↓ salida). Una anulada queda tachada y en gris. */
export function CantidadMov({ tipo, cantidad, anulado = false, className }: { tipo: "entrada" | "salida"; cantidad: number; anulado?: boolean; className?: string }) {
  const s = signoMovimiento(tipo, cantidad, anulado);
  const Flecha = tipo === "entrada" ? ArrowUp : ArrowDown;
  return (
    <span
      data-cantidad={tipo}
      data-anulado={anulado || undefined}
      className={cn("num inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap font-semibold", tipo === "salida" && "text-red", anulado && "text-faint", className)}
    >
      <span aria-hidden className={cn(anulado && "line-through")}>{s.texto}</span>
      <Flecha aria-hidden className="size-[0.8em] shrink-0" strokeWidth={2.75} />
      <span className="sr-only">{s.lectura}</span>
    </span>
  );
}

/** Marca de movimiento anulado: icono y texto, no solo un tachado. */
export function MarcaAnulado({ className }: { className?: string }) {
  return (
    <span data-marca-anulado className={cn("inline-flex items-center gap-1 rounded-md bg-red-soft px-1.5 py-0.5 text-[11px] font-semibold text-red", className)}>
      <Ban className="size-3" aria-hidden /> Anulado
    </span>
  );
}

type BtnProps =ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "ink" | "claro" | "fantasma" };
export function Boton({ className, variante = "claro", ...p }: BtnProps) {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50",
        variante === "ink" && "bg-ink text-white hover:bg-ink-2 active:scale-[0.98]",
        variante === "claro" && "border border-line bg-surface text-ink hover:bg-ground active:scale-[0.98]",
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
        "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition",
        activo ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:border-faint hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Numero que sube animado hasta su valor. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const [v, setV] = useState(0);
  const previo = useRef(0);
  useEffect(() => {
    const c = animate(previo.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (x) => setV(Math.round(x)),
    });
    previo.current = value;
    return () => c.stop();
  }, [value]);
  return <span className={cn("num", className)}>{entero(v)}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function Vacio({ icono, titulo, texto }: { icono: ReactNode; titulo: string; texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-ground text-muted">{icono}</div>
      <p className="text-sm font-semibold text-ink">{titulo}</p>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{texto}</p>
    </div>
  );
}

/**
 * Una parte que no cargó. Nunca se muestra como vacía: dice qué falta y, si hay con qué, ofrece reintentar.
 * `incompleto` es la falta de señal (se completa sola); `error` es un fallo del servidor.
 */
export function FallaCarga({
  tipo,
  que,
  reintentar,
  breve = false,
  className,
}: {
  tipo: "error" | "incompleto";
  /** "Los movimientos", "Los datos del personal"… (en plural). */
  que: string;
  reintentar?: () => Promise<unknown> | void;
  /** Para tarjetas pequeñas: una frase corta. */
  breve?: boolean;
  className?: string;
}) {
  const texto = breve
    ? tipo === "error"
      ? `${que} no cargaron porque el servidor falló; no es que no haya.`
      : `${que} no cargaron antes de perder la señal; no es que no haya.`
    : tipo === "error"
      ? `${que} no alcanzaron a descargarse porque el servidor falló. Lo que ves puede estar incompleto: no es que no haya datos.`
      : `${que} no alcanzaron a descargarse antes de perder la señal, así que esta parte está incompleta. Se completa sola cuando vuelva la conexión.`;
  return (
    <div role="alert" data-falla={tipo} className={cn("flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-[13px] font-medium", tipo === "error" ? "bg-red-soft text-red" : "bg-warn-soft text-warn", className)}>
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-justify">{texto}</p>
      {reintentar && tipo === "error" && <BotonReintentar alReintentar={reintentar} />}
    </div>
  );
}

/** Vuelve a pedir los datos y muestra que está en ello. */
export function BotonReintentar({ alReintentar, className }: { alReintentar: () => Promise<unknown> | void; className?: string }) {
  const [probando, setProbando] = useState(false);
  return (
    <Boton
      className={cn("h-9", className)}
      disabled={probando}
      onClick={async () => {
        setProbando(true);
        try {
          await alReintentar();
        } finally {
          setProbando(false);
        }
      }}
    >
      <RefreshCw className={cn("size-3.5", probando && "animate-spin motion-reduce:animate-none")} aria-hidden /> {probando ? "Reintentando…" : "Reintentar"}
    </Boton>
  );
}

/** Ventana de detalle accesible (Radix). */
export function Ventana({
  abierta,
  alCerrar,
  titulo,
  subtitulo,
  children,
  pie,
}: {
  abierta: boolean;
  alCerrar: () => void;
  titulo: string;
  subtitulo?: ReactNode;
  children: ReactNode;
  /** Botones que quedan siempre a la vista, debajo del contenido que se desplaza. */
  pie?: ReactNode;
}) {
  // Con una ventana abierta, una versión nueva espera: recargar borraría lo que se está llenando.
  const clave = useId();
  useEffect(() => {
    marcarEdicion(clave, abierta);
    return () => marcarEdicion(clave, false);
  }, [clave, abierta]);

  return (
    <Dialog.Root open={abierta} onOpenChange={(o) => !o && alCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ov fixed inset-0 z-50 bg-ink/45 backdrop-blur-[3px]" />
        <Dialog.Content
          className={cn(
            "sheet fixed z-50 flex flex-col overflow-hidden bg-surface shadow-pop outline-none",
            // Celular: hoja que sube desde abajo y casi llena la pantalla.
            "inset-x-0 bottom-0 max-h-[94dvh] w-full rounded-t-3xl",
            // Pantallas grandes: ventana centrada.
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88vh] sm:w-[min(720px,calc(100vw-24px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl",
          )}
          aria-describedby={undefined}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 border-b border-line-2 px-5 pb-4 pt-3 sm:px-6 sm:pt-5">
            <div className="min-w-0">
              <Dialog.Title className="display truncate text-xl font-semibold">{titulo}</Dialog.Title>
              {subtitulo && <div className="mt-1 text-[13px] text-muted">{subtitulo}</div>}
            </div>
            <Dialog.Close
              className="grid size-9 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-line-2 hover:text-ink"
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
          {pie && (
            <div className="shrink-0 border-t border-line-2 bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4">{pie}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Tabla con cabecera fija y scroll horizontal enfocable. */
export function Tabla({ children, minAncho = 640, etiqueta }: { children: ReactNode; minAncho?: number; etiqueta: string }) {
  return (
    <div
      role="region"
      aria-label={etiqueta}
      tabIndex={0}
      className="relative overflow-x-auto rounded-2xl focus-visible:outline-2 focus-visible:outline-ink"
    >
      <table className="w-full border-collapse text-left text-sm" style={{ minWidth: minAncho }}>
        {children}
      </table>
    </div>
  );
}

export const th = "whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint";
export const td = "px-4 py-3 align-middle";
