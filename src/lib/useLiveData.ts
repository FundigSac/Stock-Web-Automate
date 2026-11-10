import { useCallback, useEffect, useRef, useState } from "react";
import { faltaMigracion } from "./errores";
import { esErrorDeRed, marcarFalloRed, marcarRedOk } from "./offline/conexion";
import { guardarEspejo, leerEspejo, marcarCopiaCompleta } from "./offline/espejo";
import { senalConLimite } from "./senal";
import { supabase } from "./supabase";
import type { Datos, Entrada, Pedido, Salida, StockItem, SyncState, Trabajador } from "./types";

export type Campo = "stock" | "entradas" | "salidas" | "trabajadores" | "pedidos";

// Lo que se lee: vistas (stock, trabajadores) y tablas (entradas, salidas).
const LECTURAS: { fuente: string; campo: Campo; orden: string }[] = [
  { fuente: "stock_items", campo: "stock", orden: "codigo" },
  { fuente: "entradas", campo: "entradas", orden: "id" },
  { fuente: "salidas", campo: "salidas", orden: "id" },
  { fuente: "trabajadores", campo: "trabajadores", orden: "trabajador" },
  { fuente: "pedidos", campo: "pedidos", orden: "id" },
];

// Realtime solo funciona con tablas: cada tabla que cambia vuelve a leer lo que depende de ella.
const DEPENDEN: Record<string, Campo[]> = {
  productos: ["stock"],
  entradas: ["entradas", "stock"],
  salidas: ["salidas", "stock", "trabajadores"],
  personal: ["trabajadores"],
  pedidos: ["pedidos"],
};

const POLL_SIN_TIEMPO_REAL_MS = 20_000;
const POLL_CON_TIEMPO_REAL_MS = 60_000;
/** Con señal débil una lectura puede no terminar nunca: pasado este tiempo cuenta como sin conexión. */
const LIMITE_LECTURA_MS = 15_000;

/** La copia solo sirve si trae lo necesario para trabajar: el stock, la gente y los ajustes. */
export function copiaUsable(d: Partial<Datos>): boolean {
  return Array.isArray(d.stock) && Array.isArray(d.trabajadores) && d.sync !== undefined && d.sync !== null;
}

/** Lo que falta en la copia. Una tabla que no alcanzó a bajar no es una tabla vacía, y la pantalla lo tiene que decir. */
export function camposFaltantes(d: Partial<Datos>): Campo[] {
  return LECTURAS.map((l) => l.campo).filter((c) => !Array.isArray(d[c]));
}

async function traerTodo<T>(fuente: string, orden: string): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase
      .from(fuente)
      .select("*")
      .order(orden, { ascending: true })
      .range(desde, desde + 999)
      .abortSignal(senalConLimite(LIMITE_LECTURA_MS));
    if (error) throw new Error(`${fuente}: ${error.message}`);
    filas.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

const VACIO: Datos = { stock: [], entradas: [], salidas: [], trabajadores: [], pedidos: [], sync: null };

/**
 * Muestra primero la copia guardada en el dispositivo y luego la pone al día con el servidor.
 * Sin conexión se queda con la copia. Con conexión escucha en tiempo real y, como respaldo, vuelve a leer cada cierto tiempo.
 * `cambioAt` cambia cuando llegan datos distintos a los que ya se tenian (no en la carga inicial).
 */
