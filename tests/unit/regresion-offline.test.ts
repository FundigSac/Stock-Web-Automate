import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estadoBanda } from "../../src/components/BandaEstado";
import type { FotoCapturada } from "../../src/lib/foto";
import { abrirAlmacen, cerrarAlmacen, guardarMeta, leerMeta, suscribirBloqueo } from "../../src/lib/offline/almacen";
import { borrarBorrador, guardarBorrador, leerBorrador } from "../../src/lib/offline/borrador";
import { esErrorDeRed, limiteRed } from "../../src/lib/offline/conexion";
import { AVISO_FALTA_SESION, AVISO_OTRA_CUENTA, ErrorSubida, ESPERA_MAX_MS, sincronizar, tocaIntentar, type CargaRegistro, type RespuestaRegistro, type SesionSubida, type Transporte } from "../../src/lib/offline/motor";
import { conProvisional } from "../../src/lib/offline/provisional";
import { marcarEdicion, pedirRecarga } from "../../src/lib/offline/recarga";
import { actualizarItem, descartarItem, encolar, esDeCuenta, fotosHuerfanas, liberarEspacio, listarRespaldo, moverFotosViejas, obtenerItem, textoEstado, textoGuardado, type NuevoRegistro } from "../../src/lib/offline/respaldo";
import { anotarHoraServidor } from "../../src/lib/offline/reloj";
import { clasificarFoto, crearTransporte, fotoConfirmada } from "../../src/lib/offline/transporte";
import { copiaUsable } from "../../src/lib/useLiveData";
import type { Datos, StockItem } from "../../src/lib/types";

vi.mock("../../src/lib/supabase", () => ({ supabase: { auth: {} } }));

const CAPTURA = "2026-11-08T09:30:00.000-05:00";
const AHORA = Date.parse("2026-11-08T14:45:00.000-05:00");
const reloj = () => AHORA;

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
    foto: { id: "11111111-1111-4111-8111-111111111111", blob: new Blob(["foto"], { type: "image/jpeg" }), origen: "camara", origenHora: "camara" },
    ...extra,
  };
}

function servidor(sesion: SesionSubida | null = null) {
  const llamadas = { foto: 0, registro: 0, tokens: [] as (string | null)[] };
  const fallas = new Map<string, unknown>();
  const t: Transporte = {
    sesion: async () => sesion,
    async subirFoto(_r, _f, token) {
      llamadas.foto++;
      llamadas.tokens.push(token);
    },
    async registrar(c: CargaRegistro, token): Promise<RespuestaRegistro> {
      llamadas.registro++;
      llamadas.tokens.push(token);
      const f = fallas.get(c.p_items[0].codigo);
      if (f) throw f;
      return { reloj_desfase_segundos: 0, servidor_ahora: new Date(AHORA).toISOString(), items: c.p_items.map((i, n) => ({ client_id: i.client_id, codigo: i.codigo, id: n + 1, queda: 5 })) };
    },
  };
  return { t, llamadas, fallas };
}

const cuota = () => new DOMException("sin espacio", "QuotaExceededError");

