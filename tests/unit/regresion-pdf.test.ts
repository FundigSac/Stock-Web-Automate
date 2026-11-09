import { afterEach, describe, expect, it, vi } from "vitest";
import { contarFotos, generarPDF, type FotoEnBandeja, type SeccionesPDF } from "../../src/lib/pdf";
import type { Datos, Salida, StockItem } from "../../src/lib/types";

vi.mock("../../src/lib/supabase", () => ({
  supabase: { storage: { from: () => ({ getPublicUrl: (r: string) => ({ data: { publicUrl: `http://127.0.0.1:54321/fotos/${r}` } }) }) } },
}));

const solo = (s: Partial<SeccionesPDF>): SeccionesPDF => ({ resumen: false, stock: false, movimientos: false, trabajadores: false, fotos: false, ...s });

function fila(extra: Partial<Salida>): Salida {
  return { id: 1, fecha: "2026-11-09", codigo: "POLO-M", producto: "POLO AZUL  ·  Talla M", cantidad: 1, foto_path: null, anulado: false, anulado_motivo: null, anulado_por: null, anulado_at: null, creado_por: "ana@x.pe", created_at: "2026-11-09T12:00:00+00:00", etiqueta: null, cambio_ref: null, trabajador_cliente: "ANA", area: "A", nota: null, ...extra };
}
const talla = (extra: Partial<StockItem>): StockItem => ({ codigo: "POLO-M", empresa: "F", producto: "POLO", talla: "M", genero: null, tenia_al_inicio: 10, entro: 0, salio: 0, queda: 10, aviso: null, ultimo_movimiento: null, ...extra });
const datos = (salidas: Salida[], extra: Partial<Datos> = {}): Datos => ({ stock: [talla({})], entradas: [], salidas, trabajadores: [], pedidos: [], sync: null, ...extra });

const pedidas: string[] = [];

async function pdf(d: Datos, secciones: SeccionesPDF, extra: Record<string, unknown> = {}) {
  pedidas.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    pedidas.push(String(u));
    return new Response("", { status: 404 });
  }));
  let blob: Blob | null = null;
  const original = URL.createObjectURL;
  URL.createObjectURL = ((b: Blob) => {
    blob = b;
    return "blob:x";
  }) as typeof URL.createObjectURL;
  const r = await generarPDF({ datos: d, todos: d, empresa: "TODAS", secciones, usuario: "ana", desde: null, hasta: null, incluirAnulados: false, ventana: { closed: false, location: {} } as unknown as Window, bandeja: async () => [], ...extra });
  URL.createObjectURL = original;
  return { r, texto: await (blob as unknown as Blob).text() };
}

/** El PDF guarda cada línea entre paréntesis: se unen para buscar frases. */
const plano = (s: string) => [...s.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1")).join(" ");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("datos que no se pueden perder en el informe", () => {
  it("la nota y el motivo de revisión de una salida salen aunque no tenga foto", async () => {
    const { texto } = await pdf(datos([fila({ nota: "entrega urgente", revisar_motivo: "quedo en -3" })]), solo({ movimientos: true }));
    const p = plano(texto);
    expect(p).toContain("urgente");
    expect(p).toContain("quedo");
  });

  it("incluir anulados también trae sus fotos", async () => {
    const d = datos([fila({ id: 1, foto_path: "salidas/2026-11/viva.jpg" }), fila({ id: 2, foto_path: "salidas/2026-11/anulada.jpg", anulado: true, anulado_motivo: "error", anulado_por: "ana" })]);
    await pdf(d, solo({ fotos: true }), { incluirAnulados: true });
    expect(pedidas.some((u) => u.includes("anulada.jpg"))).toBe(true);
    await pdf(d, solo({ fotos: true }), { incluirAnulados: false });
    expect(pedidas.some((u) => u.includes("anulada.jpg"))).toBe(false);
  });

  it("lo que llegó tarde sale en una sección propia, con su foto", async () => {
    const d = datos([fila({ fecha: "2026-11-06", foto_path: "salidas/2026-11/tarde.jpg", subido_en: "2026-11-08T15:00:00.000Z" })]);
    const { texto } = await pdf(d, solo({ movimientos: true, fotos: true }), { desde: "2026-11-08", hasta: "2026-11-14", tardeDesde: "2026-11-07T22:00:00.000Z" });
    expect(plano(texto)).toContain("Llegaron");
    expect(pedidas.some((u) => u.includes("tarde.jpg"))).toBe(true);
  });

  it("distingue las variantes de una misma talla", async () => {
    const stock = [talla({ codigo: "J-CF-30", producto: "PANTALON JEANS", talla: "C/F - TALLA 30" }), talla({ codigo: "J-SF-30", producto: "PANTALON JEANS", talla: "S/F - TALLA 30" })];
    const d = datos([fila({ codigo: "J-CF-30", producto: "PANTALON JEANS  ·  Talla 30", foto_path: "salidas/2026-11/a.jpg" })], { stock });
    const { texto } = await pdf(d, solo({ stock: true, fotos: true }));
    const p = plano(texto);
    expect(p).toContain("30 C/F");
    expect(p).toContain("30 S/F");
    expect(p).toContain("J-CF-30");
  });
});

