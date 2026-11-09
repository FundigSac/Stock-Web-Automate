import { describe, expect, it } from "vitest";
import { entender, tallaDe } from "../../src/lib/asistente";
import type { GrupoProducto } from "../../src/lib/derive";
import { nombreTallaEn } from "../../src/lib/format";
import type { StockItem } from "../../src/lib/types";

const contexto = { nombres: new Set(["diego"]), vocab: new Set(["polo"]) };
const talla = (codigo: string, t: string) => ({ codigo, talla: t }) as StockItem;
const grupo = (tallas: StockItem[]) => ({ tallas }) as GrupoProducto;

describe("lo que entiende el chat", () => {
  it("responde al instante qué se está agotando", () => {
    expect(entender("¿Qué está por agotarse?", contexto).accion).toBe("bajo");
  });

  it("una entrega a alguien no es una consulta de lo que falta", () => {
    expect(entender("falta entregar un polo a Diego", contexto).accion).toBe("salida");
  });

  it("no adivina entre dos variantes con la misma talla", () => {
    const g = grupo([talla("A", "C/F - TALLA 30"), talla("B", "S/F - TALLA 30"), talla("C", "C/F - TALLA 32")]);
    expect(tallaDe(g, "30")).toBeNull();
    expect(tallaDe(g, "32")?.codigo).toBe("C");
  });

  it("muestra la variante solo si dos tallas quedarían iguales", () => {
    const tallas = [{ talla: "C/F - TALLA 30" }, { talla: "S/F - TALLA 30" }, { talla: "C/F - TALLA 32" }];
    expect(nombreTallaEn("C/F - TALLA 30", tallas)).toBe("30 C/F");
    expect(nombreTallaEn("C/F - TALLA 32", tallas)).toBe("32");
  });
});