beforeEach(async () => {
  await cerrarAlmacen();
  globalThis.indexedDB = new IDBFactory();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sin espacio", () => {
  it("la foto vive aparte: escribir un estado no reescribe el blob", async () => {
    const it0 = await encolar(registro());
    const db = await abrirAlmacen();
    expect((await db.get("respaldo", it0.id))?.foto).toBeUndefined();
    expect((await db.get("fotos", it0.id))?.blob).toBeInstanceOf(Blob);
    await actualizarItem(it0.id, { intentos: 3 });
    expect((await db.get("respaldo", it0.id))?.foto).toBeUndefined();
    expect((await obtenerItem(it0.id))?.foto).toBeInstanceOf(Blob);
  });

  it("muda las fotos guardadas antes de la versión 2", async () => {
    const it0 = await encolar(registro());
    const db = await abrirAlmacen();
    const crudo = await db.get("respaldo", it0.id);
    await db.put("respaldo", { ...crudo!, foto: new Blob(["vieja"]) });
    await db.delete("fotos", it0.id);
    expect(await moverFotosViejas()).toBe(1);
    expect((await db.get("respaldo", it0.id))?.foto).toBeUndefined();
    expect((await db.get("fotos", it0.id))?.blob).toBeInstanceOf(Blob);
  });

  it("sin espacio para anotar el estado, la subida sigue y deja un recibo", async () => {
    const s = servidor();
    const it0 = await encolar(registro());
    const put = IDBObjectStore.prototype.put;
    const espia = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...a: Parameters<typeof put>) {
      if (this.name === "respaldo") throw cuota();
      return put.apply(this, a);
    });
    const r = await sincronizar(s.t, { reloj, forzar: true });
    expect(s.llamadas).toMatchObject({ foto: 1, registro: 1 });
    expect(r.confirmados).toBe(1);
    expect(r.sinEspacio).toBe(true);
    expect(await leerMeta(`recibo:${it0.id}`)).toBeDefined();

    espia.mockRestore();
    await sincronizar(s.t, { reloj, forzar: true });
    expect((await obtenerItem(it0.id))?.estado).toBe("confirmado");
    expect(s.llamadas.registro).toBe(1);
    expect(await leerMeta(`recibo:${it0.id}`)).toBeUndefined();
  });

  it("si tampoco cabe el recibo, avisa para repetir la vuelta", async () => {
    const s = servidor();
    await encolar(registro());
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw cuota();
    });
    const r = await sincronizar(s.t, { reloj, forzar: true });
    expect(s.llamadas.registro).toBe(1);
    expect(r.reciboFallido).toBe(true);
  });

  it("libera primero las copias más viejas, nunca lo pendiente ni lo que hay que revisar", async () => {
    const viejo = await encolar(registro());
    const nuevo = await encolar(registro());
    const revisar = await encolar(registro());
    const pendiente = await encolar(registro());
    await actualizarItem(viejo.id, { estado: "confirmado", confirmadoEn: 100 });
    await actualizarItem(nuevo.id, { estado: "confirmado", confirmadoEn: 200 });
    await actualizarItem(revisar.id, { estado: "confirmado", confirmadoEn: 50, revision: "mirar" });
    expect(await liberarEspacio(1)).toBe(1);
    const quedan = (await listarRespaldo()).map((i) => i.id);
    expect(quedan).not.toContain(viejo.id);
    expect(quedan).toEqual(expect.arrayContaining([nuevo.id, revisar.id, pendiente.id]));
  });

  it("guarda con durabilidad estricta", async () => {
    const original = IDBDatabase.prototype.transaction;
    const opciones: unknown[] = [];
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...a: Parameters<typeof original>) {
      opciones.push(a[2]);
      return original.apply(this, a);
    });
    await encolar(registro());
    expect(opciones).toContainEqual({ durability: "strict" });
  });
});

