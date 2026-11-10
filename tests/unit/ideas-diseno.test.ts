import { describe, expect, it } from "vitest";
import { agruparProductos, entregasDe, estadoProducto, GRAVEDAD, signoMovimiento, textoEstadoProducto } from "../../src/lib/derive";
import { entero } from "../../src/lib/format";
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

describe("X12-4: los movimientos llevan signo y sentido", () => {
  it("entrada sube con + y flecha arriba; salida baja con signo de resta y flecha abajo", () => {
    expect(signoMovimiento("entrada", 12)).toEqual({ texto: "+12", flecha: "↑", lectura: "Entrada de 12 unidades" });
    expect(signoMovimiento("salida", 3)).toEqual({ texto: "−3", flecha: "↓", lectura: "Salida de 3 unidades" });
    expect(signoMovimiento("salida", 1).lectura).toBe("Salida de 1 unidad");
    expect(signoMovimiento("entrada", 1200).texto).toBe(`+${entero(1200)}`);
  });

  it("una anulada lo dice en voz alta", () => {
    expect(signoMovimiento("salida", 2, true).lectura).toBe("Salida de 2 unidades, anulada: no cuenta en el stock");
  });

  it("el historial de una persona puede incluir las anuladas sin cambiar el de siempre", () => {
    const s = (id: number, anulado: boolean) => ({ id, fecha: "2026-11-05", codigo: "P", producto: "P", cantidad: 1, trabajador_cliente: "DIEGO", area: null, nota: null, foto_path: null, anulado, anulado_motivo: null, anulado_por: null, anulado_at: null, creado_por: null, created_at: "2026-11-05T10:00:00Z", etiqueta: null, cambio_ref: null });
    const salidas = [s(1, false), s(2, true)];
    expect(entregasDe(salidas, "DIEGO").map((x) => x.id)).toEqual([1]);
    expect(entregasDe(salidas, "DIEGO", true).map((x) => x.id).sort()).toEqual([1, 2]);
  });
});
