import { supabase } from "./supabase";

const LADO_MAX = 1280;

/** Fecha y hora de hoy del celular, por separado: "30/10/2026" y "17:45". */
function sello(): { fecha: string; hora: string } {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, "0");
  return { fecha: `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`, hora: `${dos(d.getHours())}:${dos(d.getMinutes())}` };
}

/** Achica y comprime la foto del celular (de varios MB a ~200 KB) y la deja en JPEG. */
export async function comprimirFoto(archivo: File, ladoMax = LADO_MAX): Promise<Blob> {
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
  const { fecha, hora } = sello();
  ctx.textAlign = "left";
  ctx.fillText(fecha, margen, alto + franja / 2);
  ctx.textAlign = "right";
  ctx.fillText(hora, ancho - margen, alto + franja / 2);
  const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/jpeg", 0.8));
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  return blob;
}

/** Sube la foto con un nombre al azar y devuelve su ruta (la que se guarda con la salida). */
export async function subirFoto(blob: Blob, carpeta: "salidas" | "entradas" = "salidas"): Promise<string> {
  const ahora = new Date();
  const ruta = `${carpeta}/${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("evidencias").upload(ruta, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(/fetch|network/i.test(error.message) ? "No se pudo subir la foto. Revisa tu conexión." : `No se pudo subir la foto: ${error.message}`);
  return ruta;
}

export function urlFoto(ruta: string | null | undefined): string | null {
  return ruta ? supabase.storage.from("evidencias").getPublicUrl(ruta).data.publicUrl : null;
}
