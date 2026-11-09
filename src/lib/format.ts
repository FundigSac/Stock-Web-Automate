import { hoyLima } from "./tiempo";

/** Para comparar textos sin importar mayúsculas ni tildes. */
export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-10-29" -> "29 oct 2026" (sin pasar por Date, para evitar desfases de zona horaria). */
export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${d} ${MESES[m - 1]} ${y}`;
}

/** "2026-10-29" -> "29 oct" */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!m || !d) return "—";
  return `${d} ${MESES[m - 1]}`;
}

export function entero(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("es-PE");
}

export function hace(iso: string | null | undefined, ahora: number): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (s < 5) return "ahora mismo";
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/** "de hace 3 días": la antigüedad de una copia guardada, dicha en una frase. */
export function edadCopia(guardadoEn: number | null, ahora: number): string | null {
  if (guardadoEn === null) return null;
  const minutos = Math.max(0, Math.round((ahora - guardadoEn) / 60_000));
  if (minutos < 2) return "de hace un momento";
  if (minutos < 60) return `de hace ${minutos} minutos`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `de hace ${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.round(horas / 24);
  return `de hace ${dias} ${dias === 1 ? "día" : "días"}`;
}

/** Hoy en Lima, aunque el dispositivo esté en otra zona horaria. */
export function hoyISO(): string {
  return hoyLima();
}

/** Suma (o resta) dias a una fecha ISO. */
export function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}

const SIGLAS = new Set(["EPP", "RRHH", "S/F", "C/F", "M&L", "XL", "XXL", "XS", "SAC"]);
const MENORES = new Set(["y", "o", "de", "del", "la", "el", "en", "para", "con", "sin"]);
const ACENTOS: Record<string, string> = {
  pantalon: "pantalón",
  mascara: "máscara",
  espatula: "espátula",
  sabana: "sábana",
  almacen: "almacén",
  camison: "camisón",
};

/** Quita el "- EMPRESA" del final del nombre ("POLO MANGA LARGA - FUNDIGSAC" -> "Polo Manga Larga"): la empresa ya se muestra aparte. */
export function nombreProducto(producto: string | null | undefined, empresa?: string | null): string {
  let s = (producto ?? "").replace(/\s+/g, " ").trim();
  if (empresa) {
    const e = empresa.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`\\s*-\\s*${e}\\s*$`, "i"), "");
  }
  // En el Excel "C/F" y "S/F" son "con / sin Fundigsac" (ver "PANTALON JEANS SIN FUNDIGSAC"): se escriben completos.
  s = s.replace(/\bC\/F\b/gi, "con Fundigsac").replace(/\bS\/F\b/gi, "sin Fundigsac");
  return titulo(s);
}

/** "C/F - TALLA 30" -> "30", "TALLA ESPECIAL" -> "Especial", "ÚNICA" -> "Única". */
export function nombreTalla(talla: string | null | undefined): string {
  let s = (talla ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Sin talla";
  s = s.replace(/^[CS]\/F\s*-\s*/i, "").replace(/^talla\s+/i, "").trim();
  if (!s || /^(s\/?\s?talla|sin talla)$/i.test(s)) return "Sin talla";
  if (/^[uú]nica$/i.test(s)) return "Única";
  return /^[A-Za-z0-9]{1,4}$/.test(s) ? s.toUpperCase() : titulo(s);
}

/** La talla dentro de su producto: si dos quedarían iguales ("C/F - 30" y "S/F - 30"), conserva la variante. */
export function nombreTallaEn(talla: string | null | undefined, hermanas: { talla: string | null }[]): string {
  const n = nombreTalla(talla);
  const variante = (talla ?? "").trim().match(/^([CS]\/F)\b/i)?.[1];
  return variante && hermanas.filter((h) => nombreTalla(h.talla) === n).length > 1 ? `${n} ${variante.toUpperCase()}` : n;
}

/** Frase para mostrar: "Talla 30", "Talla única", "Sin talla". */
export function etiquetaTalla(talla: string | null | undefined): string {
  const n = nombreTalla(talla);
  if (n === "Sin talla") return n;
  return n === "Única" || n === "Especial" ? `Talla ${n.toLowerCase()}` : `Talla ${n}`;
}

/** Los movimientos guardan "NOMBRE  ·  Talla M": lo separa en nombre y talla. */
export function partirMovimiento(snapshot: string | null | undefined): { nombre: string; talla: string } {
  const [nombre, talla] = (snapshot ?? "").split(/\s+·\s+Talla\s+/i);
  return { nombre: (nombre ?? "").trim(), talla: (talla ?? "").trim() };
}

/** "PANTALON JEANS C/F - FUNDIGSAC" -> "Pantalon Jeans C/F - Fundigsac" (conserva siglas). */
export function titulo(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((w0, i) => {
      const w = ACENTOS[w0] ?? w0;
      if (SIGLAS.has(w.toUpperCase())) return w.toUpperCase();
      if (i > 0 && MENORES.has(w)) return w;
      // Mayuscula inicial tambien tras "-", "/", "&" y "(".
      return w.replace(/(^|[-/&(])(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase());
    })
    .join("");
}
