import { expect, test, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";

const SUPABASE = "http://127.0.0.1:54321";
const FOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

type Carga = { p_fecha: string; p_items: { client_id: string; codigo: string; cantidad: number }[] };

/** Supabase simulado: cada prueba cambia solo lo que le interesa. */
class Falso {
  salidas: unknown[] = [];
  salidasError = false;
  registroError: { status: number; cuerpo: unknown } | null = null;
  ajustes: Record<string, unknown> = { stock_minimo: 2, registro_abierto: true, reporte_inicio: "2026-01-01", reporte_ultimo: "2026-11-07", reporte_por: "Equipo" };
  marcados = 0;
  cortes: (string | null)[] = [];
  cargas: Carga[] = [];
  fotos = 0;
  sinRed = false;
  fotoOk = false;
  logouts: (string | null)[] = [];
  logoutCuelga = false;
  tokens = 0;
  tokenBloqueado = false;
  /** Lo que devuelve la RPC uso_almacen. */
  uso: unknown = { base_bytes: 42 * 1048576, base_limite: 524288000, fotos_bytes: 120 * 1048576, fotos_limite: 1073741824, fotos: 800 };
  usoLlamadas = 0;
  usoFalla = false;

  async conectar(context: BrowserContext) {
    await context.route(`${SUPABASE}/**`, (route) => this.responder(route));
  }

  private json(route: Route, cuerpo: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(cuerpo) });
  }

  private responder(route: Route) {
    const req = route.request();
    if (this.sinRed) return route.abort("internetdisconnected");
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    const ruta = new URL(req.url()).pathname;
    if (ruta === "/rest/v1/rpc/is_editor") return this.json(route, true);
    if (ruta === "/rest/v1/rpc/uso_almacen") {
      this.usoLlamadas++;
      return this.usoFalla ? this.json(route, { message: "boom" }, 500) : this.json(route, this.uso);
    }
    if (ruta === "/auth/v1/logout") {
      this.logouts.push(new URL(req.url()).searchParams.get("scope"));
      if (this.logoutCuelga) return;
      return route.fulfill({ status: 204, headers: cors });
    }
    if (ruta === "/auth/v1/token") {
      this.tokens++;
      if (this.tokenBloqueado) return route.fulfill({ status: 403, contentType: "text/html", headers: cors, body: "<html>bloqueado</html>" });
      return this.json(route, { access_token: "a.b.d", refresh_token: "r2", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: SESION.id, email: SESION.email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
    }
    if (ruta === "/rest/v1/rpc/marcar_reporte_sabado") {
      this.marcados++;
      this.cortes.push((req.postDataJSON() as { p_corte: string | null }).p_corte);
      return this.json(route, null);
    }
    if (ruta === "/rest/v1/rpc/registrar_offline") {
      const c = req.postDataJSON() as Carga;
      this.cargas.push(c);
      if (this.registroError) return this.json(route, this.registroError.cuerpo, this.registroError.status);
      return this.json(route, { servidor_ahora: new Date().toISOString(), reloj_desfase_segundos: 0, items: c.p_items.map((i, n) => ({ client_id: i.client_id, codigo: i.codigo, id: n + 1, queda: 9 })) });
    }
    if (ruta.startsWith("/storage/v1/object/public/")) return this.fotoOk ? route.fulfill({ status: 200, contentType: "image/png", headers: cors, body: FOTO }) : this.json(route, { error: "not found" }, 404);
    if (ruta.startsWith("/storage/v1/object/evidencias/")) {
      this.fotos++;
      return this.json(route, { Key: ruta });
    }
    if (ruta === "/rest/v1/stock_items") return this.json(route, [{ codigo: "POLO-M", empresa: "FUNDIGSAC", producto: "POLO AZUL", talla: "M", genero: null, tenia_al_inicio: 10, entro: 0, salio: 0, queda: 10, aviso: null, ultimo_movimiento: null }]);
    if (ruta === "/rest/v1/trabajadores") return this.json(route, [{ trabajador: "DIEGO SOTO", nombres: "DIEGO", apellidos: "SOTO", area: "ALMACEN", prendas_recibidas: 0, ultima_entrega: null, genero: null }]);
    if (ruta === "/rest/v1/ajustes") return this.json(route, [this.ajustes]);
    if (ruta === "/rest/v1/salidas") return this.salidasError ? this.json(route, { message: "boom" }, 500) : this.json(route, this.salidas);
    return this.json(route, []);
  }
}

const salida = (extra: object) => ({ id: 1, client_id: null, fecha: "2026-11-05", codigo: "POLO-M", producto: "POLO AZUL  ·  Talla M", cantidad: 1, trabajador_cliente: "DIEGO SOTO", area: "ALMACEN", nota: null, foto_path: "salidas/2026-11/a.jpg", anulado: false, anulado_motivo: null, anulado_por: null, anulado_at: null, creado_por: "x", created_at: "2026-11-05T15:00:00Z", capturado_en: "2026-11-05T09:00:00.000-05:00", etiqueta: null, cambio_ref: null, ...extra });

const estado = (page: Page, texto: string | RegExp) => page.getByRole("status").filter({ hasText: texto }).filter({ visible: true });
const irA = (page: Page, nombre: RegExp) => page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true }).getByRole("button", { name: nombre }).click();
const SESION = { id: "u1", email: "ana@fundigsac.pe", editor: true };

