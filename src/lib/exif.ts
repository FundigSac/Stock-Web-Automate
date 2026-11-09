import { isoLima, OFFSET_LIMA } from "./tiempo";

const DATE_TIME_ORIGINAL = 0x9003;
const DATE_TIME_DIGITIZED = 0x9004;
const OFFSET_TIME = 0x9010;
const OFFSET_TIME_ORIGINAL = 0x9011;
const OFFSET_TIME_DIGITIZED = 0x9012;
const EXIF_IFD = 0x8769;
const DATE_TIME = 0x0132;

export type DatoExif = {
  /** Tal como viene: "2026:10:30 17:45:12". */
  fecha: string;
  /** Zona de esa hora, si la foto la trae: "-05:00". */
  desfase: string | null;
};

/** Una zona como "-05:00" que además existe: el formato solo no descarta "+99:99". */
function zonaValida(z: string | null | undefined): z is string {
  return !!z && /^[+-]\d{2}:\d{2}$/.test(z) && Number.isFinite(Date.parse(`2000-01-01T00:00:00${z}`));
}

/** Lee del JPEG la fecha en que se tomó la foto y su zona horaria, si la tiene. */
export function leerExif(buf: ArrayBuffer): DatoExif | null {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p + 4 <= v.byteLength) {
      const marca = v.getUint16(p);
      if ((marca & 0xff00) !== 0xff00 || marca === 0xffda) return null;
      if (marca === 0xffe1 && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) return datoEnTiff(v, p + 10);
      p += 2 + v.getUint16(p + 2);
    }
  } catch {
    // Un archivo cortado o raro simplemente no tiene fecha legible.
  }
  return null;
}

export function leerFechaExif(buf: ArrayBuffer): string | null {
  return leerExif(buf)?.fecha ?? null;
}

function datoEnTiff(v: DataView, base: number): DatoExif | null {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const etiquetas = (ifd: number) => {
    const n = u16(ifd);
    return Array.from({ length: n }, (_, i) => ifd + 2 + i * 12).map((e) => ({ tag: u16(e), entrada: e }));
  };
  const texto = (entrada: number, largo: number) => {
    const inicio = base + u32(entrada + 8);
    let s = "";
    for (let i = 0; i < largo; i++) s += String.fromCharCode(v.getUint8(inicio + i));
    return s;
  };

  const ifd0 = etiquetas(base + u32(base + 4));
  const puntero = ifd0.find((e) => e.tag === EXIF_IFD);
  if (puntero) {
    const exif = etiquetas(base + u32(puntero.entrada + 8));
    const zona = (...tags: number[]) => {
      for (const tag of tags) {
        const e = exif.find((x) => x.tag === tag);
        // Algunas cámaras dejan el campo con espacios o ceros: eso equivale a no tener zona.
        const valor = e ? texto(e.entrada, 6) : null;
        if (zonaValida(valor)) return valor;
      }
      return null;
    };
    const original = exif.find((e) => e.tag === DATE_TIME_ORIGINAL);
    if (original) return { fecha: texto(original.entrada, 19), desfase: zona(OFFSET_TIME_ORIGINAL, OFFSET_TIME) };
    const digitalizada = exif.find((e) => e.tag === DATE_TIME_DIGITIZED);
    if (digitalizada) return { fecha: texto(digitalizada.entrada, 19), desfase: zona(OFFSET_TIME_DIGITIZED, OFFSET_TIME) };
  }
  const general = ifd0.find((e) => e.tag === DATE_TIME);
  return general ? { fecha: texto(general.entrada, 19), desfase: null } : null;
}

/** Con zona, es un instante exacto. Sin zona, la fecha se toma como hora de Lima. Rechaza fechas que no existen, como un 30 de febrero. */
export function exifAIso(fecha: string | null, desfase: string | null = null): string | null {
  const m = fecha?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [anio, mes, dia, hora, minuto, segundo] = m.slice(1).map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia, hora, minuto, segundo));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia || d.getUTCHours() !== hora || d.getUTCMinutes() !== minuto || d.getUTCSeconds() !== segundo) return null;
  const base = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000`;
  return zonaValida(desfase) ? isoLima(Date.parse(`${base}${desfase}`)) : `${base}${OFFSET_LIMA}`;
}
