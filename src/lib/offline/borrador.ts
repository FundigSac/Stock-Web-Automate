import type { FotoCapturada } from "../foto";
import { abrirAlmacen, borrarMeta, claveBorrador, guardarMeta, leerMeta } from "./almacen";
import { esQuota } from "./respaldo";

// La cámara del celular puede cerrar la página: lo que ya se llenó no debe depender de la memoria de la pestaña.
export type Borrador = {
  /** Identifica el formulario del que salió: al guardar ese formulario se borra este borrador y ningún otro. */
  id?: string;
  dueno: string | null;
  guardadoEn: number;
  tipo: "entrada" | "salida";
  sel: { clave: string | null; cants: Record<string, string> };
  quien: string;
  esCliente: boolean;
  nota: string;
  fechaElegida: string | null;
  /** null: todavía no hay foto, por ejemplo mientras la cámara está abierta. */
  foto: FotoCapturada | null;
  /** La foto ya se usó en otro registro de esta misma entrega ("Guardar y registrar otro"). */
  continuacion?: boolean;
};

export type ResultadoBorrador = "ok" | "sin_espacio" | "error";

/** Antes había una sola ranura para todo el dispositivo. */
const CLAVE_ANTIGUA = "borrador_registrar";

export async function guardarBorrador(b: Borrador): Promise<ResultadoBorrador> {
  try {
    await guardarMeta(claveBorrador(b.dueno), b);
    return "ok";
  } catch (e) {
    console.error("[respaldo] borrador", e);
    return esQuota(e) ? "sin_espacio" : "error";
  }
}

async function fotoYaEnCola(fotoId: string): Promise<boolean> {
  const registros = await (await abrirAlmacen()).getAll("respaldo");
  return registros.some((r) => r.fotoRuta?.endsWith(`/${fotoId}.jpg`));
}

async function leerDeRanura(dueno: string | null): Promise<Borrador | undefined> {
  const propio = await leerMeta<Borrador>(claveBorrador(dueno));
  if (propio) return propio;
  const antiguo = await leerMeta<Borrador>(CLAVE_ANTIGUA);
  if (!antiguo || (antiguo.dueno ?? null) !== dueno) return undefined;
  await guardarMeta(claveBorrador(dueno), antiguo);
  await borrarMeta(CLAVE_ANTIGUA);
  return antiguo;
}

export async function leerBorrador(dueno: string | null): Promise<Borrador | null> {
  try {
    const b = await leerDeRanura(dueno);
    if (!b) return null;
    // Si su foto ya está en la cola, ese registro se guardó: ofrecerlo otra vez crearía una salida duplicada.
    if (b.foto && !b.continuacion && (await fotoYaEnCola(b.foto.id))) {
      await borrarMeta(claveBorrador(dueno));
      return null;
    }
    return b;
  } catch {
    return null;
  }
}

export async function borrarBorrador(dueno: string | null): Promise<void> {
  try {
    await borrarMeta(claveBorrador(dueno));
  } catch (e) {
    console.error("[respaldo] borrador", e);
  }
}
