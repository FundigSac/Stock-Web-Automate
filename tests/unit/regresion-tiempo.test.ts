import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { entregasDe, lecturas, momentoMovimiento, porcentaje, resumir } from "../../src/lib/derive";
import { exifAIso, leerExif } from "../../src/lib/exif";
import { cerrarAlmacen, type ItemRespaldo } from "../../src/lib/offline/almacen";
import { construirCarga, motivosRevision, sincronizar, type RespuestaRegistro, type Transporte } from "../../src/lib/offline/motor";
import { encolar, obtenerItem, type NuevoRegistro } from "../../src/lib/offline/respaldo";
import { anotarHoraServidor } from "../../src/lib/offline/reloj";
import { estadoReporte, inicioLlegadasTarde, movimientosTardios } from "../../src/lib/reporteSemanal";
import { fechaDelRegistro, fechaLima } from "../../src/lib/tiempo";
import type { Movimiento, Salida, StockItem } from "../../src/lib/types";

vi.mock("../../src/lib/supabase", () => ({ supabase: {} }));

const raiz = new URL("../../", import.meta.url);
const leer = (r: string) => readFileSync(new URL(r, raiz), "utf8");

beforeEach(async () => {
  await cerrarAlmacen();
  globalThis.indexedDB = new IDBFactory();
});

describe("fecha del movimiento", () => {
  const ahora = Date.parse("2026-11-09T00:02:00.000-05:00");

  it("con foto, vale el día de la foto aunque se guarde pasada la medianoche", () => {
    expect(fechaDelRegistro({ capturadoEn: "2026-11-08T23:58:00.000-05:00", ahora })).toBe("2026-11-08");
  });

  it("formulario abierto antes de medianoche y foto después: vale el día de la foto", () => {
    expect(fechaDelRegistro({ capturadoEn: "2026-11-09T00:05:00.000-05:00", ahora })).toBe("2026-11-09");
  });

  it("sin foto, vale el día en que se guarda", () => {
    expect(fechaDelRegistro({ ahora })).toBe("2026-11-09");
  });

  it("lo que elige la persona manda", () => {
    expect(fechaDelRegistro({ capturadoEn: "2026-11-08T23:58:00.000-05:00", elegida: "2026-11-05", ahora })).toBe("2026-11-05");
  });

  it("el día es el de Lima", () => {
    expect(fechaLima("2026-11-09T03:00:00.000Z")).toBe("2026-11-08");
  });
});

function jpeg(fecha: string, zona?: string): ArrayBuffer {
  const tiff = new DataView(new ArrayBuffer(200));
  const p16 = (o: number, v: number) => tiff.setUint16(o, v, true);
  const p32 = (o: number, v: number) => tiff.setUint32(o, v, true);
  tiff.setUint16(0, 0x4949);
  p16(2, 42);
  p32(4, 8);
  p16(8, 1);
  p16(10, 0x8769);
  p16(12, 4);
  p32(14, 1);
  p32(18, 26);
  p16(26, zona ? 2 : 1);
  p16(28, 0x9003);
  p16(30, 2);
  p32(32, 20);
  p32(36, 80);
  if (zona) {
    p16(40, 0x9011);
    p16(42, 2);
    p32(44, 7);
    p32(48, 110);
  }
  for (let i = 0; i < fecha.length; i++) tiff.setUint8(80 + i, fecha.charCodeAt(i));
  if (zona) for (let i = 0; i < zona.length; i++) tiff.setUint8(110 + i, zona.charCodeAt(i));
  const out = new Uint8Array(12 + 200);
  out.set([0xff, 0xd8, 0xff, 0xe1], 0);
  new DataView(out.buffer).setUint16(4, 208);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  out.set(new Uint8Array(tiff.buffer), 12);
  return out.buffer;
}