describe("una actualización no borra un formulario abierto", () => {
  it("espera a que se cierre la ventana", () => {
    const recargar = vi.fn();
    marcarEdicion("registrar", true);
    pedirRecarga(recargar);
    expect(recargar).not.toHaveBeenCalled();
    marcarEdicion("registrar", false);
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it("sin ventanas abiertas recarga de una vez", () => {
    const recargar = vi.fn();
    pedirRecarga(recargar);
    expect(recargar).toHaveBeenCalledTimes(1);
  });
});

describe("cada registro es de su cuenta", () => {
  const ana = { usuario: "ana-id", token: "jwt-ana" };
  const beto = { usuario: "beto-id", token: "jwt-beto" };

  it("sube con la sesión de su dueño", async () => {
    const s = servidor(ana);
    const it0 = await encolar(registro({ dueno: "ana-id" }));
    await sincronizar(s.t, { reloj });
    expect((await obtenerItem(it0.id))?.estado).toBe("confirmado");
    expect(new Set(s.llamadas.tokens)).toEqual(new Set(["jwt-ana"]));
  });

  it("no sube con la sesión de otra persona ni gasta intentos", async () => {
    const s = servidor(beto);
    const it0 = await encolar(registro({ dueno: "ana-id" }));
    const r = await sincronizar(s.t, { reloj });
    const g = await obtenerItem(it0.id);
    expect(s.llamadas.foto + s.llamadas.registro).toBe(0);
    expect(r.esperanSesion).toBe(1);
    expect(g).toMatchObject({ estado: "pendiente", intentos: 0, ultimoError: AVISO_OTRA_CUENTA });
  });

  it("sin sesión (token vencido en segundo plano) espera y no sube como anónimo", async () => {
    const s = servidor(null);
    const it0 = await encolar(registro({ dueno: "ana-id" }));
    await sincronizar(s.t, { reloj, forzar: true });
    expect(s.llamadas.foto + s.llamadas.registro).toBe(0);
    expect(await obtenerItem(it0.id)).toMatchObject({ intentos: 0, ultimoError: AVISO_FALTA_SESION });
  });

  it("lo guardado sin sesión sigue subiendo sin sesión", async () => {
    const s = servidor(null);
    const it0 = await encolar(registro());
    await sincronizar(s.t, { reloj });
    expect((await obtenerItem(it0.id))?.estado).toBe("confirmado");
    expect(s.llamadas.tokens).toEqual([null, null]);
  });

  it("cada cuenta solo ve lo suyo y lo que no tiene dueño", () => {
    expect(esDeCuenta({ dueno: "ana-id" }, "beto-id")).toBe(false);
    expect(esDeCuenta({ dueno: "ana-id" }, "ana-id")).toBe(true);
    expect(esDeCuenta({ dueno: null }, "beto-id")).toBe(true);
    expect(esDeCuenta({ dueno: "ana-id" }, null)).toBe(false);
  });
});

describe("un registro que falla no detiene a los demás", () => {
  it("un error propio del registro no bloquea la cola ni dice que no hay conexión", async () => {
    const s = servidor();
    s.fallas.set("MALO", new TypeError("x.items es indefinido"));
    const malo = await encolar(registro({ lineas: [{ codigo: "MALO", cantidad: 1, producto: "P", talla: null }] }));
    const bueno = await encolar(registro({ capturadoEn: "2026-11-08T09:31:00.000-05:00" }));
    for (let i = 0; i < 3; i++) await sincronizar(s.t, { reloj, forzar: true });
    expect((await obtenerItem(bueno.id))?.estado).toBe("confirmado");
    const m = await obtenerItem(malo.id);
    expect(m?.estado).toBe("pendiente");
    expect(m?.ultimoError).not.toContain("conexión");
  });

  it("un fallo de red aislado no corta la vuelta", async () => {
    const s = servidor();
    s.fallas.set("RED", new ErrorSubida("red", "cortó"));
    await encolar(registro({ lineas: [{ codigo: "RED", cantidad: 1, producto: "P", talla: null }] }));
    const bueno = await encolar(registro({ capturadoEn: "2026-11-08T09:31:00.000-05:00" }));
    const r = await sincronizar(s.t, { reloj, forzar: true });
    expect((await obtenerItem(bueno.id))?.estado).toBe("confirmado");
    expect(r.sinRed).toBe(false);
  });

  it("una foto ilegible se queda con su registro", async () => {
    const s = servidor();
    const it0 = await encolar(registro());
    const lista = await listarRespaldo();
    vi.spyOn(Blob.prototype, "slice").mockImplementation(() => {
      throw new Error("no se puede leer");
    });
    expect(lista).toHaveLength(1);
    await sincronizar(s.t, { reloj, forzar: true });
    expect(s.llamadas.foto).toBe(0);
    expect((await obtenerItem(it0.id))?.ultimoError).toContain("no se pudo leer");
  });
});

describe("respuestas del servidor", () => {
  it("un JWT vencido en la foto es de sesión, no un rechazo", () => {
    expect(clasificarFoto(400, { statusCode: "400", error: "InvalidJWT", message: '"exp" claim timestamp check failed' })?.clase).toBe("auth");
  });

  it("un 200 que no viene del almacén no cuenta como foto guardada", async () => {
    expect(fotoConfirmada("text/html", {})).toBe(false);
    expect(fotoConfirmada("application/json", {})).toBe(false);
    expect(fotoConfirmada("application/json", { Key: "evidencias/a.jpg" })).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>portal</html>", { status: 200, headers: { "content-type": "text/html" } })));
    const t = crearTransporte({ url: "http://127.0.0.1:54321", anonKey: "k", sesion: async () => null });
    await expect(t.subirFoto("salidas/2026-11/a.jpg", new Blob(["x"]), null)).rejects.toMatchObject({ clase: "red" });
    vi.unstubAllGlobals();
  });

  it("un 200 que no se entiende no revienta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })));
    const t = crearTransporte({ url: "http://127.0.0.1:54321", anonKey: "k", sesion: async () => null });
    await expect(t.registrar({} as CargaRegistro, null)).rejects.toMatchObject({ clase: "servidor" });
    vi.unstubAllGlobals();
  });

  it("no manda la clave anónima si hay token", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ Key: "x" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", f);
    const t = crearTransporte({ url: "http://127.0.0.1:54321", anonKey: "anon", sesion: async () => null });
    await t.subirFoto("a.jpg", new Blob(["x"]), "jwt-ana");
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-ana");
    vi.unstubAllGlobals();
  });
});

