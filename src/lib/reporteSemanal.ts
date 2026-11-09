import { sumarDias } from "./format";
import type { Datos, Movimiento, SyncState } from "./types";

/** Dia de la semana de una fecha ISO (0 = domingo ... 6 = sabado). */
const diaSemana = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Dias entre dos fechas ISO (b - a). */
export const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** El sabado de esa fecha o el siguiente. */
export const sabadoDesde = (iso: string) => sumarDias(iso, (6 - diaSemana(iso) + 7) % 7);

export type Semaforo = "verde" | "amarillo" | "rojo";

export type EstadoReporte = {
  /** espera: aun falta mucho; pendiente: se acerca; hoy: es sabado; atrasado: se paso el sabado; hecho: ya se saco esta semana. */
  fase: "espera" | "pendiente" | "hoy" | "atrasado" | "hecho";
  semaforo: Semaforo;
  /** Sabado al que se refiere (el que toca, el que se paso o el proximo si ya esta hecho). */
  fecha: string;
  /** Dias que faltan para `fecha` (negativo = dias de atraso). */
  dias: number;
  /** Desde cuando cuenta el reporte (dia despues del ultimo, o el inicio). */
  desde: string;
  /** Ultimo sabado del ciclo actual, para dibujar la semana. */
  sabado: string;
};

/** Instante desde el que una fila que sube cuenta como llegada tarde: el del último reporte. */
export function inicioLlegadasTarde(s: Pick<SyncState, "reporte_ultimo" | "reporte_ultimo_en"> | null | undefined): string | null {
  if (s?.reporte_ultimo_en) return s.reporte_ultimo_en;
  // Sin el instante solo se sabe el día: lo subido ese mismo día pudo salir en aquel reporte, así que no se da por tardío.
  return s?.reporte_ultimo ? `${s.reporte_ultimo}T23:59:59.999-05:00` : null;
}

/**
 * Hasta qué instante llegan los datos que se van a imprimir: la última subida que el servidor ya había recibido.
 * Es hora del servidor y sale de las mismas filas del PDF, así que lo que suba después siempre queda por detrás del corte.
 */
export function corteDeDatos(d: Pick<Datos, "entradas" | "salidas">): string | null {
  let corte: string | null = null;
  for (const f of [...d.entradas, ...d.salidas]) {
    if (f.subido_en && (corte === null || Date.parse(f.subido_en) > Date.parse(corte))) corte = f.subido_en;
  }
  return corte;
}

/** Filas con fecha anterior al periodo que llegaron al servidor después del último reporte: no salieron en ninguno. */
export function movimientosTardios(movs: Movimiento[], desde: string | null, tardeDesde: string | null | undefined): Movimiento[] {
  const limite = tardeDesde ? Date.parse(tardeDesde) : Number.NaN;
  if (!desde || Number.isNaN(limite)) return [];
  return movs.filter((m) => !m.anulado && m.fecha < desde && !!m.subido && Date.parse(m.subido) > limite);
}

/** El sabado que queda cubierto al sacar el reporte hoy: el atrasado o, si estamos a 3 dias o menos, el que viene. */
export function sabadoCubierto(e: EstadoReporte): string {
  if (e.fase === "atrasado") return e.sabado;
  return e.dias <= 3 ? e.fecha : sumarDias(e.fecha, -7);
}

/**
 * Reporte semanal: cada sabado, empezando por el primer sabado desde `inicio`.
 * Semaforo: verde si faltan 4 dias o mas, amarillo a 2-3 dias (miercoles y jueves), rojo desde el viernes y si ya se paso.
 * Un reporte sacado desde 3 dias antes del sabado cuenta para ese sabado.
 * `cubierto` es el ultimo sabado ya reportado (reporte_sabado). Sin ese dato solo se conoce la fecha del ultimo reporte,
 * y un reporte tardio del jueves cuenta tambien para el sabado que viene.
 */
export function estadoReporte(inicio: string, ultimo: string | null, hoy: string, cubierto: string | null = null): EstadoReporte {
  const primera = sabadoDesde(inicio);
  const cumple = (sabado: string) => (cubierto ? sabado <= cubierto : !!ultimo && ultimo >= sumarDias(sabado, -3));
  const siguiente = sabadoDesde(hoy < primera ? primera : hoy);
  const previo = sumarDias(siguiente, -7);

  // El primer reporte cubre la ultima semana; los siguientes, desde el dia despues del anterior.
  let desde = ultimo ? sumarDias(ultimo, 1) : sumarDias(hoy, -6);
  // Si el ultimo reporte fue hoy, "desde" caeria en manana y el periodo quedaria al reves.
  if (desde > hoy) desde = sumarDias(hoy, -6);

  if (previo >= primera && hoy > previo && !cumple(previo)) {
    // Varias semanas sin reporte: el atraso se cuenta desde la primera que falto.
    let primeraFalta = previo;
    while (sumarDias(primeraFalta, -7) >= primera && !cumple(sumarDias(primeraFalta, -7))) primeraFalta = sumarDias(primeraFalta, -7);
    // Si nunca hubo reporte, este cierra todas las semanas atrasadas: tiene que cubrirlas desde el inicio.
    return { fase: "atrasado", semaforo: "rojo", fecha: primeraFalta, dias: diasEntre(hoy, primeraFalta), desde: ultimo ? desde : inicio, sabado: previo };
  }
  if (cumple(siguiente)) {
    const proximo = sumarDias(siguiente, 7);
    // "Descargar de nuevo": el periodo es la ultima semana (si no, empezaria despues de hoy y quedaria al reves).
    return { fase: "hecho", semaforo: "verde", fecha: proximo, dias: diasEntre(hoy, proximo), desde: sumarDias(hoy, -6), sabado: siguiente };
  }
  const dias = diasEntre(hoy, siguiente);
  const semaforo: Semaforo = dias >= 4 ? "verde" : dias >= 2 ? "amarillo" : "rojo";
  return { fase: dias === 0 ? "hoy" : hoy < primera ? "espera" : "pendiente", semaforo, fecha: siguiente, dias, desde, sabado: siguiente };
}
