import { exifAIso, leerExif } from "./exif";
import type { OrigenHora } from "./offline/almacen";
import { supabase } from "./supabase";
import { diasDeFoto, fotoAntigua, isoLima, selloLima } from "./tiempo";
import { nuevoUuid } from "./uuid";

const LADO_MAX = 1280;
/** Si el archivo de la cámara tiene una hora así de reciente, esa es la del disparo. */
const VENTANA_CAMARA_MS = 10 * 60_000;
const BYTES_EXIF = 256 * 1024;
/** Una foto de hace más de dos años no es de una entrega de hoy: es una cámara con la fecha reiniciada. */
const ANTIGUEDAD_MAX_MS = 730 * 86_400_000;
/** Margen para decidir que dos horas difieren en un número exacto de horas. */
const TOLERANCIA_HORA_MS = 90_000;

export type OrigenFoto = "camara" | "galeria";

/** La foto lista para guardar, con el instante en que se tomó. */
export type FotoCapturada = {
  /** UUID de la foto: de él sale su ruta en el almacén, así un reintento nunca crea otra copia. */
  id: string;
  blob: Blob;
  capturadoEn: string;
  origen: OrigenFoto;
  origenHora: OrigenHora;
  /** La fecha de la foto no se pudo creer del todo: hay que revisarla. */
  dudosa: boolean;
};

export type MomentoFoto = Pick<FotoCapturada, "capturadoEn" | "origenHora" | "dudosa">;

/** Si difieren en horas exactas, la foto se tomó con otra zona horaria en el teléfono. */
function difierenEnHorasExactas(a: number, b: number): boolean {
  const d = Math.abs(a - b);
  const horas = Math.round(d / 3_600_000);
  return horas >= 1 && horas <= 14 && Math.abs(d - horas * 3_600_000) <= TOLERANCIA_HORA_MS;
}

/**
 * Instante de la foto y de dónde salió.
 * Cámara: la hora del archivo si es reciente. En una computadora "Tomar foto" abre un selector de archivos común, así que
 * un archivo que no es de hace un momento se trata como uno de galería y nunca se certifica como tomado ahora.
 * Galería: la fecha guardada en la foto (EXIF) o la del archivo. Nunca la hora actual si se conoce otra.
 */
export async function detalleCaptura(archivo: File, origen: OrigenFoto, ahora: number): Promise<MomentoFoto> {
  const archivoMs = archivo.lastModified;
  if (origen === "camara") {
    const edad = ahora - archivoMs;
    if (edad >= 0 && edad <= VENTANA_CAMARA_MS) return { capturadoEn: isoLima(archivoMs), origenHora: "camara", dudosa: false };
  }
  const archivoValido = archivoMs > 0 && archivoMs <= ahora;
  // La fecha de un archivo de WhatsApp o una captura es la de la copia, no la de la foto.
  const delArchivo: MomentoFoto = archivoValido ? { capturadoEn: isoLima(archivoMs), origenHora: "archivo", dudosa: false } : { capturadoEn: isoLima(ahora), origenHora: "ahora", dudosa: false };
  const inicio = await archivo.slice(0, BYTES_EXIF).arrayBuffer().catch(() => null);
  const dato = inicio ? leerExif(inicio) : null;
  const iso = dato ? exifAIso(dato.fecha, dato.desfase) : null;
  if (!dato || !iso) return delArchivo;
  const ms = Date.parse(iso);
  if (ms > ahora || ahora - ms > ANTIGUEDAD_MAX_MS) return { ...delArchivo, dudosa: true };
  if (!dato.desfase && archivoValido && difierenEnHorasExactas(ms, archivoMs)) {
    // Un EXIF por delante del archivo es imposible salvo por la zona horaria. Si va detrás, lo normal es una copia hecha después.
    return archivoMs > ms ? { capturadoEn: iso, origenHora: "exif", dudosa: true } : { capturadoEn: isoLima(archivoMs), origenHora: "archivo", dudosa: true };
  }
  return { capturadoEn: iso, origenHora: "exif", dudosa: false };
}

