import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Simulado } from "./simulado";

// Tanda 2 de ideas (B25-1, X10-4, B6-2, X10-5, B23-3), siempre con datos simulados.

const FOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const enVivo = (page: Page) => page.getByRole("status").filter({ hasText: /En vivo|Conectado/ }).filter({ visible: true });
const sinConexion = (page: Page) => page.getByRole("status").filter({ hasText: /^Sin conexión/ }).filter({ visible: true });
const irA = (page: Page, nombre: RegExp) => page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true }).getByRole("button", { name: nombre }).click();
const mostrando = (page: Page) => page.getByText(/^Mostrando \d+ de \d+ tallas$/);

async function abrir(page: Page, sb = new Simulado()) {
  await sb.conectar(page.context());
  await page.goto("/");
  await expect(enVivo(page)).toBeVisible();
  return sb;
}

test.describe("B25-1 StockHealthBar", () => {
  test("los tramos cuentan con la regla del mínimo y filtran la lista", async ({ page }) => {
    await abrir(page);
    await irA(page, /^Stock/);
    const barra = page.getByTestId("barra-salud");
    // Datos simulados: 10 tallas, mínimo 2 → 6 con stock, 2 por agotarse (2 y 1), 2 sin stock.
    await expect(barra.getByRole("button")).toHaveCount(3);
    await expect(barra.getByRole("button", { name: "Con stock: 6 de 10 tallas" })).toBeVisible();
    const bajo = barra.getByRole("button", { name: "Por agotarse: 2 de 10 tallas" });
    await expect(barra.getByRole("button", { name: "Sin stock: 2 de 10 tallas" })).toBeVisible();
    await expect(page.getByText("Por agotarse: quedan 2 unidades o menos. Sin stock: quedan 0.")).toBeVisible();

    // El ancho de cada tramo sigue a su cuenta.
    const [ok, b] = await Promise.all([barra.locator('[data-estado="ok"]').boundingBox(), bajo.boundingBox()]);
    expect(ok!.width).toBeGreaterThan(b!.width * 2);

    await bajo.click();
    await expect(bajo).toHaveAttribute("aria-pressed", "true");
    await expect(mostrando(page)).toHaveText("Mostrando 2 de 10 tallas");
    // Tocar el tramo activo quita el filtro.
    await bajo.click();
    await expect(bajo).toHaveAttribute("aria-pressed", "false");
    await expect(mostrando(page)).toHaveText("Mostrando 10 de 10 tallas");
  });
});

test.describe("B6-2 tabla con total y título visible", () => {
  test("el pie suma lo que se ve y el título dice filtro y orden", async ({ page }) => {
    await abrir(page);
    await irA(page, /^Stock/);
    await page.getByRole("button", { name: /^Lista/ }).click();
    const tabla = page.getByRole("table");
    const titulo = tabla.locator("caption");
    await expect(titulo).toBeVisible();
    await expect(titulo).toHaveText("10 tallas en stock, ordenadas por producto (de la A a la Z).");
    // 12 + 2 + 0 + 8 + 6 + 5 + 1 + 4 + 15 + 0
    await expect(tabla.locator("tfoot")).toContainText("Total · 10 tallas");
    await expect(page.getByTestId("total-queda")).toHaveText("53");

    await page.getByTestId("barra-salud").getByRole("button", { name: /^Por agotarse/ }).click();
    await expect(titulo).toHaveText("2 tallas por agotarse, ordenadas por producto (de la A a la Z).");
    await expect(page.getByTestId("total-queda")).toHaveText("3");

    await tabla.getByRole("button", { name: /^Queda/ }).click();
    await expect(titulo).toContainText("ordenadas por unidades que quedan (de menos a más)");
  });

  test("las filas entran escalonadas solo la primera vez", async ({ page }) => {
    await abrir(page);
    await irA(page, /^Stock/);
    await page.getByRole("button", { name: /^Lista/ }).click();
    await expect(page.getByTestId("total-queda")).toBeVisible();
    await page.getByRole("button", { name: /^Por producto/ }).click();
    // De vuelta en la lista: nada empieza transparente.
    await page.getByRole("button", { name: /^Lista/ }).click();
    await expect(page.locator("tbody tr")).toHaveCount(10);
    const transparentes = await page.locator("tbody tr").evaluateAll((filas) => filas.filter((f) => getComputedStyle(f).opacity !== "1").length);
    expect(transparentes).toBe(0);
    // Igual con las tarjetas al volver a la vista.
    await page.getByRole("button", { name: /^Por producto/ }).click();
    await irA(page, /^Resumen/);
    await expect(page.getByTestId("barra-salud")).toHaveCount(0);
    await irA(page, /^Stock/);
    // Stock se monta cuando Resumen terminó de salir (AnimatePresence mode="wait"): no se mide lo que se va.
    await expect(page.getByTestId("barra-salud")).toBeVisible();
    await expect(page.getByText("Unidades en almacén")).toHaveCount(0);
    const tarjetas = page.locator("main button.shadow-card").filter({ hasText: "unidades" });
    await expect(tarjetas.first()).toBeAttached();
    const n = await tarjetas.evaluateAll((b) => b.filter((e) => getComputedStyle(e).opacity !== "1").length);
    expect(n).toBe(0);
  });
});

