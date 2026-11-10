import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FotoCapturada } from "../../src/lib/foto";
import { abrirAlmacen, cerrarAlmacen, fotoComoBlob, fotoComoBytes, olvidarSondaBlob } from "../../src/lib/offline/almacen";
import { guardarBorrador, leerBorrador } from "../../src/lib/offline/borrador";
import { encolar, listarRespaldo, obtenerItem, type NuevoRegistro } from "../../src/lib/offline/respaldo";

vi.mock("../../src/lib/supabase", () => ({ supabase: { auth: {} } }));

// Safari en navegación privada (y el WebKit de Playwright, que abre contextos efímeros) rechaza los Blob en IndexedDB.
// Aquí se imita: cualquier put que lleve un Blob falla como en WebKit.
function comoWebKitPrivado() {
  const original = IDBObjectStore.prototype.put;
  const llevaBlob = (v: unknown): boolean => v instanceof Blob || (typeof v === "object" && v !== null && Object.values(v).some(llevaBlob));
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, valor: unknown, clave?: IDBValidKey) {
    if (llevaBlob(valor)) throw new DOMException("Error preparing Blob/File data to be stored in object store", "UnknownError");
    return original.call(this, valor, clave);
  });
}

const CAPTURA = "2026-11-08T09:30:00.000-05:00";
const registro = (): NuevoRegistro => ({
  tipo: "salida",
  capturadoEn: CAPTURA,
  guardadoEn: CAPTURA,
  fecha: "2026-11-08",
  quien: "prueba@example.test",
  trabajador: "TRABAJADOR PRUEBA",
  area: null,
  nota: null,
  lineas: [{ codigo: "POLO-M", cantidad: 1, producto: "POLO AZUL", talla: "M" }],
  foto: { id: "22222222-2222-4222-8222-222222222222", blob: new Blob(["foto-de-prueba"], { type: "image/jpeg" }), origen: "camara", origenHora: "camara" },
});

beforeEach(async () => {
  await cerrarAlmacen();
  globalThis.indexedDB = new IDBFactory();
  olvidarSondaBlob();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("fotos en WebKit privado", () => {
  it("los bytes vuelven a ser el mismo Blob", async () => {
    const b = new Blob(["abc"], { type: "image/png" });
    const vuelta = fotoComoBlob(await fotoComoBytes(b))!;
    expect(vuelta).toBeInstanceOf(Blob);
    expect(vuelta.type).toBe("image/png");
    expect(await vuelta.text()).toBe("abc");
    expect(fotoComoBlob(b)).toBe(b);
    expect(fotoComoBlob(null)).toBeNull();
  });

  it("el registro con foto se guarda como bytes y se lee como Blob", async () => {
    comoWebKitPrivado();
    const item = await encolar(registro());
    const db = await abrirAlmacen();
    const guardada = (await db.get("fotos", item.id))?.blob;
    expect(guardada).not.toBeInstanceOf(Blob);
    const leido = await obtenerItem(item.id);
    expect(leido?.foto).toBeInstanceOf(Blob);
    expect(await leido!.foto!.text()).toBe("foto-de-prueba");
    expect((await listarRespaldo())[0].foto?.type).toBe("image/jpeg");
  });

  it("donde sí se aceptan Blob, se siguen guardando como Blob", async () => {
    const item = await encolar(registro());
    const db = await abrirAlmacen();
    expect((await db.get("fotos", item.id))?.blob).toBeInstanceOf(Blob);
  });

  it("el borrador con foto también sobrevive", async () => {
    comoWebKitPrivado();
    const foto = { id: "f", blob: new Blob(["x"], { type: "image/jpeg" }), capturadoEn: CAPTURA, origen: "camara", origenHora: "camara", dudosa: false } as FotoCapturada;
    expect(await guardarBorrador({ dueno: null, guardadoEn: 1, tipo: "salida", sel: { clave: null, cants: {} }, quien: "TRABAJADOR PRUEBA", esCliente: false, nota: "", fechaElegida: null, foto })).toBe("ok");
    await cerrarAlmacen();
    const b = await leerBorrador(null);
    expect(b?.foto?.blob).toBeInstanceOf(Blob);
    expect(await b!.foto!.blob.text()).toBe("x");
  });
});
