import { useCallback, useState } from "react";

// v3: ya no hay un nombre por defecto. Antes todo dispositivo nuevo firmaba como la misma persona.
const CLAVE = "stock_quien_v3";

/** Nombre de quien registra en este dispositivo, cuando no hay sesion: se pide la primera vez y se recuerda. */
export function useQuien() {
  const [quien, setQuien] = useState(() => {
    try {
      return window.localStorage.getItem(CLAVE) ?? "";
    } catch {
      return "";
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