/** Las pantallas se traen al abrirlas: para usarlas sin red el service worker ya tiene que tenerlas. */
async function serviceWorkerListo(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((ok) => navigator.serviceWorker.addEventListener("controllerchange", () => ok(), { once: true }));
    }
  });
}

async function conSesion(context: BrowserContext) {
  const expira = Math.floor(Date.now() / 1000) + 3600;
  await context.addInitScript(
    ({ expira, sesion }) => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: expira, user: { id: sesion.id, email: sesion.email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
      localStorage.setItem("stock_sesion_vista_v1", JSON.stringify(sesion));
    },
    { expira, sesion: SESION },
  );
}

async function llenarSalida(page: Page, autor = true) {
  await page.getByRole("button", { name: "Entregar a un trabajador" }).click();
  const v = page.getByRole("dialog");
  await v.locator("#reg-quien").fill("diego");
  await v.getByRole("button", { name: /Diego Soto/ }).click();
  await v.getByRole("button", { name: "Siguiente" }).click();
  await v.getByRole("button", { name: /Polo Azul/ }).click();
  await v.getByRole("button", { name: "Agregar una unidad (Talla M)" }).click();
  await v.getByRole("button", { name: "Siguiente" }).click();
  await page.locator("#foto-camara").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: FOTO });
  await expect(v.getByAltText("Foto de la entrega")).toBeVisible();
  await v.getByRole("button", { name: "Siguiente" }).click();
  if (autor) await v.locator("#reg-autor").fill("Cristhian");
  return v;
}

/** Después de guardar, el registro muestra cómo quedó; "Ir al inicio" lo cierra. */
const irAlInicio = (v: Locator) => v.getByRole("button", { name: "Ir al inicio" }).click();

