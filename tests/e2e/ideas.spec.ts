import { expect, test, type Locator, type Page } from "@playwright/test";
import { Simulado } from "./simulado";

// Ideas de diseño de Report/03 (B9-2, X12-2, X12-4, B12-1, B9-3, B16-4, B5-1, B9-1, X10-4), siempre con datos simulados.

const enVivo = (page: Page) => page.getByRole("status").filter({ hasText: /En vivo|Conectado/ }).filter({ visible: true });
const irA = (page: Page, nombre: RegExp) => page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true }).getByRole("button", { name: nombre }).click();

/** Abre la app con datos simulados. Con un fallo del servidor no hay "En vivo": basta con que se vea el Resumen. */
async function abrir(page: Page, sb = new Simulado()) {
  await sb.conectar(page.context());
  await page.goto("/");
  await expect(sb.fallan.size ? page.getByText("Unidades en almacén") : enVivo(page)).toBeVisible();
  return sb;
}

/** Cada estado visible lleva icono y texto: nunca solo color. */
async function conIconoYTexto(estados: Locator) {
  const n = await estados.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const e = estados.nth(i);
    await expect(e.locator("svg")).toHaveCount(1);
    expect((await e.innerText()).trim().length).toBeGreaterThan(0);
  }
}

test.describe("B9-2 + X12-2 estado con icono y texto, el del producto es su peor talla", () => {
  test("Stock por producto y en lista", async ({ page }) => {
    await abrir(page);
    await irA(page, /^Stock/);
    const polo = page.getByRole("button", { name: /Polo Azul/ }).first();
    await expect(polo.locator("[data-estado]").first()).toHaveText("Sin stock · 1 de 3 tallas");
    await expect(page.getByRole("button", { name: /Pantalón Drill/ }).first().locator("span[data-estado]").first()).toHaveText("Con stock");
    await expect(page.getByRole("button", { name: /Botas de Seguridad/ }).first().locator("span[data-estado]").first()).toHaveText("Por agotarse · 1 de 2 tallas");
    // Las casillas de talla que no están bien llevan su icono y lo dicen al lector de pantalla.
    const agotada = polo.locator('[data-estado="sin"]').filter({ hasText: /^L/ });
    await expect(agotada.locator("svg")).toHaveCount(1);
    await expect(agotada).toContainText("sin stock");
    await conIconoYTexto(page.locator("main span.rounded-full[data-estado]"));

    await page.getByRole("button", { name: /^Lista/ }).click();
    await conIconoYTexto(page.locator("main table [data-estado]"));
  });

  test("Resumen y ficha del producto", async ({ page }) => {
    await abrir(page);
    const lista = page.locator("li").filter({ hasText: "Polo Azul" }).first();
    await expect(lista.locator("[data-estado]")).toHaveText("Sin stock · 1 de 3 tallas");
    await lista.getByRole("button").click();
    const ficha = page.getByRole("dialog");
    await expect(ficha.locator("[data-estado]").first()).toHaveText("Sin stock · 1 de 3 tallas");
    await conIconoYTexto(ficha.locator("[data-estado]"));
  });
});

test.describe("X12-4 cantidades con signo y flecha, anuladas marcadas", () => {
  test("Movimientos", async ({ page }) => {
    await abrir(page);
    await irA(page, /^Movimientos/);
    await page.getByRole("button", { name: /Mostrar anulados/ }).click();
    const entrada = page.locator('main [data-cantidad="entrada"]').first();
    await expect(entrada).toContainText("+12");
    await expect(entrada.locator("svg")).toHaveCount(1);
    await expect(entrada.locator(".sr-only")).toHaveText("Entrada de 12 unidades");
    const salida = page.locator('main [data-cantidad="salida"]:not([data-anulado])').first();
    await expect(salida).toContainText("−3");
    await expect(salida.locator(".sr-only")).toHaveText("Salida de 3 unidades");
    const anulada = page.locator("main [data-anulado]");
    await expect(anulada).toHaveCount(1);
    await expect(anulada.locator(".sr-only")).toContainText("anulada");
    await expect(page.locator("main [data-marca-anulado]")).toHaveText("Anulado");
  });

  test("historial del producto y del trabajador", async ({ page }) => {
    await abrir(page);
    await irA(page, /^Stock/);
    await page.getByRole("button", { name: /Pantalón Drill/ }).first().click();
    let ficha = page.getByRole("dialog");
    await expect(ficha.locator("[data-marca-anulado]")).toHaveCount(1);
    await expect(ficha.locator("[data-anulado]")).toContainText("−2");
    await page.keyboard.press("Escape");
    await expect(ficha).toBeHidden();

    await irA(page, /^Trabajadores/);
    await page.getByRole("button", { name: /Diego Soto/ }).first().click();
    ficha = page.getByRole("dialog");
    await expect(ficha.locator('[data-cantidad="salida"]')).toHaveCount(2);
    await expect(ficha.locator('[data-cantidad="salida"]:not([data-anulado])')).toContainText("−3");
    await expect(ficha.locator("[data-marca-anulado]")).toHaveCount(1);
  });
});

