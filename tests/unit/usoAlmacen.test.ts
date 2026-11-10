import { beforeEach, describe, expect, it, vi } from "vitest";
import { esUsoValido, fraccionUso, hayQueAvisar, leerUsoGuardado, textoLimite, textoMb } from "../../src/lib/usoAlmacen";

const MB = 1048576;
const GB = 1073741824;

describe("espacio usado", () => {
  it("escribe los megas con un decimal por debajo de 10 y enteros desde ahí", () => {
    expect(textoMb(3.4 * MB)).toBe("3.4 MB");
    expect(textoMb(120 * MB)).toBe("120 MB");
  });

  it("escribe los límites del plan", () => {
    expect(textoLimite(GB)).toBe("1 GB");
    expect(textoLimite(524288000)).toBe("500 MB");
  });

  it("avisa desde el 80 %, no antes", () => {
    expect(hayQueAvisar(0.79 * GB, GB)).toBe(false);
    expect(hayQueAvisar(0.8 * GB, GB)).toBe(true);
    expect(fraccionUso(1, 0)).toBe(0);
  });

  it("rechaza respuestas que no traen las cifras", () => {
    expect(esUsoValido([])).toBe(false);
    expect(esUsoValido(null)).toBe(false);
    expect(esUsoValido({ base_bytes: 1, base_limite: 0, fotos_bytes: 1, fotos_limite: 1, fotos: 1 })).toBe(false);
    expect(esUsoValido({ base_bytes: 1, base_limite: 2, fotos_bytes: 1, fotos_limite: 2, fotos: 0 })).toBe(true);
  });
});

describe("último valor conocido", () => {
  beforeEach(() => {
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => guardado.get(k) ?? null,
      setItem: (k: string, v: string) => guardado.set(k, v),
    });
  });

  it("devuelve lo guardado, o nada si no hay o está dañado", () => {
    expect(leerUsoGuardado()).toBeNull();
    localStorage.setItem("stock_uso_almacen_v1", "{dañado");
    expect(leerUsoGuardado()).toBeNull();
    const uso = { base_bytes: 1, base_limite: 2, fotos_bytes: 1, fotos_limite: 2, fotos: 0 };
    localStorage.setItem("stock_uso_almacen_v1", JSON.stringify(uso));
    expect(leerUsoGuardado()).toEqual(uso);
  });
});