describe("hora de la foto en las tarjetas", () => {
  const conFoto = (extra: Partial<Salida>) => datos([fila({ foto_path: "salidas/2026-11/a.jpg", ...extra })]);

  it("sin hora de foto no dice que la tomó a esa hora", async () => {
    const { texto } = await pdf(conFoto({ capturado_en: null }), solo({ fotos: true }));
    expect(plano(texto)).toContain("no se guard");
    expect(plano(texto)).not.toContain("Foto tomada");
  });

  it("la fecha de un archivo no se presenta como la de la foto", async () => {
    const { texto } = await pdf(conFoto({ capturado_en: "2026-11-09T10:00:00.000-05:00", capturado_origen: "archivo" }), solo({ fotos: true }));
    expect(plano(texto)).toContain("Fecha del archivo");
  });

  it("con EXIF sí dice foto tomada", async () => {
    const { texto } = await pdf(conFoto({ capturado_en: "2026-11-09T10:00:00.000-05:00", capturado_origen: "exif" }), solo({ fotos: true }));
    expect(plano(texto)).toContain("Foto tomada");
  });

  it("ordena por el instante real aunque los desfases sean distintos", async () => {
    const d = datos([fila({ id: 1, trabajador_cliente: "PRIMERO", foto_path: "a/1.jpg", capturado_en: "2026-11-09T08:00:00-05:00" }), fila({ id: 2, trabajador_cliente: "SEGUNDO", foto_path: "a/2.jpg", capturado_en: "2026-11-09T12:30:00+00:00" })]);
    const { texto } = await pdf(d, solo({ fotos: true }));
    const p = plano(texto);
    // 08:00 Lima es más tarde que 07:30 Lima: va primero en una lista de más reciente a más antigua.
    expect(p.indexOf("Primero")).toBeLessThan(p.indexOf("Segundo"));
  });
});

describe("lo guardado en el dispositivo", () => {
  const local = (extra: Partial<FotoEnBandeja>): FotoEnBandeja => ({ id: "x-0", fotoId: "x", ruta: "salidas/2026-11/local.jpg", clientId: "c1", confirmada: false, tipo: "salida", fecha: "2026-11-09", codigo: "POLO-M", producto: "POLO  ·  Talla M", cantidad: 1, persona: "ANA", area: null, nota: null, registradoPor: "ana", creado: "2026-11-09T10:00:00-05:00", capturadoEn: "2026-11-09T09:00:00-05:00", foto: new Blob(["x"]), ...extra });

  it("lo rechazado no promete enviarse solo", async () => {
    const { texto } = await pdf(datos([]), solo({ fotos: true }), { bandeja: async () => [local({ estado: "rechazado", revision: "Producto no encontrado" })] });
    const p = plano(texto);
    expect(p).toContain("RECHAZADO");
    expect(p).not.toContain("SIN SINCRONIZAR");
    expect(p).toContain("No se env");
  });

  it("lo pendiente sí lo promete", async () => {
    const { texto } = await pdf(datos([]), solo({ fotos: true }), { bandeja: async () => [local({ estado: "pendiente" })] });
    expect(plano(texto)).toContain("SIN SINCRONIZAR");
  });

  it("el conteo previo incluye las fotos que solo están en el dispositivo", () => {
    const d = datos([fila({ foto_path: "salidas/2026-11/a.jpg" })]);
    expect(contarFotos(d, null, null, { bandeja: [local({})] })).toBe(2);
    expect(contarFotos(d, null, null, { bandeja: [local({ confirmada: true })] })).toBe(1);
    expect(contarFotos(d, null, null)).toBe(1);
  });

  it("el conteo cuenta los anulados si se piden", () => {
    const d = datos([fila({ foto_path: "a.jpg", anulado: true })]);
    expect(contarFotos(d, null, null)).toBe(0);
    expect(contarFotos(d, null, null, { conAnulados: true })).toBe(1);
  });
});

describe("cifras del informe", () => {
  it("el total de Queda cuadra aunque haya saldo negativo y lo explica", async () => {
    const stock = [talla({ codigo: "A", talla: "S", tenia_al_inicio: 14, entro: 7, salio: 10, queda: 13 }), talla({ codigo: "B", talla: "M", tenia_al_inicio: 0, entro: 0, salio: 2, queda: -2 })];
    const { texto } = await pdf(datos([], { stock }), solo({ stock: true }));
    const p = plano(texto);
    expect(p).toMatch(/Disponibles: 13; 2 en saldo/);
    expect(p).toContain(" 11 ");
  });

  it("no cuenta a los clientes como personal registrado", async () => {
    const trabajadores = ["ANA", "BETO", "CARLA"].map((trabajador) => ({ trabajador, nombres: null, apellidos: null, area: null, prendas_recibidas: 0, ultima_entrega: null, genero: null }));
    const d = datos([fila({ id: 1, trabajador_cliente: "ANA" }), fila({ id: 2, trabajador_cliente: "CLIENTE SAC" })], { trabajadores });
    const { texto } = await pdf(d, solo({ trabajadores: true }));
    const p = plano(texto);
    expect(p).toMatch(/de las 3/);
    expect(p).toContain("1 cliente");
  });
});

describe("texto justificado", () => {
  it("las celdas de producto que ocupan varias líneas van justificadas", async () => {
    const largo = "POLO MANGA LARGA CON LOGO BORDADO DE LA EMPRESA EN EL PECHO Y CINTAS REFLECTIVAS";
    const d = datos([fila({ producto: `${largo}  ·  Talla M` })]);
    const { texto } = await pdf(d, solo({ movimientos: true }));
    expect([...texto.matchAll(/([\d.]+) Tw/g)].some((m) => Number(m[1]) > 0)).toBe(true);
  });
});
