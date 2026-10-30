import { sumarDias } from "./format";

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

/**
 * Reporte semanal: cada sabado, empezando por el primer sabado desde `inicio`.
 * Semaforo: verde si faltan 4 dias o mas, amarillo a 2-3 dias (miercoles y jueves), rojo desde el viernes y si ya se paso.
 * Un reporte sacado desde 3 dias antes del sabado cuenta para ese sabado.
 */
export function estadoReporte(inicio: string, ultimo: string | null, hoy: string): EstadoReporte {
  const primera = sabadoDesde(inicio);
  const cumple = (sabado: string) => !!ultimo && ultimo >= sumarDias(sabado, -3);
  const siguiente = sabadoDesde(hoy < primera ? primera : hoy);
  const previo = sumarDias(siguiente, -7);

  // El primer reporte cubre la ultima semana; los siguientes, desde el dia despues del anterior.
  let desde = ultimo ? sumarDias(ultimo, 1) : sumarDias(hoy, -6);
  const tope = sumarDias(hoy, -30);
  if (desde < tope) desde = tope;

  if (previo >= primera && hoy > previo && !cumple(previo)) {
    return { fase: "atrasado", semaforo: "rojo", fecha: previo, dias: diasEntre(hoy, previo), desde, sabado: previo };
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