/** Un archivo elegido con "Tomar foto" que no salió de la cámara en este momento es, en la práctica, de galería. */
export const origenReal = (origen: OrigenFoto, m: Pick<MomentoFoto, "origenHora">): OrigenFoto => (origen === "camara" && m.origenHora !== "camara" ? "galeria" : origen);

/** Lo que el sello de la foto dice junto a la fecha. La imagen circula fuera de la app y tiene que explicarse sola. */
export function textoSello(o: { origen?: OrigenFoto; origenHora?: OrigenHora; dudosa?: boolean }): string | null {
  if (o.dudosa) return "revisar";
  if (o.origenHora === "archivo") return "archivo";
  if (o.origenHora === "ahora") return "elegida";
  return o.origen === "galeria" ? "galería" : null;
}

/** Lo que el chat dice de la fecha de una foto antes de pedir la confirmación. */
export function avisoFechaFoto(f: MomentoFoto, ahora: number): string {
  const { fecha, hora } = selloLima(f.capturadoEn);
  const avisos = [f.origenHora === "ahora" ? `\n📅 La foto no trae fecha: el movimiento queda con la de hoy, ${fecha}.` : `\n📅 ${f.origenHora === "archivo" ? "El archivo es del" : "La foto es del"} ${fecha} a las ${hora}: el movimiento queda con esa fecha.`];
  if (fotoAntigua(f.capturadoEn, ahora)) avisos.push(`\n⚠️ Tiene ${diasDeFoto(f.capturadoEn, ahora)} días. Si la usas, el stock cambia hoy con fecha de entonces y el registro pasa a Por revisar.`);
  if (f.dudosa) avisos.push("\n⚠️ Esa fecha no es segura. Revísala antes de confirmar: el registro pasará a Por revisar.");
  return avisos.join("");
}

export async function momentoCaptura(archivo: File, origen: OrigenFoto, ahora: number): Promise<string> {
  return (await detalleCaptura(archivo, origen, ahora)).capturadoEn;
}

type OpcionesFoto = { ladoMax?: number; capturadoEn?: string; origen?: OrigenFoto; origenHora?: OrigenHora; dudosa?: boolean };

/** Achica y comprime la foto del celular (de varios MB a ~200 KB), la deja en JPEG y le pone el sello con su fecha y hora. */
export async function comprimirFoto(archivo: File, { ladoMax = LADO_MAX, capturadoEn, origen, origenHora, dudosa }: OpcionesFoto = {}): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error("No se pudo leer la imagen. Prueba con otra foto.");
  const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);
  const franja = Math.max(40, Math.round(Math.min(ancho, alto) * 0.07));
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto + franja;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();
  // Franja debajo de la foto (no tapa nada de la imagen): fecha a la izquierda, hora a la derecha.
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(0, alto, ancho, franja);
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${Math.round(franja * 0.55)}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const margen = Math.round(franja * 0.4);
  const { fecha, hora } = selloLima(capturadoEn ?? Date.now());
  ctx.textAlign = "left";
  const marca = textoSello({ origen, origenHora, dudosa });
  ctx.fillText(marca ? `${fecha} · ${marca}` : fecha, margen, alto + franja / 2);
  ctx.textAlign = "right";
  ctx.fillText(hora, ancho - margen, alto + franja / 2);
  const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/jpeg", 0.8));
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  return blob;
}

/** `ahora` se toma al elegir el archivo, antes de comprimir: comprimir tarda y no debe mover la hora. */
export async function prepararFoto(archivo: File, origen: OrigenFoto, ahora: number): Promise<FotoCapturada> {
  const momento = await detalleCaptura(archivo, origen, ahora);
  const real = origenReal(origen, momento);
  const blob = await comprimirFoto(archivo, { ...momento, origen: real });
  return { id: nuevoUuid(), blob, origen: real, ...momento };
}

/** Guarda un archivo en el dispositivo de la persona. */
export function descargarBlob(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const nombreEvidencia = (capturadoEn: string) => `evidencia-${capturadoEn.slice(0, 16).replace(/[:T]/g, "-")}.jpg`;

export function urlFoto(ruta: string | null | undefined): string | null {
  return ruta ? supabase.storage.from("evidencias").getPublicUrl(ruta).data.publicUrl : null;
}
