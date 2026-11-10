import { readFileSync } from "node:fs";
import { openDB } from "idb";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entregasDe, momentoMovimiento } from "../../src/lib/derive";
import { exifAIso, leerExif } from "../../src/lib/exif";
import { edadCopia, titulo } from "../../src/lib/format";
import { avisoFechaFoto, detalleCaptura, origenReal, textoSello, type FotoCapturada } from "../../src/lib/foto";
import { abrirAlmacen, cerrarAlmacen, esVersionVieja, guardarMeta, leerMeta, suscribirRecargaNecesaria, type ItemRespaldo } from "../../src/lib/offline/almacen";
import { guardarBorrador, leerBorrador, type Borrador } from "../../src/lib/offline/borrador";
import { registrarMovimiento } from "../../src/lib/offline/cliente";
import { motivosRevision, sincronizar, type CargaRegistro, type RespuestaRegistro, type Transporte } from "../../src/lib/offline/motor";
import { anotarHoraServidor } from "../../src/lib/offline/reloj";
import * as respaldo from "../../src/lib/offline/respaldo";
import { contarFotos, generarPDF, type FotoEnBandeja, type SeccionesPDF } from "../../src/lib/pdf";
import { crearPedidoEnTandas, llaveDeTanda, PedidoParcial } from "../../src/lib/pedidos";
import { corteDeDatos, inicioLlegadasTarde, movimientosTardios } from "../../src/lib/reporteSemanal";
import { senalConLimite } from "../../src/lib/senal";
import { fotoAntigua } from "../../src/lib/tiempo";
import type { Datos, Movimiento, Salida, StockItem } from "../../src/lib/types";
import { camposFaltantes } from "../../src/lib/useLiveData";

const sb = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../src/lib/supabase", () => ({
  supabase: { auth: {}, rpc: sb.rpc, storage: { from: () => ({ getPublicUrl: (r: string) => ({ data: { publicUrl: `http://127.0.0.1:54321/fotos/${r}` } }) }) } },
}));

const { adoptarItem, encolar, listarRespaldo, obtenerItem, purgarConfirmados, actualizarItem, fotosHuerfanas, descartarItem } = respaldo;
type NuevoRegistro = respaldo.NuevoRegistro;

const raiz = new URL("../../", import.meta.url);
const leer = (r: string) => readFileSync(new URL(r, raiz), "utf8");

const FOTO_ID = "11111111-1111-4111-8111-111111111111";
const CAPTURA = "2026-11-08T09:30:00.000-05:00";
const AHORA = Date.parse("2026-11-08T14:45:00.000-05:00");

function registro(extra: Partial<NuevoRegistro> = {}): NuevoRegistro {
  return {
    tipo: "salida",
    capturadoEn: CAPTURA,
    guardadoEn: CAPTURA,
    fecha: "2026-11-08",
    quien: "ana",
    trabajador: "DIEGO SOTO",
    area: null,
    nota: null,
    lineas: [{ codigo: "POLO-M", cantidad: 2, producto: "POLO AZUL", talla: "M" }],
    foto: { id: FOTO_ID, blob: new Blob(["foto"], { type: "image/jpeg" }), origen: "camara", origenHora: "camara" },
    ...extra,
  };
}

const fotoBorrador = (id = FOTO_ID) => ({ id, blob: new Blob(["x"]), capturadoEn: CAPTURA, origen: "camara", origenHora: "camara", dudosa: false }) as FotoCapturada;
const borrador = (extra: Partial<Borrador> = {}): Borrador => ({ id: "form-1", dueno: "ana-id", guardadoEn: 1, tipo: "salida", sel: { clave: "POLO", cants: { "POLO-M": "2" } }, quien: "DIEGO", esCliente: false, nota: "", fechaElegida: null, foto: fotoBorrador(), ...extra });

const cuota = () => new DOMException("sin espacio", "QuotaExceededError");

function servidor() {
  const registradas: CargaRegistro[] = [];
  const borradas: string[] = [];
  const t: Transporte = {
    sesion: async () => ({ usuario: "u1", token: "t" }),
    async subirFoto() {},
    async registrar(c): Promise<RespuestaRegistro> {
      registradas.push(c);
      return { reloj_desfase_segundos: 0, servidor_ahora: new Date(AHORA).toISOString(), items: c.p_items.map((i, n) => ({ client_id: i.client_id, codigo: i.codigo, id: n + 1, queda: 5 })) };
    },
    async borrarFotoHuerfana(ruta) {
      borradas.push(ruta);
      return "borrada";
    },
  };
  return { t, registradas, borradas };
}

