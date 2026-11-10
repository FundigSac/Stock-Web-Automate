import { useEffect, useState } from "react";
import { hace } from "../lib/format";
import type { Respaldo } from "../lib/offline/useRespaldo";
import { cn } from "../lib/utils";

type Entrada = {
  enLinea: boolean;
  subiendo: boolean;
  porSubir: number;
  sinMigracion: number;
  porRevisar: number;
  errorDatos: boolean;
  tiempoReal: boolean;
  /** Segundos desde la última lectura correcta. */
  edad: number;
  ultimaCarga: number | null;
  ahora: number;
};

type Pastilla = { tono: "ok" | "aviso" | "mal"; texto: string; vivo: boolean };

/** Una sola frase con lo que importa ahora. Va de lo más urgente a lo normal. */
export function estadoConexion(e: Entrada): Pastilla {
  if (!e.enLinea) return { tono: "aviso", texto: e.porSubir > 0 ? `Sin conexión, ${e.porSubir} por subir` : "Sin conexión", vivo: false };
  if (e.sinMigracion > 0) return { tono: "aviso", texto: `${e.porSubir} esperando al servidor`, vivo: false };
  if (e.subiendo && e.porSubir > 0) return { tono: "aviso", texto: `Subiendo ${e.porSubir}…`, vivo: false };
  if (e.porSubir > 0) return { tono: "aviso", texto: `${e.porSubir} por subir`, vivo: false };
  if (e.porRevisar > 0) return { tono: "mal", texto: `${e.porRevisar} por revisar`, vivo: false };
  if (e.errorDatos) return { tono: "mal", texto: "Revisar conexión", vivo: false };
  // Sin una sola lectura correcta no se puede decir que hay conexión.
  if (e.ultimaCarga === null) return { tono: "aviso", texto: "Conectando…", vivo: false };
  if (e.edad > 90) return { tono: "aviso", texto: `Sin actualizar ${hace(e.ultimaCarga ? new Date(e.ultimaCarga).toISOString() : null, e.ahora)}`, vivo: false };
  return { tono: "ok", texto: e.tiempoReal ? "En vivo" : "Conectado", vivo: e.tiempoReal };
}

const TONO: Record<Pastilla["tono"], string> = {
  ok: "bg-ok-soft text-ok",
  aviso: "bg-warn-soft text-warn",
  mal: "bg-red-soft text-red",
};

/** Reloj propio que avanza cada `cada` ms: así el resto de la app no se redibuje por la hora. */
function useAhora(cada: number) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), cada);
    return () => window.clearInterval(id);
  }, [cada]);
  return ahora;
}

/** La pastilla de conexión de la cabecera. Al tocarla abre Respaldo, donde se ve lo que espera subir. */
export function EstadoRed({ r, errorDatos, tiempoReal, ultimaCarga, alAbrir, className }: { r: Respaldo; errorDatos: boolean; tiempoReal: boolean; ultimaCarga: number | null; alAbrir: () => void; className?: string }) {
  const ahora = useAhora(15_000);
  const edad = ultimaCarga ? (ahora - ultimaCarga) / 1000 : 0;
  const p = estadoConexion({ enLinea: r.enLinea, subiendo: r.subiendo, porSubir: r.porSubir, sinMigracion: r.sinMigracion, porRevisar: r.porRevisar, errorDatos, tiempoReal, edad, ultimaCarga, ahora });
  return (
    <div role="status" className="min-w-0 max-w-full">
      <button
        type="button"
        onClick={alAbrir}
        title="Abrir Respaldo"
        className={cn("inline-flex h-10 max-w-full items-center gap-2.5 rounded-xl px-3.5 text-[13px] font-semibold transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink", TONO[p.tono], className)}
      >
        <span className={cn("relative size-2 shrink-0 rounded-full bg-current", p.vivo && "live-dot")} />
        <span className="truncate">{p.texto}</span>
      </button>
    </div>
  );
}

/** Caja de la barra lateral: cuándo se leyeron los datos por última vez y el último movimiento. */
export function DatosEnVivo({ cargando, ultimaCarga, ultimoMovimiento }: { cargando: boolean; ultimaCarga: number | null; ultimoMovimiento: string | null }) {
  const ahora = useAhora(15_000);
  return (
    <div className="rounded-2xl bg-ground p-3.5 text-[12px] leading-relaxed text-muted">
      <p className="font-semibold text-ink">Datos en vivo</p>
      <p>{cargando ? "Conectando…" : `Actualizado ${hace(ultimaCarga ? new Date(ultimaCarga).toISOString() : null, ahora)}`}</p>
      {ultimoMovimiento && <p>Último movimiento: {ultimoMovimiento}</p>}
    </div>
  );
}
