import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  resolve: {
    // El tiempo real de Supabase se trae aparte, después de abrir (ver src/lib/tiempoRealDiferido.ts).
    // Solo cambia la importación exacta: la ruta completa del paquete sigue llegando al original.
    alias: [{ find: /^@supabase\/realtime-js$/, replacement: fileURLToPath(new URL("./src/lib/tiempoRealDiferido.ts", import.meta.url)) }],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Stock EPP",
        short_name: "Stock EPP",
        description: "Control de stock de EPP y uniformes, con o sin conexión.",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#004257",
        background_color: "#f1f5f7",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: {
        // jsPDF y mammoth pesan: sin subir el tope quedarían fuera y esas partes no abrirían sin red.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
      },
      devOptions: { enabled: false },
    }),
  ],
});
