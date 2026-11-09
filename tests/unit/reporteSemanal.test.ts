import { describe, expect, it } from "vitest";
import { estadoReporte, sabadoCubierto } from "../../src/lib/reporteSemanal";

const INICIO = "2026-08-01";

describe("reporte semanal", () => {
  it("nunca da un periodo al revés después de marcar el reporte hoy", () => {
    const e = estadoReporte(INICIO, "2026-11-08", "2026-11-08");
    expect(e.desde <= "2026-11-08").toBe(true);
  });

  it("un reporte tardío no borra el aviso del sábado siguiente cuando se sabe qué sábado cubrió", () => {
    const e = estadoReporte(INICIO, "2026-11-12", "2026-11-12", "2026-11-07");
    expect(e.fase).toBe("pendiente");
    expect(e.fecha).toBe("2026-11-14");
    expect(e.semaforo).toBe("amarillo");
  });

  it("varias semanas sin reporte cuentan desde la primera que faltó", () => {
    const e = estadoReporte(INICIO, "2026-09-01", "2026-11-09");
    expect(e.fase).toBe("atrasado");
    expect(e.fecha).toBe("2026-09-05");
    expect(e.dias).toBe(-65);
    expect(e.desde).toBe("2026-09-02");
  });

  it("el sábado que cubre un reporte depende de cuándo se saca", () => {
    expect(sabadoCubierto(estadoReporte(INICIO, "2026-10-31", "2026-11-09"))).toBe("2026-11-07");
    expect(sabadoCubierto(estadoReporte(INICIO, "2026-11-07", "2026-11-12", "2026-11-07"))).toBe("2026-11-14");
    expect(sabadoCubierto(estadoReporte(INICIO, "2026-11-07", "2026-11-09", "2026-11-07"))).toBe("2026-11-07");
  });
});