test.describe("X10-4 un fallo de carga nunca se muestra como 'no hay datos'", () => {
  test("si fallan los movimientos se dice y se puede reintentar", async ({ page }) => {
    const sb = new Simulado();
    sb.fallan.add("salidas");
    await abrir(page, sb);
    const aviso = page.getByRole("alert").filter({ hasText: "El servidor no entregó los datos" });
    await expect(aviso).toBeVisible();
    // Resumen: ni el gráfico ni los últimos movimientos dicen que no hay movimientos.
    await expect(page.locator('[data-falla="error"]')).toHaveCount(2);
    await expect(page.getByText("Sin movimientos todavía")).toHaveCount(0);
    await expect(page.getByText("Aún no hay movimientos registrados.")).toHaveCount(0);
    await irA(page, /^Movimientos/);
    await expect(page.locator('main [data-falla="error"]').filter({ hasText: "Los movimientos no alcanzaron a descargarse porque el servidor falló" })).toBeVisible();
    await expect(page.getByText("Sin movimientos para mostrar")).toHaveCount(0);

    sb.fallan.clear();
    await aviso.getByRole("button", { name: "Reintentar" }).click();
    await expect(aviso).toBeHidden();
    await expect(page.locator("[data-falla]")).toHaveCount(0);
    await expect(page.locator('main [data-cantidad="salida"]').first()).toBeVisible();
  });

  test("si no carga nada se ve el error con reintento, no un almacén vacío", async ({ page }) => {
    const sb = new Simulado();
    sb.fallan = new Set(["stock_items", "entradas", "salidas", "trabajadores", "ajustes", "pedidos"]);
    await sb.conectar(page.context());
    await page.goto("/");
    const error = page.locator('[data-falla="error"]');
    await expect(error).toContainText("No se pudieron cargar los datos");
    await expect(error).toContainText("no es que el almacén esté vacío");
    await expect(page.getByText(/No hay tallas|Todavía no hay productos/)).toHaveCount(0);
    sb.fallan.clear();
    await error.getByRole("button", { name: "Reintentar" }).click();
    await expect(enVivo(page)).toBeVisible();
    await expect(page.getByText("Unidades en almacén")).toBeVisible();
  });

  test("si de verdad no hay movimientos se dice que no hay", async ({ page }) => {
    const sb = new Simulado();
    sb.vacias = new Set(["entradas", "salidas"]);
    await abrir(page, sb);
    await expect(page.getByText("Sin movimientos todavía")).toBeVisible();
    await irA(page, /^Movimientos/);
    await expect(page.getByText("Sin movimientos para mostrar")).toBeVisible();
    await expect(page.locator("[data-falla]")).toHaveCount(0);
  });

  test("la ficha del trabajador no dice 'sin entregas' si no cargaron", async ({ page }) => {
    const sb = new Simulado();
    sb.fallan.add("salidas");
    await abrir(page, sb);
    await irA(page, /^Trabajadores/);
    await page.getByRole("button", { name: /Diego Soto/ }).first().click();
    const ficha = page.getByRole("dialog");
    await expect(ficha.locator('[data-falla="error"]')).toContainText("Las entregas no alcanzaron a descargarse");
    await expect(ficha.getByText("todavía no tiene entregas")).toHaveCount(0);
    sb.fallan.clear();
    await ficha.getByRole("button", { name: "Reintentar" }).click();
    await expect(ficha.locator('[data-cantidad="salida"]').first()).toBeVisible();
  });
});
