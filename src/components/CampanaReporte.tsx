import { AnimatePresence, motion } from "framer-motion";
import { Bell, FileDown, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { filtrarPorEmpresa } from "../lib/derive";
import { faltaMigracion } from "../lib/errores";
import { fechaCorta, hoyISO, sumarDias } from "../lib/format";
import { estaEnLinea } from "../lib/offline/conexion";
import { LIMITE_DESFASE_SEGUNDOS } from "../lib/offline/motor";
import { ahoraServidor, desfaseConocido } from "../lib/offline/reloj";
import { corteDeDatos, estadoReporte, inicioLlegadasTarde, sabadoCubierto, type EstadoReporte, type Semaforo } from "../lib/reporteSemanal";
import { supabase } from "../lib/supabase";
import { hoyLima } from "../lib/tiempo";
import type { Datos } from "../lib/types";
import { cn } from "../lib/utils";

type Modo = "cerrada" | "pildora" | "abierta";

/** Lado de la campana respecto a la pantalla y ancho que puede tomar la isla sin salirse. */
type Geo = { derecha: boolean; ancho: number };

const CLAVE = "rep_isla_v1";
const CADA_HORAS_ROJO = 3;
const INK = "#0E0F11";
/** Distancia entre la campana y la isla ya abierta. */
const SEPARACION = 10;
const LADO_CAMPANA = 40;
/** Un solo resorte para todo (isla, contenido y espacio que empuja el resto): asi se mueven a la par. */
export const RESORTE = { type: "spring", stiffness: 400, damping: 32, mass: 1 } as const;

/** Colores del semaforo: la campana (fondo claro) y la isla (fondo oscuro). */
const TONO: Record<Semaforo, { campana: string; punto: string; chip: string; relleno: string; brillo: string }> = {
  verde: { campana: "bg-ok-soft text-ok", punto: "bg-emerald-400", chip: "bg-emerald-400/15 text-emerald-300", relleno: "bg-emerald-400", brillo: "52,211,153" },
  amarillo: { campana: "bg-warn-soft text-warn", punto: "bg-amber-400", chip: "bg-amber-400/15 text-amber-300", relleno: "bg-amber-400", brillo: "251,191,36" },
  rojo: { campana: "bg-red-soft text-red", punto: "bg-red-500", chip: "bg-red-500/20 text-red-300", relleno: "bg-red-500", brillo: "239,68,68" },
};

const dia = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;
const sabadoLargo = (iso: string) => `sábado ${fechaCorta(iso)}`;

function textos(e: EstadoReporte): { titulo: string; detalle: string; corto: string } {
  if (e.fase === "atrasado") {
    return { titulo: "Reporte semanal atrasado", detalle: `Tocaba el ${sabadoLargo(e.fecha)} · hace ${dia(-e.dias)}. Descárgalo ahora.`, corto: "Atrasado" };
  }
  if (e.fase === "hoy") return { titulo: "Hoy toca el reporte semanal", detalle: "Es sábado: descárgalo y queda listo para la semana.", corto: "Hoy" };
  if (e.fase === "hecho") return { titulo: "Reporte de la semana listo", detalle: `Próximo: ${sabadoLargo(e.fecha)} (en ${dia(e.dias)}).`, corto: "Al día" };
  if (e.dias === 1) return { titulo: "Mañana toca el reporte semanal", detalle: `Será el ${sabadoLargo(e.fecha)}. Ve preparando las fotos de las entregas.`, corto: "Mañana" };
  const primero = e.fase === "espera" ? "El primer reporte toca" : "El reporte toca";
  return { titulo: `Faltan ${dia(e.dias)} para el reporte`, detalle: `${primero} el ${sabadoLargo(e.fecha)}.`, corto: `En ${dia(e.dias)}` };
}

function leerGuardado(): { dia: string; ts: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as { dia?: string; ts?: number } | null;
    return v && typeof v.dia === "string" && typeof v.ts === "number" ? { dia: v.dia, ts: v.ts } : null;
  } catch {
    return null;
  }
}

function guardar(hoy: string) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ dia: hoy, ts: Date.now() }));
  } catch {
    /* sin almacenamiento: simplemente puede repetirse */
  }
}