describe("fecha dentro de la foto", () => {
  const ahora = Date.parse("2026-12-10T09:30:00.000-05:00");
  const archivo = (lastModified: number, contenido: BlobPart = "x") => new File([contenido], "f.jpg", { type: "image/jpeg", lastModified });

  it("respeta la zona que trae la foto", async () => {
    expect(leerExif(jpeg("2026:12:01 01:00:00", "+00:00"))).toEqual({ fecha: "2026:12:01 01:00:00", desfase: "+00:00" });
    expect(exifAIso("2026:12:01 01:00:00", "+00:00")).toBe("2026-11-30T20:00:00.000-05:00");
    const { detalleCaptura } = await import("../../src/lib/foto");
    expect(await detalleCaptura(archivo(ahora - 1000, jpeg("2026:12:01 01:00:00", "+00:00")), "galeria", ahora)).toEqual({ capturadoEn: "2026-11-30T20:00:00.000-05:00", origenHora: "exif", dudosa: false });
  });

  it("sin zona y a horas exactas del archivo, la hora del archivo es la buena y queda marcada", async () => {
    const { detalleCaptura } = await import("../../src/lib/foto");
    const real = Date.parse("2026-11-30T20:00:00.000-05:00");
    const m = await detalleCaptura(archivo(real, jpeg("2026:12:01 01:00:00")), "galeria", ahora);
    expect(m).toMatchObject({ origenHora: "archivo", dudosa: true });
    expect(Date.parse(m.capturadoEn)).toBe(real);
  });

  it("rechaza fechas que no existen", () => {
    expect(exifAIso("2026:02:30 10:00:00")).toBeNull();
  });

  it("una cámara con la fecha reiniciada no pone la foto en el año 2000", async () => {
    const { detalleCaptura } = await import("../../src/lib/foto");
    const m = await detalleCaptura(archivo(ahora - 60_000, jpeg("2000:01:01 00:00:00")), "galeria", ahora);
    expect(m).toMatchObject({ origenHora: "archivo", dudosa: true });
    expect(m.capturadoEn.startsWith("2026")).toBe(true);
  });

  it("un archivo sin EXIF dice que la fecha es del archivo", async () => {
    const { detalleCaptura } = await import("../../src/lib/foto");
    expect((await detalleCaptura(archivo(ahora - 1000), "galeria", ahora)).origenHora).toBe("archivo");
  });
});

const CAPTURA = "2026-11-08T12:30:00.000-05:00";
const SUBIDA = Date.parse("2026-11-08T09:45:00.000-05:00");

function item(extra: Partial<ItemRespaldo> = {}): ItemRespaldo {
  return { id: "a", tipo: "entrada", capturadoEn: "2026-11-08T08:00:00.000-05:00", guardadoEn: "", fecha: "2026-11-08", quien: "x", trabajador: null, area: null, nota: null, lineas: [{ clientId: "c", codigo: "P", cantidad: 1, producto: "P", talla: null }], foto: null, fotoRuta: null, fotoOrigen: null, fotoSubida: false, estado: "pendiente", intentos: 0, proximoIntentoEn: 0, ultimoError: null, confirmadoEn: null, desfaseSegundos: null, revision: null, dueno: null, origenHora: "registro", horaDudosa: false, desfaseAlGuardar: null, ...extra };
}
const resp = (extra: Partial<RespuestaRegistro> = {}): RespuestaRegistro => ({ reloj_desfase_segundos: 0, items: [{ client_id: "c", codigo: "P", id: 1, queda: 5 }], ...extra });

