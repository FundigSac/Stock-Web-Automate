import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { suscribirBloqueo, suscribirRecargaNecesaria, type ItemRespaldo } from "./almacen";
import { subirPendientes } from "./cliente";
import { useEnLinea } from "./conexion";
import { ESPERA_MAX_MS } from "./motor";
import { adoptarItem, descartarItem, esDeCuenta, faltaSubir, listarRespaldo, pedirPersistencia, porRevisar, reintentarItem, suscribirRespaldo } from "./respaldo";

export type Respaldo = ReturnType<typeof useRespaldo>;

const REINTENTO_RECIBO_MS = 30_000;

/**
 * Lista lo guardado en este dispositivo y decide cuándo subirlo.
 * `cuentaVencida`: la cuenta que perdió la sesión sin pedirlo. Lo suyo se sigue mostrando como suyo, a la espera de que entre.
 */
export function useRespaldo(alConfirmar: () => void, usuario: string | null, cuentaVencida: string | null = null) {
  const [todos, setTodos] = useState<ItemRespaldo[]>([]);
  const [recargaNecesaria, setRecargaNecesaria] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [sinEspacio, setSinEspacio] = useState(false);
  const [persistente, setPersistente] = useState<boolean | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const enLinea = useEnLinea();
  const aviso = useRef(alConfirmar);
  aviso.current = alConfirmar;
  const reintentoRecibo = useRef<number | undefined>(undefined);

  const refrescar = useCallback(() => {
    listarRespaldo().then(setTodos).catch((e) => console.error("[respaldo] lista", e));
  }, []);

  const protegerDatos = useCallback(async () => {
    setPersistente(await pedirPersistencia());
  }, []);

  const subir = useCallback(async (forzar: boolean) => {
    if (!navigator.onLine) return;
    setSubiendo(true);
    try {
      const r = await subirPendientes(forzar);
      if (r.confirmados > 0) aviso.current();
      if (r.sinEspacio) setSinEspacio(true);
      else if (r.confirmados > 0) setSinEspacio(false);
      if (r.reciboFallido) {
        window.clearTimeout(reintentoRecibo.current);
        reintentoRecibo.current = window.setTimeout(() => void subir(true), REINTENTO_RECIBO_MS);
      }
    } catch (e) {
      console.error("[respaldo] subida", e);
      if ((e as { name?: string } | null)?.name === "QuotaExceededError") setSinEspacio(true);
    } finally {
      setSubiendo(false);
    }
  }, []);

  useEffect(() => {
    void protegerDatos();
    refrescar();
    // Instalar la app suele bastar para que el navegador acepte proteger los datos.
    const alInstalar = () => void protegerDatos();
    window.addEventListener("appinstalled", alInstalar);
    const soltarBloqueo = suscribirBloqueo(setBloqueado);
    const soltarRecarga = suscribirRecargaNecesaria(setRecargaNecesaria);
    const soltar = suscribirRespaldo(refrescar);
    return () => {
      window.removeEventListener("appinstalled", alInstalar);
      window.clearTimeout(reintentoRecibo.current);
      soltarBloqueo();
      soltarRecarga();
      soltar();
    };
  }, [refrescar, protegerDatos]);

  // Al abrir la app, al volver la conexión, al regresar a la pestaña y cuando el service worker lo pide.
  useEffect(() => {
    void subir(true);
    const alConectar = () => void subir(true);
    const alVolver = () => {
      if (document.visibilityState === "visible") void subir(false);
    };
    const delWorker = (e: MessageEvent) => {
      if ((e.data as { tipo?: string } | null)?.tipo === "sincronizar") void subir(true);
    };
    window.addEventListener("online", alConectar);
    document.addEventListener("visibilitychange", alVolver);
    navigator.serviceWorker?.addEventListener("message", delWorker);
    return () => {
      window.removeEventListener("online", alConectar);
      document.removeEventListener("visibilitychange", alVolver);
      navigator.serviceWorker?.removeEventListener("message", delWorker);
    };
  }, [subir]);

  // Al entrar con una cuenta se sube lo que estaba esperando su sesión.
  useEffect(() => {
    if (usuario) void subir(true);
  }, [usuario, subir]);

  const esMio = useCallback((i: ItemRespaldo) => esDeCuenta(i, usuario) || (cuentaVencida !== null && i.dueno === cuentaVencida), [usuario, cuentaVencida]);
  const items = useMemo(() => todos.filter(esMio), [todos, esMio]);
  const deOtrasCuentas = useMemo(() => todos.filter((i) => faltaSubir(i) && !esMio(i)), [todos, esMio]);
  const esperanEntrar = cuentaVencida === null ? 0 : items.filter((i) => faltaSubir(i) && i.dueno === cuentaVencida).length;

  // Reintento con espera: se programa para el primero que toque.
  useEffect(() => {
    if (!enLinea) return;
    const proximos = items.filter(faltaSubir).map((i) => i.proximoIntentoEn);
    if (proximos.length === 0) return;
    // setTimeout se desborda con esperas enormes, y un reloj equivocado las produce.
    const espera = Math.min(ESPERA_MAX_MS, Math.max(1_000, Math.min(...proximos) - Date.now()));
    const id = window.setTimeout(() => void subir(false), espera);
    return () => window.clearTimeout(id);
  }, [items, enLinea, subir]);

  const reintentar = useCallback(
    async (id: string) => {
      await reintentarItem(id);
      await subir(true);
    },
    [subir],
  );

  const descartar = useCallback(async (id: string) => {
    await descartarItem(id);
  }, []);

  /** Pasa a esta cuenta un registro de otra que no va a volver a entrar, y lo sube. */
  const adoptar = useCallback(
    async (id: string) => {
      if (!usuario) return;
      await adoptarItem(id, usuario);
      await subir(true);
    },
    [usuario, subir],
  );

  const cuentas = useMemo(
    () => ({
      porSubir: items.filter(faltaSubir).length,
      sinMigracion: items.filter((i) => i.estado === "sin_migracion").length,
      porRevisar: items.filter(porRevisar).length,
    }),
    [items],
  );

  const subirAhora = useCallback(() => {
    void protegerDatos();
    return subir(true);
  }, [protegerDatos, subir]);

  return { items, subiendo, enLinea, sinEspacio, persistente, bloqueado, recargaNecesaria, deOtrasCuentas, deOtraCuenta: deOtrasCuentas.length, esperanEntrar, ...cuentas, subirAhora, reintentar, descartar, adoptar, protegerDatos };
}
