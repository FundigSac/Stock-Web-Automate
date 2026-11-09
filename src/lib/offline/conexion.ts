import { useSyncExternalStore } from "react";

// navigator.onLine dice si hay red, no si la red sirve: con datos agotados puede seguir en true.
// Por eso un fallo real de la petición también cuenta como "sin conexión" hasta que una vuelva a funcionar.
let falloRed = false;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((o) => o());

export function marcarFalloRed() {
  if (falloRed) return;
  falloRed = true;
  avisar();
}

export function marcarRedOk() {
  if (!falloRed) return;
  falloRed = false;
  avisar();
}

export function estaEnLinea(): boolean {
  return navigator.onLine && !falloRed;
}

function suscribir(fn: () => void) {
  oyentes.add(fn);
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    oyentes.delete(fn);
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
}

export function useEnLinea(): boolean {
  return useSyncExternalStore(suscribir, estaEnLinea, () => true);
}

/** Errores de supabase-js cuando la petición ni siquiera llegó o nunca se respondió. */
export function esErrorDeRed(mensaje: string | null | undefined): boolean {
  return /failed to fetch|fetch failed|load failed|networkerror|network request failed|err_internet|sin conexi|timeouterror|aborterror|timed out|signal is aborted|tardó demasiado/i.test(mensaje ?? "");
}

/** Con señal débil una petición puede quedarse colgada para siempre: pasado el tiempo, cuenta como fallo de red. */
export function limiteRed<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((ok, mal) => {
    const reloj = setTimeout(() => mal(new Error("TimeoutError: el servidor tardó demasiado")), ms);
    p.then(
      (v) => {
        clearTimeout(reloj);
        ok(v);
      },
      (e) => {
        clearTimeout(reloj);
        mal(e);
      },
    );
  });
}