test("cerrar sesión con registros sin subir pide confirmación", async ({ context, page }) => {
  const sb = new Falso();
  sb.registroError = { status: 500, cuerpo: { message: "boom" } };
  await sb.conectar(context);
  await conSesion(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();

  const v = await llenarSalida(page, false);
  await v.getByRole("button", { name: "Guardar", exact: true }).click();
  await irAlInicio(v);
  await expect(v).toBeHidden();
  await expect(estado(page, "1 por subir")).toBeVisible();

  await irA(page, /Más/);
  await page.getByRole("button", { name: /ana/i, expanded: false }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Tienes registros sin subir" })).toBeVisible();
  await page.getByRole("button", { name: "Seguir con la sesión" }).click();
  expect(await page.evaluate(() => localStorage.getItem("sb-127-auth-token"))).not.toBeNull();
});

test("con el almacenamiento lleno la cola sigue subiendo", async ({ context, page }) => {
  test.setTimeout(120_000);
  const origen = "http://127.0.0.1:4174";
  const sb = new Falso();
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await serviceWorkerListo(page);

  sb.sinRed = true;
  await context.setOffline(true);
  await expect(estado(page, /^Sin conexión/)).toBeVisible();
  const v = await llenarSalida(page);
  await v.getByRole("button", { name: "Guardar", exact: true }).click();
  await irAlInicio(v);
  await expect(v).toBeHidden();
  await expect(estado(page, "Sin conexión · 1 por subir")).toBeVisible();

  const cdp = await context.newCDPSession(page);
  const { usage } = (await cdp.send("Storage.getUsageAndQuota", { origin: origen })) as { usage: number };
  await cdp.send("Storage.overrideQuotaForOrigin", { origin: origen, quotaSize: Math.max(1, Math.floor(usage)) });
  // Chromium guarda el hueco libre unos 30 s por bucket: hay que dejarlo caducar.
  await page.waitForTimeout(33_000);

  sb.sinRed = false;
  await context.setOffline(false);
  await expect.poll(() => sb.cargas.length, { timeout: 25_000 }).toBeGreaterThanOrEqual(1);
  expect(sb.fotos).toBeGreaterThanOrEqual(1);
  await cdp.send("Storage.overrideQuotaForOrigin", { origin: origen });
});

test("un registro rechazado no toca el stock y se puede descartar", async ({ context, page }) => {
  const sb = new Falso();
  sb.registroError = { status: 400, cuerpo: { code: "P0001", message: "Producto no encontrado." } };
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();

  const v = await llenarSalida(page);
  await v.getByRole("button", { name: "Guardar", exact: true }).click();
  await irAlInicio(v);
  await expect(v).toBeHidden();
  await expect(estado(page, "1 por revisar")).toBeVisible();
  await irA(page, /Stock/);
  await expect(page.getByRole("heading", { name: "Stock", exact: true })).toBeVisible();
  await expect(page.getByTestId("aviso-provisional")).toHaveCount(0);

  await irA(page, /Por subir/);
  await expect(page.getByText("Producto no encontrado.")).toBeVisible();
  await page.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByRole("button", { name: "Descargar foto" })).toBeVisible();
  await page.getByRole("button", { name: "Sí, descartar" }).click();
  await expect(page.getByText("Producto no encontrado.")).toHaveCount(0);
  expect(await page.evaluate(() => new Promise<number>((ok) => {
    const r = indexedDB.open("stock-offline");
    r.onsuccess = () => {
      const g = r.result.transaction("fotos").objectStore("fotos").count();
      g.onsuccess = () => ok(g.result);
    };
  }))).toBe(0);
});

test("con una tabla sin cargar el informe no se genera ni se marca hecho", async ({ context, page }) => {
  const sb = new Falso();
  sb.salidasError = true;
  sb.ajustes = { ...sb.ajustes, reporte_ultimo: "2026-10-31" };
  await sb.conectar(context);
  await page.goto("/");
  await expect(page.getByText("El servidor no entregó los datos")).toBeVisible();

  await irA(page, /Más/);
  await page.getByRole("button", { name: "Descargar reporte" }).click();
  await expect(page.getByText(/no entregó todos los datos/)).toBeVisible();
  expect(sb.marcados).toBe(0);

  await page.getByRole("button", { name: "Informes PDF" }).click();
  await expect(page.getByRole("button", { name: "Descargar PDF" })).toBeDisabled();
});

test("el reporte semanal con fotos que no cargan no cierra la semana", async ({ context, page }) => {
  const sb = new Falso();
  sb.salidas = [salida({})];
  sb.ajustes = { ...sb.ajustes, reporte_ultimo: "2026-10-31" };
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();

  await irA(page, /Más/);
  await page.getByRole("button", { name: "Descargar reporte" }).click();
  await expect(page.getByTestId("aviso-reporte")).toContainText("fotos no cargaron", { timeout: 30_000 });
  expect(sb.marcados).toBe(0);
  await expect(page.getByRole("button", { name: "Marcar como hecho" })).toBeVisible();
});

test("la foto sin conexión lo dice en vez de mostrarse rota", async ({ context, page }) => {
  const sb = new Falso();
  sb.salidas = [salida({})];
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await irA(page, /Movimientos/);
  await expect(page.getByRole("button", { name: "Ver la foto de la entrega" }).first()).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Ver la foto de la entrega" }).first().click();
  await expect(page.getByText("La foto necesita conexión")).toBeVisible();
  await expect(page.getByText("Toca la foto para abrirla")).toHaveCount(0);
});

test("la fecha se toma de la foto aunque el formulario se abriera el día anterior", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.clock.setFixedTime(new Date("2026-11-08T23:55:00.000-05:00"));
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();

  await page.getByRole("button", { name: "Entregar a un trabajador" }).click();
  const v = page.getByRole("dialog");
  await v.locator("#reg-quien").fill("diego");
  await v.getByRole("button", { name: /Diego Soto/ }).click();
  await v.getByRole("button", { name: "Siguiente" }).click();
  await v.getByRole("button", { name: /Polo Azul/ }).click();
  await v.getByRole("button", { name: "Agregar una unidad (Talla M)" }).click();
  await v.getByRole("button", { name: "Siguiente" }).click();

  await page.clock.setFixedTime(new Date("2026-11-09T00:05:00.000-05:00"));
  await page.locator("#foto-camara").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: FOTO });
  await expect(v.getByAltText("Foto de la entrega")).toBeVisible();
  await v.getByRole("button", { name: "Siguiente" }).click();
  await v.locator("#reg-autor").fill("Cristhian");
  await expect(v.locator("#reg-fecha")).toHaveValue("2026-11-09");
  await v.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect.poll(() => sb.cargas.length).toBe(1);
  expect(sb.cargas[0].p_fecha).toBe("2026-11-09");
});

test("el nombre de quien registra se escribe completo tecla a tecla", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  const v = await llenarSalida(page, false);
  await v.locator("#reg-autor").pressSequentially("Cristhian", { delay: 20 });
  await expect(v.locator("#reg-autor")).toHaveValue("Cristhian");
  expect(await page.evaluate(() => localStorage.getItem("stock_quien_v3"))).toBe("Cristhian");
  await v.locator("#reg-autor").blur();
  await expect(v.getByText("Registrando como")).toContainText("Cristhian");
  await v.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect.poll(() => sb.cargas.length).toBe(1);
  expect((sb.cargas[0] as Carga & { p_quien: string }).p_quien).toBe("Cristhian");
});

test("elegir otra fecha que la de la foto pide confirmación", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  const v = await llenarSalida(page);
  await v.locator("#reg-fecha").fill("2026-10-01");
  await v.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(v.getByRole("alert")).toContainText("La foto es del");
  expect(sb.cargas).toHaveLength(0);
  await v.getByRole("button", { name: "Registrar igual" }).click();
  await expect.poll(() => sb.cargas.length).toBe(1);
  expect(sb.cargas[0].p_fecha).toBe("2026-10-01");
});