export function useLiveData(activo: boolean) {
  const [datos, setDatos] = useState<Datos>(VACIO);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cambioAt, setCambioAt] = useState<number | null>(null);
  const [ultimaCarga, setUltimaCarga] = useState<number | null>(null);
  const [tiempoReal, setTiempoReal] = useState(false);
  const [copiaLista, setCopiaLista] = useState(false);
  const [faltan, setFaltan] = useState<Campo[]>([]);
  const previo = useRef<Record<string, string>>({});
  const primera = useRef(true);
  const temporizador = useRef<number | undefined>(undefined);
  const pendientes = useRef<Set<Campo>>(new Set());
  const secuencia = useRef<Record<string, number>>({});
  const hayCopia = useRef(false);
  const enMemoria = useRef<Partial<Datos>>({});
  const leyendoTodo = useRef(false);
  const tiempoRealRef = useRef(false);
  const sinColumnaSabado = useRef(false);
  // Sin red, no se decide que "no hay copia" hasta terminar de buscarla.
  const lecturaCopia = useRef<Promise<void>>(Promise.resolve());

  const cargarCampo = useCallback(async (campo: Campo): Promise<boolean> => {
    const def = LECTURAS.find((l) => l.campo === campo)!;
    const turno = (secuencia.current[campo] ?? 0) + 1;
    secuencia.current[campo] = turno;
    const filas = await traerTodo<StockItem | Entrada | Salida | Trabajador | Pedido>(def.fuente, def.orden);
    // Llegó una lectura más nueva mientras esta viajaba: esta ya no vale.
    if (secuencia.current[campo] !== turno) return false;
    (enMemoria.current as Record<string, unknown>)[campo] = filas;
    setFaltan((f) => (f.includes(campo) ? f.filter((c) => c !== campo) : f));
    const huella = JSON.stringify(filas);
    if (previo.current[campo] === huella) return false;
    const cambio = previo.current[campo] !== undefined;
    previo.current[campo] = huella;
    setDatos((d) => ({ ...d, [campo]: filas }));
    void guardarEspejo(campo, filas);
    return cambio;
  }, []);

  const cargarAjustes = useCallback(async () => {
    const leer = (extra: string) => supabase.from("ajustes").select(`stock_minimo, registro_abierto, reporte_inicio, reporte_ultimo, reporte_por${extra}`).eq("id", 1).abortSignal(senalConLimite(LIMITE_LECTURA_MS)).maybeSingle();
    let r = await leer(sinColumnaSabado.current ? "" : ", reporte_sabado, reporte_ultimo_en");
    if (faltaMigracion(r.error?.code)) {
      sinColumnaSabado.current = true;
      r = await leer("");
    }
    if (r.error) throw new Error(`ajustes: ${r.error.message}`);
    const fila = (r.data as unknown as SyncState | null) ?? null;
    enMemoria.current.sync = fila;
    const huella = JSON.stringify(fila);
    if (previo.current.sync === huella) return;
    previo.current.sync = huella;
    setDatos((d) => ({ ...d, sync: fila }));
    void guardarEspejo("sync", fila);
  }, []);

  const cargar = useCallback(
    async (campos: Campo[], conAjustes = false): Promise<boolean> => {
      if (!navigator.onLine) {
        await lecturaCopia.current;
        primera.current = false;
        setError(hayCopia.current ? null : "sin-copia");
        setCargando(false);
        return false;
      }
      try {
        const cambios = await Promise.all([...campos.map(cargarCampo), conAjustes ? cargarAjustes().then(() => false) : Promise.resolve(false)]);
        const completa = campos.length === LECTURAS.length && conAjustes;
        if (copiaUsable(enMemoria.current)) hayCopia.current = true;
        if (completa && hayCopia.current) {
          setCopiaLista(true);
          void marcarCopiaCompleta();
        }
        // Una lectura parcial no prueba que lo que falló antes ya cargue.
        setError((e) => (e === "servidor" && !completa ? e : null));
        setUltimaCarga(Date.now());
        marcarRedOk();
        if (!primera.current && cambios.some(Boolean)) setCambioAt(Date.now());
        return true;
      } catch (e) {
        const mensaje = e instanceof Error ? e.message : String(e);
        if (esErrorDeRed(mensaje)) {
          marcarFalloRed();
          await lecturaCopia.current;
          setError(hayCopia.current ? null : "sin-copia");
        } else {
          console.error("[datos]", mensaje);
          setError("servidor");
        }
        // Lo que no llegó ni del servidor ni de la copia queda marcado: la pantalla no debe decir "no hay" de algo que no cargó.
        await lecturaCopia.current;
        setFaltan(camposFaltantes(enMemoria.current));
        return false;
      } finally {
        primera.current = false;
        setCargando(false);
      }
    },
    [cargarCampo, cargarAjustes],
  );

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    const todos = LECTURAS.map((l) => l.campo);

    // La copia se lee sin esperar a la red: así la app abre igual con o sin señal.
    lecturaCopia.current = leerEspejo()
      .then(({ datos: copia, guardadoEn }) => {
        if (!vivo || !copiaUsable(copia)) return;
        hayCopia.current = true;
        // Lo que ya haya llegado del servidor no se pisa con la copia.
        const sinLeer = Object.entries(copia).filter(([campo]) => previo.current[campo] === undefined);
        for (const [campo, filas] of sinLeer) {
          previo.current[campo] = JSON.stringify(filas);
          (enMemoria.current as Record<string, unknown>)[campo] = filas;
        }
        setDatos((d) => ({ ...d, ...Object.fromEntries(sinLeer) }));
        setFaltan(camposFaltantes(enMemoria.current));
        setUltimaCarga((u) => u ?? guardadoEn);
        setError((e) => (e === "sin-copia" ? null : e));
        setCargando(false);
      })
      .catch((e) => console.error("[respaldo] copia local", e));

    void cargar(todos, true);

    // Tiempo real: en cuanto alguien registra algo, vuelve a leer lo afectado.
    const programar = (campos: Campo[], conAjustes = false) => {
      campos.forEach((c) => pendientes.current.add(c));
      window.clearTimeout(temporizador.current);
      temporizador.current = window.setTimeout(() => {
        const lote = Array.from(pendientes.current);
        pendientes.current.clear();
        void cargar(lote, conAjustes);
      }, 300);
    };
    let canal = supabase.channel(`stock-en-vivo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    for (const tabla of Object.keys(DEPENDEN)) {
      canal = canal.on("postgres_changes", { event: "*", schema: "public", table: tabla }, () => programar(DEPENDEN[tabla]));
    }
    canal = canal.on("postgres_changes", { event: "*", schema: "public", table: "ajustes" }, () => void cargarAjustes().catch((e) => console.error("[datos] ajustes", e)));
    canal.subscribe((estado) => {
      tiempoRealRef.current = estado === "SUBSCRIBED";
      setTiempoReal(tiempoRealRef.current);
    });

    // Respaldo por si se pierde algun aviso: seguido si no hay tiempo real, y con calma si lo hay. Nunca en una pestana oculta.
    let ultimoPoll = Date.now();
    const respaldo = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !navigator.onLine || leyendoTodo.current) return;
      if (Date.now() - ultimoPoll < (tiempoRealRef.current ? POLL_CON_TIEMPO_REAL_MS : POLL_SIN_TIEMPO_REAL_MS)) return;
      ultimoPoll = Date.now();
      leyendoTodo.current = true;
      void cargar(todos, true).finally(() => {
        leyendoTodo.current = false;
      });
    }, 5_000);
    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      ultimoPoll = Date.now();
      void cargar(todos, true);
    };
    const alConectar = () => {
      marcarRedOk();
      ultimoPoll = Date.now();
      void cargar(todos, true);
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", alConectar);

    return () => {
      vivo = false;
      window.clearInterval(respaldo);
      window.clearTimeout(temporizador.current);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", alConectar);
      void supabase.removeChannel(canal);
    };
  }, [activo, cargar, cargarAjustes]);

  /** Vuelve a leer todo. Devuelve lo recién leído del servidor, o null si alguna lectura falló. */
  const recargar = useCallback(async (): Promise<Datos | null> => {
    const ok = await cargar(LECTURAS.map((l) => l.campo), true);
    return ok ? { ...VACIO, ...enMemoria.current } : null;
  }, [cargar]);

  return { datos, cargando, error, cambioAt, ultimaCarga, tiempoReal, recargar, copiaLista, faltan };
}
