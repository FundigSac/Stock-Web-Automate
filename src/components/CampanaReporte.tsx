import { AlertTriangle, CalendarClock, CheckCircle2, FileDown, Loader2, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { filtrarPorEmpresa } from "../lib/derive";
import { faltaMigracion } from "../lib/errores";
import { fechaCorta, hoyISO } from "../lib/format";
import { estaEnLinea } from "../lib/offline/conexion";
import { LIMITE_DESFASE_SEGUNDOS } from "../lib/offline/motor";
import { ahoraServidor, desfaseConocido } from "../lib/offline/reloj";
import { corteDeDatos, estadoReporte, inicioLlegadasTarde, sabadoCubierto, type EstadoReporte, type Semaforo } from "../lib/reporteSemanal";
import { supabase } from "../lib/supabase";
import { hoyLima } from "../lib/tiempo";
import type { Datos } from "../lib/types";
import { cn } from "../lib/utils";
import { Boton } from "./ui";

const CLAVE = "rep_aviso_v2";
/** En rojo, "ahora no" solo dura este rato. */
const HORAS_ROJO = 3;

const TONO: Record<Semaforo, string> = {
  verde: "bg-ok-soft text-ok",
  amarillo: "bg-warn-soft text-warn",
  rojo: "bg-red-soft text-red",
};

/** El color nunca va solo: cada estado lleva su icono y su texto. */
const ICONO: Record<Semaforo, LucideIcon> = {
  verde: CheckCircle2,
  amarillo: CalendarClock,
  rojo: AlertTriangle,
};

const dias = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

function textos(e: EstadoReporte): { titulo: string; detalle: string } {
  const sabado = `sábado ${fechaCorta(e.fecha)}`;
  if (e.fase === "atrasado") return { titulo: "El reporte semanal está atrasado", detalle: `Tocaba el ${sabado}, hace ${dias(-e.dias)}.` };
  if (e.fase === "hoy") return { titulo: "Hoy toca el reporte semanal", detalle: "Descárgalo y queda marcado como hecho." };
  if (e.dias === 1) return { titulo: "Mañana toca el reporte semanal", detalle: `Es el ${sabado}. Ten a mano las fotos de las entregas.` };
  return { titulo: `Faltan ${dias(e.dias)} para el reporte semanal`, detalle: `Toca el ${sabado}.` };
}

type Descartado = { dia: string; ts: number };

function leerDescartado(): Descartado | null {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as Partial<Descartado> | null;
    return v && typeof v.dia === "string" && typeof v.ts === "number" ? { dia: v.dia, ts: v.ts } : null;
  } catch {
    return null;
  }
}

