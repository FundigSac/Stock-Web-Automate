import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EsqueletoVista } from "../../src/components/Esqueletos";
import type { Vista } from "../../src/views/tipos";

describe("B12-1: esqueleto con la forma de cada vista", () => {
  const vistas: Vista[] = ["resumen", "stock", "movimientos", "trabajadores", "respaldo"];

  it.each(vistas)("%s se marca ocupado y avisa que carga, sin decir que no hay datos", (vista) => {
    const html = renderToStaticMarkup(createElement(EsqueletoVista, { vista }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(`data-esqueleto="${vista}"`);
    expect(html).toContain("Cargando datos…");
    expect(html).not.toMatch(/No hay|Sin movimientos|Todavía no/);
    // Los bloques son decorativos: el lector de pantalla oye solo "Cargando datos…".
    const bloques = html.match(/class="skeleton[^"]*"/g) ?? [];
    expect(bloques.length).toBeGreaterThan(3);
    expect(html.match(/class="skeleton[^"]*" aria-hidden="true"/g)?.length).toBe(bloques.length);
  });

  it("usa las mismas tarjetas que el contenido real", () => {
    const html = renderToStaticMarkup(createElement(EsqueletoVista, { vista: "stock" }));
    expect(html).toContain("rounded-2xl border border-line-2 bg-surface p-4 shadow-card");
    expect(renderToStaticMarkup(createElement(EsqueletoVista, { vista: "resumen" }))).toContain("rounded-3xl bg-ink p-6 shadow-pop");
  });
});
