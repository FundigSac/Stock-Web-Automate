import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estadoBanda } from "../../src/components/BandaEstado";
import { estadoPorSubir } from "../../src/components/estadoPorSubir";
import { cerrarAlmacen, type ItemRespaldo } from "../../src/lib/offline/almacen";
import { ErrorSubida, esperaReintento, sincronizar, type CargaRegistro, type RespuestaRegistro, type Transporte } from "../../src/lib/offline/motor";
import { conProvisional } from "../../src/lib/offline/provisional";
import { actualizarItem, encolar, faltaSubir, listarRespaldo, obtenerItem, porRevisar, purgarConfirmados, reintentarItem, rutaFoto, SinEspacioError, type NuevoRegistro } from "../../src/lib/offline/respaldo";
import { clasificarFoto, clasificarRegistro } from "../../src/lib/offline/transporte";
import type { Datos, StockItem } from "../../src/lib/types";

const CAPTURA = "2026-11-08T09:30:00.000-05:00";
const SUBIDA = Date.parse("2026-11-08T14:45:00.000-05:00");
const reloj = () => SUBIDA;

function registro(extra: Partial<NuevoRegistro> = {}): NuevoRegistro {
  return {
    tipo: "salida",
    capturadoEn: CAPTURA,
    guardadoEn: CAPTURA,
    fecha: "2026-11-08",
    quien: "Cristhian",
    trabajador: "DIEGO SOTO",
    area: "ALMACEN",
    nota: null,
    lineas: [{ codigo: "POLO-M", cantidad: 2, producto: "POLO AZUL", talla: "M" }],
    foto: { id: "11111111-1111-4111-8111-111111111111", blob: new Blob(["foto"], { type: "image/jpeg" }), origen: "camara" },
    ...extra,
  };
}

/** Servidor falso con la misma regla que la migración: una fila por client_id. */
function servidor(stockInicial = 10) {
  const filas = new Map<string, CargaRegistro>();
  const fotos = new Map<string, number>();
  const orden: string[] = [];
  const llamadas = { foto: 0, registro: 0 };
  let queda = stockInicial;
  let desfase = 0;
  let falla: { foto?: ErrorSubida; registro?: ErrorSubida; respuestaPerdida?: boolean } = {};

  const t: Transporte = {
    async subirFoto(ruta) {
      llamadas.foto++;
      if (falla.foto) throw falla.foto;
      fotos.set(ruta, (fotos.get(ruta) ?? 0) + 1);
      orden.push("foto");
    },
    async registrar(carga): Promise<RespuestaRegistro> {
      llamadas.registro++;
      if (falla.registro) throw falla.registro;
      orden.push("fila");
      const items = carga.p_items.map((i, n) => {
        if (!filas.has(i.client_id)) {
          filas.set(i.client_id, carga);
          queda -= i.cantidad;
        }
        return { client_id: i.client_id, codigo: i.codigo, id: 100 + n, queda };
      });
      if (falla.respuestaPerdida) {
        falla.respuestaPerdida = false;
        throw new ErrorSubida("red", "se cortó");
      }
      return { reloj_desfase_segundos: desfase, items };
    },
  };
  return {
    t,
    filas,
    fotos,
    orden,
    llamadas,
    fallar: (f: typeof falla) => {
      falla = f;
    },
    ponerDesfase: (s: number) => {
      desfase = s;
    },
  };
}

