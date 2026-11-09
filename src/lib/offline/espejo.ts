import type { Datos } from "../types";
import { abrirAlmacen, guardarMeta, type CampoEspejo } from "./almacen";

export async function leerEspejo(): Promise<{ datos: Partial<Datos>; guardadoEn: number | null }> {
  const filas = await (await abrirAlmacen()).getAll("espejo");
  const datos: Partial<Datos> = {};
  let guardadoEn: number | null = null;
  for (const f of filas) {
    (datos as Record<string, unknown>)[f.campo] = f.filas;
    if (guardadoEn === null || f.guardadoEn > guardadoEn) guardadoEn = f.guardadoEn;
  }
  return { datos, guardadoEn };
}

/** Deja constancia de que hubo una lectura completa del servidor. */
export async function marcarCopiaCompleta(): Promise<void> {
  try {
    await guardarMeta("espejo_completo", Date.now());
  } catch (e) {
    console.error("[respaldo] copia local", e);
  }
}

/** Si no se puede guardar la copia, la app sigue funcionando con conexión: solo se anota. */
export async function guardarEspejo(campo: CampoEspejo, filas: unknown): Promise<void> {
  try {
    await (await abrirAlmacen()).put("espejo", { campo, filas, guardadoEn: Date.now() });
  } catch (e) {
    console.error("[respaldo] copia local", e);
  }
}