describe("cifras provisionales", () => {
  const stock: StockItem = { codigo: "POLO-M", empresa: "F", producto: "POLO", talla: "M", genero: null, tenia_al_inicio: 10, entro: 0, salio: 0, queda: 10, aviso: null, ultimo_movimiento: null };
  const base: Datos = { stock: [stock], entradas: [], salidas: [], trabajadores: [{ trabajador: "DIEGO SOTO", nombres: null, apellidos: null, area: null, prendas_recibidas: 4, ultima_entrega: null, genero: null }], pedidos: [], sync: null };

  it("lo rechazado no cambia el stock", async () => {
    const it0 = await encolar(registro());
    const r = conProvisional(base, [{ ...it0, estado: "rechazado" }]);
    expect(r.provisionales).toBe(0);
    expect(r.datos.stock[0].queda).toBe(10);
    expect(r.datos.trabajadores[0].prendas_recibidas).toBe(4);
  });

  it("lo ya subido que la copia aún no trae sigue restando y avisa", async () => {
    const it0 = await encolar(registro());
    const r = conProvisional(base, [{ ...it0, estado: "confirmado" }]);
    expect(r).toMatchObject({ provisionales: 1, sinCopia: 1, sinSubir: 0 });
    expect(r.datos.stock[0].queda).toBe(8);
    expect(r.datos.salidas[0].sinCopia).toBe(true);
  });

  it("el aviso al guardar no promete subir lo que el servidor rechazó", () => {
    expect(textoGuardado({ estado: "rechazado", revision: "Producto no encontrado" }, "Salida")).toContain("no lo aceptó");
    expect(textoGuardado({ estado: "pendiente", revision: null }, "Salida")).toContain("se subirá");
  });
});

describe("descartar", () => {
  it("borra el registro rechazado y anota su foto para limpiarla", async () => {
    const s = servidor({ usuario: "ana-id", token: "jwt-ana" });
    const borradas: string[] = [];
    s.t.borrarFotoHuerfana = async (ruta) => {
      borradas.push(ruta);
      return "borrada";
    };
    const it0 = await encolar(registro());
    await actualizarItem(it0.id, { estado: "rechazado", fotoSubida: true });
    await descartarItem(it0.id);
    expect(await obtenerItem(it0.id)).toBeUndefined();
    expect(await fotosHuerfanas()).toEqual([it0.fotoRuta]);
    await sincronizar(s.t, { reloj, forzar: true });
    expect(borradas).toEqual([it0.fotoRuta]);
    expect(await fotosHuerfanas()).toEqual([]);
  });

  it("sin sesión no intenta borrar y la deja anotada", async () => {
    const s = servidor(null);
    const borrar = vi.fn(async () => "borrada" as const);
    s.t.borrarFotoHuerfana = borrar;
    const it0 = await encolar(registro());
    await actualizarItem(it0.id, { estado: "rechazado", fotoSubida: true });
    await descartarItem(it0.id);
    await sincronizar(s.t, { reloj, forzar: true });
    expect(borrar).not.toHaveBeenCalled();
    expect(await fotosHuerfanas()).toEqual([it0.fotoRuta]);
  });

  it("no toca una foto que otro registro usa", async () => {
    const a = await encolar(registro());
    await encolar(registro());
    await actualizarItem(a.id, { estado: "rechazado", fotoSubida: true });
    await descartarItem(a.id);
    expect(await fotosHuerfanas()).toEqual([]);
  });

  it("solo se descarta lo rechazado", async () => {
    const a = await encolar(registro());
    await expect(descartarItem(a.id)).rejects.toThrow();
    expect(await obtenerItem(a.id)).toBeDefined();
  });
});

describe("reloj del dispositivo y reintentos", () => {
  it("una espera absurda de un reloj equivocado no se respeta", async () => {
    expect(tocaIntentar(AHORA + 365 * 86_400_000, AHORA)).toBe(true);
    expect(tocaIntentar(AHORA + ESPERA_MAX_MS, AHORA)).toBe(false);
    const s = servidor();
    const it0 = await encolar(registro());
    await actualizarItem(it0.id, { proximoIntentoEn: AHORA + 365 * 86_400_000 });
    await sincronizar(s.t, { reloj });
    expect(s.llamadas.registro).toBe(1);
  });

  it("un reloj adelantado no borra copias: solo cuenta la hora del servidor", async () => {
    const it0 = await encolar(registro());
    await actualizarItem(it0.id, { estado: "confirmado", confirmadoEn: AHORA, desfaseSegundos: 0 });
    const s = servidor();
    await sincronizar(s.t, { reloj: () => AHORA + 8 * 86_400_000 });
    expect(await obtenerItem(it0.id)).toBeDefined();

    await anotarHoraServidor(AHORA + 8 * 86_400_000, AHORA + 8 * 86_400_000);
    await sincronizar(s.t, { reloj: () => AHORA + 8 * 86_400_000 });
    expect(await obtenerItem(it0.id)).toBeUndefined();
  });
});

