import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const SUPABASE = "http://127.0.0.1:54321";
const CAPTURA = "2026-11-08T09:30:00.000-05:00";
const SUBIDA = "2026-11-08T14:45:00.000-05:00";
// PNG de 1x1: basta para que el navegador pueda decodificarla y ponerle el sello.
const FOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

type Carga = { p_capturado_en: string; p_reloj_dispositivo: string; p_foto: string; p_tipo: string; p_quien: string; p_trabajador: string; p_items: { client_id: string; codigo: string; cantidad: number }[] };

/** Supabase simulado. Igual que la base real con la migración: una fila por client_id. */
class SupabaseFalso {
  sinRed = false;
  sinMigracion = false;
  /** Guarda la fila pero corta la conexión antes de responder, una vez. */
  cortarTrasGuardar = false;
  stockQueda = 10;
  /** Hora que informa el servidor simulado. Por defecto, la real. */
  horaServidor: string | null = null;
  llamadasRegistro: Carga[] = [];
  llamadasFoto: string[] = [];
  orden: string[] = [];
  filas = new Map<string, Carga>();
  fotos = new Set<string>();

  async conectar(context: BrowserContext) {
    await context.route(`${SUPABASE}/**`, (route) => this.responder(route));
  }

  private cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

  private json(route: Route, cuerpo: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", headers: this.cors, body: JSON.stringify(cuerpo) });
  }

  private responder(route: Route) {
    const req = route.request();
    if (this.sinRed) return route.abort("internetdisconnected");
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: this.cors });
    const ruta = new URL(req.url()).pathname;

    if (ruta === "/rest/v1/rpc/registrar_offline") return this.registrar(route, req.postDataJSON() as Carga);
    if (ruta.startsWith("/storage/v1/object/evidencias/")) return this.foto(route, ruta.replace("/storage/v1/object/evidencias/", ""));
    if (ruta === "/rest/v1/stock_items") {
      return this.json(route, [{ codigo: "POLO-M", empresa: "FUNDIGSAC", producto: "POLO AZUL", talla: "M", genero: null, tenia_al_inicio: 10, entro: 0, salio: 10 - this.stockQueda, queda: this.stockQueda, aviso: null, ultimo_movimiento: null }]);
    }
    if (ruta === "/rest/v1/trabajadores") return this.json(route, [{ trabajador: "DIEGO SOTO", nombres: "DIEGO", apellidos: "SOTO", area: "ALMACEN", prendas_recibidas: 0, ultima_entrega: null, genero: null }]);
    if (ruta === "/rest/v1/ajustes") return this.json(route, [{ stock_minimo: 2, registro_abierto: true, reporte_inicio: "2026-01-01", reporte_ultimo: "2026-11-07", reporte_por: "Equipo" }]);
    if (ruta === "/rest/v1/salidas") {
      const filas = [...this.filas.entries()].map(([client_id, c], i) => ({ id: i + 1, client_id, fecha: "2026-11-08", codigo: "POLO-M", producto: "POLO AZUL  ·  Talla M", cantidad: 1, trabajador_cliente: c.p_trabajador, area: "ALMACEN", nota: null, foto_path: c.p_foto, anulado: false, anulado_motivo: null, anulado_por: null, anulado_at: null, creado_por: c.p_quien, created_at: SUBIDA, capturado_en: c.p_capturado_en, etiqueta: null, cambio_ref: null }));
      return this.json(route, filas);
    }
    return this.json(route, []);
  }

  private foto(route: Route, ruta: string) {
    this.llamadasFoto.push(ruta);
    this.orden.push("foto");
    if (this.fotos.has(ruta)) return this.json(route, { statusCode: "409", error: "Duplicate", message: "The resource already exists" }, 400);
    this.fotos.add(ruta);
    return this.json(route, { Key: `evidencias/${ruta}` });
  }

  private registrar(route: Route, carga: Carga) {
    this.llamadasRegistro.push(carga);
    this.orden.push("fila");
    if (this.sinMigracion) return this.json(route, { code: "PGRST202", message: "Could not find the function public.registrar_offline" }, 404);
    const items = carga.p_items.map((i, n) => {
      if (!this.filas.has(i.client_id)) {
        this.filas.set(i.client_id, carga);
        this.stockQueda -= i.cantidad;
      }
      return { client_id: i.client_id, codigo: i.codigo, id: n + 1, queda: this.stockQueda };
    });
    if (this.cortarTrasGuardar) {
      this.cortarTrasGuardar = false;
      return route.abort("connectionreset");
    }
    return this.json(route, { servidor_ahora: this.horaServidor ?? new Date().toISOString(), reloj_desfase_segundos: 0, items });
  }
}