test("un formulario con foto se puede recuperar después de recargar", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  const v = await llenarSalida(page);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(estado(page, /En línea/)).toBeVisible();

  await page.getByRole("button", { name: "Entregar a un trabajador" }).click();
  await expect(v.getByText(/Quedó un registro sin guardar/)).toBeVisible();
  await v.getByRole("button", { name: "Recuperar" }).click();
  await expect(v.getByAltText("Foto de la entrega")).toBeVisible();
  // Con todo completo se abre el resumen; desde ahí se vuelve a quién recibe.
  await v.getByRole("button", { name: "Cambiar quién recibe" }).click();
  await expect(v.locator("#reg-quien")).toHaveValue("DIEGO SOTO");
});

test("el texto va justificado, la fuente es la del sistema y avisa que quedó lista sin conexión", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  const externas: string[] = [];
  page.on("request", (r) => {
    if (/fonts\.g/.test(r.url())) externas.push(r.url());
  });
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await expect(page.getByText("Lista para usar sin conexión")).toBeVisible({ timeout: 20_000 });
  await irA(page, /Por subir/);
  await expect(page.getByText(/Sin señal puedes seguir registrando/)).toBeVisible();
  const medidas = await page.evaluate(async () => {
    await document.fonts.ready;
    const largos = [...document.querySelectorAll("main p, main li")].filter((e) => (e.textContent ?? "").length >= 45 && e.getBoundingClientRect().width > 0);
    return { total: largos.length, justificados: largos.filter((e) => getComputedStyle(e).textAlign === "justify").length, cargadas: document.fonts.size, familia: getComputedStyle(document.body).fontFamily };
  });
  expect(medidas.total).toBeGreaterThan(0);
  expect(medidas.justificados).toBe(medidas.total);
  expect(medidas.cargadas).toBe(0);
  expect(medidas.familia).toContain("system-ui");
  expect(externas).toEqual([]);
});

test("avisa cuando el navegador no protege lo guardado", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await context.addInitScript(() => {
    Object.defineProperty(navigator.storage, "persist", { value: async () => false });
    Object.defineProperty(navigator.storage, "persisted", { value: async () => false });
  });
  await page.goto("/");
  await irA(page, /Por subir/);
  await expect(page.getByRole("button", { name: "Pedir protección" })).toBeVisible();
  await expect(page.getByText(/incluso con la app cerrada/)).toHaveCount(0);
});

test("con la red colgada el editor puede registrar y no dice conectado", async ({ context, page }) => {
  await context.route(`${SUPABASE}/**`, () => {
    /* nunca responde */
  });
  await conSesion(context);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Entregar a un trabajador" })).toBeEnabled({ timeout: 3_000 });
  await expect(estado(page, /En línea/)).toHaveCount(0);
  await expect(page.getByText("Todavía no hay datos guardados en este dispositivo")).toBeVisible({ timeout: 25_000 });
  await expect(estado(page, /^Sin conexión/)).toBeVisible();
});

