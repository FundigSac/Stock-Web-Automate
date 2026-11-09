// La hora del negocio es la de Lima. Perú no cambia de hora en el año: siempre es UTC-5.
const LIMA_MS = 5 * 3_600_000;
export const OFFSET_LIMA = "-05:00";

const dos = (n: number) => String(n).padStart(2, "0");

/** Instante en ISO 8601 con el desfase de Lima: "2026-11-09T09:30:00.000-05:00". */
export function isoLima(ms: number): string {
  return new Date(ms - LIMA_MS).toISOString().replace("Z", OFFSET_LIMA);
}

type Partes = { anio: number; mes: number; dia: number; hora: number; minuto: number };

export function partesLima(valor: number | string): Partes {
  const ms = typeof valor === "number" ? valor : Date.parse(valor);
  const d = new Date(ms - LIMA_MS);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), hora: d.getUTCHours(), minuto: d.getUTCMinutes() };
}

/** Fecha de hoy en Lima, sin importar la zona horaria del dispositivo: "2026-11-09". */
export function hoyLima(ahora = Date.now()): string {
  const p = partesLima(ahora);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** Día en Lima de un instante: "2026-11-08". Es el día que le corresponde a una foto. */
export function fechaLima(valor: number | string): string {
  return hoyLima(typeof valor === "number" ? valor : Date.parse(valor));
}

/**
 * Fecha del movimiento al guardar. Lo que la persona eligió manda; si no eligió, vale el día de la foto,
 * y sin foto el día en que se guarda (no el día en que se abrió el formulario).
 */
export function fechaDelRegistro(o: { capturadoEn?: string | null; elegida?: string | null; ahora?: number }): string {
  if (o.elegida) return o.elegida;
  return o.capturadoEn ? fechaLima(o.capturadoEn) : hoyLima(o.ahora);
}

/** Días que puede llevar una foto antes de pedir confirmación: hoy, ayer y anteayer pasan sin aviso. */
export const DIAS_FOTO_RECIENTE = 2;

/** Días entre el día en Lima de la foto y el de `referencia`. Negativo si la foto es posterior. */
export function diasDeFoto(capturadoEn: string, referencia: number | string): number {
  return Math.round((Date.parse(`${fechaLima(referencia)}T00:00:00Z`) - Date.parse(`${fechaLima(capturadoEn)}T00:00:00Z`)) / 86_400_000);
}

/** La foto es de hace varios días respecto a cuando se registra. */
export function fotoAntigua(capturadoEn: string, referencia: number | string): boolean {
  return diasDeFoto(capturadoEn, referencia) > DIAS_FOTO_RECIENTE;
}

/** "09/11/2026" y "09:30", separados, para el sello de la foto. */
export function selloLima(valor: number | string): { fecha: string; hora: string } {
  const p = partesLima(valor);
  return { fecha: `${dos(p.dia)}/${dos(p.mes)}/${p.anio}`, hora: `${dos(p.hora)}:${dos(p.minuto)}` };
}

export function horaLima(valor: number | string): string {
  return selloLima(valor).hora;
}

/** "2026-11" del instante dado, en Lima. Es la carpeta del mes en el almacén de fotos. */
export function mesLima(valor: number | string): string {
  const p = partesLima(valor);
  return `${p.anio}-${dos(p.mes)}`;
}