beforeEach(async () => {
  await cerrarAlmacen();
  globalThis.indexedDB = new IDBFactory();
  sb.rpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("el borrador y el registro no coexisten", () => {
  it("encolar borra el borrador de su formulario en la misma escritura", async () => {
    await guardarBorrador(borrador());
    await encolar(registro({ dueno: "ana-id", borrador: { id: "form-1" } }));
    expect(await leerMeta("borrador_registrar:ana-id")).toBeUndefined();
  });

  it("si la escritura falla, el borrador se queda", async () => {
    await guardarBorrador(borrador());
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...a: Parameters<typeof put>) {
      if (this.name === "respaldo") throw new DOMException("no", "UnknownError");
      return put.apply(this, a);
    });
    await expect(encolar(registro({ dueno: "ana-id", borrador: { id: "form-1" } }))).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await leerBorrador("ana-id")).not.toBeNull();
  });

  it("un borrador cuya foto ya está en la cola no se ofrece", async () => {
    await encolar(registro({ dueno: "ana-id" }));
    await guardarBorrador(borrador());
    expect(await leerBorrador("ana-id")).toBeNull();
  });

  it("tras 'Guardar y registrar otro', el borrador del siguiente producto sí se conserva", async () => {
    await encolar(registro({ dueno: "ana-id" }));
    await guardarBorrador(borrador({ id: "form-2", continuacion: true }));
    expect((await leerBorrador("ana-id"))?.id).toBe("form-2");
  });
});

describe("el borrador solo se borra cuando corresponde", () => {
  it("guardar otro formulario no borra un borrador sin resolver", async () => {
    await guardarBorrador(borrador());
    await encolar(registro({ dueno: "ana-id", tipo: "entrada", foto: null, borrador: { id: "otro-form" } }));
    expect((await leerBorrador("ana-id"))?.id).toBe("form-1");
  });

  it("cada cuenta tiene su propio borrador", async () => {
    await guardarBorrador(borrador());
    await guardarBorrador(borrador({ id: "b", dueno: "beto-id", foto: fotoBorrador("22222222-2222-4222-8222-222222222222") }));
    expect((await leerBorrador("ana-id"))?.id).toBe("form-1");
    expect((await leerBorrador("beto-id"))?.id).toBe("b");
  });

  it("se puede guardar sin foto", async () => {
    await guardarBorrador(borrador({ foto: null }));
    const b = await leerBorrador("ana-id");
    expect(b?.foto).toBeNull();
    expect(b?.quien).toBe("DIEGO");
  });

  it("recupera el borrador con el formato anterior", async () => {
    await guardarMeta("borrador_registrar", borrador({ id: undefined }));
    expect((await leerBorrador("ana-id"))?.quien).toBe("DIEGO");
    expect(await leerMeta("borrador_registrar")).toBeUndefined();
  });
});

describe("sin espacio", () => {
  it("avisa cuando el borrador no se pudo guardar", async () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw cuota();
    });
    expect(await guardarBorrador(borrador())).toBe("sin_espacio");
  });

  it("la cola suelta la foto del borrador antes de rendirse", async () => {
    await guardarBorrador(borrador());
    const put = IDBObjectStore.prototype.put;
    let fallos = 1;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...a: Parameters<typeof put>) {
      if (this.name === "respaldo" && fallos-- > 0) throw cuota();
      return put.apply(this, a);
    });
    expect((await encolar(registro({ dueno: "ana-id", borrador: { id: "form-1" } }))).estado).toBe("pendiente");
    expect(await leerMeta("borrador_registrar:ana-id")).toBeUndefined();
  });

  it("un estado pasajero no sacrifica copias: solo la confirmación libera espacio", async () => {
    const it0 = await encolar(registro());
    const put = IDBObjectStore.prototype.put;
    const liberar = vi.spyOn(respaldo, "liberarEspacio");
    let n = 0;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...a: Parameters<typeof put>) {
      // La primera escritura es el "subiendo".
      if (this.name === "respaldo" && n++ === 0) throw cuota();
      return put.apply(this, a);
    });
    const { t } = servidor();
    await sincronizar({ ...t, sesion: async () => null }, { forzar: true, reloj: () => AHORA });
    expect(liberar).not.toHaveBeenCalled();
    expect((await obtenerItem(it0.id))?.estado).toBe("confirmado");
  });
});

describe("versión vieja de la base", () => {
  it("avisa que hay que recargar en vez de quedarse sin poder guardar", async () => {
    await abrirAlmacen();
    const estados: boolean[] = [];
    const soltar = suscribirRecargaNecesaria((r) => estados.push(r));
    const nueva = await openDB("stock-offline", 3);
    expect(estados.at(-1)).toBe(true);
    const e = await encolar(registro()).catch((x: unknown) => x);
    expect(esVersionVieja(e)).toBe(true);
    nueva.close();
    soltar();
  });
});