/**
 * Recordatorio del reporte semanal (cada sabado). Un solo estado compartido por la campana (que lleva
 * la isla dentro) y el espacio que empuja el contenido hacia abajo mientras la isla esta abierta.
 * Usa los datos del servidor: lo que todavía no subió no sale en el reporte.
 */
export function useReporte({
  todos,
  autor,
  avisar,
  recargar,
  errorDatos,
  dueno,
}: {
  todos: Datos;
  autor: string;
  avisar: (texto: string, error?: boolean) => void;
  recargar: () => Promise<Datos | null>;
  errorDatos: boolean;
  dueno: string | null;
}) {
  const [hoy, setHoy] = useState(hoyISO);
  const [modo, setModo] = useState<Modo>("cerrada");
  const [trabajando, setTrabajando] = useState<"bajar" | "marcar" | null>(null);
  // Solo después de una descarga que no se pudo anotar o a la que le faltan fotos: nadie marca como hecho un reporte que no sacó.
  const [faltaMarcar, setFaltaMarcar] = useState(false);
  const [fotosFaltantes, setFotosFaltantes] = useState<string | null>(null);
  // Hasta dónde llegan los datos del PDF descargado. Marcar como hecho, aunque sea horas después, reutiliza ese instante.
  const corteDescarga = useRef<string | null>(null);
  /** La isla esta fuera: abierta, y un momento mas mientras se recoge. */
  const [unido, setUnido] = useState(false);
  /** Cuanto hay que bajar el contenido de la pagina para que la isla no lo tape. */
  const [empuje, setEmpuje] = useState(0);
  /** Lo mismo en celular: la fila del titulo (con la campana) se separa del resto. */
  const [empujeMovil, setEmpujeMovil] = useState(0);
  const temporizadores = useRef<number[]>([]);
  const manual = useRef(false);
  const modoRef = useRef<Modo>("cerrada");
  modoRef.current = modo;
  const campanaRef = useRef<HTMLSpanElement>(null);
  const [geo, setGeo] = useState<Geo>({ derecha: false, ancho: 340 });

  /** Mide de que lado esta la campana y cuanto ancho le queda a la isla. */
  const medir = useCallback(() => {
    const b = campanaRef.current?.getBoundingClientRect();
    if (!b) return;
    const derecha = b.left + b.width / 2 > window.innerWidth / 2;
    const libre = derecha ? b.right - 16 : window.innerWidth - b.left - 16;
    setGeo({ derecha, ancho: Math.round(Math.max(240, Math.min(420, libre))) });
  }, []);

  const sync = todos.sync;
  const estado = useMemo(
    () => (sync?.reporte_inicio ? estadoReporte(sync.reporte_inicio, sync.reporte_ultimo, hoy, sync.reporte_sabado ?? null) : null),
    [sync?.reporte_inicio, sync?.reporte_ultimo, sync?.reporte_sabado, hoy],
  );

  const limpiar = useCallback(() => {
    temporizadores.current.forEach((t) => window.clearTimeout(t));
    temporizadores.current = [];
  }, []);
  const tras = useCallback((ms: number, fn: () => void) => {
    temporizadores.current.push(window.setTimeout(fn, ms));
  }, []);

  // El dia cambia solo (y al volver a la pestana). Sale de la hora del servidor: un reloj atrasado dejaría el día real fuera del reporte.
  useEffect(() => {
    const revisar = () => void ahoraServidor().then((ms) => setHoy(hoyLima(ms)));
    revisar();
    const id = window.setInterval(revisar, 60_000);
    document.addEventListener("visibilitychange", revisar);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", revisar);
    };
  }, []);

  // Sale sola: verde = pildora corta; amarillo/rojo = se abre unos segundos y se recoge.
  useEffect(() => {
    if (!estado || estado.fase === "hecho") return;
    const toca = () => {
      if (document.visibilityState !== "visible" || manual.current || modoRef.current !== "cerrada") return;
      const g = leerGuardado();
      const yaHoy = g?.dia === hoy;
      const repetir = estado.semaforo === "rojo" && !!g && Date.now() - g.ts > CADA_HORAS_ROJO * 3_600_000;
      if (yaHoy && !repetir) return;
      limpiar();
      // Se anota como "mostrado hoy" recien cuando sale (asi un remontaje no lo cancela).
      if (estado.semaforo === "verde") {
        tras(1600, () => {
          guardar(hoy);
          setModo("pildora");
        });
        tras(1600 + 4500, () => setModo("cerrada"));
        return;
      }
      const lectura = estado.semaforo === "rojo" ? 10000 : 7000;
      tras(1600, () => {
        guardar(hoy);
        setModo("abierta");
      });
      tras(1600 + lectura, () => setModo("cerrada"));
    };
    toca();
    const id = window.setInterval(toca, 60_000);
    document.addEventListener("visibilitychange", toca);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", toca);
    };
  }, [estado, hoy, limpiar, tras]);

  useEffect(() => limpiar, [limpiar]);

  useLayoutEffect(() => {
    if (modo === "cerrada") return;
    setUnido(true);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [modo, medir]);

  // Al recogerse se mantiene la isla montada hasta que termina de volver a la campana.
  useEffect(() => {
    if (modo !== "cerrada") return;
    const t = window.setTimeout(() => setUnido(false), 650);
    return () => window.clearTimeout(t);
  }, [modo]);

  const cerrar = useCallback(() => {
    manual.current = true;
    limpiar();
    setModo("cerrada");
  }, [limpiar]);

  const alternar = useCallback(() => {
    manual.current = true;
    limpiar();
    const abrir = modoRef.current !== "abierta";
    if (abrir && window.scrollY > 4) window.scrollTo({ top: 0, behavior: "smooth" });
    setModo(abrir ? "abierta" : "cerrada");
  }, [limpiar]);

  useEffect(() => {
    if (modo !== "abierta") return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [modo, cerrar]);

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
    manual.current = true;
    limpiar();
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
      setFaltaMarcar(estado.fase !== "hecho");
      const aviso = `Se descargó, pero ${faltaron} de ${total} fotos no cargaron. Descárgalo otra vez${estado.fase !== "hecho" ? " o toca «Marcar como hecho» si te sirve así" : ""}.`;
      setFotosFaltantes(aviso);
      avisar(aviso, true);
      setTrabajando(null);
      return;
    }
    try {
      if (estado.fase !== "hecho") await marcar(estado);
      avisar(estado.fase !== "hecho" ? "Reporte semanal descargado. Quedó marcado como hecho." : "Reporte semanal descargado.");
      setModo("cerrada");
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
    manual.current = true;
    limpiar();
    setTrabajando("marcar");
    try {
      await marcar(estado);
      avisar("El reporte quedó marcado como hecho.");
      setModo("cerrada");
    } catch (e) {
      console.error(e);
      avisar("No se pudo marcar. Revisa tu conexión.", true);
    } finally {
      setTrabajando(null);
    }
  }

  return { estado, hoy, modo, unido, empuje, setEmpuje, empujeMovil, setEmpujeMovil, trabajando, faltaMarcar, fotosFaltantes, sync, geo, campanaRef, alternar, cerrar, descargar, marcarHecho };
}

