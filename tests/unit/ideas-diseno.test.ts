import { describe, expect, it } from "vitest";
import { agruparProductos, estadoProducto, GRAVEDAD, textoEstadoProducto } from "../../src/lib/derive";
import type { StockItem } from "../../src/lib/types";

const talla = (codigo: string, queda: number, producto = "POLO AZUL"): StockItem => ({
  codigo,
  empresa: "FUNDIGSAC",
  producto,
  talla: codigo.split("-")[1] ?? null,
  genero: null,
  tenia_al_inicio: queda,
  entro: 0,
  salio: 0,
  queda,
  aviso: null,
  ultimo_movimiento: null,
});

describe("B9-2 + X12-2: el estado del producto es el de su peor talla", () => {
  it("una talla agotada pesa más que una por agotarse", () => {
    const ep = estadoProducto([talla("P-S", 12), talla("P-M", 2), talla("P-L", 0)], 2);
    expect(ep).toEqual({ estado: "sin", afectadas: 1, total: 3 });
    expect(textoEstadoProducto(ep)).toBe("Sin stock · 1 de 3 tallas");
  });

  it("un saldo negativo es lo más grave", () => {
    expect(estadoProducto([talla("P-S", 0), talla("P-M", -1)], 2).estado).toBe("revisar");
    expect(GRAVEDAD.revisar).toBeLessThan(GRAVEDAD.sin);
    expect(GRAVEDAD.sin).toBeLessThan(GRAVEDAD.bajo);
    expect(GRAVEDAD.bajo).toBeLessThan(GRAVEDAD.ok);
  });

  it("si todas las tallas comparten el estado no se agrega el conteo", () => {
    expect(textoEstadoProducto(estadoProducto([talla("P-S", 9), talla("P-M", 5)], 2))).toBe("Con stock");
    expect(textoEstadoProducto(estadoProducto([talla("P-S", 0), talla("P-M", 0)], 2))).toBe("Sin stock");
    expect(textoEstadoProducto(estadoProducto([talla("P-U", 1)], 2))).toBe("Por agotarse");
  });

  it("cuenta todas las tallas que están en el peor estado", () => {
    const ep = estadoProducto([talla("P-S", 1), talla("P-M", 2), talla("P-L", 7)], 2);
    expect(ep).toEqual({ estado: "bajo", afectadas: 2, total: 3 });
    expect(textoEstadoProducto(ep)).toBe("Por agotarse · 2 de 3 tallas");
  });

  it("agruparProductos usa la misma gravedad", () => {
    const [g] = agruparProductos([talla("P-S", 1), talla("P-M", 0)], 2);
    expect(g.peor).toBe("sin");
  });
});
