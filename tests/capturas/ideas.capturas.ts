import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Simulado } from "../e2e/simulado";

/**
 * Capturas antes/después de las ideas de diseño, solo con datos simulados.
 * FASE=antes|despues y CAPTURAS=<carpeta> eligen el nombre y el destino.
 */
const FASE = process.env.FASE ?? "despues";
const DESTINO = process.env.CAPTURAS ?? "test-results/capturas";
mkdirSync(DESTINO, { recursive: true });

const ANCHOS = [
  [1280, 800],
  [390, 844],
] as const;

const enVivo = (page: Page) => page.getByRole("status").filter({ hasText: /En vivo|Conectado/ }).filter({ visible: true });
const irA = (page: Page, nombre: RegExp) => page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true }).getByRole("button", { name: nombre }).click();

async function foto(page: Page, nombre: string, ancho: number, completa = true) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(DESTINO, `${nombre}-${ancho}-${FASE}.png`), fullPage: completa, animations: "disabled" });
}

for (const [ancho, alto] of ANCHOS) {
  test.describe(`${ancho}px`, () => {
    test.use({ viewport: { width: ancho, height: alto } });

    test("vistas con datos", async ({ context, page }) => {
      const sb = new Simulado();
      await sb.conectar(context);
      await page.goto("/");
      await expect(enVivo(page)).toBeVisible();
      await foto(page, "resumen", ancho);
      await irA(page, /^Stock/);
      await foto(page, "stock", ancho);
      await page.getByRole("button", { name: /^Lista/ }).click();
      await foto(page, "stock-lista", ancho);
      await page.getByRole("button", { name: /^Por producto/ }).click();
      await page.getByRole("button", { name: /Polo Azul/ }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await foto(page, "detalle-producto", ancho, false);
      await page.keyboard.press("Escape");
      await irA(page, /^Movimientos/);
      const anulados = page.getByRole("button", { name: /Mostrar anulados/ });
      if (await anulados.count()) await anulados.click();
      await foto(page, "movimientos", ancho);
      await irA(page, /^Trabajadores/);
      await page.getByRole("button", { name: /Diego Soto/ }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await foto(page, "detalle-trabajador", ancho, false);
    });

    test("cargando", async ({ context, page }) => {
      const sb = new Simulado();
      let soltar = () => {};
      sb.espera = new Promise<void>((ok) => (soltar = ok));
      await sb.conectar(context);
      await page.goto("/");
      await expect.poll(() => sb.lecturas).toBeGreaterThan(0);
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(DESTINO, `cargando-${ancho}-${FASE}.png`), animations: "disabled" });
      soltar();
    });

    test("error de carga", async ({ context, page }) => {
      const sb = new Simulado();
      sb.fallan = new Set(["stock_items", "entradas", "salidas", "trabajadores", "ajustes", "pedidos"]);
      await sb.conectar(context);
      await page.goto("/");
      await expect(page.getByText(/No se pudieron cargar|no entregó/).first()).toBeVisible();
      await foto(page, "error", ancho, false);
    });
  });
}
