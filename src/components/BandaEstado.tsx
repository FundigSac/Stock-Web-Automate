import { AlertTriangle, CheckCircle2, UploadCloud, Wifi, WifiOff, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { useEffect, useState } from "react";
import type { Respaldo } from "../lib/offline/useRespaldo";

type Entrada = {
  enLinea: boolean;
  subiendo: boolean;
  porSubir: number;
  porRevisar: number;
  ultimaCarga: number | null;
  /** Segundos desde la última lectura correcta. */
  edad: number;
};

type Tono = "revisar" | "sin-red" | "subir" | "ok";
export type Estado = { tono: Tono; icono: LucideIcon; texto: string };

/** El primer caso que coincide es el que se muestra. */
export function estadoBanda(e: Entrada): Estado {
  if (e.porRevisar > 0) return { tono: "revisar", icono: AlertTriangle, texto: `${e.porRevisar} por revisar` };
  if (!e.enLinea) return { tono: "sin-red", icono: WifiOff, texto: e.porSubir > 0 ? `Sin conexión · ${e.porSubir} por subir` : "Sin conexión · Puedes seguir registrando" };
  if (e.subiendo && e.porSubir > 0) return { tono: "subir", icono: UploadCloud, texto: `Subiendo ${e.porSubir}…` };
  if (e.porSubir > 0) return { tono: "subir", icono: UploadCloud, texto: `${e.porSubir} por subir · Subir ahora` };
  // Sin una lectura reciente no se puede decir que hay conexión (fila 6) ni que no la hay (filas 2 y 3).
  // Es el único estado fuera de la tabla de 7.2: sale mientras llega la primera lectura o si la última tiene más de 90 s.
  // Lleva icono de señal, no de subida.
  if (e.ultimaCarga === null || e.edad > 90) return { tono: "subir", icono: Wifi, texto: "Conectando…" };
  return { tono: "ok", icono: CheckCircle2, texto: "En línea · Todo subido" };
}

const TONO: Record<Tono, string> = {
  revisar: "bg-red text-white",
  "sin-red": "bg-band-offline text-on-band-offline",
  subir: "bg-info text-white",
  ok: "bg-ok text-white",
};

/** Fija arriba en todas las pantallas. Tiene su propio reloj para que el resto de la app no se redibuje. */
export function BandaEstado({ r, ultimaCarga, alAbrir }: { r: Respaldo; ultimaCarga: number | null; alAbrir: () => void }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  // Una lectura recién llegada puede ser posterior al último tic del reloj.
  const edad = ultimaCarga ? Math.max(0, ahora - ultimaCarga) / 1000 : 0;
  const e = estadoBanda({ enLinea: r.enLinea, subiendo: r.subiendo, porSubir: r.porSubir, porRevisar: r.porRevisar, ultimaCarga, edad });
  const Icono = e.icono;
  return (
    <div role="status" className="no-print fixed inset-x-0 top-0 z-[55] h-14">
      <button type="button" onClick={alAbrir} className={clsx("num flex size-full items-center justify-center gap-3 px-4 text-[17px] font-semibold leading-5", TONO[e.tono])}>
        <Icono className="size-6 shrink-0" aria-hidden />
        <span className="line-clamp-2 text-left">{e.texto}</span>
      </button>
    </div>
  );
}