beforeEach(async () => {
  await cerrarAlmacen();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("guardar en el dispositivo", () => {
  it("conserva foto, hora de captura y un UUID por línea", async () => {
    const it0 = await encolar(registro());
    const guardado = await obtenerItem(it0.id);
    expect(guardado?.capturadoEn).toBe(CAPTURA);
    expect(guardado?.capturadoEn.endsWith("-05:00")).toBe(true);
    expect(guardado?.foto).toBeInstanceOf(Blob);
    expect(guardado?.lineas[0].clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(guardado?.estado).toBe("pendiente");
  });

  it("la ruta de la foto sale del UUID y del mes de captura, nunca de la hora de subida", () => {
    expect(rutaFoto("salida", "abc", CAPTURA)).toBe("salidas/2026-11/abc.jpg");
    expect(rutaFoto("entrada", "abc", "2026-12-01T00:30:00.000-05:00")).toBe("entradas/2026-12/abc.jpg");
  });

  it("si no hay espacio avisa con un error propio y no deja nada a medias", async () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("sin espacio", "QuotaExceededError");
    });
    await expect(encolar(registro())).rejects.toBeInstanceOf(SinEspacioError);
    vi.restoreAllMocks();
    expect(await listarRespaldo()).toHaveLength(0);
  });
});

describe("subida", () => {
  it("sube primero la foto, luego la fila, con la hora de captura y no la de subida", async () => {
    const s = servidor();
    const it0 = await encolar(registro());
    const r = await sincronizar(s.t, { reloj });
    expect(r.confirmados).toBe(1);
    expect(s.orden).toEqual(["foto", "fila"]);
    const carga = [...s.filas.values()][0];
    expect(carga.p_capturado_en).toBe(CAPTURA);
    expect(carga.p_foto).toBe(it0.fotoRuta);
    expect(carga.p_reloj_dispositivo).toBe("2026-11-08T14:45:00.000-05:00");
  });

  it("confirmado no borra la copia local", async () => {
    const s = servidor();
    const it0 = await encolar(registro());
    await sincronizar(s.t, { reloj });
    const guardado = await obtenerItem(it0.id);
    expect(guardado?.estado).toBe("confirmado");
    expect(guardado?.foto).toBeInstanceOf(Blob);
    expect(guardado?.confirmadoEn).toBe(SUBIDA);
  });

  it("si falla la foto no se manda la fila ni se borra nada", async () => {
    const s = servidor();
    s.fallar({ foto: new ErrorSubida("red", "sin red") });
    const it0 = await encolar(registro());
    const r = await sincronizar(s.t, { reloj });
    expect(r.sinRed).toBe(true);
    expect(s.llamadas.registro).toBe(0);
    const guardado = await obtenerItem(it0.id);
    expect(guardado?.estado).toBe("pendiente");
    expect(guardado?.foto).toBeInstanceOf(Blob);
    expect(guardado?.intentos).toBe(1);
  });

  it("un reintento no duplica: el servidor guardó, se perdió la respuesta y se vuelve a enviar", async () => {
    const s = servidor();
    s.fallar({ respuestaPerdida: true });
    const it0 = await encolar(registro());
    await sincronizar(s.t, { reloj });
    expect((await obtenerItem(it0.id))?.estado).toBe("pendiente");
    expect(s.filas.size).toBe(1);

    await sincronizar(s.t, { reloj, forzar: true });
    expect((await obtenerItem(it0.id))?.estado).toBe("confirmado");
    expect(s.llamadas.registro).toBe(2);
    expect(s.filas.size).toBe(1);
    // La foto ya estaba arriba: no se sube otra vez.
    expect(s.llamadas.foto).toBe(1);
    expect([...s.fotos.values()]).toEqual([1]);
  });

  it("dos subidas a la vez no procesan dos veces", async () => {
    const s = servidor();
    await encolar(registro());
    await Promise.all([sincronizar(s.t, { reloj }), sincronizar(s.t, { reloj })]);
    expect(s.llamadas.registro).toBe(1);
  });

  it("respeta la espera entre intentos, salvo que se fuerce", async () => {
    const s = servidor();
    s.fallar({ registro: new ErrorSubida("servidor", "500") });
    await encolar(registro());
    await sincronizar(s.t, { reloj, azar: () => 0.5 });
    expect(s.llamadas.registro).toBe(1);
    await sincronizar(s.t, { reloj });
    expect(s.llamadas.registro).toBe(1);
    await sincronizar(s.t, { reloj, forzar: true });
    expect(s.llamadas.registro).toBe(2);
    await sincronizar(s.t, { reloj: () => SUBIDA + 3_600_000 });
    expect(s.llamadas.registro).toBe(3);
  });

  it("la espera crece y tiene tope", () => {
    const fijo = () => 0.5;
    expect(esperaReintento(1, fijo)).toBe(5_000);
    expect(esperaReintento(2, fijo)).toBe(10_000);
    expect(esperaReintento(3, fijo)).toBe(20_000);
    expect(esperaReintento(30, fijo)).toBe(30 * 60_000);
  });

  it("sin red corta la vuelta: tras dos fallos seguidos no gasta intentos en los demás", async () => {
    const s = servidor();
    s.fallar({ foto: new ErrorSubida("red", "sin red") });
    await encolar(registro());
    await encolar(registro({ capturadoEn: "2026-11-08T09:31:00.000-05:00" }));
    await encolar(registro({ capturadoEn: "2026-11-08T09:32:00.000-05:00" }));
    await sincronizar(s.t, { reloj });
    expect(s.llamadas.foto).toBe(2);
  });
});

