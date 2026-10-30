import { useCallback, useState } from "react";

// v2: antes se guardaba cualquier nombre tecleado en pruebas; ahora todos parten de Ronald.
const CLAVE = "stock_quien_v2";
/** Quien registra casi siempre; se puede cambiar desde "Registrando como … · Cambiar". */
export const QUIEN_POR_DEFECTO = "Ronald";

/** Nombre de quien registra en este dispositivo: empieza en Ronald y se recuerda si se cambia. */
export function useQuien() {
  const [quien, setQuien] = useState(() => {
    try {
      return window.localStorage.getItem(CLAVE) || QUIEN_POR_DEFECTO;
    } catch {
      return QUIEN_POR_DEFECTO;
    }
  });
  const guardar = useCallback((v: string) => {
    setQuien(v);
    try {
      window.localStorage.setItem(CLAVE, v.trim());
    } catch {
      /* sin almacenamiento: solo vale mientras la pagina siga abierta */
    }
  }, []);
  return [quien, guardar] as const;
}
