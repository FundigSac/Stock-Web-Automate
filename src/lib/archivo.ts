/** Convierte un Excel, CSV o Word en texto plano (una fila por línea, columnas con " | ") para que la IA lo lea. */
export const MAX_TEXTO = 60_000;

const celda = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, " ").trim());

export async function textoDeExcel(archivo: File): Promise<string> {
  const { default: leer } = await import("read-excel-file/browser");
  const hojas = await leer(archivo);
  return hojas
    .map((h) => {
      const filas = h.data.map((r) => r.map(celda).join(" | ")).filter((l) => l.replace(/[\s|]/g, "") !== "");
      return `${hojas.length > 1 ? `HOJA: ${h.sheet}\n` : ""}${filas.join("\n")}`;
    })
    .join("\n\n");
}

export async function textoDeWord(archivo: File): Promise<string> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await archivo.arrayBuffer() });
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("td,th").forEach((c) => c.append(" | "));
  doc.querySelectorAll("tr,p,li,br,h1,h2,h3,h4").forEach((e) => e.append("\n"));
  return (doc.body.textContent ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const esImagen = (f: File) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name);
export const esPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** Devuelve el texto del archivo, o lanza un error en español que se le muestra al usuario. */
export async function textoDeArchivo(f: File): Promise<string> {
  const nombre = f.name.toLowerCase();
  if (/\.xlsx$/.test(nombre)) return textoDeExcel(f);
  if (/\.docx$/.test(nombre)) return textoDeWord(f);
  if (/\.(csv|txt)$/.test(nombre)) return f.text();
  if (/\.(xls|doc)$/.test(nombre)) throw new Error("Ese formato es muy antiguo. Guárdalo como .xlsx (Excel) o .docx (Word) y vuelve a subirlo.");
  throw new Error("No puedo leer ese tipo de archivo. Sube una foto, PDF, Excel (.xlsx), CSV o Word (.docx).");
}