test.describe("sin service worker", () => {
  test.use({ serviceWorkers: "block" });

  test("si no carga el gráfico, el resto de la pantalla sigue", async ({ context, page }) => {
    const sb = new Falso();
    sb.salidas = [salida({})];
    await sb.conectar(context);
    await context.route("**/assets/MovChart-*.js", (r) => r.abort());
    await page.goto("/");
    await expect(estado(page, /En línea/)).toBeVisible();
    await irA(page, /Resumen/);
    await expect(page.getByText("El gráfico necesita conexión").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stock por empresa" })).toBeVisible();
  });

  test("si no carga una parte de la app, avisa y no deja la página en blanco", async ({ context, page }) => {
    const sb = new Falso();
    await sb.conectar(context);
    await context.route("**/assets/Reportes-*.js", (r) => r.abort());
    await page.goto("/");
    await expect(estado(page, /En línea/)).toBeVisible();
    await irA(page, /Más/);
    await page.getByRole("button", { name: "Informes PDF" }).click();
    await expect(page.getByRole("heading", { name: "El PDF necesita conexión" })).toBeVisible();
    await expect(page.locator("#root")).not.toBeEmpty();
  });
});

/** Sesión sembrada una sola vez: al recargar no vuelve si la app ya la borró. */
async function sesionUnaVez(context: BrowserContext, expirada: boolean) {
  await context.addInitScript(
    ({ expira, sesion }) => {
      if (localStorage.getItem("__sembrada")) return;
      localStorage.setItem("__sembrada", "1");
      localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: expira, user: { id: sesion.id, email: sesion.email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
      localStorage.setItem("stock_sesion_vista_v1", JSON.stringify(sesion));
    },
    { expira: Math.floor(Date.now() / 1000) + (expirada ? -3600 : 3600), sesion: SESION },
  );
}

const tokenGuardado = (page: Page) => page.evaluate(() => localStorage.getItem("sb-127-auth-token"));
const botonCuenta = (page: Page) => page.getByRole("button", { name: /ana/i, expanded: false });

async function salirDelMenu(page: Page) {
  await botonCuenta(page).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
}

test("cerrar sesión sin red con el token vencido no se deshace al volver la señal", async ({ context, page }) => {
  const sb = new Falso();
  sb.sinRed = true;
  await sb.conectar(context);
  await sesionUnaVez(context, true);
  await page.goto("/");
  await irA(page, /Más/);
  await expect(botonCuenta(page)).toBeVisible();
  await context.setOffline(true);

  await salirDelMenu(page);
  await expect.poll(() => tokenGuardado(page), { timeout: 2_000 }).toBeNull();
  await expect(botonCuenta(page)).toHaveCount(0);

  sb.sinRed = false;
  await context.setOffline(false);
  await page.waitForTimeout(2_500);
  expect(await tokenGuardado(page)).toBeNull();

  await page.reload();
  await expect(estado(page, /En línea/)).toBeVisible();
  await irA(page, /Más/);
  await expect(page.getByRole("heading", { name: "Más", exact: true })).toBeVisible();
  await expect(botonCuenta(page)).toHaveCount(0);
  expect(await tokenGuardado(page)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("stock_sesion_vista_v1"))).toBeNull();
});

test("cerrar sesión con el servidor colgado termina y solo cierra este dispositivo", async ({ context, page }) => {
  const sb = new Falso();
  sb.logoutCuelga = true;
  await sb.conectar(context);
  await sesionUnaVez(context, false);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await irA(page, /Más/);

  await salirDelMenu(page);
  await expect.poll(() => tokenGuardado(page), { timeout: 7_000 }).toBeNull();
  await expect(botonCuenta(page)).toHaveCount(0);
  expect(sb.logouts).toEqual(["local"]);
});

test("si un proxy corta la renovación, lo guardado sigue siendo de esa cuenta", async ({ context, page }) => {
  const sb = new Falso();
  sb.registroError = { status: 500, cuerpo: { message: "boom" } };
  await sb.conectar(context);
  await sesionUnaVez(context, false);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  const v = await llenarSalida(page, false);
  await v.getByRole("button", { name: "Guardar", exact: true }).click();
  await irAlInicio(v);
  await expect(v).toBeHidden();
  await expect(estado(page, "1 por subir")).toBeVisible();

  sb.tokenBloqueado = true;
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("sb-127-auth-token") as string) as { expires_at: number };
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) - 3600 }));
  });
  await page.reload();
  await expect.poll(() => sb.tokens, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByText(/Tu sesión se cerró/).first()).toBeVisible({ timeout: 15_000 });

  await irA(page, /Por subir/);
  await expect(page.getByText(/Tu registro sigue guardado aquí/)).toBeVisible();
  await expect(page.getByText(/guardado con otra cuenta/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Por subir" })).toBeVisible();
});

const abrirRegistro = (page: Page) => page.getByRole("button", { name: "Ingresar a almacén" }).click();

test("lo llenado antes de la foto se recupera tras un cierre", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();

  await page.getByRole("button", { name: "Entregar a un trabajador" }).click();
  const v = page.getByRole("dialog");
  await v.locator("#reg-quien").fill("diego");
  await v.getByRole("button", { name: /Diego Soto/ }).click();
  await page.waitForTimeout(800);
  await page.reload();
  await expect(estado(page, /En línea/)).toBeVisible();

  await abrirRegistro(page);
  await expect(v.getByText(/Quedó un registro sin guardar, para Diego Soto/)).toBeVisible();
  await v.getByRole("button", { name: "Recuperar" }).click();
  // Se abre el primer paso que falta (el producto); quién recibe queda un paso atrás.
  await v.getByRole("button", { name: "Atrás" }).click();
  await expect(v.locator("#reg-quien")).toHaveValue("DIEGO SOTO");
});

test("'Otro producto para…' no deja un borrador de lo ya guardado", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();

  const v = await llenarSalida(page);
  await v.getByRole("button", { name: "Guardar", exact: true }).click();
  await v.getByRole("button", { name: /^Otro producto para/ }).click();
  await expect.poll(() => sb.cargas.length).toBe(1);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(estado(page, /En línea/)).toBeVisible();

  await abrirRegistro(page);
  await expect(page.getByRole("dialog").getByRole("heading", { name: "¿Qué ingresa?" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole("dialog").getByText(/Quedó un registro/)).toHaveCount(0);
});

test("un borrador sin resolver no se pierde al guardar otra cosa ni al tomar otra foto", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  const v = await llenarSalida(page);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(estado(page, /En línea/)).toBeVisible();

  // Una foto nueva no esconde el aviso ni escribe encima.
  await page.getByRole("button", { name: "Entregar a un trabajador" }).click();
  await expect(v.getByText(/Quedó un registro sin guardar/)).toBeVisible();
  await v.locator("#reg-quien").fill("diego");
  await v.getByRole("button", { name: /Diego Soto/ }).click();
  await v.getByRole("button", { name: "Siguiente" }).click();
  await v.getByRole("button", { name: /Polo Azul/ }).click();
  await v.getByRole("button", { name: "Agregar una unidad (Talla M)" }).click();
  await v.getByRole("button", { name: "Siguiente" }).click();
  await page.locator("#foto-camara").setInputFiles({ name: "otra.png", mimeType: "image/png", buffer: FOTO });
  await expect(v.getByAltText("Foto de la entrega")).toBeVisible();
  await expect(v.getByText(/Quedó un registro sin guardar/)).toBeVisible();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(estado(page, /En línea/)).toBeVisible();

  // Guardar una entrada que no tiene nada que ver tampoco lo borra.
  await abrirRegistro(page);
  await expect(v.getByText(/para Diego Soto/)).toBeVisible();
  await v.getByRole("button", { name: /Polo Azul/ }).click();
  await v.getByRole("button", { name: "Siguiente" }).click();
  await v.getByRole("button", { name: "Agregar una unidad (Talla M)" }).click();
  await v.getByRole("button", { name: "Siguiente" }).click();
  await v.getByRole("button", { name: "Guardar", exact: true }).click();
  await irAlInicio(v);
  await expect(v).toBeHidden();
  await expect.poll(() => sb.cargas.length).toBe(1);

  await abrirRegistro(page);
  await expect(v.getByText(/para Diego Soto/)).toBeVisible();
});

