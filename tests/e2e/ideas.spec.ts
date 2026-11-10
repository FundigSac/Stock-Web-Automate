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

test.describe("B12-1 esqueletos mientras cargan los datos", () => {
  /** Retiene las lecturas hasta que la prueba las suelte. */
  function retenido() {
    const sb = new Simulado();
    let soltar = () => {};
    sb.espera = new Promise<void>((ok) => (soltar = ok));
    return { sb, soltar: () => soltar() };
  }

  test("se ven tarjetas esqueleto, nunca un 'no hay', y luego los datos", async ({ page }) => {
    const { sb, soltar } = retenido();
    await sb.conectar(page.context());
    await page.goto("/");
    const esq = page.locator('[data-esqueleto="resumen"]');
    await expect(esq).toBeVisible();
    await expect(esq).toHaveAttribute("aria-busy", "true");
    await expect(esq.getByRole("status")).toHaveText("Cargando datos…");
    expect(await esq.locator(".skeleton").count()).toBeGreaterThan(10);
    await expect(page.getByText(/Sin movimientos|No hay|Todavía no hay/)).toHaveCount(0);
    // Con movimiento normal hay brillo.
    expect(await esq.locator(".skeleton").first().evaluate((e) => getComputedStyle(e, "::after").animationName)).toBe("shimmer");
    // Se puede cambiar de vista mientras carga: el esqueleto toma la forma de esa vista.
    await irA(page, /^Movimientos/);
    await expect(page.locator('[data-esqueleto="movimientos"]')).toBeVisible();
    await irA(page, /^Resumen/);
    soltar();
    await expect(esq).toHaveCount(0);
    await expect(page.getByText("Unidades en almacén")).toBeVisible();
  });

  test("con movimiento reducido no hay brillo", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const { sb, soltar } = retenido();
    await sb.conectar(context);
    await page.goto("/");
    const bloque = page.locator('[data-esqueleto="resumen"] .skeleton').first();
    await expect(bloque).toBeVisible();
    expect(await bloque.evaluate((e) => getComputedStyle(e, "::after").display)).toBe("none");
    soltar();
    await context.close();
  });

  for (const [ancho, alto] of [[1280, 800], [390, 844]] as const) {
    test(`al llegar los datos no hay saltos de diseño a ${ancho}px`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number };
        w.__cls = 0;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
      const { sb, soltar } = retenido();
      await sb.conectar(page.context());
      await page.goto("/");
      await expect(page.locator('[data-esqueleto="resumen"]')).toBeVisible();
      await page.waitForTimeout(400);
      soltar();
      await expect(enVivo(page)).toBeVisible();
      await page.waitForTimeout(1500);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls, `CLS a ${ancho}px`).toBeLessThan(0.1);
    });
  }
});

test.describe("B16-4 + B5-1 barra inferior con píldora", () => {
  const barra = (page: Page) => page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true });

  /** Centro horizontal de la píldora y del botón activo. */
  async function centros(page: Page) {
    const pildora = await barra(page).locator("[data-pildora] > span").boundingBox();
    const activo = await barra(page).locator('[aria-current="page"]').boundingBox();
    return { pildora: pildora!.x + pildora!.width / 2, activo: activo!.x + activo!.width / 2, alto: pildora!.height, ancho: pildora!.width };
  }

  for (const ancho of [360, 390]) {
    test(`etiquetas siempre visibles y píldora bajo el activo a ${ancho}px`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 800 });
      await abrir(page);
      const nav = barra(page);
      const botones = nav.getByRole("button");
      await expect(botones).toHaveCount(5);
      for (const t of ["Resumen", "Stock", "Movimientos", "Trabajadores", "Respaldo"]) {
        const etiqueta = nav.getByText(t, { exact: true });
        await expect(etiqueta).toBeVisible();
        // Sin recortes: el texto entero cabe en su botón.
        expect(await etiqueta.evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5)).toBe(true);
        expect(Number.parseFloat(await etiqueta.evaluate((e) => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(11);
      }
      for (const [i, v] of (["Resumen", "Movimientos", "Respaldo", "Stock"] as const).entries()) {
        await irA(page, new RegExp(`^${v}`));
        const activo = nav.locator('[aria-current="page"]');
        await expect(activo).toHaveText(v);
        await expect(activo.locator("svg[data-relleno]")).toHaveCount(v === "Movimientos" ? 0 : 1);
        await expect(nav.locator("svg[data-relleno]")).toHaveCount(v === "Movimientos" ? 0 : 1);
        await expect.poll(async () => Math.abs((await centros(page)).pildora - (await centros(page)).activo), `píldora bajo ${v} (${i})`).toBeLessThan(1.5);
      }
      const c = await centros(page);
      expect(c.alto).toBe(32);
      expect(c.ancho).toBe(56);
    });
  }

  test("la píldora solo anima transform, en rojo Slab al 12 %", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrir(page);
    const pildora = barra(page).locator("[data-pildora]");
    // Tailwind 4 nombra la familia completa de transform; nada de left, width ni color.
    const props = (await pildora.evaluate((e) => getComputedStyle(e).transitionProperty)).split(", ");
    expect(props.every((p) => ["transform", "translate", "scale", "rotate"].includes(p))).toBe(true);
    expect(await pildora.evaluate((e) => getComputedStyle(e).transitionDuration)).toBe("0.3s");
    const color = await pildora.locator("span").evaluate((e) => getComputedStyle(e).backgroundColor);
    // #d7261e al 12 %: canal alfa 0,12 (Chromium lo da en oklab o srgb según la versión).
    expect(color).toMatch(/\/ 0\.12\)|, 0\.12\)/);
  });

  test("con movimiento reducido la píldora salta sin animar", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await abrir(page);
    const pildora = barra(page).locator("[data-pildora]");
    expect(await pildora.evaluate((e) => getComputedStyle(e).transitionProperty)).toBe("none");
    await irA(page, /^Trabajadores/);
    // Sin esperar: ya está en su sitio en el siguiente cuadro.
    const [p, a] = await Promise.all([pildora.locator("span").boundingBox(), barra(page).locator('[aria-current="page"]').boundingBox()]);
    expect(Math.abs(p!.x + p!.width / 2 - (a!.x + a!.width / 2))).toBeLessThan(1.5);
    await context.close();
  });
});