describe("base de datos", () => {
  it("una pestaña abierta suelta la base cuando otra necesita una versión nueva", async () => {
    await abrirAlmacen();
    const abierta = await new Promise<boolean>((ok) => {
      const r = indexedDB.open("stock-offline", 3);
      r.onsuccess = () => {
        r.result.close();
        ok(true);
      };
      r.onerror = () => ok(false);
      setTimeout(() => ok(false), 2000);
    });
    expect(abierta).toBe(true);
  });

  it("avisa cuando otra pestaña impide actualizar", async () => {
    const vieja = await new Promise<IDBDatabase>((ok) => {
      const r = indexedDB.open("stock-offline", 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore("respaldo", { keyPath: "id" });
        s.createIndex("estado", "estado");
        r.result.createObjectStore("espejo", { keyPath: "campo" });
        r.result.createObjectStore("meta");
      };
      r.onsuccess = () => ok(r.result);
    });
    const estados: boolean[] = [];
    const soltar = suscribirBloqueo((b) => estados.push(b));
    const apertura = abrirAlmacen();
    await vi.waitFor(() => expect(estados).toContain(true));
    vieja.close();
    await apertura;
    await vi.waitFor(() => expect(estados.at(-1)).toBe(false));
    soltar();
  });
});

describe("borrador del formulario", () => {
  const foto = { id: "f", blob: new Blob(["x"]), capturadoEn: CAPTURA, origen: "camara", origenHora: "camara", dudosa: false } as FotoCapturada;
  const b = { dueno: "ana-id", guardadoEn: 1, tipo: "salida" as const, sel: { clave: "POLO", cants: { "POLO-M": "2" } }, quien: "DIEGO", esCliente: false, nota: "n", fechaElegida: null, foto };

  it("sobrevive a una recarga y solo lo recupera su cuenta", async () => {
    await guardarBorrador(b);
    await cerrarAlmacen();
    const leido = await leerBorrador("ana-id");
    expect(leido?.quien).toBe("DIEGO");
    expect(leido?.foto?.blob).toBeInstanceOf(Blob);
    expect(await leerBorrador("beto-id")).toBeNull();
    await borrarBorrador("ana-id");
    expect(await leerBorrador("ana-id")).toBeNull();
  });
});

describe("estado que se muestra", () => {
  it("un 'subiendo' que quedó guardado se muestra como por subir", async () => {
    const it0 = await encolar(registro());
    expect(textoEstado({ ...it0, estado: "subiendo" }, false)).toBe("Por subir");
    expect(textoEstado({ ...it0, estado: "subiendo" }, true)).toBe("Subiendo");
  });

  it("no dice conectado sin una sola lectura correcta", () => {
    const e = { enLinea: true, subiendo: false, porSubir: 0, porRevisar: 0, edad: 0, ultimaCarga: null };
    expect(estadoBanda(e).texto).toBe("Conectando…");
  });

  it("una lectura que no responde cuenta como sin conexión", async () => {
    expect(esErrorDeRed("stock_items: TimeoutError: signal timed out")).toBe(true);
    expect(esErrorDeRed("stock_items: AbortError: signal is aborted")).toBe(true);
    expect(esErrorDeRed("permission denied")).toBe(false);
    await expect(limiteRed(new Promise(() => {}), 5)).rejects.toThrow(/TimeoutError/);
  });

  it("una copia a medias no sirve para trabajar sin conexión", () => {
    expect(copiaUsable({ stock: [] })).toBe(false);
    expect(copiaUsable({ stock: [], trabajadores: [], sync: null })).toBe(false);
    expect(copiaUsable({ stock: [], trabajadores: [], sync: { stock_minimo: 2 } as Datos["sync"] })).toBe(true);
  });

  it("el dato de meta se puede leer y escribir", async () => {
    await guardarMeta("x", 1);
    expect(await leerMeta("x")).toBe(1);
  });
});
