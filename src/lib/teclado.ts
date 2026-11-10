import { useCallback, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

/** B23-3: a qué fila lleva cada tecla. Devuelve null si la tecla no mueve nada. */
export function siguienteFila(actual: number, total: number, tecla: string): number | null {
  if (total <= 0) return null;
  const desde = actual < 0 ? -1 : Math.min(actual, total - 1);
  switch (tecla) {
    case "ArrowDown":
      return desde < 0 ? 0 : Math.min(desde + 1, total - 1);
    case "ArrowUp":
      return desde < 0 ? 0 : Math.max(desde - 1, 0);
    case "Home":
      return 0;
    case "End":
      return total - 1;
    case "PageDown":
      return desde < 0 ? 0 : Math.min(desde + 10, total - 1);
    case "PageUp":
      return desde < 0 ? 0 : Math.max(desde - 10, 0);
    default:
      return null;
  }
}

export type Resalte = { top: number; alto: number } | null;

/**
 * B23-3: recorrer una lista con las flechas, con un solo resaltado que se desliza a la fila activa.
 * Solo una fila queda en el orden de tabulación (tabindex itinerante); las flechas, Inicio, Fin y Re Pág/Av Pág mueven el foco.
 * El resaltado se mide contra el contenedor, así sigue a la fila aunque esté en otra sección.
 */
export function useListaConFlechas(claves: string[]) {
  const contenedor = useRef<HTMLDivElement | null>(null);
  const filas = useRef(new Map<string, HTMLElement>());
  const [activa, setActiva] = useState<string | null>(null);
  const [conFoco, setConFoco] = useState(false);
  const [resalte, setResalte] = useState<Resalte>(null);

  // Si la fila activa desaparece (otro filtro), vuelve a la primera.
  const actual = activa !== null && claves.includes(activa) ? activa : (claves[0] ?? null);

  const medir = useCallback(() => {
    const caja = contenedor.current;
    const fila = actual ? filas.current.get(actual) : undefined;
    if (!caja || !fila) return setResalte(null);
    const a = caja.getBoundingClientRect();
    const b = fila.getBoundingClientRect();
    const top = b.top - a.top;
    // Solo cambia el estado si la medida cambió: así medir en cada dibujo no provoca otro dibujo.
    setResalte((r) => (r && r.top === top && r.alto === b.height ? r : { top, alto: b.height }));
  }, [actual]);

  useLayoutEffect(() => {
    medir();
    const caja = contenedor.current;
    if (!caja || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => medir());
    ro.observe(caja);
    return () => ro.disconnect();
  }, [medir, claves]);

  const registrar = useCallback(
    (clave: string) => (el: HTMLElement | null) => {
      if (el) filas.current.set(clave, el);
      else filas.current.delete(clave);
    },
    [],
  );

  const alTeclear = (e: KeyboardEvent<HTMLElement>) => {
    // Dentro de un campo de texto las flechas son del campo.
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable='true']")) return;
    const i = actual ? claves.indexOf(actual) : -1;
    const destino = siguienteFila(i, claves.length, e.key);
    if (destino === null) return;
    e.preventDefault();
    const clave = claves[destino];
    setActiva(clave);
    filas.current.get(clave)?.focus();
  };

  const props = {
    ref: contenedor,
    onKeyDown: alTeclear,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      setConFoco(true);
      // El foco pudo llegar con el ratón o con Tab a un botón de la fila: esa pasa a ser la activa.
      for (const [clave, el] of filas.current) {
        if (el.contains(e.target as Node)) {
          setActiva(clave);
          break;
        }
      }
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setConFoco(false);
    },
  };

  return { props, registrar, actual, resalte: conFoco ? resalte : null };
}