describe("reloj al guardar y al subir", () => {
  it("una hora de foto en el futuro no pasa en silencio aunque el reloj ya esté bien", () => {
    expect(motivosRevision(item({ capturadoEn: CAPTURA }), resp({ servidor_ahora: new Date(SUBIDA).toISOString() }), SUBIDA)).toContain("posterior a la del servidor");
  });

  it("si el reloj cambió después del último contacto, no pasa en silencio", () => {
    expect(motivosRevision(item({ desfaseAlGuardar: 0 }), resp({ reloj_desfase_segundos: 3600 }), SUBIDA)).toContain("cambió");
  });

  it("si el desfase conocido no coincide con el de ahora, no afirma cómo estaba el reloj", () => {
    expect(motivosRevision(item({ desfaseAlGuardar: 10_800 }), resp(), SUBIDA)).toContain("cambió");
    expect(motivosRevision(item({ desfaseAlGuardar: 10_800 }), resp({ reloj_desfase_segundos: 10_790 }), SUBIDA)).toContain("Al guardar");
  });

  it("marca la fecha que no coincide con la foto", () => {
    expect(motivosRevision(item({ fecha: "2026-11-01", fotoRuta: "entradas/2026-11/a.jpg", origenHora: "exif" }), resp(), SUBIDA)).toContain("no coincide");
  });

  it("marca una fecha de foto poco confiable", () => {
    expect(motivosRevision(item({ horaDudosa: true }), resp(), SUBIDA)).toContain("no es confiable");
  });

  it("un reintento no cambia el veredicto del primer intento", () => {
    const r = resp({ reloj_desfase_segundos: 60, items: [{ client_id: "c", codigo: "P", id: 1, queda: 5, ya_existia: true, revisar_motivo: "Primer veredicto." }] });
    expect(motivosRevision(item({ desfaseAlGuardar: 9999 }), r, SUBIDA)).toBe("Primer veredicto.");
    expect(motivosRevision(item({ desfaseAlGuardar: 9999 }), { ...r, items: [{ ...r.items[0], revisar_motivo: null }] }, SUBIDA)).toBeNull();
  });

  it("guarda el desfase conocido al encolar y lo manda al servidor", async () => {
    await anotarHoraServidor(Date.now() - 600_000, Date.now());
    const n: NuevoRegistro = { tipo: "entrada", capturadoEn: CAPTURA, guardadoEn: CAPTURA, fecha: "2026-11-08", quien: "x", trabajador: null, area: null, nota: null, lineas: [{ codigo: "P", cantidad: 1, producto: "P", talla: null }], foto: null };
    const it0 = await encolar(n);
    expect(it0.desfaseAlGuardar).toBe(600);
    expect(it0.origenHora).toBe("registro");
    expect(construirCarga(it0, SUBIDA)).toMatchObject({ p_desfase_captura: 600, p_capturado_origen: "registro", p_hora_dudosa: false });
  });

  it("la subida anota la hora del servidor para el próximo registro", async () => {
    const t: Transporte = { subirFoto: async () => {}, registrar: async (c) => ({ reloj_desfase_segundos: 0, servidor_ahora: new Date(SUBIDA).toISOString(), items: c.p_items.map((i) => ({ client_id: i.client_id, codigo: i.codigo, id: 1, queda: 1 })) }) };
    const n: NuevoRegistro = { tipo: "entrada", capturadoEn: CAPTURA, guardadoEn: CAPTURA, fecha: "2026-11-08", quien: "x", trabajador: null, area: null, nota: null, lineas: [{ codigo: "P", cantidad: 1, producto: "P", talla: null }], foto: null };
    const a = await encolar(n);
    await sincronizar(t, { reloj: () => SUBIDA + 3_600_000 });
    expect((await obtenerItem(a.id))?.estado).toBe("confirmado");
    const b = await encolar(n);
    expect(b.desfaseAlGuardar).not.toBeNull();
  });
});

const mov = (extra: Partial<Movimiento>): Movimiento => ({ key: "s1", id: 1, tipo: "salida", fecha: "2026-11-08", codigo: "P", producto: "P", cantidad: 1, persona: null, area: null, nota: null, anulado: false, motivo: null, anuladoPor: null, registradoPor: null, creado: "2026-11-08T08:00:00.000-05:00", foto: null, etiqueta: null, cambioRef: null, ...extra });

describe("cómo se muestra un movimiento", () => {
  it("la hora de la foto y el día del registro son dos datos", () => {
    expect(momentoMovimiento(mov({ fecha: "2026-11-09", foto: "a.jpg", capturado: "2026-10-30T17:45:00.000-05:00", origenHora: "exif", creado: "2026-10-30T17:45:00.000-05:00" }))).toBe("Foto del 30 oct, 17:45 · Registrado 9 nov 2026");
  });

  it("si es la fecha del archivo, no dice foto", () => {
    expect(momentoMovimiento(mov({ foto: "a.jpg", capturado: "2026-10-30T17:45:00.000-05:00", origenHora: "archivo" }))).toContain("Archivo del");
  });

  it("sin foto dice cuándo se registró", () => {
    expect(momentoMovimiento(mov({ capturado: "2026-11-08T08:00:00.000-05:00", origenHora: "registro" }))).toBe("8 nov 2026 · registrado a las 08:00");
  });

  it("una fila antigua sin hora de foto no finge tenerla", () => {
    expect(momentoMovimiento(mov({ foto: "a.jpg", capturado: null, creado: "2026-05-01T22:10:00.000Z" }))).toBe("8 nov 2026 · registrado a las 17:10");
  });

  it("las entregas de un día se ordenan por la hora real, no por el orden de subida", () => {
    const s = (id: number, capturado_en: string) => ({ id, fecha: "2026-11-08", trabajador_cliente: "ANA", anulado: false, capturado_en, created_at: "2026-11-08T23:00:00.000Z" }) as Salida;
    expect(entregasDe([s(7, "2026-11-08T08:00:00.000-05:00"), s(3, "2026-11-08T12:00:00.000-05:00")], "ANA").map((x) => x.id)).toEqual([3, 7]);
  });
});

