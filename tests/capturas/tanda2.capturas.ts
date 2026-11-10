import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Simulado } from "../e2e/simulado";

/**
 * Capturas antes/después de la tanda 2 de ideas (StockHealthBar, aviso sin conexión, pie de la tabla,
 * registro que falla y navegación con flechas). Solo datos simulados.
 * FASE=antes|despues y CAPTURAS=<carpeta> eligen el nombre y el destino.
 */
const FASE = process.env.FASE ?? "despues";
const DESTINO = process.env.CAPTURAS ?? "test-results/capturas-tanda2";
mkdirSync(DESTINO, { recursive: true });

const ANCHOS = [
  [1440, 900],
  [390, 844],
] as const;

const FOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const enVivo = (page: Page) => page.getByRole("status").filter({ hasText: /En vivo|Conectado/ }).filter({ visible: true });
const irA = (page: Page, nombre: RegExp) => page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true }).getByRole("button", { name: nombre }).click();

async function foto(page: Page, nombre: string, ancho: number, completa = true) {
  if (completa) await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(DESTINO, `${nombre}-${ancho}-${FASE}.png`), fullPage: completa, animations: "disabled" });
}

for (const [ancho, alto] of ANCHOS) {
  test.describe(`${ancho}px`, () => {
    test.use({ viewport: { width: ancho, height: alto } });

    test("stock: barra de salud y tabla con total", async ({ context, page }) => {
      const sb = new Simulado();
      await sb.conectar(context);
      await page.goto("/");
      await expect(enVivo(page)).toBeVisible();
      await irA(page, /^Stock/);
      await foto(page, "stock", ancho);
      await page.getByRole("button", { name: /^Lista/ }).click();
      await foto(page, "stock-lista", ancho);
    });

    test("sin conexión con datos guardados", async ({ context, page }) => {
      const sb = new Simulado();
      await sb.conectar(context);
      await page.goto("/");
      await expect(enVivo(page)).toBeVisible();
      // Deja que la copia termine de guardarse y vuelve a abrir la app con la red caída.
      await page.waitForTimeout(800);
      sb.sinRed = true;
      await page.reload();
      // supabase-js reintenta las lecturas (1 s + 2 s + 4 s) antes de dar la red por caída.
      await expect(page.getByRole("status").filter({ hasText: /Sin conexión/ }).filter({ visible: true })).toBeVisible({ timeout: 20_000 });
      await irA(page, /^Stock/);
      await foto(page, "sin-conexion", ancho, false);
    });

    test("registro que no se pudo guardar", async ({ context, page }) => {
      const sb = new Simulado();
      await sb.conectar(context);
      // Hace fallar solo la escritura de la cola local, como un fallo del almacenamiento del navegador.
      await context.addInitScript(() => {
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (this: IDBDatabase, nombres: string | string[], modo?: IDBTransactionMode, opciones?: IDBTransactionOptions) {
          const lista = Array.isArray(nombres) ? nombres : [nombres];
          if ((window as unknown as { __fallarCola?: boolean }).__fallarCola && modo === "readwrite" && lista.includes("respaldo") && lista.includes("fotos")) {
            throw new DOMException("Fallo simulado", "UnknownError");
          }
          return original.call(this, nombres, modo, opciones);
        } as typeof IDBDatabase.prototype.transaction;
      });
      await page.goto("/");
      await expect(enVivo(page)).toBeVisible();
      await page.getByRole("button", { name: "Registrar", exact: true }).filter({ visible: true }).first().click();
      const v = page.getByRole("dialog");
      await v.locator("#reg-autor").fill("Prueba");
      await v.getByRole("tab", { name: /Salida/ }).click();
      await v.locator("#reg-quien").fill("diego");
      await v.getByRole("button", { name: /Diego Soto/ }).click();
      await v.getByRole("button", { name: /Pantalón Drill|Pantalon Drill/ }).click();
      await v.getByRole("button", { name: "Agregar una unidad (Talla 30)" }).click();
      await page.locator("#foto-camara").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: FOTO });
      await expect(v.getByAltText("Foto de la entrega")).toBeVisible();
      await page.evaluate(() => ((window as unknown as { __fallarCola?: boolean }).__fallarCola = true));
      await v.locator("button[type=submit][form=registrar-form]").click();
      await expect(v.getByRole("alert").first()).toBeVisible();
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(DESTINO, `registro-fallido-${ancho}-${FASE}.png`), animations: "disabled" });
    });

    test("movimientos con el teclado", async ({ context, page }) => {
      const sb = new Simulado();
      await sb.conectar(context);
      await page.goto("/");
      await expect(enVivo(page)).toBeVisible();
      await irA(page, /^Movimientos/);
      await expect(page.locator("h1")).toHaveText("Movimientos");
      const filas = page.getByTestId("lista-movimientos").locator("article");
      if (await filas.count()) {
        await filas.first().focus();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowDown");
      } else {
        await page.locator("section").first().scrollIntoViewIfNeeded();
      }
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(DESTINO, `movimientos-teclado-${ancho}-${FASE}.png`), animations: "disabled" });
    });
  });
}