describe("casos por revisar", () => {
  it("más de 5 minutos de desfase: lo marca y no toca capturado_en", async () => {
    const s = servidor();
    s.ponerDesfase(-720);
    const it0 = await encolar(registro());
    await sincronizar(s.t, { reloj });
    const g = await obtenerItem(it0.id);
    expect(g?.desfaseSegundos).toBe(-720);
    expect(g?.revision).toContain("12 min atrasado");
    expect(g?.capturadoEn).toBe(CAPTURA);
    expect(g && porRevisar(g)).toBe(true);
    expect([...s.filas.values()][0].p_capturado_en).toBe(CAPTURA);
  });

  it("5 minutos justos todavía no se marcan", async () => {
    const s = servidor();
    s.ponerDesfase(300);
    const it0 = await encolar(registro());
    await sincronizar(s.t, { reloj });
    expect((await obtenerItem(it0.id))?.revision).toBeNull();
  });

  it("si la salida deja el servidor en negativo, se conserva y explica por qué", async () => {
    const s = servidor(1);
    const it0 = await encolar(registro());
    await sincronizar(s.t, { reloj });
    const g = await obtenerItem(it0.id);
    expect(g?.estado).toBe("confirmado");
    expect(g?.revision).toContain("quedó en -1");
    expect(g && porRevisar(g)).toBe(true);
  });

  it("si el servidor la rechaza, sigue guardada, con motivo, y se puede reintentar", async () => {
    const s = servidor();
    s.fallar({ registro: new ErrorSubida("rechazado", "No hay stock suficiente.") });
    const it0 = await encolar(registro());
    await sincronizar(s.t, { reloj });
    let g = await obtenerItem(it0.id);
    expect(g?.estado).toBe("rechazado");
    expect(g?.revision).toBe("No hay stock suficiente.");
    expect(g?.foto).toBeInstanceOf(Blob);

    // No se reintenta sola.
    await sincronizar(s.t, { reloj, forzar: true });
    expect(s.llamadas.registro).toBe(1);

    s.fallar({});
    await reintentarItem(it0.id);
    await sincronizar(s.t, { reloj, forzar: true });
    g = await obtenerItem(it0.id);
    expect(g?.estado).toBe("confirmado");
  });

  it("sin la migración aplicada queda en cola con aviso y sube cuando esté lista", async () => {
    const s = servidor();
    s.fallar({ registro: clasificarRegistro(404, { code: "PGRST202", message: "Could not find the function" }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const it0 = await encolar(registro());
    await sincronizar(s.t, { reloj });
    let g = await obtenerItem(it0.id);
    expect(g?.estado).toBe("sin_migracion");
    expect(g?.ultimoError).toContain("Sigue guardado aquí");
    expect(g && faltaSubir(g)).toBe(true);

    s.fallar({});
    await sincronizar(s.t, { reloj, forzar: true });
    g = await obtenerItem(it0.id);
    expect(g?.estado).toBe("confirmado");
    expect(s.filas.size).toBe(1);
  });
});

describe("limpieza de copias", () => {
  it("borra lo confirmado hace más de 7 días y nada más", async () => {
    const dia = 86_400_000;
    const viejo = await encolar(registro());
    const reciente = await encolar(registro());
    const sinSubir = await encolar(registro());
    const rechazado = await encolar(registro());
    await actualizarItem(viejo.id, { estado: "confirmado", confirmadoEn: SUBIDA - 8 * dia });
    await actualizarItem(reciente.id, { estado: "confirmado", confirmadoEn: SUBIDA - 6 * dia });
    await actualizarItem(sinSubir.id, { intentos: 90 });
    await actualizarItem(rechazado.id, { estado: "rechazado" });

    expect(await purgarConfirmados(SUBIDA)).toBe(1);
    const quedan = (await listarRespaldo()).map((i) => i.id);
    expect(quedan).not.toContain(viejo.id);
    expect(quedan).toEqual(expect.arrayContaining([reciente.id, sinSubir.id, rechazado.id]));
  });
});

describe("cifras provisionales", () => {
  const stock: StockItem = { codigo: "POLO-M", empresa: "FUNDIGSAC", producto: "POLO AZUL", talla: "M", genero: null, tenia_al_inicio: 10, entro: 0, salio: 0, queda: 10, aviso: null, ultimo_movimiento: null };
  const base: Datos = { stock: [stock], entradas: [], salidas: [], trabajadores: [], pedidos: [], sync: null };

  it("resta lo que falta subir y marca la fila como pendiente", async () => {
    const it0 = (await encolar(registro())) as ItemRespaldo;
    const { datos, provisionales } = conProvisional(base, [it0]);
    expect(provisionales).toBe(1);
    expect(datos.stock[0].queda).toBe(8);
    expect(datos.salidas[0]).toMatchObject({ pendiente: true, capturado_en: CAPTURA, trabajador_cliente: "DIEGO SOTO" });
  });

  it("no cuenta dos veces lo que el servidor ya tiene", async () => {
    const it0 = (await encolar(registro())) as ItemRespaldo;
    const yaArriba = { ...base, salidas: [{ client_id: it0.lineas[0].clientId } as Datos["salidas"][number]] };
    const { datos, provisionales } = conProvisional(yaArriba, [it0]);
    expect(provisionales).toBe(0);
    expect(datos.stock[0].queda).toBe(10);
  });

  it("lo confirmado que ya está en la copia no se suma", async () => {
    const it0 = (await encolar(registro())) as ItemRespaldo;
    const yaArriba = { ...base, salidas: [{ client_id: it0.lineas[0].clientId } as Datos["salidas"][number]] };
    expect(conProvisional(yaArriba, [{ ...it0, estado: "confirmado" }]).provisionales).toBe(0);
  });
});

describe("respuestas del servidor", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("clasifica lo que falta por migrar", () => {
    expect(clasificarRegistro(404, { code: "PGRST202" }).clase).toBe("sin_migracion");
    expect(clasificarRegistro(400, { code: "42703" }).clase).toBe("sin_migracion");
  });

  it("no enseña errores técnicos a quien usa la app", () => {
    const e = clasificarRegistro(400, { code: "23514", message: 'new row violates check constraint "x"' });
    expect(e.clase).toBe("rechazado");
    expect(e.message).not.toContain("constraint");
    expect(clasificarRegistro(400, { code: "P0001", message: "Producto no encontrado." }).message).toBe("Producto no encontrado.");
  });

  it("distingue sesión vencida de fallo del servidor", () => {
    expect(clasificarRegistro(401, {}).clase).toBe("auth");
    expect(clasificarRegistro(503, {}).clase).toBe("servidor");
  });

  it("una foto que ya existe cuenta como subida", () => {
    expect(clasificarFoto(409, {})).toBeNull();
    expect(clasificarFoto(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" })).toBeNull();
    expect(clasificarFoto(500, {})?.clase).toBe("servidor");
  });

  it("el freno de ritmo retrasa la subida y no la manda a revisión", () => {
    expect(clasificarRegistro(400, { code: "P0001", message: "Demasiados registros seguidos. Espera un momento e inténtalo de nuevo." }).clase).toBe("servidor");
    const foto = clasificarFoto(400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
    expect(foto?.clase).toBe("servidor");
    expect(foto?.message).not.toContain("row-level");
  });
});

describe("frase de estado", () => {
  const base = { enLinea: true, subiendo: false, porSubir: 0, porRevisar: 0, edad: 1, ultimaCarga: Date.now() };

  it("dice cuánto falta cuando no hay conexión", () => {
    expect(estadoBanda({ ...base, enLinea: false, porSubir: 3 }).texto).toBe("Sin conexión · 3 por subir");
    expect(estadoBanda({ ...base, enLinea: false }).texto).toBe("Sin conexión · Puedes seguir registrando");
  });

  it("con conexión pasa por subiendo, por subir y en línea", () => {
    expect(estadoBanda({ ...base, subiendo: true, porSubir: 2 }).texto).toBe("Subiendo 2…");
    expect(estadoBanda({ ...base, porSubir: 2 }).texto).toBe("2 por subir · Subir ahora");
    expect(estadoBanda(base).texto).toBe("En línea · Todo subido");
  });

  it("lo que espera la actualización del servidor sigue contando como por subir", () => {
    expect(estadoBanda({ ...base, porSubir: 1 }).texto).toBe("1 por subir · Subir ahora");
  });

  it("aplica el primer caso que coincide", () => {
    expect(estadoBanda({ ...base, porRevisar: 1, porSubir: 4, enLinea: false }).texto).toBe("1 por revisar");
    expect(estadoBanda({ ...base, enLinea: false, porSubir: 2, subiendo: true }).texto).toBe("Sin conexión · 2 por subir");
    expect(estadoBanda({ ...base, subiendo: true }).texto).toBe("En línea · Todo subido");
  });

  it("cada estado lleva su color e icono de la tabla", () => {
    expect(estadoBanda({ ...base, porRevisar: 1 }).tono).toBe("revisar");
    expect(estadoBanda({ ...base, enLinea: false }).tono).toBe("sin-red");
    expect(estadoBanda({ ...base, porSubir: 1 }).tono).toBe("subir");
    expect(estadoBanda(base).tono).toBe("ok");
  });

  it("sin una lectura reciente no dice que hay conexión", () => {
    expect(estadoBanda({ ...base, edad: 91 }).texto).toBe("Conectando…");
    expect(estadoBanda({ ...base, edad: 91, porSubir: 2 }).texto).toBe("2 por subir · Subir ahora");
  });

  it("la fila de un pendiente no contradice a la banda", () => {
    // Con red la banda dice "1 por subir · Subir ahora": la fila no puede decir "Esperando conexión".
    expect(estadoBanda({ ...base, porSubir: 1 }).texto).toBe("1 por subir · Subir ahora");
    expect(estadoPorSubir({ estado: "pendiente" }, false, true).texto).toBe("Por subir");
    expect(estadoPorSubir({ estado: "subiendo" }, false, true).texto).toBe("Por subir");
    expect(estadoPorSubir({ estado: "pendiente" }, false, false).texto).toBe("Esperando conexión");
    expect(estadoPorSubir({ estado: "subiendo" }, true, true).texto).toBe("Subiendo");
  });
});
