/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { leerMeta } from "./lib/offline/almacen";
import { sincronizar } from "./lib/offline/motor";
import { listarRespaldo } from "./lib/offline/respaldo";
import { crearTransporte } from "./lib/offline/transporte";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// La app entera queda guardada en la primera visita: después abre sin red, incluso en frío.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

clientsClaim();

// Una versión nueva espera a que la persona pulse "Actualizar", para no recargar en medio de un registro.
self.addEventListener("message", (e) => {
  if ((e.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});

type EventoSync = ExtendableEvent & { tag: string };

const transporte = crearTransporte({
  url: import.meta.env.VITE_SUPABASE_URL as string,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  // Con el token vencido no hay sesión: el token solo se renueva con una ventana abierta, así que esos registros esperan.
  sesion: async () => {
    const t = await leerMeta<{ access_token: string; expires_at: number; usuario?: string }>("token");
    return t?.usuario && t.expires_at * 1000 > Date.now() ? { usuario: t.usuario, token: t.access_token } : null;
  },
});

async function alRecuperarSenal() {
  const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (ventanas.length > 0) {
    // Con la app abierta sube la ventana, que tiene la sesión al día.
    ventanas.forEach((v) => v.postMessage({ tipo: "sincronizar" }));
    return;
  }
  const r = await sincronizar(transporte, { forzar: true });
  const quedan = (await listarRespaldo()).filter((i) => i.estado === "pendiente" || i.estado === "subiendo").length;
  // Fallar aquí hace que el navegador vuelva a intentarlo más tarde. Lo que espera una sesión no se resuelve reintentando.
  if (quedan > r.esperanSesion) throw new Error("Quedan registros por subir");
}

self.addEventListener("sync", ((e: EventoSync) => {
  if (e.tag === "stock-respaldo") e.waitUntil(alRecuperarSenal());
}) as EventListener);