test("el reporte marca hasta la última fila incluida, aunque se marque horas después", async ({ context, page }) => {
  const sb = new Falso();
  const primera = "2026-11-08T15:00:40.000Z";
  sb.salidas = [salida({ subido_en: primera })];
  sb.ajustes = { ...sb.ajustes, reporte_ultimo: "2026-10-31" };
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();

  await irA(page, /Más/);
  await page.getByRole("button", { name: "Descargar reporte" }).click();
  await expect(page.getByTestId("aviso-reporte")).toContainText("fotos no cargaron", { timeout: 30_000 });

  // Llega otra fila después de armar el PDF: no salió en él y no puede quedar cubierta por el corte.
  sb.salidas = [...sb.salidas, salida({ id: 2, subido_en: "2026-11-08T18:00:00.000Z" })];
  await page.getByRole("button", { name: "Marcar como hecho" }).click();
  await expect.poll(() => sb.cortes).toEqual([primera]);
});

test("el reporte sin fotos pendientes se marca con su corte", async ({ context, page }) => {
  const sb = new Falso();
  const ultima = "2026-11-08T16:00:00.000Z";
  sb.salidas = [salida({ id: 1, subido_en: "2026-11-08T15:00:00.000Z", foto_path: null }), salida({ id: 2, subido_en: ultima, foto_path: null })];
  sb.ajustes = { ...sb.ajustes, reporte_ultimo: "2026-10-31" };
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await irA(page, /Más/);
  await page.getByRole("button", { name: "Descargar reporte" }).click();
  await expect.poll(() => sb.cortes, { timeout: 30_000 }).toEqual([ultima]);
});

test("la miniatura que falló sin señal vuelve con la conexión", async ({ context, page }) => {
  const sb = new Falso();
  sb.salidas = [salida({})];
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await serviceWorkerListo(page);

  sb.sinRed = true;
  await context.setOffline(true);
  await expect(estado(page, /^Sin conexión/)).toBeVisible();
  await irA(page, /Movimientos/);
  const mini = page.getByRole("button", { name: "Ver la foto de la entrega" }).first();
  await expect(mini.locator("svg")).toBeVisible();

  sb.sinRed = false;
  sb.fotoOk = true;
  await context.setOffline(false);
  await expect(mini.locator("img")).toBeVisible({ timeout: 15_000 });
});

test("una copia sin movimientos lo dice en vez de mostrar el historial vacío", async ({ context, page }) => {
  const sb = new Falso();
  sb.salidasError = true;
  await sb.conectar(context);
  await page.goto("/");
  await expect(page.getByText("El servidor no entregó los datos")).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await irA(page, /Movimientos/);
  await expect(page.getByText(/no alcanzaron a descargarse/)).toBeVisible();
  await expect(page.getByText("Sin movimientos para mostrar")).toHaveCount(0);
  await expect(page.getByText("El almacén quedó igual")).toHaveCount(0);
});

test("Más muestra el espacio usado desde la RPC simulada y no avisa por debajo del 80 %", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await irA(page, /Más/);
  await expect(page.getByText("Fotos: 120 MB de 1 GB")).toBeVisible();
  await expect(page.getByText("Base: 42 MB de 500 MB")).toBeVisible();
  await expect(page.getByText(/Queda poco espacio/)).toHaveCount(0);
  expect(sb.usoLlamadas).toBeGreaterThan(0);
});

test("desde el 80 % se ve un aviso del espacio", async ({ context, page }) => {
  const sb = new Falso();
  sb.uso = { base_bytes: 450 * 1048576, base_limite: 524288000, fotos_bytes: 900 * 1048576, fotos_limite: 1073741824, fotos: 5000 };
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await irA(page, /Más/);
  await expect(page.getByRole("alert").filter({ hasText: "Queda poco espacio" })).toContainText("las fotos ocupan el 88 % y la base ocupa el 90 %");
});

