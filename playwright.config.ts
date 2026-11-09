import { defineConfig, devices } from "@playwright/test";

// Supabase va apuntado a una dirección local que no existe: todas las llamadas se simulan en la prueba.
const PUERTO = 4174;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PUERTO}`, ...devices["Desktop Chrome"], serviceWorkers: "allow" },
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PUERTO} --strictPort`,
    url: `http://127.0.0.1:${PUERTO}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_ANON_KEY: "clave-de-prueba" },
  },
});
