import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { Datos, Entrada, Pedido, Salida, StockItem, SyncState, Trabajador } from "./types";

type Campo = "stock" | "entradas" | "salidas" | "trabajadores" | "pedidos";

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

async function traerTodo<T>(fuente: string, orden: string): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase
      .from(fuente)
      .select("*")
      .order(orden, { ascending: true })
      .range(desde, desde + 999);
    if (error) throw new Error(`${fuente}: ${error.message}`);
    filas.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

const VACIO: Datos = { stock: [], entradas: [], salidas: [], trabajadores: [], pedidos: [], sync: null };

/**
 * Carga los datos, escucha los cambios en tiempo real y, como respaldo, vuelve a leer cada 20 s.
 * `cambioAt` cambia cuando llegan datos distintos a los que ya se tenian (no en la carga inicial).
 */
export function useLiveData(activo: boolean) {
  const [datos, setDatos] = useState<Datos>(VACIO);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cambioAt, setCambioAt] = useState<number | null>(null);
  const [ultimaCarga, setUltimaCarga] = useState<number | null>(null);
  const [tiempoReal, setTiempoReal] = useState(false);
  const previo = useRef<Record<string, string>>({});
  const primera = useRef(true);
  const temporizador = useRef<number | undefined>(undefined);
  const pendientes = useRef<Set<Campo>>(new Set());

  const cargarCampo = useCallback(async (campo: Campo): Promise<boolean> => {
    const def = LECTURAS.find((l) => l.campo === campo)!;
    const filas = await traerTodo<StockItem | Entrada | Salida | Trabajador | Pedido>(def.fuente, def.orden);
    const huella = JSON.stringify(filas);
    const cambio = previo.current[campo] !== undefined && previo.current[campo] !== huella;
    previo.current[campo] = huella;
    setDatos((d) => ({ ...d, [campo]: filas }));
    return cambio;
  }, []);

  const cargarAjustes = useCallback(async () => {
    const { data, error: e } = await supabase.from("ajustes").select("stock_minimo, registro_abierto, reporte_inicio, reporte_ultimo, reporte_por").eq("id", 1).maybeSingle();
    if (e) throw new Error(`ajustes: ${e.message}`);
    setDatos((d) => ({ ...d, sync: (data as SyncState | null) ?? null }));
  }, []);

  const cargar = useCallback(
    async (campos: Campo[], conAjustes = false) => {
      try {
        const cambios = await Promise.all([...campos.map(cargarCampo), conAjustes ? cargarAjustes().then(() => false) : Promise.resolve(false)]);
        setError(null);
        setUltimaCarga(Date.now());
        if (!primera.current && cambios.some(Boolean)) setCambioAt(Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        primera.current = false;
        setCargando(false);
      }
    },
    [cargarCampo, cargarAjustes],
  );

  useEffect(() => {
    if (!activo) return;
    const todos = LECTURAS.map((l) => l.campo);
    cargar(todos, true);

    // Tiempo real: en cuanto alguien registra algo, vuelve a leer lo afectado.
    const programar = (campos: Campo[]) => {
      campos.forEach((c) => pendientes.current.add(c));
      window.clearTimeout(temporizador.current);
      temporizador.current = window.setTimeout(() => {
        const lote = Array.from(pendientes.current);
        pendientes.current.clear();
        cargar(lote);
      }, 300);
    };
    let canal = supabase.channel("stock-en-vivo");
    for (const tabla of Object.keys(DEPENDEN)) {
      canal = canal.on("postgres_changes", { event: "*", schema: "public", table: tabla }, () => programar(DEPENDEN[tabla]));
    }
    canal.subscribe((estado) => setTiempoReal(estado === "SUBSCRIBED"));

    // Respaldo por si se pierde algun aviso (cada 20 s) y al volver a la pestana.
    const respaldo = window.setInterval(() => cargar(todos), 20_000);
    const alVolver = () => {
      if (document.visibilityState === "visible") cargar(todos, true);
    };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      window.clearInterval(respaldo);
      window.clearTimeout(temporizador.current);
      document.removeEventListener("visibilitychange", alVolver);
      supabase.removeChannel(canal);
    };
  }, [activo, cargar]);

  return { datos, cargando, error, cambioAt, ultimaCarga, tiempoReal, recargar: () => cargar(LECTURAS.map((l) => l.campo), true) };
}
