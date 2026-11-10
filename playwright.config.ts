import { defineConfig, devices } from "@playwright/test";

// Supabase va apuntado a una dirección local que no existe: todas las llamadas se simulan en la prueba.
// PW_PUERTO permite correr la suite junto a otra copia del repo sin chocar de puerto.
const PUERTO = Number(process.env.PW_PUERTO ?? 4174);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PUERTO}`, serviceWorkers: "allow" },
  // Chromium es el navegador de los celulares Android del almacén; Safari (WebKit) el de los iPhone.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    // En WebKit, Playwright no intercepta las peticiones de una página controlada por el service worker: irían a la red
    // real (Supabase falso apagado). Ahí el SW se bloquea y las pruebas que lo necesitan se saltan con su motivo.
    { name: "webkit", use: { ...devices["Desktop Safari"], serviceWorkers: "block" } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"], serviceWorkers: "block" } },
  ],
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PUERTO} --strictPort`,
    url: `http://127.0.0.1:${PUERTO}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_ANON_KEY: "clave-de-prueba" },
  },
});