test.describe("X10-4 OfflineBanner", () => {
  test("sin señal dice la hora de los datos guardados", async ({ context, page }) => {
    await abrir(page);
    await page.waitForTimeout(800);
    await context.setOffline(true);
    await expect(sinConexion(page)).toBeVisible();
    await expect(page.getByTestId("aviso-provisional")).toHaveText(/^Sin conexión — mostrando datos guardados a las \d{2}:\d{2}\.$/);
    await expect(page.getByText("Unidades en almacén")).toBeVisible();
    await context.setOffline(false);
    await expect(enVivo(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("aviso-provisional")).toHaveCount(0);
  });

  test("si la carga falla por red y hay copia, se ve la copia y nunca 'sin datos' ni 'Conectado'", async ({ page }) => {
    const sb = await abrir(page);
    await page.waitForTimeout(800);
    sb.sinRed = true;
    await page.reload();
    // La copia aparece enseguida; mientras las lecturas se reintentan no se dice "Conectado".
    await expect(page.getByText("Unidades en almacén")).toBeVisible();
    await expect(enVivo(page)).toHaveCount(0);
    await expect(sinConexion(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("aviso-provisional")).toContainText("Sin conexión — mostrando datos guardados a las");
    await expect(page.locator("[data-falla]")).toHaveCount(0);
    await expect(page.getByText(/Todavía no hay datos|No se pudieron cargar|No hay tallas/)).toHaveCount(0);
  });

  test("un fallo del servidor con copia dice de cuándo son los datos", async ({ page }) => {
    const sb = await abrir(page);
    // Deja que la copia termine de guardarse en el dispositivo.
    await page.waitForTimeout(1000);
    sb.fallan = new Set(["salidas"]);
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: /El servidor no entregó los datos\. Mostrando datos guardados a las \d{2}:\d{2}; se reintentará solo\./ })).toBeVisible();
  });
});

/** Hace fallar solo la escritura en la cola local mientras `window.__fallarCola` sea true. */
async function colaQueFalla(context: BrowserContext) {
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
}
const fallar = (page: Page, si: boolean) => page.evaluate((v) => ((window as unknown as { __fallarCola?: boolean }).__fallarCola = v), si);

async function llenarEntrega(page: Page) {
  await page.getByRole("button", { name: "Registrar", exact: true }).filter({ visible: true }).first().click();
  const v = page.getByRole("dialog");
  await v.locator("#reg-autor").fill("Prueba");
  await expect(v.getByRole("button", { name: "Registrar entrada" })).toBeVisible();
  await v.getByRole("tab", { name: /Salida/ }).click();
  await v.locator("#reg-quien").fill("diego");
  await v.getByRole("button", { name: /Diego Soto/ }).click();
  await v.getByRole("button", { name: /Pantalón Drill/ }).click();
  await v.getByRole("button", { name: "Agregar una unidad (Talla 30)" }).click();
  await page.locator("#foto-camara").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: FOTO });
  await expect(v.getByAltText("Foto de la entrega")).toBeVisible();
  return v;
}