const estado = (page: Page, texto: string | RegExp) => page.getByRole("status").filter({ hasText: texto }).filter({ visible: true });

const SIN_SW_EN_WEBKIT = "En WebKit, Playwright no intercepta las peticiones que pasan por el service worker; el proyecto WebKit corre con el SW bloqueado.";

async function abrirConServiceWorker(page: Page) {
  test.skip(test.info().project.name.includes("webkit"), SIN_SW_EN_WEBKIT);
  await page.goto("/");
  await expect(estado(page, /En vivo|Conectado/)).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((ok) => navigator.serviceWorker.addEventListener("controllerchange", () => ok(), { once: true }));
    }
  });
  // Espera a que la copia local tenga los datos: es lo que se verá sin red.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((ok) => {
            const r = indexedDB.open("stock-offline");
            r.onsuccess = () => {
              const g = r.result.transaction("espejo").objectStore("espejo").count();
              g.onsuccess = () => ok(g.result);
            };
          }),
      ),
    )
    .toBeGreaterThanOrEqual(3);
}

async function registrarSalidaConFoto(page: Page) {
  await page.getByRole("button", { name: "Registrar", exact: true }).filter({ visible: true }).first().click();
  const v = page.getByRole("dialog");
  await v.locator("#reg-autor").fill("Cristhian");
  await v.getByRole("tab", { name: /Salida/ }).click();
  await v.locator("#reg-quien").fill("diego");
  await v.getByRole("button", { name: /Diego Soto/ }).click();
  await v.getByRole("button", { name: /Polo Azul/ }).click();
  await v.getByRole("button", { name: "Agregar una unidad (Talla M)" }).click();
  await page.locator("#foto-camara").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: FOTO });
  await expect(v.getByAltText("Foto de la entrega")).toBeVisible();
  await v.getByRole("button", { name: /^Registrar (entrega|entrada)$/ }).click();
  await expect(v).toBeHidden();
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions([]);
});

test("sin conexión: registra con foto, sobrevive a recargar y sube con la hora de la foto", async ({ context, page, browserName }) => {
  test.skip(browserName === "firefox", "Con context.setOffline, Playwright pone a Firefox en modo «trabajar sin conexión»: la recarga falla con NS_ERROR_OFFLINE antes de llegar al service worker. Es del modo de prueba, no de la app.");
  const sb = new SupabaseFalso();
  await sb.conectar(context);
  await abrirConServiceWorker(page);

  await page.clock.setFixedTime(new Date(CAPTURA));
  sb.horaServidor = SUBIDA;
  sb.sinRed = true;
  await context.setOffline(true);
  await expect(estado(page, /^Sin conexión/)).toBeVisible();

  await registrarSalidaConFoto(page);
  await expect(estado(page, "Sin conexión, 1 por subir")).toBeVisible();
  expect(sb.llamadasRegistro).toHaveLength(0);

  // Las cifras incluyen lo que falta subir, y se dice que son provisionales.
  await expect(page.getByTestId("aviso-provisional")).toContainText(/Sin conexión — mostrando datos guardados .* Falta subir 1 registro: las cifras son provisionales./);
  await page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true }).getByRole("button", { name: "Stock" }).click();
  await expect(page.getByText("9", { exact: true }).first()).toBeVisible();

  // Recarga en frío, sin red: la app, la copia y la cola siguen ahí.
  await page.reload();
  await expect(estado(page, "Sin conexión, 1 por subir")).toBeVisible();

  // Otra pestaña abierta desde cero, también sin red.
  const otra = await context.newPage();
  await otra.goto("/");
  await expect(estado(otra, "Sin conexión, 1 por subir")).toBeVisible();
  await otra.close();

  // La pantalla de respaldo muestra la hora original.
  await page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true }).getByRole("button", { name: /Respaldo/ }).click();
  await expect(page.getByText("08/11/2026")).toBeVisible();
  await expect(page.getByText("09:30", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Foto guardada")).toBeVisible();

  // Vuelve la señal cinco horas después.
  await page.clock.setFixedTime(new Date(SUBIDA));
  sb.sinRed = false;
  await context.setOffline(false);

  await expect.poll(() => sb.filas.size).toBe(1);
  await expect(page.getByText("Subido", { exact: true })).toBeVisible();

  const carga = sb.llamadasRegistro.at(-1)!;
  expect(carga.p_capturado_en).toBe(CAPTURA);
  expect(carga.p_reloj_dispositivo).toBe(SUBIDA);
  expect(carga.p_tipo).toBe("salida");
  expect(carga.p_trabajador).toBe("DIEGO SOTO");
  expect(carga.p_foto).toMatch(/^salidas\/2026-11\/[0-9a-f-]{36}\.jpg$/);
  expect(carga.p_items).toHaveLength(1);
  expect([...sb.fotos]).toEqual([carga.p_foto]);
  expect(sb.orden.indexOf("foto")).toBeLessThan(sb.orden.indexOf("fila"));
  expect(sb.filas.size).toBe(1);
});