test("sin red el espacio muestra el último valor conocido", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await serviceWorkerListo(page);
  await irA(page, /Más/);
  await expect(page.getByText("Fotos: 120 MB de 1 GB")).toBeVisible();
  const antes = sb.usoLlamadas;

  sb.sinRed = true;
  await context.setOffline(true);
  await page.reload();
  await expect(estado(page, /^Sin conexión/)).toBeVisible();
  await irA(page, /Más/);
  await expect(page.getByText("Fotos: 120 MB de 1 GB")).toBeVisible();
  expect(sb.usoLlamadas).toBe(antes);
});

test("si nunca se pudo leer el espacio no se muestra nada", async ({ context, page }) => {
  const sb = new Falso();
  sb.usoFalla = true;
  await sb.conectar(context);
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await irA(page, /Más/);
  await expect(page.getByRole("heading", { name: "Empresa" })).toBeVisible();
  await expect.poll(() => sb.usoLlamadas).toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "Espacio usado" })).toHaveCount(0);
});

test("la banda mide 56 px, está en todas las pantallas y abre Por subir", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.goto("/");
  const banda = estado(page, /En línea/);
  await expect(banda).toBeVisible();
  expect((await banda.boundingBox())?.height).toBeCloseTo(56, 0);
  await irA(page, /Stock/);
  await expect(banda).toBeVisible();
  await banda.getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Por subir", exact: true })).toBeVisible();
});

test("las piezas que se cargan al abrirlas están en el precache", async ({ page }) => {
  await page.goto("/");
  const sw = await (await page.request.get("/sw.js")).text();
  for (const pieza of ["Registrar", "Stock", "Movimientos", "Trabajadores", "Respaldo", "Mas", "Resumen", "MovChart", "Reportes", "Asistente", "Ventana"]) {
    expect(sw, pieza).toContain(`assets/${pieza}-`);
  }
});

test("en escritorio Trabajadores es una tabla con área, unidades y última entrega", async ({ context, page }) => {
  const sb = new Falso();
  await sb.conectar(context);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(estado(page, /En línea/)).toBeVisible();
  await irA(page, /Trabajadores/);
  const tabla = page.getByRole("table", { name: "Trabajadores y unidades recibidas" });
  await expect(tabla).toBeVisible();
  await expect(tabla.getByRole("columnheader")).toHaveText(["Trabajador", "Área", "Unidades recibidas", "Última entrega"]);
  await expect(tabla.getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("list", { name: "Trabajadores y unidades recibidas" })).toBeHidden();
});

test.describe("en el celular", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("cuatro secciones abajo, sin flotantes y la pantalla inicial es Registrar", async ({ context, page }) => {
    const sb = new Falso();
    await sb.conectar(context);
    await page.goto("/");
    await expect(estado(page, /En línea/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "¿Qué vas a registrar?" })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true });
    await expect(nav.getByRole("button")).toHaveText(["Registrar", "Stock", "Por subir", "Más"]);
    expect((await nav.boundingBox())?.height).toBeCloseTo(72, 0);
    await expect(page.getByRole("button", { name: "Abrir el asistente de stock" })).toBeHidden();

    for (const nombre of ["Entregar a un trabajador", "Ingresar a almacén"]) {
      const caja = await page.getByRole("button", { name: nombre }).boundingBox();
      expect(caja?.height).toBeCloseTo(120, 0);
    }
    await expect(page.getByRole("button", { name: "Preguntar al asistente" })).toBeVisible();
  });

  test("sin conexión el asistente queda desactivado y lo dice", async ({ context, page }) => {
    const sb = new Falso();
    await sb.conectar(context);
    await page.goto("/");
    await expect(estado(page, /En línea/)).toBeVisible();
    sb.sinRed = true;
    await context.setOffline(true);
    await expect(estado(page, /^Sin conexión/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Necesita conexión/ })).toBeDisabled();
  });

  test("Más lleva a Movimientos y se puede volver", async ({ context, page }) => {
    const sb = new Falso();
    await sb.conectar(context);
    await page.goto("/");
    await expect(estado(page, /En línea/)).toBeVisible();
    await irA(page, /Más/);
    for (const nombre of ["Resumen", "Movimientos", "Trabajadores", "Informes PDF"]) await expect(page.getByRole("main").getByRole("button", { name: nombre })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: "Movimientos" }).click();
    await expect(page.getByRole("heading", { name: "Movimientos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Volver a Más" }).click();
    await expect(page.getByRole("heading", { name: "Más", exact: true })).toBeVisible();
  });

  test("Resumen se abre desde Más y el gráfico de 30 días carga solo al pedirlo", async ({ context, page }) => {
    const sb = new Falso();
    // Una salida de hoy (fecha de Lima) para que el gráfico tenga algo que mostrar.
    const hoy = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
    sb.salidas = [salida({ fecha: hoy })];
    await sb.conectar(context);
    await page.goto("/");
    await expect(estado(page, /En línea/)).toBeVisible();
    await irA(page, /Más/);
    await page.getByRole("main").getByRole("button", { name: "Resumen" }).click();
    await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
    const ver = page.getByRole("button", { name: "Ver gráfico de 30 días" });
    await expect(ver).toBeVisible();
    // El service worker precarga el archivo para usarlo sin red; lo que se evita es dibujarlo antes de pedirlo.
    await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
    await ver.click();
    await expect(ver).toBeHidden();
    await expect(page.locator(".recharts-wrapper")).toHaveCount(1);
    await page.getByRole("button", { name: "Volver a Más" }).click();
    await expect(page.getByRole("heading", { name: "Más", exact: true })).toBeVisible();
  });

  test("el distintivo de Por subir se ve con el número", async ({ context, page }) => {
    const sb = new Falso();
    sb.registroError = { status: 500, cuerpo: { message: "boom" } };
    await sb.conectar(context);
    await page.goto("/");
    await expect(estado(page, /En línea/)).toBeVisible();
    const v = await llenarSalida(page);
    await v.getByRole("button", { name: "Guardar", exact: true }).click();
    await irAlInicio(v);
    await expect(v).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true }).getByRole("button", { name: /Por subir/ })).toContainText("1");
  });
});