describe("reporte semanal", () => {
  it("el primer reporte atrasado cubre desde el inicio", () => {
    const e = estadoReporte("2026-10-01", null, "2026-11-09");
    expect(e.fase).toBe("atrasado");
    expect(e.desde).toBe("2026-10-01");
  });

  it("lo que subió después del último reporte con fecha anterior no se pierde", () => {
    const tarde = mov({ fecha: "2026-11-06", subido: "2026-11-08T15:00:00.000Z" });
    const aTiempo = mov({ key: "s2", fecha: "2026-11-06", subido: "2026-11-06T15:00:00.000Z" });
    const anulado = mov({ key: "s3", fecha: "2026-11-06", subido: "2026-11-08T15:00:00.000Z", anulado: true });
    expect(movimientosTardios([tarde, aTiempo, anulado], "2026-11-08", "2026-11-07T22:00:00.000Z").map((m) => m.key)).toEqual(["s1"]);
  });

  it("usa el momento exacto del reporte y, si no existe, el final de ese día", () => {
    expect(inicioLlegadasTarde({ reporte_ultimo: "2026-11-07", reporte_ultimo_en: "2026-11-07T22:00:00.000Z" })).toBe("2026-11-07T22:00:00.000Z");
    expect(inicioLlegadasTarde({ reporte_ultimo: "2026-11-07" })).toBe("2026-11-07T23:59:59.999-05:00");
  });
});

describe("cifras en pantalla", () => {
  const talla = (queda: number): StockItem => ({ codigo: String(Math.random()), empresa: "F", producto: "P", talla: "M", genero: null, tenia_al_inicio: 0, entro: 0, salio: 0, queda, aviso: null, ultimo_movimiento: null });

  it("el porcentaje no redondea a 100 ni a 0 si no lo es", () => {
    expect(porcentaje(199, 200)).toBe(99);
    expect(porcentaje(1, 250)).toBe(1);
    expect(porcentaje(200, 200)).toBe(100);
    expect(porcentaje(0, 200)).toBe(0);
    expect(resumir([...Array(199).fill(0).map(() => talla(10)), talla(0)], 2).pctDisponible).toBe(99);
  });

  it("usa el singular cuando es una talla", () => {
    const r = resumir([talla(10), talla(1), talla(-1)], 2);
    const t = lecturas(r, [], []);
    expect(t.some((x) => x.startsWith("1 talla está por agotarse"))).toBe(true);
    expect(t.some((x) => x.startsWith("1 talla tiene saldo negativo"))).toBe(true);
  });
});

describe("archivos que no se ejecutan en estas pruebas", () => {
  const offline = leer("supabase/migrations/20261109120000_offline_capturado_en.sql");
  const sabado = leer("supabase/migrations/20261109130000_reporte_sabado.sql");

  it("la migración no certifica la hora de inserción como hora de la foto", () => {
    expect(offline).not.toMatch(/set capturado_en = created_at/);
    expect(offline).not.toMatch(/alter column capturado_en set default/);
    expect(offline).toMatch(/capturado_origen/);
  });

  it("el servidor marca horas futuras, fechas que no coinciden y conserva el primer veredicto", () => {
    expect(offline).toMatch(/p_capturado_en > now\(\) \+ interval '5 minutes'/);
    expect(offline).toMatch(/abs\(p_fecha - v_fecha_foto\) > 1/);
    expect(offline).toMatch(/'ya_existia', v_ya_existia/);
    expect(offline).toMatch(/coalesce\(v_desfase_primero, v_desfase\)/);
  });

  it("un reloj adelantado no puede dar por hecho el reporte", () => {
    expect(sabado).toMatch(/p_sabado > \(now\(\) at time zone 'America\/Lima'\)::date \+ 3/);
    expect(sabado).toContain("reporte_ultimo_en = greatest(reporte_ultimo_en, least(coalesce(p_corte, now()), now()))");
  });

  it("el asistente ordena por cuándo pasó, no por cuándo subió", () => {
    const f = leer("supabase/functions/asistente-ia/index.ts");
    expect(f).toMatch(/order\("capturado_en"/);
    expect(f).not.toMatch(/sort\(\(a, b\) => b\.created_at\.localeCompare/);
  });

  it("las tipografías van con la app y quedan guardadas para abrir sin red", () => {
    expect(leer("index.html")).not.toMatch(/fonts\.googleapis/);
    expect(leer("vite.config.ts")).toMatch(/woff2/);
    expect(leer("src/main.tsx")).toMatch(/@fontsource\/archivo/);
  });

  it("todo el texto corrido va justificado", () => {
    expect(leer("src/index.css")).toMatch(/p,\s+li \{\s+text-align: justify;/);
  });
});