test.describe("X10-5 formulario de entregas que no pierde nada", () => {
  test("si no se pudo guardar, la foto sigue y se reintenta", async ({ context, page }) => {
    await colaQueFalla(context);
    const sb = await abrir(page);
    const v = await llenarEntrega(page);
    await fallar(page, true);
    await v.getByRole("button", { name: "Registrar entrega" }).click();
    const aviso = v.getByRole("alert").filter({ hasText: "No se pudo guardar en este dispositivo" });
    await expect(aviso).toContainText("Lo que llenaste y la foto siguen aquí, guardado como borrador");
    await expect(v.getByAltText("Foto de la entrega")).toBeVisible();
    await expect(v.locator("#reg-quien")).toHaveValue("DIEGO SOTO");

    await fallar(page, false);
    await aviso.getByRole("button", { name: "Reintentar" }).click();
    await expect(v).toBeHidden();
    await expect.poll(() => sb.registros).toBe(1);
  });

  test("el borrador de un intento fallido se recupera con la foto tras recargar", async ({ context, page }) => {
    await colaQueFalla(context);
    await abrir(page);
    const v = await llenarEntrega(page);
    await fallar(page, true);
    await v.getByRole("button", { name: "Registrar entrega" }).click();
    await expect(v.getByRole("alert").filter({ hasText: "No se pudo guardar" })).toBeVisible();
    await page.waitForTimeout(500);
    await page.reload();
    await expect(enVivo(page)).toBeVisible();
    await page.getByRole("button", { name: "Registrar", exact: true }).filter({ visible: true }).first().click();
    await expect(v.getByText(/Quedó un registro sin guardar, con la foto/)).toBeVisible();
    await v.getByRole("button", { name: "Recuperar" }).click();
    await expect(v.getByAltText("Foto de la entrega")).toBeVisible();
    await expect(v.getByRole("button", { name: "Registrar entrega" })).toBeEnabled();
  });
});

test.describe("B23-3 Movimientos con el teclado", () => {
  const filas = (page: Page) => page.getByTestId("lista-movimientos").locator("article");
  const activa = (page: Page) => page.evaluate(() => document.activeElement?.closest("article")?.textContent?.slice(0, 60) ?? null);

  test("las flechas mueven el foco y el resaltado lo sigue", async ({ page }) => {
    await abrir(page);
    await irA(page, /^Movimientos/);
    await expect(filas(page)).toHaveCount(4);
    // Una sola fila en el orden de tabulación.
    await expect(page.getByTestId("lista-movimientos").locator('article[tabindex="0"]')).toHaveCount(1);
    await filas(page).first().focus();
    const resalte = page.getByTestId("resalte-lista");
    await expect(resalte).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await expect(filas(page).nth(1)).toBeFocused();
    expect(await activa(page)).toBe(await filas(page).nth(1).evaluate((e) => e.textContent?.slice(0, 60)));
    await page.keyboard.press("End");
    await expect(filas(page).nth(3)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(filas(page).first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(filas(page).nth(2)).toBeFocused();

    // El resaltado termina sobre la fila activa.
    await expect(async () => {
      const [r, f] = await Promise.all([resalte.boundingBox(), filas(page).nth(2).boundingBox()]);
      expect(Math.abs(r!.y - f!.y)).toBeLessThan(1.5);
      expect(Math.abs(r!.height - f!.height)).toBeLessThan(1.5);
    }).toPass();
    // Solo anima transform y alto.
    expect(await resalte.evaluate((e) => getComputedStyle(e).transitionProperty)).toBe("transform, height");

    // Al salir de la lista el resaltado se va.
    await page.getByRole("textbox", { name: "Buscar movimientos" }).focus();
    await expect(resalte).toHaveCount(0);
  });

  test("las flechas dentro del buscador son del buscador", async ({ page }) => {
    await abrir(page);
    await irA(page, /^Movimientos/);
    const buscar = page.getByRole("textbox", { name: "Buscar movimientos" });
    await buscar.focus();
    await page.keyboard.press("ArrowDown");
    await expect(buscar).toBeFocused();
  });

  test("con movimiento reducido el resaltado salta sin animar", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await abrir(page);
    await irA(page, /^Movimientos/);
    await filas(page).first().focus();
    const resalte = page.getByTestId("resalte-lista");
    expect(await resalte.evaluate((e) => getComputedStyle(e).transitionProperty)).toBe("none");
    await page.keyboard.press("ArrowDown");
    // Sin esperar: ya está en su sitio.
    const [r, f] = await Promise.all([resalte.boundingBox(), filas(page).nth(1).boundingBox()]);
    expect(Math.abs(r!.y - f!.y)).toBeLessThan(1.5);
    await context.close();
  });
});