test.describe("sin service worker, una pantalla que no llega", () => {
  test.use({ serviceWorkers: "block" });

  test("avisa con un mensaje claro y se puede reintentar", async ({ context, page }) => {
    const sb = new Falso();
    await sb.conectar(context);
    let bloquear = true;
    await context.route("**/assets/Stock-*.js", (r) => (bloquear ? r.abort() : r.continue()));
    await page.goto("/");
    await expect(estado(page, /En línea/)).toBeVisible();
    await irA(page, /Stock/);
    await expect(page.getByText("Esta pantalla no se pudo abrir")).toBeVisible();

    bloquear = false;
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByRole("heading", { name: "Stock", exact: true })).toBeVisible();
    await expect(page.getByLabel("Buscar en el stock")).toBeVisible();
    await expect(page.getByText("Esta pantalla no se pudo abrir")).toHaveCount(0);
  });

  test("si no llega el registro, lo dice en vez de no hacer nada", async ({ context, page }) => {
    const sb = new Falso();
    await sb.conectar(context);
    await context.route("**/assets/Registrar-*.js", (r) => r.abort());
    await page.goto("/");
    await expect(estado(page, /En línea/)).toBeVisible();
    await page.getByRole("button", { name: "Entregar a un trabajador" }).click();
    await expect(page.getByRole("heading", { name: "Esta parte de la app necesita conexión" })).toBeVisible();
  });
});

test.describe("entrada Línea de flujo", () => {
  test("se ve una vez por sesión, se retira sola y no bloquea el primer toque", async ({ context, page }) => {
    const sb = new Falso();
    await sb.conectar(context);
    // La línea dura 0,9 s desde el primer pintado: se revisa antes de que termine de cargar la página.
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("html")).toHaveAttribute("data-intro", "", { timeout: 1000 });
    expect(await page.locator(".fx-flow-line").evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
    await expect(page.locator("html")).not.toHaveAttribute("data-intro", /.*/, { timeout: 2500 });
    await expect(page.locator(".fx-flow-line")).toBeHidden();
    await page.reload();
    await expect(estado(page, /En línea/)).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-intro", /.*/);
  });

  test("con movimiento reducido no aparece", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const sb = new Falso();
    await sb.conectar(context);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-intro", /.*/);
    await expect(page.locator(".fx-flow-line")).toBeHidden();
    await context.close();
  });
});

// §9D: sin desborde horizontal en ninguna vista, en los anchos pedidos (datos simulados, sin la base real).
for (const [ancho, alto] of [[360, 800], [375, 812], [390, 844], [768, 1024], [1280, 800], [1440, 900], [1920, 1080]] as const) {
  test(`sin desborde horizontal en todas las vistas a ${ancho}×${alto}`, async ({ context, page }) => {
    const sb = new Falso();
    sb.salidas = [salida({})];
    await sb.conectar(context);
    await page.setViewportSize({ width: ancho, height: alto });
    await page.goto("/");
    await expect(estado(page, /En línea/)).toBeVisible();
    const vistas = ancho >= 1024 ? ["Resumen", "Stock", "Por subir", "Movimientos", "Trabajadores", "Más"] : ["Stock", "Por subir", "Más"];
    for (const v of ["Registrar", ...vistas]) {
      await irA(page, new RegExp(`^${v}`));
      await page.waitForTimeout(150);
      const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(desborde, `${v} a ${ancho}px`).toBeLessThanOrEqual(1);
    }
    if (ancho < 1024) {
      for (const v of ["Resumen", "Movimientos", "Trabajadores"]) {
        await irA(page, /Más/);
        await page.getByRole("main").getByRole("button", { name: v }).click();
        await page.waitForTimeout(150);
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(desborde, `${v} a ${ancho}px`).toBeLessThanOrEqual(1);
      }
    }
  });
}
