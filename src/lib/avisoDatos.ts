import { fechaCorta } from "./format";
import { fechaLima, horaLima } from "./tiempo";

/**
 * Cuándo se guardaron los datos que se ven: "a las 14:05" si son de hoy, "el 7 nov a las 14:05" si no.
 * La hora es la de Lima, como el resto de la app.
 */
export function cuandoSeGuardo(guardadoEn: number | null, ahora: number): string | null {
  if (guardadoEn === null) return null;
  const hora = horaLima(guardadoEn);
  return fechaLima(guardadoEn) === fechaLima(ahora) ? `a las ${hora}` : `el ${fechaCorta(fechaLima(guardadoEn))} a las ${hora}`;
}

const registros = (n: number) => `${n} ${n === 1 ? "registro" : "registros"}`;

/**
 * X10-4 OfflineBanner: la frase del aviso de datos. Sin señal se dice de cuándo son los datos guardados;
 * nunca "no hay datos" mientras haya una copia que mostrar.
 */
export function textoAvisoDatos(e: { enLinea: boolean; sinSubir: number; provisionales: number; guardadoEn: number | null; ahora: number }): string | null {
  const cuando = cuandoSeGuardo(e.guardadoEn, e.ahora);
  if (!e.enLinea) {
    const base = cuando ? `Sin conexión — mostrando datos guardados ${cuando}.` : "Sin conexión — mostrando los datos guardados en este dispositivo.";
    return e.sinSubir > 0 ? `${base} Falta subir ${registros(e.sinSubir)}: las cifras son provisionales.` : base;
  }
  if (e.sinSubir > 0) return `Cifras provisionales: falta subir ${registros(e.sinSubir)}.`;
  if (e.provisionales > 0) return `Cifras provisionales: ${registros(e.provisionales)} ya en el servidor, pero todavía no en los datos de este dispositivo.`;
  return null;
}

/** El servidor respondió con error pero hay copia: se dice que lo que se ve es lo guardado, y de cuándo es. */
export function textoFalloServidor(guardadoEn: number | null, ahora: number): string {
  const cuando = cuandoSeGuardo(guardadoEn, ahora);
  return `El servidor no entregó los datos. ${cuando ? `Mostrando datos guardados ${cuando}` : "Mostrando lo último que llegó"}; se reintentará solo.`;
}