/** Aviso del reporte semanal: aparece desde el miércoles y se va al descargar el reporte. */
export function AvisoReporte({ todos, autor, avisar, recargar, errorDatos, dueno, sinPendiente }: { todos: Datos; autor: string; avisar: (texto: string, error?: boolean) => void; recargar: () => Promise<Datos | null>; errorDatos: boolean; dueno: string | null; /** Lo que se muestra cuando no hay nada que hacer. */ sinPendiente?: ReactNode }) {
  const [hoy, setHoy] = useState(hoyISO);
  const [ahora, setAhora] = useState(() => Date.now());
  const [descartado, setDescartado] = useState(leerDescartado);
  const [trabajando, setTrabajando] = useState<"bajar" | "marcar" | null>(null);
  // Solo después de una descarga que no se pudo anotar o a la que le faltan fotos: nadie marca como hecho un reporte que no sacó.
  const [faltaMarcar, setFaltaMarcar] = useState(false);
  const [fotosFaltantes, setFotosFaltantes] = useState<string | null>(null);
  // Hasta dónde llegan los datos del PDF descargado. Marcar como hecho, aunque sea horas después, reutiliza ese instante.
  const corteDescarga = useRef<string | null>(null);

  const sync = todos.sync;
  const estado = useMemo(
    () => (sync?.reporte_inicio ? estadoReporte(sync.reporte_inicio, sync.reporte_ultimo, hoy, sync.reporte_sabado ?? null) : null),
    [sync?.reporte_inicio, sync?.reporte_ultimo, sync?.reporte_sabado, hoy],
  );

  // Una pestaña abierta toda la semana también recibe el aviso del sábado.
  useEffect(() => {
    // El día sale de la hora del servidor: un reloj atrasado dejaría el día real fuera del reporte.
    const revisar = () => {
      setAhora(Date.now());
      void ahoraServidor().then((ms) => setHoy(hoyLima(ms)));
    };
    revisar();
    const id = window.setInterval(revisar, 60_000);
    document.addEventListener("visibilitychange", revisar);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", revisar);
    };
  }, []);

  async function marcar(e: EstadoReporte) {
    const quien = autor.trim() || "Equipo";
    let { error } = await supabase.rpc("marcar_reporte_sabado", { p_quien: quien, p_sabado: sabadoCubierto(e), p_corte: corteDescarga.current });
    if (faltaMigracion(error?.code)) ({ error } = await supabase.rpc("marcar_reporte", { p_quien: quien }));
    if (error) throw new Error(error.message);
    setFaltaMarcar(false);
    setFotosFaltantes(null);
    recargar();
  }

  async function descargar() {
    if (!estado || trabajando) return;
    if (!estaEnLinea()) {
      avisar("El reporte necesita conexión. Sácalo cuando vuelva la señal.", true);
      return;
    }
    if (errorDatos) {
      avisar("El servidor no entregó todos los datos. Saca el reporte cuando carguen.", true);
      return;
    }
    setTrabajando("bajar");
    let faltaron = 0;
    let total = 0;
    try {
      // Se lee todo otra vez: el corte tiene que corresponder exactamente a las filas que van a salir en el PDF.
      const fresco = await recargar();
      if (!fresco) {
        avisar("No se pudieron traer los datos al día. Inténtalo de nuevo.", true);
        setTrabajando(null);
        return;
      }
      corteDescarga.current = corteDeDatos(fresco);
      const desfase = await desfaseConocido(Date.now());
      if (desfase !== null && Math.abs(desfase) > LIMITE_DESFASE_SEGUNDOS) avisar("La hora de este dispositivo no está bien. El reporte sale con la hora del servidor.", true);
      const { generarPDF } = await import("../lib/pdf");
      const r = await generarPDF({
        datos: filtrarPorEmpresa(fresco, "TODAS"),
        todos: fresco,
        empresa: "TODAS",
        secciones: { resumen: true, stock: true, movimientos: true, trabajadores: true, fotos: true },
        usuario: autor,
        desde: estado.desde,
        hasta: hoy,
        incluirAnulados: false,
        titulo: "Reporte semanal",
        tardeDesde: inicioLlegadasTarde(sync),
        dueno,
      });
      faltaron = r.fallidas;
      total = r.fotos;
    } catch (e) {
      console.error(e);
      avisar("No se pudo generar el reporte", true);
      setTrabajando(null);
      return;
    }
    // Un reporte al que le faltan fotos no cierra la semana solo: lo decide la persona.
    if (faltaron > 0) {
      setFaltaMarcar(true);
      const aviso = `Se descargó, pero ${faltaron} de ${total} fotos no cargaron. Descárgalo otra vez o toca «Marcar como hecho» si te sirve así.`;
      setFotosFaltantes(aviso);
      avisar(aviso, true);
      setTrabajando(null);
      return;
    }
    try {
      await marcar(estado);
      avisar("Reporte semanal descargado.");
    } catch (e) {
      console.error(e);
      setFaltaMarcar(true);
      avisar("Se descargó, pero no quedó anotado. Toca «Marcar como hecho».", true);
    } finally {
      setTrabajando(null);
    }
  }

  async function marcarHecho() {
    if (!estado || trabajando) return;
    setTrabajando("marcar");
    try {
      await marcar(estado);
      avisar("El reporte quedó marcado como hecho.");
    } catch (e) {
      console.error(e);
      avisar("No se pudo marcar. Revisa tu conexión.", true);
    } finally {
      setTrabajando(null);
    }
  }

  function ahoraNo() {
    const v = { dia: hoy, ts: Date.now() };
    setDescartado(v);
    try {
      localStorage.setItem(CLAVE, JSON.stringify(v));
    } catch {
      /* sin almacenamiento: vale mientras la página siga abierta */
    }
  }

  const toca = !!estado && estado.fase !== "hecho" && estado.fase !== "espera" && estado.semaforo !== "verde";
  const oculto = descartado?.dia === hoy && (estado?.semaforo !== "rojo" || ahora - descartado.ts < HORAS_ROJO * 3_600_000);
  const tx = estado && toca ? textos(estado) : null;

  if (!(estado && tx && !oculto)) return <>{sinPendiente}</>;
  const Icono = ICONO[estado.semaforo];

  return (
    <div role="status" data-testid="aviso-reporte" className={cn("no-print rounded-lg px-4 py-4", TONO[estado.semaforo])}>
      <div className="flex items-start gap-3">
        <Icono className="mt-0.5 size-6 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-left text-[18px] font-semibold leading-[26px]">{tx.titulo}</p>
          <p className="mt-0.5 text-[16px] leading-6">{fotosFaltantes ?? tx.detalle}</p>
        </div>
        <button type="button" onClick={ahoraNo} aria-label="Ahora no" title="Ahora no" className="-mr-2 -mt-2 grid size-14 shrink-0 place-items-center rounded-lg hover:bg-ink/5">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Boton variante="ink" className="min-h-16 flex-1 text-[18px] sm:flex-none" onClick={descargar} disabled={trabajando !== null}>
          {trabajando === "bajar" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <FileDown className="size-5" aria-hidden />}
          {trabajando === "bajar" ? "Preparando…" : "Descargar reporte"}
        </Boton>
        {faltaMarcar && (
          <Boton className="min-h-16 flex-1 sm:flex-none" onClick={marcarHecho} disabled={trabajando !== null}>
            {trabajando === "marcar" && <Loader2 className="size-5 animate-spin" aria-hidden />} Marcar como hecho
          </Boton>
        )}
      </div>
    </div>
  );
}