export type Reporte = ReturnType<typeof useReporte>;

const letras = ["D", "L", "M", "M", "J", "V", "S"];

/** Entrada y salida del contenido de la isla: aparece con desenfoque y escala, como la isla de iOS. */
const contenidoAnim = {
  initial: { opacity: 0, scale: 0.94, filter: "blur(10px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)", transition: { delay: 0.1, duration: 0.28 } },
  exit: { opacity: 0, scale: 0.96, filter: "blur(10px)", transition: { duration: 0.14 } },
};

/**
 * La campana de la cabecera (junto al boton PDF) lleva la isla dentro: al abrirse, la isla sale de la campana
 * y se expande hacia abajo con un solo resorte (como la isla dinamica del iPhone). Es un unico elemento negro
 * que cambia de tamano; el contenido entra con desenfoque.
 */
export function CampanaReporte({ r }: { r: Reporte }) {
  const { estado, geo, unido, modo } = r;
  const [alto, setAlto] = useState(290);
  const tx = estado ? textos(estado) : null;
  const abierta = modo === "abierta";
  const pildora = modo === "pildora";
  const ancho = pildora ? Math.min(geo.ancho, 300) : geo.ancho;
  const altoObjetivo = abierta ? alto : 44;

  // Empuja el contenido de la pagina lo justo para que la isla no lo tape (misma fisica que la isla).
  useLayoutEffect(() => {
    if (modo === "cerrada") return;
    const campana = r.campanaRef.current;
    const b = campana?.getBoundingClientRect();
    if (!campana || !b) return;
    const fondoIsla = b.top + LADO_CAMPANA + SEPARACION + altoObjetivo;
    const movil = !window.matchMedia("(min-width: 640px)").matches;
    if (movil) {
      // Celular: la campana va junto al titulo; se baja el resto de la cabecera (los botones) para no taparlos.
      const fila = campana.closest("[data-fila-titulo]")?.getBoundingClientRect();
      if (!fila) return;
      r.setEmpujeMovil(Math.max(0, Math.round(fondoIsla - fila.bottom)));
      r.setEmpuje(0);
    } else {
      // Pantalla grande: la isla cuelga bajo la cabecera y se baja el contenido de la pagina.
      const cabecera = campana.closest("header")?.getBoundingClientRect();
      if (!cabecera) return;
      r.setEmpuje(Math.max(0, Math.round(fondoIsla - cabecera.bottom)) + 14);
      r.setEmpujeMovil(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, altoObjetivo, geo.ancho, geo.derecha]);

  if (!estado || !tx) return null;
  const tono = TONO[estado.semaforo];
  const hecho = estado.fase === "hecho";
  const semana = Array.from({ length: 7 }, (_, i) => sumarDias(estado.sabado, i - 6));
  const brillo = `radial-gradient(90% 70% at ${geo.derecha ? "0% 100%" : "100% 100%"}, rgba(${tono.brillo},0.20), transparent 62%), ${INK}`;

  return (
    <span ref={r.campanaRef} className="relative block">
      {/* La isla: un solo elemento que nace bajo la campana y se agranda (ancho, alto y redondeo con el mismo resorte) */}
      <AnimatePresence>
        {unido && modo !== "cerrada" && (
          <motion.div
            key="isla"
            initial={{ width: LADO_CAMPANA, height: LADO_CAMPANA, top: 0, borderRadius: 12 }}
            animate={{ width: ancho, height: altoObjetivo, top: LADO_CAMPANA + SEPARACION, borderRadius: abierta ? 28 : 22 }}
            exit={{ width: LADO_CAMPANA, height: LADO_CAMPANA, top: 0, borderRadius: 12, transition: { ...RESORTE, damping: 36 } }}
            transition={RESORTE}
            className="absolute z-20 overflow-hidden text-white shadow-[0_22px_44px_-14px_rgba(14,15,17,0.55)]"
            style={{ [geo.derecha ? "right" : "left"]: 0, background: brillo, willChange: "width, height, top" }}
            role="status"
            aria-live="polite"
            data-testid="aviso-reporte"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {abierta ? (
                <motion.div
                  key="completa"
                  {...contenidoAnim}
                  ref={(el: HTMLDivElement | null) => {
                    if (el && el.offsetHeight) setAlto(el.offsetHeight);
                  }}
                  className="absolute left-0 top-0 w-full px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5 sm:pt-4"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={cn("size-2.5 shrink-0 rounded-full", tono.punto)} />
                    <p className="min-w-0 flex-1 text-left text-[14.5px] font-semibold leading-tight sm:text-[15.5px]">{tx.titulo}</p>
                    <button
                      type="button"
                      onClick={r.cerrar}
                      aria-label="Cerrar"
                      className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-white/75 sm:text-[13px]">{r.fotosFaltantes ?? tx.detalle}</p>

                  {/* La semana hasta el sabado */}
                  <div className="mt-3.5 flex items-end justify-between gap-1 sm:mt-4" aria-hidden>
                    {semana.map((d, i) => {
                      const pasado = d < r.hoy || estado.fase === "atrasado";
                      const esHoy = d === r.hoy;
                      const sab = i === 6;
                      return (
                        <div key={d} className="flex flex-1 flex-col items-center gap-1.5">
                          <motion.span
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: 0.2 + i * 0.04, type: "spring", stiffness: 380, damping: 26 }}
                            className={cn(
                              "grid size-7 place-items-center rounded-full text-[10.5px] font-bold sm:size-8 sm:text-[11.5px]",
                              sab ? cn(tono.relleno, "text-white") : pasado || esHoy ? "bg-white/25 text-white" : "bg-white/10 text-white/40",
                              esHoy && "ring-2 ring-white",
                            )}
                          >
                            {letras[i]}
                          </motion.span>
                          <span className={cn("text-[9.5px] sm:text-[10.5px]", esHoy ? "font-bold text-white" : "text-white/40")}>{esHoy ? "hoy" : fechaCorta(d).split(" ")[0]}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex flex-col gap-2 sm:mt-5">
                    <button
                      type="button"
                      onClick={r.descargar}
                      disabled={r.trabajando !== null}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-[13.5px] font-semibold text-ink transition hover:bg-white/90 active:scale-[0.98] disabled:opacity-60"
                    >
                      {r.trabajando === "bajar" ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
                      {r.trabajando === "bajar" ? "Preparando el reporte…" : hecho ? "Descargar reporte de nuevo" : "Descargar reporte semanal"}
                    </button>
                    <div className="flex gap-2">
                      {/* Solo se marca a mano un reporte que se descargó y no quedó anotado o al que le faltan fotos. */}
                      {r.faltaMarcar && (
                        <button
                          type="button"
                          onClick={r.marcarHecho}
                          disabled={r.trabajando !== null}
                          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-[12.5px] font-semibold transition hover:bg-white/15 active:scale-[0.98] disabled:opacity-60"
                        >
                          {r.trabajando === "marcar" && <Loader2 className="size-3.5 animate-spin" />} Marcar como hecho
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={r.cerrar}
                        className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-white/10 text-[12.5px] font-semibold transition hover:bg-white/15 active:scale-[0.98]"
                      >
                        Más tarde
                      </button>
                    </div>
                    {hecho && r.sync?.reporte_ultimo && (
                      <p className="text-center text-[11px] text-white/60">
                        Último reporte: {fechaCorta(r.sync.reporte_ultimo)}
                        {r.sync.reporte_por ? ` · ${r.sync.reporte_por}` : ""}
                      </p>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.button
                  key="pildora"
                  {...contenidoAnim}
                  type="button"
                  onClick={r.alternar}
                  aria-label={`Reporte semanal: ${tx.corto}. Toca para ver.`}
                  className="absolute left-0 top-0 flex h-11 w-full items-center gap-2.5 px-4 text-left"
                >
                  <span className={cn("size-2.5 shrink-0 rounded-full", tono.punto)} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">Reporte semanal</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", tono.chip)}>{tx.corto}</span>
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* La campana va encima de la isla: al abrirse se vuelve negra y la isla parece crecer desde ella */}
      <button
        type="button"
        onClick={r.alternar}
        aria-expanded={abierta}
        aria-label={`Recordatorio del reporte semanal: ${tx.titulo}`}
        title={tx.titulo}
        className={cn(
          "relative z-30 grid size-10 place-items-center rounded-xl transition-[background-color,color,transform] duration-300 active:scale-95",
          modo !== "cerrada" ? "bg-ink text-white" : tono.campana,
        )}
      >
        <motion.span key={modo} animate={modo === "cerrada" ? undefined : { rotate: [0, -16, 13, -8, 4, 0] }} transition={{ duration: 0.7, delay: 0.1 }} className="grid place-items-center">
          <Bell className="size-[18px]" />
        </motion.span>
        {(modo !== "cerrada" || (estado.semaforo !== "verde" && !hecho) || r.faltaMarcar) && (
          <span className="absolute right-1.5 top-1.5 grid size-2.5 place-items-center">
            {estado.semaforo === "rojo" && modo === "cerrada" && (
              <motion.span
                className={cn("absolute inline-flex size-full rounded-full", tono.punto)}
                animate={{ scale: [1, 2.4], opacity: [0.55, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
              />
            )}
            <span className={cn("relative size-2 rounded-full ring-2 transition-colors", modo !== "cerrada" ? "ring-ink" : "ring-surface", tono.punto)} />
          </span>
        )}
      </button>
    </span>
  );
}

/** Espacio en el flujo de la pagina: baja el contenido mientras la isla esta abierta y lo sube al recogerse. */
export function EspacioReporte({ r }: { r: Reporte }) {
  return <motion.div aria-hidden className="no-print" initial={false} animate={{ height: r.modo === "cerrada" ? 0 : r.empuje }} transition={RESORTE} />;
}