describe("fotos huérfanas", () => {
  it("no borra una foto que un registro local está usando", async () => {
    const a = await encolar(registro());
    await actualizarItem(a.id, { estado: "rechazado", fotoSubida: true });
    await descartarItem(a.id);
    const ruta = (await fotosHuerfanas())[0];
    expect(ruta).toBeDefined();

    await encolar(registro());
    const { t, borradas } = servidor();
    await sincronizar(t, { forzar: true, reloj: () => AHORA });
    expect(borradas).not.toContain(ruta);
  });

  it("volver a usar la foto la saca de la lista de huérfanas", async () => {
    const ruta = respaldo.rutaFoto("salida", FOTO_ID, CAPTURA);
    await guardarMeta("fotos_huerfanas", [ruta]);
    await encolar(registro());
    expect(await fotosHuerfanas()).toEqual([]);
  });

  it("no pregunta al servidor por una ruta en uso aunque quede anotada", async () => {
    await encolar(registro({ dueno: "u1" }));
    const ruta = respaldo.rutaFoto("salida", FOTO_ID, CAPTURA);
    await guardarMeta("fotos_huerfanas", [ruta]);
    const { t, borradas } = servidor();
    const orig = t.registrar;
    t.registrar = async (...a) => {
      expect(borradas).toEqual([]);
      return orig(...a);
    };
    await sincronizar(t, { forzar: true, reloj: () => AHORA });
    expect(borradas).toEqual([]);
  });
});

describe("copia de 7 días", () => {
  const OCHO_DIAS = 8 * 86_400_000;

  it("lo que hay que revisar no se borra aunque pasen 7 días", async () => {
    const it0 = await encolar(registro());
    await actualizarItem(it0.id, { estado: "confirmado", confirmadoEn: AHORA - OCHO_DIAS, revision: "Saldo negativo" });
    expect(await purgarConfirmados(AHORA)).toBe(0);
    expect(await obtenerItem(it0.id)).toBeDefined();
  });

  it("lo demás sí vence", async () => {
    const it0 = await encolar(registro());
    await actualizarItem(it0.id, { estado: "confirmado", confirmadoEn: AHORA - OCHO_DIAS, revision: null });
    expect(await purgarConfirmados(AHORA)).toBe(1);
  });

  it("un reintento con el desfase del primer intento no la borra de inmediato", async () => {
    const it0 = await encolar(registro());
    await actualizarItem(it0.id, { estado: "confirmado", confirmadoEn: AHORA, confirmadoServidorEn: AHORA, desfaseSegundos: 864_000, revision: null });
    expect(await purgarConfirmados(AHORA + 60_000)).toBe(0);
  });
});

describe("guardar y releer", () => {
  it("un fallo al releer no dice que no se guardó", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    vi.spyOn(respaldo, "obtenerItem").mockRejectedValue(new DOMException("cerrada", "InvalidStateError"));
    const r = await registrarMovimiento(registro());
    expect(r.estado).toBe("pendiente");
    expect(await listarRespaldo()).toHaveLength(1);
  });
});

describe("AbortSignal.timeout", () => {
  it("sin esa función, la señal se cancela igual", async () => {
    vi.stubGlobal("AbortSignal", Object.assign(function () {}, { timeout: undefined }));
    const s = senalConLimite(5);
    expect(s.aborted).toBe(false);
    await vi.waitFor(() => expect(s.aborted).toBe(true));
  });

  it("ningún archivo llama a la función directamente", () => {
    for (const r of ["src/lib/offline/transporte.ts", "src/lib/useLiveData.ts"]) expect(leer(r)).not.toContain("AbortSignal.timeout");
  });
});

