import { describe, expect, it, vi } from "vitest";
import { exifAIso, leerFechaExif } from "../../src/lib/exif";
import { hoyLima, horaLima, isoLima, mesLima, selloLima } from "../../src/lib/tiempo";

vi.mock("../../src/lib/supabase", () => ({ supabase: {} }));

describe("hora de Lima", () => {
  it("escribe el instante en ISO 8601 con -05:00 y representa el mismo momento", () => {
    const ms = Date.UTC(2026, 10, 9, 14, 30, 5, 120);
    expect(isoLima(ms)).toBe("2026-11-09T09:30:05.120-05:00");
    expect(Date.parse(isoLima(ms))).toBe(ms);
  });

  it("el día lo marca Lima aunque en UTC ya sea mañana", () => {
    const noche = Date.UTC(2026, 10, 10, 3, 0, 0);
    expect(hoyLima(noche)).toBe("2026-11-09");
    expect(selloLima(noche)).toEqual({ fecha: "09/11/2026", hora: "22:00" });
    expect(horaLima(noche)).toBe("22:00");
  });

  it("la carpeta del mes también es la de Lima", () => {
    expect(mesLima("2026-12-01T01:00:00.000Z")).toBe("2026-11");
  });
});

/** JPEG mínimo con un bloque EXIF y la fecha original indicada. */
function jpegConExif(fecha: string, le = true): ArrayBuffer {
  const tiff = new DataView(new ArrayBuffer(200));
  const p16 = (o: number, v: number) => tiff.setUint16(o, v, le);
  const p32 = (o: number, v: number) => tiff.setUint32(o, v, le);
  tiff.setUint16(0, le ? 0x4949 : 0x4d4d);
  p16(2, 42);
  p32(4, 8);
  // IFD0 con el puntero al bloque EXIF
  p16(8, 1);
  p16(10, 0x8769);
  p16(12, 4);
  p32(14, 1);
  p32(18, 26);
  // IFD EXIF con DateTimeOriginal
  p16(26, 1);
  p16(28, 0x9003);
  p16(30, 2);
  p32(32, 20);
  p32(36, 44);
  for (let i = 0; i < fecha.length; i++) tiff.setUint8(44 + i, fecha.charCodeAt(i));

  const salida = new Uint8Array(2 + 4 + 6 + 200);
  salida.set([0xff, 0xd8, 0xff, 0xe1], 0);
  new DataView(salida.buffer).setUint16(4, 208);
  salida.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  salida.set(new Uint8Array(tiff.buffer), 12);
  return salida.buffer;
}

describe("fecha dentro de la foto", () => {
  it("lee DateTimeOriginal en los dos órdenes de bytes", () => {
    expect(leerFechaExif(jpegConExif("2026:10:30 17:45:12"))).toBe("2026:10:30 17:45:12");
    expect(leerFechaExif(jpegConExif("2026:10:30 17:45:12", false))).toBe("2026:10:30 17:45:12");
  });

  it("no revienta con un archivo que no es JPEG", () => {
    expect(leerFechaExif(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
    expect(leerFechaExif(new ArrayBuffer(0))).toBeNull();
  });

  it("convierte la fecha a ISO en hora de Lima", () => {
    expect(exifAIso("2026:10:30 17:45:12")).toBe("2026-10-30T17:45:12.000-05:00");
    expect(exifAIso("0000:00:00 00:00:00")).toBeNull();
    expect(exifAIso(null)).toBeNull();
  });
});

describe("momento de captura", () => {
  const ahora = Date.parse("2026-11-09T09:30:00.000-05:00");
  const archivo = (lastModified: number, contenido: BlobPart = "x") => new File([contenido], "foto.jpg", { type: "image/jpeg", lastModified });

  it("cámara: usa la hora del archivo si es de hace poco", async () => {
    const { momentoCaptura } = await import("../../src/lib/foto");
    const disparo = ahora - 40_000;
    expect(await momentoCaptura(archivo(disparo), "camara", ahora)).toBe(isoLima(disparo));
  });

  it("cámara: un archivo que no es de hace un momento no se certifica como tomado ahora", async () => {
    const { momentoCaptura } = await import("../../src/lib/foto");
    expect(await momentoCaptura(archivo(ahora - 86_400_000), "camara", ahora)).toBe(isoLima(ahora - 86_400_000));
    expect(await momentoCaptura(archivo(ahora + 60_000), "camara", ahora)).toBe(isoLima(ahora));
  });

  it("galería: una foto de ayer conserva la fecha de ayer", async () => {
    const { momentoCaptura } = await import("../../src/lib/foto");
    const ayer = ahora - 86_400_000;
    expect(await momentoCaptura(archivo(ayer), "galeria", ahora)).toBe(isoLima(ayer));
  });

  it("galería: la fecha EXIF manda sobre la del archivo", async () => {
    const { momentoCaptura } = await import("../../src/lib/foto");
    const f = archivo(ahora - 1000, jpegConExif("2026:10:30 17:45:12"));
    expect(await momentoCaptura(f, "galeria", ahora)).toBe("2026-10-30T17:45:12.000-05:00");
  });
});
