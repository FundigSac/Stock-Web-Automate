import { describe, expect, it } from "vitest";
import { estadoConexion } from "../../src/components/EstadoRed";
import { cuandoSeGuardo, textoAvisoDatos, textoFalloServidor } from "../../src/lib/avisoDatos";
import { resumir } from "../../src/lib/derive";
import { reglaBajo, segmentosSalud } from "../../src/lib/salud";
import { siguienteFila } from "../../src/lib/teclado";
import type { StockItem } from "../../src/lib/types";

const item = (codigo: string, queda: number): StockItem =>
  ({ codigo, empresa: "EMPRESA PRUEBA", producto: "PRODUCTO", talla: "M", genero: null, tenia_al_inicio: queda, entro: 0, salio: 0, queda, aviso: null, ultimo_movimiento: null }) as StockItem;

describe("B25-1 StockHealthBar", () => {
  it("parte el total con la misma regla que el resto de la app (mínimo de Ajustes)", () => {
    const r = resumir([item("A", 12), item("B", 2), item("C", 1), item("D", 0), item("E", 5)], 2);
    const s = segmentosSalud(r);
    expect(s.map((x) => [x.estado, x.cuenta])).toEqual([
      ["ok", 2],
      ["bajo", 2],
      ["sin", 1],
    ]);
    expect(s.reduce((t, x) => t + x.pct, 0)).toBeCloseTo(100);
  });

  it("solo muestra Saldo negativo cuando existe, y nada si no hay tallas", () => {
    expect(segmentosSalud(resumir([item("A", -1), item("B", 4)], 2)).map((x) => x.estado)).toEqual(["ok", "revisar"]);
    expect(segmentosSalud(resumir([], 2))).toEqual([]);
  });

  it("dice la regla de 'por agotarse' en palabras", () => {
    expect(reglaBajo(2)).toBe("Por agotarse: quedan 2 unidades o menos.");
    expect(reglaBajo(1)).toBe("Por agotarse: quedan 1 unidad.");
    expect(reglaBajo(0)).toMatch(/Sin mínimo/);
  });
});

describe("X10-4 OfflineBanner", () => {
  // 10 nov 2026, 14:05 en Lima (UTC-5).
  const ahora = Date.parse("2026-11-10T19:05:00Z");

  it("dice la hora de los datos guardados, y el día si no son de hoy", () => {
    expect(cuandoSeGuardo(Date.parse("2026-11-10T18:30:00Z"), ahora)).toBe("a las 13:30");
    expect(cuandoSeGuardo(Date.parse("2026-11-07T15:00:00Z"), ahora)).toBe("el 7 nov a las 10:00");
    expect(cuandoSeGuardo(null, ahora)).toBeNull();
  });

  it("sin conexión nunca dice que no hay datos", () => {
    const t = textoAvisoDatos({ enLinea: false, sinSubir: 0, provisionales: 0, guardadoEn: Date.parse("2026-11-10T18:30:00Z"), ahora });
    expect(t).toBe("Sin conexión — mostrando datos guardados a las 13:30.");
    expect(t).not.toMatch(/sin datos|no hay/i);
    expect(textoAvisoDatos({ enLinea: false, sinSubir: 2, provisionales: 2, guardadoEn: null, ahora })).toBe(
      "Sin conexión — mostrando los datos guardados en este dispositivo. Falta subir 2 registros: las cifras son provisionales.",
    );
  });

  it("con conexión solo avisa de cifras provisionales", () => {
    expect(textoAvisoDatos({ enLinea: true, sinSubir: 0, provisionales: 0, guardadoEn: ahora, ahora })).toBeNull();
    expect(textoAvisoDatos({ enLinea: true, sinSubir: 1, provisionales: 1, guardadoEn: ahora, ahora })).toBe("Cifras provisionales: falta subir 1 registro.");
  });

  it("un fallo del servidor con copia dice de cuándo son los datos", () => {
    expect(textoFalloServidor(Date.parse("2026-11-10T18:30:00Z"), ahora)).toBe("El servidor no entregó los datos. Mostrando datos guardados a las 13:30; se reintentará solo.");
  });

  it("la copia del dispositivo no basta para decir 'Conectado'", () => {
    const base = { enLinea: true, subiendo: false, porSubir: 0, sinMigracion: 0, porRevisar: 0, errorDatos: false, tiempoReal: false, edad: 0, ahora };
    expect(estadoConexion({ ...base, ultimaCarga: null }).texto).toBe("Conectando…");
    expect(estadoConexion({ ...base, ultimaCarga: ahora }).texto).toBe("Conectado");
  });
});

describe("B23-3 navegación con flechas", () => {
  it("baja, sube y no se sale de la lista", () => {
    expect(siguienteFila(-1, 5, "ArrowDown")).toBe(0);
    expect(siguienteFila(0, 5, "ArrowDown")).toBe(1);
    expect(siguienteFila(4, 5, "ArrowDown")).toBe(4);
    expect(siguienteFila(0, 5, "ArrowUp")).toBe(0);
    expect(siguienteFila(3, 5, "ArrowUp")).toBe(2);
  });

  it("Inicio, Fin y páginas de 10", () => {
    expect(siguienteFila(2, 30, "Home")).toBe(0);
    expect(siguienteFila(2, 30, "End")).toBe(29);
    expect(siguienteFila(2, 30, "PageDown")).toBe(12);
    expect(siguienteFila(25, 30, "PageDown")).toBe(29);
    expect(siguienteFila(5, 30, "PageUp")).toBe(0);
  });

  it("otras teclas y listas vacías no mueven nada", () => {
    expect(siguienteFila(1, 5, "a")).toBeNull();
    expect(siguienteFila(0, 0, "ArrowDown")).toBeNull();
  });
});
