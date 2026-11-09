import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import { pedirRecarga } from "./recarga";

/** Registra el service worker, avisa cuando hay una versión nueva esperando y cuando la app ya quedó guardada. */
export function usePwa() {
  const [actualizar, setActualizar] = useState<(() => void) | null>(null);
  const [offlineListo, setOfflineListo] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const aplicar = registerSW({
      onNeedRefresh: () => setActualizar(() => () => void aplicar(true)),
      // Sin esto, "Actualizar" en una pestaña recarga las demás y borra lo que estuvieran llenando.
      onNeedReload: () => pedirRecarga(() => window.location.reload()),
      onOfflineReady: () => setOfflineListo(true),
    });
  }, []);

  return { actualizar, offlineListo };
}