test.describe("B9-3 objetivos táctiles de 48 px en el celular", () => {
  /** Mide cada control visible (fuera de la barra lateral de escritorio y de los enlaces dentro de un párrafo). */
  async function medir(page: Page, donde: string) {
    // Una ventana que se está abriendo todavía está algo escalada: se mide cuando termina.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    return page.evaluate((donde) => {
      const sel = 'button, select, textarea, a[href], [role="tab"], [role="menuitem"], input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"])';
      const chicos: string[] = [];
      let medidos = 0;
      for (const e of document.querySelectorAll<HTMLElement>(sel)) {
        if (e.closest("p, aside") || e.classList.contains("sr-only")) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === "hidden") continue;
        medidos++;
        if (r.height < 47.5 || r.width < 47.5) chicos.push(`${donde}: <${e.tagName.toLowerCase()}> "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 40)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return { chicos, medidos };
    }, donde);
  }

  test("todas las acciones y campos a 390 px miden al menos 48×48", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrir(page);
    const chicos: string[] = [];
    let medidos = 0;
    const anotar = (r: { chicos: string[]; medidos: number }) => {
      chicos.push(...r.chicos);
      medidos += r.medidos;
    };
    anotar(await medir(page, "Resumen"));
    for (const v of ["Stock", "Movimientos", "Trabajadores", "Respaldo"]) {
      await irA(page, new RegExp(`^${v}`));
      await expect(page.locator("h1")).toHaveText(v);
      anotar(await medir(page, v));
    }
    await irA(page, /^Stock/);
    await page.getByRole("button", { name: /^Lista/ }).click();
    anotar(await medir(page, "Stock en lista"));
    await page.getByRole("button", { name: /^Por producto/ }).click();
    await page.getByRole("button", { name: /Polo Azul/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    anotar(await medir(page, "Ficha del producto"));
    await page.getByRole("dialog").getByRole("button", { name: "Agregar stock" }).click();
    const registro = page.getByRole("dialog");
    await expect(registro.getByRole("tab", { name: /Salida/ })).toBeVisible();
    anotar(await medir(page, "Registrar entrada"));
    await registro.getByRole("tab", { name: /Salida/ }).click();
    anotar(await medir(page, "Registrar salida"));
    expect(chicos, chicos.join("\n")).toEqual([]);
    expect(medidos).toBeGreaterThan(80);
  });

  test("en escritorio no cambia el tamaño de los controles", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await abrir(page);
    const pdf = await page.getByRole("button", { name: "PDF" }).boundingBox();
    expect(pdf!.height).toBe(40);
  });
});

test.describe("B9-1 cifras tabulares", () => {
  const tabular = (l: Locator) => l.evaluate((e) => getComputedStyle(e).fontVariantNumeric);

  test("KPI, cantidades y tablas usan tabular-nums", async ({ page }) => {
    await abrir(page);
    const kpi = page.getByRole("button", { name: /Unidades en almacén/ }).locator(".display");
    expect(await tabular(kpi)).toBe("tabular-nums");
    await irA(page, /^Stock/);
    expect(await tabular(page.getByRole("button", { name: /Polo Azul/ }).first().locator("p.display"))).toBe("tabular-nums");
    await page.getByRole("button", { name: /^Lista/ }).click();
    const celdas = page.locator("main table td");
    expect(await celdas.count()).toBeGreaterThan(10);
    for (const i of [0, 3, 5]) expect(await tabular(celdas.nth(i))).toBe("tabular-nums");
    await irA(page, /^Movimientos/);
    expect(await tabular(page.locator('main [data-cantidad="entrada"]').first())).toBe("tabular-nums");
    // Hasta el texto corrido: una fecha en una lista no cambia de ancho al pasar de 1 a 8.
    expect(await tabular(page.locator("main h3").first())).toBe("tabular-nums");
  });
});
