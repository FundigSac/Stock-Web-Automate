import { defineConfig, devices } from "@playwright/test";

// Capturas de QA con datos simulados (no forman parte de la suite). Uso:
//   FASE=antes CAPTURAS=<carpeta> npx playwright test -c playwright.capturas.config.ts
const PUERTO = 4176;

export default defineConfig({
  testDir: "tests/capturas",
  testMatch: "*.capturas.ts",
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PUERTO}`, ...devices["Desktop Chrome"], serviceWorkers: "block" },
  webServer: {
    command: `npx vite build --outDir dist-capturas --emptyOutDir && npx vite preview --outDir dist-capturas --host 127.0.0.1 --port ${PUERTO} --strictPort`,
    url: `http://127.0.0.1:${PUERTO}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_ANON_KEY: "clave-de-prueba" },
  },
});