describe("pedidos por tandas", () => {
  const items = Array.from({ length: 85 }, (_, i) => ({ codigo: `P${i}`, cantidad: 1 }));
  const ok = (id: number) => ({ data: { ids: [id] }, error: null });
  const malo = { data: null, error: { code: "P0001", message: "No hay permiso" } };

  it("las llaves salen de una sola y son estables por tanda", () => {
    const base = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(llaveDeTanda(base, 1)).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001");
    expect(llaveDeTanda(base, 1)).toBe(llaveDeTanda(base, 1));
  });

  it("si falla una tanda dice cuánto se guardó y al repetir solo manda lo que faltó, con las mismas llaves", async () => {
    sb.rpc.mockResolvedValueOnce(ok(1)).mockResolvedValueOnce(malo);
    const e = await crearPedidoEnTandas("ana", items, "n").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PedidoParcial);
    expect((e as Error).message).toContain("1 de 3 tandas");
    expect((e as Error).message).toContain("40 de 85");

    const llaveSegunda = sb.rpc.mock.calls[1][1].p_client_id;
    sb.rpc.mockReset();
    sb.rpc.mockResolvedValueOnce(ok(2)).mockResolvedValueOnce(ok(3));
    expect(await crearPedidoEnTandas("ana", items, "n")).toEqual([1, 2, 3]);
    expect(sb.rpc).toHaveBeenCalledTimes(2);
    expect(sb.rpc.mock.calls[0][1].p_client_id).toBe(llaveSegunda);
  });

  it("un pedido idéntico hecho después de terminar es otro pedido", async () => {
    sb.rpc.mockResolvedValue(ok(1));
    await crearPedidoEnTandas("ana", items.slice(0, 2), "x");
    const primera = sb.rpc.mock.calls[0][1].p_client_id;
    await crearPedidoEnTandas("ana", items.slice(0, 2), "x");
    expect(sb.rpc.mock.calls[1][1].p_client_id).not.toBe(primera);
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
  p16(26, zona !== undefined ? 2 : 1);
  p16(28, 0x9003);
  p16(30, 2);
  p32(32, 20);
  p32(36, 80);
  if (zona !== undefined) {
    p16(40, 0x9011);
    p16(42, 2);
    p32(44, 7);
    p32(48, 110);
  }
  for (let i = 0; i < fecha.length; i++) tiff.setUint8(80 + i, fecha.charCodeAt(i));
  if (zona !== undefined) for (let i = 0; i < zona.length; i++) tiff.setUint8(110 + i, zona.charCodeAt(i));
  const out = new Uint8Array(12 + 200);
  out.set([0xff, 0xd8, 0xff, 0xe1], 0);
  new DataView(out.buffer).setUint16(4, 208);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  out.set(new Uint8Array(tiff.buffer), 12);
  return out.buffer;
}

describe("hora de la foto", () => {
  const ahora = Date.parse("2026-11-08T23:55:00.000-05:00");
  const archivo = (lastModified: number, contenido: BlobPart = "x") => new File([contenido], "f.jpg", { type: "image/jpeg", lastModified });

  it("un archivo viejo elegido con 'Tomar foto' no queda como tomado ahora", async () => {
    const viejo = Date.parse("2026-10-01T10:00:00.000-05:00");
    const m = await detalleCaptura(archivo(viejo), "camara", ahora);
    expect(m.origenHora).toBe("archivo");
    expect(m.capturadoEn.startsWith("2026-10-01")).toBe(true);
    expect(origenReal("camara", m)).toBe("galeria");
  });

  it("un disparo real sigue siendo de cámara", async () => {
    const m = await detalleCaptura(archivo(ahora - 2000), "camara", ahora);
    expect(m.origenHora).toBe("camara");
    expect(origenReal("camara", m)).toBe("camara");
  });

  it("una copia hecha horas después conserva la hora del EXIF y queda marcada", async () => {
    const m = await detalleCaptura(archivo(Date.parse("2026-11-09T01:00:30.000-05:00"), jpeg("2026:11:08 22:00:00")), "galeria", Date.parse("2026-11-09T02:00:00.000-05:00"));
    expect(m).toEqual({ capturadoEn: "2026-11-08T22:00:00.000-05:00", origenHora: "exif", dudosa: true });
  });

  it("una zona en blanco no se salta la comprobación de zona equivocada", async () => {
    expect(leerExif(jpeg("2026:11:08 14:00:00", "      "))?.desfase).toBeNull();
    const real = Date.parse("2026-11-08T09:00:00.000-05:00");
    const m = await detalleCaptura(archivo(real, jpeg("2026:11:08 14:00:00", "\0\0\0\0\0\0")), "galeria", Date.parse("2026-11-08T10:00:00.000-05:00"));
    expect(m).toMatchObject({ origenHora: "archivo", dudosa: true });
  });

  it("una zona imposible no rompe la foto", async () => {
    expect(leerExif(jpeg("2026:11:08 14:00:00", "+99:99"))?.desfase).toBeNull();
    expect(exifAIso("2026:11:08 14:00:00", "+24:00")).toBe("2026-11-08T14:00:00.000-05:00");
    await expect(detalleCaptura(archivo(ahora - 5 * 3_600_000, jpeg("2026:11:08 14:00:00", "+24:00")), "galeria", ahora)).resolves.toBeDefined();
  });

  it("la pantalla no dice 'Foto del' cuando es la hora de elegirla", () => {
    expect(momentoMovimiento({ fecha: "2026-11-09", creado: CAPTURA, foto: "a.jpg", capturado: CAPTURA, origenHora: "ahora" })).toContain("Elegida el");
  });

  it("el sello distingue una captura de una copia o una fecha dudosa", () => {
    expect(textoSello({ origen: "camara", origenHora: "camara", dudosa: false })).toBeNull();
    expect(textoSello({ origen: "galeria", origenHora: "exif", dudosa: false })).toBe("galería");
    expect(textoSello({ origen: "galeria", origenHora: "archivo", dudosa: false })).toBe("archivo");
    expect(textoSello({ origen: "galeria", origenHora: "ahora", dudosa: false })).toBe("elegida");
    expect(textoSello({ origen: "galeria", origenHora: "exif", dudosa: true })).toBe("revisar");
  });
});

describe("foto vieja de la galería", () => {
  const ahora = Date.parse("2026-11-09T10:00:00.000-05:00");
  const vieja = "2026-05-20T10:00:00.000-05:00";

  it("pasa el límite solo si tiene varios días", () => {
    expect(fotoAntigua("2026-11-07T10:00:00.000-05:00", ahora)).toBe(false);
    expect(fotoAntigua("2026-11-06T10:00:00.000-05:00", ahora)).toBe(true);
  });

  it("el chat dice la fecha, los días y si es dudosa antes de guardar", () => {
    const m = avisoFechaFoto({ capturadoEn: vieja, origenHora: "exif", dudosa: true }, ahora);
    expect(m).toContain("20/05/2026");
    expect(m).toContain("173 días");
    expect(m).toContain("no es segura");
  });

  it("queda marcada para el servidor y con un motivo claro", async () => {
    const it0 = await encolar(registro({ capturadoEn: vieja, guardadoEn: new Date(ahora).toISOString(), fecha: "2026-05-20" }));
    expect(it0.horaDudosa).toBe(true);
    const r = motivosRevision(it0, { reloj_desfase_segundos: 0, items: [] }, ahora);
    expect(r).toContain("2026-05-20");
    expect(r).toContain("revisa que corresponda");
  });
});

describe("reloj y revisión", () => {
  const base: ItemRespaldo = { id: "a", tipo: "entrada", capturadoEn: "2026-11-09T08:00:00.000-05:00", guardadoEn: "2026-11-09T08:00:00.000-05:00", fecha: "2026-11-05", quien: "x", trabajador: null, area: null, nota: null, lineas: [{ clientId: "c", codigo: "P", cantidad: 1, producto: "P", talla: null }], foto: null, fotoRuta: null, fotoOrigen: null, fotoSubida: false, estado: "pendiente", intentos: 0, proximoIntentoEn: 0, ultimoError: null, confirmadoEn: null, desfaseSegundos: null, revision: null, dueno: null, origenHora: "registro", horaDudosa: false, desfaseAlGuardar: 0 };
  const resp = (s: number): RespuestaRegistro => ({ reloj_desfase_segundos: s, items: [{ client_id: "c", codigo: "P", id: 1, queda: 1 }] });

  it("un contacto bueno y un reloj movido después se detectan", () => {
    expect(motivosRevision({ ...base, fecha: "2026-11-09", desfaseAlGuardar: 0 }, resp(-10_800), Date.parse(base.capturadoEn))).toContain("cambió");
  });

  it("un reloj corregido después de un contacto malo no afirma que estaba adelantado", () => {
    const r = motivosRevision({ ...base, fecha: "2026-11-09", desfaseAlGuardar: 7_200 }, resp(0), Date.parse(base.capturadoEn));
    expect(r).not.toContain("adelantado");
    expect(r).toContain("cambió");
  });

  it("una entrada sin foto con fecha elegida no se manda a revisar", () => {
    expect(motivosRevision(base, resp(0), Date.parse(base.capturadoEn))).toBeNull();
  });

  it("el servidor aplica las mismas reglas", () => {
    const sql = leer("supabase/migrations/20261109120000_offline_capturado_en.sql");
    expect(sql).toContain("abs(coalesce(p_desfase_captura, 0)) > abs(v_desfase)");
    expect(sql).toContain("abs(p_desfase_captura - v_desfase) > 300");
    expect(sql).toContain("p_foto is not null and coalesce(p_capturado_origen, '') <> 'registro'");
  });
});

describe("reporte semanal", () => {
  const fila = (extra: Partial<Salida>) => ({ id: 1, fecha: "2026-11-07", codigo: "P", producto: "P", cantidad: 1, foto_path: null, anulado: false, anulado_motivo: null, anulado_por: null, anulado_at: null, creado_por: "a", created_at: "2026-11-07T15:00:00Z", etiqueta: null, cambio_ref: null, trabajador_cliente: "ANA", area: null, nota: null, ...extra }) as Salida;
  const mov = (extra: Partial<Movimiento>): Movimiento => ({ key: "s1", id: 1, tipo: "salida", fecha: "2026-11-07", codigo: "P", producto: "P", cantidad: 1, persona: null, area: null, nota: null, anulado: false, motivo: null, anuladoPor: null, registradoPor: null, creado: "", foto: null, etiqueta: null, cambioRef: null, ...extra });

  it("el corte es la última subida incluida en los datos", () => {
    expect(corteDeDatos({ entradas: [], salidas: [fila({ subido_en: "2026-11-08T15:00:00+00:00" }), fila({ subido_en: "2026-11-08T15:00:40+00:00" })] })).toBe("2026-11-08T15:00:40+00:00");
    expect(corteDeDatos({ entradas: [], salidas: [fila({})] })).toBeNull();
  });

  it("una fila que subió después del corte sale como tardía, aunque se marque más tarde", () => {
    expect(movimientosTardios([mov({ fecha: "2026-11-06", subido: "2026-11-08T15:00:41Z" })], "2026-11-08", "2026-11-08T15:00:40+00:00")).toHaveLength(1);
  });

  it("marcar usa el corte y no la hora de marcar", () => {
    const sql = leer("supabase/migrations/20261109130000_reporte_sabado.sql");
    expect(sql).toContain("p_corte timestamptz default null");
    expect(sql).not.toMatch(/reporte_ultimo_en = now\(\)/);
    const campana = leer("src/components/CampanaReporte.tsx");
    expect(campana).toContain("p_corte: corteDescarga.current");
    expect(campana.indexOf("corteDescarga.current = corteDeDatos(fresco)")).toBeLessThan(campana.indexOf("await generarPDF"));
  });

  it("sin el instante exacto, lo subido el mismo día del reporte no se da por tardío", () => {
    const limite = inicioLlegadasTarde({ reporte_ultimo: "2026-11-07" });
    expect(movimientosTardios([mov({ fecha: "2026-11-07", subido: "2026-11-07T15:00:00Z" })], "2026-11-08", limite)).toHaveLength(0);
    expect(movimientosTardios([mov({ fecha: "2026-11-07", subido: "2026-11-08T15:00:00Z" })], "2026-11-08", limite)).toHaveLength(1);
  });

  it("marcar_reporte_sabado reutiliza marcar_reporte, que guarda la fecha de Lima", () => {
    expect(leer("supabase/migrations/20261109130000_reporte_sabado.sql")).toContain("perform public.marcar_reporte(p_quien)");
  });
});

describe("otra cuenta", () => {
  it("una cuenta autorizada puede tomar un registro que quedó sin dueño posible", async () => {
    const it0 = await encolar(registro({ dueno: "vieja" }));
    await adoptarItem(it0.id, "nueva");
    const r = await obtenerItem(it0.id);
    expect(r?.dueno).toBe("nueva");
    expect(r?.quien).toBe("ana");
  });
});

describe("lo que se ve en pantalla", () => {
  it("una copia sin movimientos no se presenta como historial vacío", () => {
    expect(camposFaltantes({ stock: [], trabajadores: [], pedidos: [], entradas: [] })).toEqual(["salidas"]);
    expect(camposFaltantes({ stock: [], trabajadores: [], pedidos: [], entradas: [], salidas: [] })).toEqual([]);
    // El aviso vive en FallaCarga (ui.tsx) desde X10-4; Movimientos lo usa para su historial.
    expect(leer("src/views/Movimientos.tsx")).toContain("<FallaCarga");
    expect(leer("src/components/ui.tsx")).toContain("no alcanzaron a descargarse");
  });

  it("dice la edad de la copia", () => {
    const ahora = 10 * 86_400_000;
    expect(edadCopia(ahora - 3 * 86_400_000, ahora)).toBe("de hace 3 días");
    expect(edadCopia(ahora - 3_600_000, ahora)).toBe("de hace 1 hora");
    expect(edadCopia(ahora - 30_000, ahora)).toBe("de hace un momento");
    expect(edadCopia(null, ahora)).toBeNull();
  });

  it("las listas conservan la variante de la talla", () => {
    expect(leer("src/views/Stock.tsx")).toContain("nombreTallaEn(s.talla");
    expect(leer("src/views/Resumen.tsx")).toContain("nombreTallaEn(t.talla, g.tallas)");
  });

  it("la miniatura vuelve a intentar al recuperar la conexión", () => {
    expect(leer("src/components/Evidencia.tsx")).toMatch(/if \(enLinea\) setRota\(false\);/);
  });

  it("cerrar sesión solo cierra este dispositivo y siempre termina", () => {
    const auth = leer("src/lib/auth.tsx");
    expect(auth).toContain('signOut({ scope: "local" })');
    expect(auth).not.toContain('"global"');
    expect(auth).toContain("limiteRed(supabase.auth.signOut");
  });

  it("el asistente lee una ventana amplia antes de ordenar", () => {
    expect(leer("supabase/functions/asistente-ia/index.ts")).toContain(".limit(200)");
  });

  it("el diálogo de informes va justificado y 'Todo' incluye los anulados", () => {
    const r = leer("src/components/Reportes.tsx");
    expect(r.match(/text-justify/g)?.length).toBeGreaterThanOrEqual(3);
    expect(r).toContain('eleccionAnulados ?? tipo === "completo"');
  });

  it("un cambio de prenda no cuenta como entrega", () => {
    const s = (extra: Partial<Salida>) => ({ id: 1, fecha: "2026-11-09", codigo: "P", producto: "P", cantidad: 1, foto_path: null, anulado: false, anulado_motivo: null, anulado_por: null, anulado_at: null, creado_por: "a", created_at: "2026-11-09T15:00:00Z", etiqueta: null, cambio_ref: null, trabajador_cliente: "ROSA", area: null, nota: null, ...extra }) as Salida;
    expect(entregasDe([s({ etiqueta: "CAMBIO" }), s({ id: 2 })], "ROSA").map((x) => x.id)).toEqual([2]);
  });

  it("los títulos respetan siglas y palabras cortas", () => {
    expect(titulo("ACEROS SAC")).toBe("Aceros SAC");
    expect(titulo("LIMA O CALLAO")).toBe("Lima o Callao");
  });
});

describe("informe PDF", () => {
  const solo = (s: Partial<SeccionesPDF>): SeccionesPDF => ({ resumen: false, stock: false, movimientos: false, trabajadores: false, fotos: false, ...s });
  const fila = (extra: Partial<Salida>): Salida => ({ id: 1, fecha: "2026-11-09", codigo: "POLO-M", producto: "POLO AZUL  ·  Talla M", cantidad: 1, foto_path: null, anulado: false, anulado_motivo: null, anulado_por: null, anulado_at: null, creado_por: "ana@x.pe", created_at: "2026-11-09T12:00:00+00:00", etiqueta: null, cambio_ref: null, trabajador_cliente: "ANA", area: "A", nota: null, ...extra });
  const talla = (extra: Partial<StockItem>): StockItem => ({ codigo: "POLO-M", empresa: "F", producto: "POLO", talla: "M", genero: null, tenia_al_inicio: 10, entro: 0, salio: 0, queda: 10, aviso: null, ultimo_movimiento: null, ...extra });
  const datos = (salidas: Salida[], extra: Partial<Datos> = {}): Datos => ({ stock: [talla({})], entradas: [], salidas, trabajadores: [], pedidos: [], sync: null, ...extra });
  const local = (extra: Partial<FotoEnBandeja>): FotoEnBandeja => ({ id: "x-0", fotoId: "x", ruta: null, clientId: "c1", confirmada: false, tipo: "entrada", fecha: "2026-11-09", codigo: "POLO-M", producto: "POLO  ·  Talla M", cantidad: 2, persona: null, area: null, nota: null, registradoPor: "ana", creado: "2026-11-09T10:00:00-05:00", capturadoEn: "2026-11-09T10:00:00-05:00", estado: "pendiente", foto: null, ...extra });
  const pedidas: string[] = [];
  const plano = (s: string) => [...s.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1")).join(" ");

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

  it("lo pendiente sin foto sale en una tabla bajo 'sin sincronizar'", async () => {
    const { texto } = await pdf(datos([]), solo({ fotos: true, movimientos: true }), { bandeja: async () => [local({})] });
    const p = plano(texto);
    expect(p).toContain("sin sincronizar");
    expect(p).toContain("POLO-M");
    expect(p).toContain("+2");
  });

  it("el respaldo local entrega también lo que no lleva foto", async () => {
    const { leerRespaldoLocal } = await import("../../src/lib/pdf");
    await encolar(registro({ tipo: "entrada", foto: null, trabajador: null }));
    const b = await leerRespaldoLocal();
    expect(b).toHaveLength(1);
    expect(b[0].foto).toBeNull();
  });

  it("todo tipo de informe avisa lo que no está en sus cifras", async () => {
    for (const s of [solo({ stock: true }), solo({ resumen: true }), solo({ trabajadores: true })]) {
      const { texto } = await pdf(datos([]), s, { bandeja: async () => [local({})] });
      const p = plano(texto);
      expect(p).toContain("Hay 1 registro guardado en este equipo");
      expect(p).toContain("no lo incluyen");
    }
  });

  it("sin nada pendiente no aparece el aviso", async () => {
    expect(plano((await pdf(datos([]), solo({ stock: true }))).texto)).not.toContain("guardado en este equipo");
  });

  it("un registro pendiente no se pierde porque otra fila use su misma foto", async () => {
    const ruta = "salidas/2026-11/misma.jpg";
    const d = datos([fila({ foto_path: ruta, client_id: "otro" })]);
    const b = local({ tipo: "salida", ruta, clientId: "c1", estado: "rechazado", persona: "ANA", foto: new Blob(["x"]) });
    expect(plano((await pdf(d, solo({ fotos: true }), { bandeja: async () => [b] })).texto)).toContain("RECHAZADO");
  });

  it("los anulados de un informe de stock traen sus fotos", async () => {
    const d = datos([fila({ foto_path: "salidas/2026-11/anulada.jpg", anulado: true, anulado_motivo: "error", anulado_por: "ana" })]);
    await pdf(d, solo({ stock: true }), { incluirAnulados: true });
    expect(pedidas.some((u) => u.includes("anulada.jpg"))).toBe(true);
  });

  it("las entregas traen la foto de sus cambios de prenda y el conteo coincide", async () => {
    const d = datos([fila({ foto_path: "salidas/2026-11/cambio.jpg", etiqueta: "CAMBIO" })]);
    await pdf(d, solo({ trabajadores: true }));
    expect(pedidas.some((u) => u.includes("cambio.jpg"))).toBe(true);
    expect(contarFotos(d, null, null, { secciones: solo({ trabajadores: true }) })).toBe(1);
    expect(contarFotos(d, null, null, { secciones: solo({ stock: true }) })).toBe(0);
  });

  it("el conteo con anulados sirve aunque el informe no sea de fotos", () => {
    const d = datos([fila({ foto_path: "a.jpg", anulado: true })]);
    expect(contarFotos(d, null, null, { conAnulados: true, secciones: solo({ stock: true }) })).toBe(1);
  });

  it("lo que espera al servidor no promete volver con la conexión", async () => {
    const p = plano((await pdf(datos([]), solo({ fotos: true }), { bandeja: async () => [local({ estado: "sin_migracion" })] })).texto);
    expect(p).toContain("actualizaci");
    expect(p).not.toContain("Cuando vuelva la conexi");
  });

  it("una línea larga se corta dentro de la tarjeta", async () => {
    const autor = "Maria Fernanda Gonzales Quispe De La Torre Montenegro Villanueva";
    const d = datos([fila({ foto_path: "a/1.jpg", creado_por: autor, area: "ALMACEN CENTRAL DE EQUIPOS DE PROTECCION PERSONAL Y UNIFORMES DE PLANTA" })]);
    const { texto } = await pdf(d, solo({ fotos: true }));
    const lineas = [...texto.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]);
    expect(lineas.some((l) => l.includes("Registr") && l.includes("Villanueva"))).toBe(false);
    expect(lineas.join(" ")).toContain("Villanueva");
  });

  it("corrige mayúsculas y quita la empresa del nombre", async () => {
    const stock = [talla({ empresa: "FUNDIGSAC", producto: "POLO MANGA LARGA - FUNDIGSAC" })];
    const d = datos([fila({ producto: "POLO MANGA LARGA - FUNDIGSAC  ·  Talla M", area: null })], { stock, trabajadores: [] });
    const p = plano((await pdf(d, solo({ movimientos: true, trabajadores: true }))).texto);
    expect(p).toContain("Cliente o sin");
    expect(p).not.toContain("Cliente O");
    expect(p).not.toMatch(/Polo Manga Larga - Fundigsac/);
  });

  it("un tabulador no pega las palabras", async () => {
    const p = plano((await pdf(datos([fila({ nota: "Proveedor\tNorte" })]), solo({ movimientos: true }))).texto);
    expect(p).toContain("Proveedor Norte");
  });

  it("el pie de stock usa un solo formato de número", async () => {
    const stock = [talla({ tenia_al_inicio: 1200, entro: 300, salio: 100, queda: 1400 })];
    const p = plano((await pdf(datos([], { stock }), solo({ stock: true }))).texto);
    expect(p).toContain("1,200");
    expect(p).toContain("1,400");
  });

  it("la fecha del informe sale de la hora del servidor", async () => {
    const ahora = Date.now();
    await anotarHoraServidor(ahora - 3 * 86_400_000, ahora);
    const { fechaLarga } = await import("../../src/lib/format");
    const { hoyLima } = await import("../../src/lib/tiempo");
    const p = plano((await pdf(datos([]), solo({ stock: true }))).texto);
    expect(p).toContain(`Datos al ${fechaLarga(hoyLima(ahora - 3 * 86_400_000))}`);
  });
});