test("un reintento no duplica aunque se pierda la respuesta del servidor", async ({ context, page }) => {
  const sb = new SupabaseFalso();
  await sb.conectar(context);
  await abrirConServiceWorker(page);

  sb.cortarTrasGuardar = true;
  await registrarSalidaConFoto(page);

  // El servidor ya tiene la fila, pero el dispositivo no se enteró.
  await expect.poll(() => sb.filas.size).toBe(1);
  await expect(estado(page, /por subir|Sin conexión, 1/)).toBeVisible();
  expect(sb.llamadasRegistro).toHaveLength(1);

  await page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true }).getByRole("button", { name: /Respaldo/ }).click();
  await page.getByRole("button", { name: "Subir ahora" }).click();

  await expect(page.getByText("Subido", { exact: true })).toBeVisible();
  expect(sb.llamadasRegistro).toHaveLength(2);
  expect(sb.llamadasRegistro[0].p_items[0].client_id).toBe(sb.llamadasRegistro[1].p_items[0].client_id);
  expect(sb.llamadasRegistro[0].p_capturado_en).toBe(sb.llamadasRegistro[1].p_capturado_en);
  expect(sb.filas.size).toBe(1);
  expect(sb.fotos.size).toBe(1);
  expect(sb.stockQueda).toBe(9);
});

test("sin la migración el registro se queda en cola y lo dice", async ({ context, page }) => {
  const sb = new SupabaseFalso();
  sb.sinMigracion = true;
  await sb.conectar(context);
  await abrirConServiceWorker(page);

  await registrarSalidaConFoto(page);
  await expect(estado(page, "1 esperando al servidor")).toBeVisible();

  await page.getByRole("navigation", { name: "Secciones" }).filter({ visible: true }).getByRole("button", { name: /Respaldo/ }).click();
  await expect(page.getByText("Esperando al servidor", { exact: true })).toBeVisible();
  await expect(page.getByText(/todavía no tiene la actualización/)).toBeVisible();

  sb.sinMigracion = false;
  await page.getByRole("button", { name: "Subir ahora" }).click();
  await expect(page.getByText("Subido", { exact: true })).toBeVisible();
  expect(sb.filas.size).toBe(1);
});

test("sin red no se cierra la sesión aunque el token haya vencido", async ({ context, page, browserName }) => {
  test.skip(browserName === "firefox", "Con context.setOffline, Playwright pone a Firefox en modo «trabajar sin conexión»: la recarga falla con NS_ERROR_OFFLINE antes de llegar al service worker. Es del modo de prueba, no de la app.");
  const sb = new SupabaseFalso();
  await sb.conectar(context);
  await abrirConServiceWorker(page);

  const vencido = Math.floor(Date.now() / 1000) - 3600;
  await page.evaluate((expira) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: expira, user: { id: "u1", email: "ana@fundigsac.pe", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
    localStorage.setItem("stock_sesion_vista_v1", JSON.stringify({ id: "u1", email: "ana@fundigsac.pe", editor: true }));
  }, vencido);

  sb.sinRed = true;
  await context.setOffline(true);
  await page.reload();
  await expect(estado(page, /^Sin conexión/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^AN?\s*ana/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("sb-127-auth-token"))).not.toBeNull();
});

test("el asistente y el PDF dicen que necesitan conexión", async ({ context, page }) => {
  const sb = new SupabaseFalso();
  await sb.conectar(context);
  await abrirConServiceWorker(page);
  sb.sinRed = true;
  await context.setOffline(true);
  await expect(estado(page, /^Sin conexión/)).toBeVisible();

  await page.getByRole("button", { name: "PDF" }).click();
  await expect(page.getByRole("heading", { name: "El PDF necesita conexión" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();

  await page.getByRole("button", { name: "Abrir el asistente de stock" }).click();
  await expect(page.getByRole("heading", { name: "El asistente necesita conexión" })).toBeVisible();
});
