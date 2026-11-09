import { isAuthRetryableFetchError, type Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { borrarMeta, guardarMeta } from "./offline/almacen";
import { fijarDuenoActual } from "./offline/cliente";
import { esErrorDeRed, estaEnLinea, limiteRed, useEnLinea } from "./offline/conexion";
import { supabase } from "./supabase";

/** Lo que la app necesita saber de la sesion; sin conexion puede venir de la copia guardada. */
export type SesionVista = { user: { id: string; email?: string } };

type Auth = {
  sesion: SesionVista | null;
  email: string | null;
  /** true si la cuenta puede registrar y anular movimientos. */
  editor: boolean;
  /** Mientras se comprueba si ya habia una sesion guardada. */
  cargando: boolean;
  /** Se está cerrando la sesión. */
  saliendo: boolean;
  /** La sesión se cerró sin que nadie lo pidiera: esta cuenta tiene que volver a entrar. */
  cuentaVencida: { id: string; email?: string } | null;
  entrar: (email: string, clave: string) => Promise<string | null>;
  salir: () => Promise<void>;
  cambiarClave: (nueva: string) => Promise<string | null>;
};

const Contexto = createContext<Auth | null>(null);

// Solo quien es y si puede editar; los tokens los guarda supabase-js. Sirve para no cerrar la sesion cuando falta la red.
const CLAVE_SESION = "stock_sesion_vista_v1";
/** Con señal débil is_editor puede no responder nunca: pasado este tiempo vale lo último que se supo. */
export const LIMITE_EDITOR_MS = 5_000;
/** Cerrar sesión no se puede quedar colgado: pasado este tiempo se termina en este dispositivo. */
export const LIMITE_SALIR_MS = 4_000;
const CLAVE_VENCIDA = "stock_cuenta_vencida_v1";
type Recordada = { id: string; email?: string; editor: boolean };
type Vencida = { id: string; email?: string };

function leerVencida(): Vencida | null {
  try {
    return JSON.parse(window.localStorage.getItem(CLAVE_VENCIDA) ?? "null") as Vencida | null;
  } catch {
    return null;
  }
}

function anotarVencida(v: Vencida | null) {
  try {
    if (v) window.localStorage.setItem(CLAVE_VENCIDA, JSON.stringify(v));
    else window.localStorage.removeItem(CLAVE_VENCIDA);
  } catch {
    /* sin almacenamiento: solo se pierde el aviso */
  }
}

/** La sesión que guarda supabase-js. Sin borrarla, la próxima renovación del token devuelve la cuenta sin pedir la contraseña. */
const ES_CLAVE_AUTH = /^sb-.+-auth-token(-code-verifier|-user)?$/;

function quitarSesionGuardada() {
  try {
    const claves = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i));
    for (const k of claves) if (k && ES_CLAVE_AUTH.test(k)) window.localStorage.removeItem(k);
  } catch {
    /* sin almacenamiento tampoco hay sesión guardada */
  }
}

function leerRecordada(): Recordada | null {
  try {
    return JSON.parse(window.localStorage.getItem(CLAVE_SESION) ?? "null") as Recordada | null;
  } catch {
    return null;
  }
}

function recordar(r: Recordada | null) {
  try {
    if (r) window.localStorage.setItem(CLAVE_SESION, JSON.stringify(r));
    else window.localStorage.removeItem(CLAVE_SESION);
  } catch {
    /* sin almacenamiento: solo se pierde el recuerdo sin conexion */
  }
}

/** El service worker no puede leer la sesion de supabase-js: para subir en segundo plano se le deja el token vigente. */
function compartirToken(s: Session | null) {
  const hecho = s ? guardarMeta("token", { access_token: s.access_token, expires_at: s.expires_at ?? 0, usuario: s.user.id }) : borrarMeta("token");
  hecho.catch((e) => console.error("[respaldo] token", e));
}

function traducir(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "Correo o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "Este correo aún no está confirmado.";
  if (m.includes("same password") || m.includes("different from the old")) return "La contraseña nueva debe ser distinta de la actual.";
  if (m.includes("at least") || m.includes("weak")) return "La contraseña es muy corta o débil (mínimo 8 caracteres).";
  if (m.includes("rate limit") || m.includes("too many")) return "Demasiados intentos. Espera un minuto.";
  if (m.includes("fetch") || m.includes("network")) return "Sin conexión. Revisa tu internet.";
  return "No se pudo completar. Inténtalo de nuevo.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Se arranca con lo último que se supo: con señal débil, comprobar la sesión puede tardar medio minuto o no terminar.
  const [previa] = useState(leerRecordada);
  const [sesion, setSesion] = useState<SesionVista | null>(() => (previa ? { user: { id: previa.id, email: previa.email } } : null));
  const [editor, setEditor] = useState(previa?.editor ?? false);
  const [cargando, setCargando] = useState(previa === null);
  const [saliendo, setSaliendo] = useState(false);
  const [cuentaVencida, setCuentaVencida] = useState<Vencida | null>(leerVencida);
  const enLinea = useEnLinea();
  // Una renovación del token que ya estaba en camino no puede traer de vuelta una cuenta que acaba de salir.
  const salidaPedida = useRef(false);

  const olvidarVencida = useCallback(() => {
    anotarVencida(null);
    setCuentaVencida(null);
  }, []);

  /** La sesión se perdió sin que la persona la cerrara. Lo que guardó sigue siendo suyo y hay que decirle que entre otra vez. */
  const anotarSesionPerdida = useCallback((r: Recordada) => {
    const v = { id: r.id, email: r.email };
    anotarVencida(v);
    setCuentaVencida(v);
  }, []);

  const limpiarSesion = useCallback(() => {
    setSesion(null);
    setEditor(false);
    recordar(null);
    compartirToken(null);
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data, error }) => {
      if (data.session) {
        setSesion(data.session);
        compartirToken(data.session);
        olvidarVencida();
        return;
      }
      // Token vencido y sin red para renovarlo: la sesion sigue siendo valida, solo que no se puede comprobar ahora.
      const r = leerRecordada();
      if (r && error && (isAuthRetryableFetchError(error) || !navigator.onLine)) {
        setSesion({ user: { id: r.id, email: r.email } });
        setEditor(r.editor);
      } else {
        // Si había una cuenta recordada y nadie cerró la sesión, se perdió al renovar el token.
        if (r) anotarSesionPerdida(r);
        setSesion(null);
        setEditor(false);
        recordar(null);
      }
      setCargando(false);
    });
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      if (s && evento === "TOKEN_REFRESHED" && salidaPedida.current) {
        quitarSesionGuardada();
      } else if (s) {
        // Alguien entró, aquí o en otra pestaña: de ahora en adelante las renovaciones son de esa sesión.
        salidaPedida.current = false;
        setSesion(s);
        compartirToken(s);
        olvidarVencida();
      } else if (evento === "SIGNED_OUT") {
        // También llega si el servidor o un proxy responden algo que no es JSON al renovar el token: ahí la persona no pidió salir.
        const r = leerRecordada();
        if (r && !salidaPedida.current) anotarSesionPerdida(r);
        limpiarSesion();
      }
    });
    // Otra pestaña cerró la sesión sin red: aquí no llega ningún evento de supabase-js.
    const enOtraPestana = (e: StorageEvent) => {
      if (e.key && ES_CLAVE_AUTH.test(e.key) && e.newValue === null && !leerRecordada()) limpiarSesion();
    };
    window.addEventListener("storage", enOtraPestana);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("storage", enOtraPestana);
    };
  }, [anotarSesionPerdida, limpiarSesion, olvidarVencida]);

  // Con cada cambio de usuario se vuelve a preguntar si es editor.
  const usuario = sesion?.user.id ?? null;
  const correo = sesion?.user.email;
  // Los registros nuevos quedan a nombre de esta cuenta.
  fijarDuenoActual(usuario);
  useEffect(() => {
    if (!usuario) {
      setEditor(false);
      return;
    }
    if (!enLinea) {
      const r = leerRecordada();
      setEditor(r?.id === usuario && r.editor);
      setCargando(false);
      return;
    }
    let vivo = true;
    // Sin respuesta no se sabe: vale lo ultimo que se supo de esta misma cuenta.
    const sinRespuesta = () => {
      const r = leerRecordada();
      setEditor(r?.id === usuario && r.editor);
    };
    void limiteRed(supabase.rpc("is_editor"), LIMITE_EDITOR_MS)
      .then(({ data, error }) => {
        if (!vivo || salidaPedida.current) return;
        if (error && esErrorDeRed(error.message)) sinRespuesta();
        else {
          const puede = !error && data === true;
          setEditor(puede);
          if (!error) recordar({ id: usuario, email: correo, editor: puede });
        }
      })
      .catch(() => {
        if (vivo) sinRespuesta();
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
    // Al volver la conexion se comprueba de nuevo.
  }, [usuario, correo, enLinea]);

  const entrar = useCallback(async (email: string, clave: string) => {
    salidaPedida.current = false;
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: clave });
    return error ? traducir(error.message) : null;
  }, []);

  const salir = useCallback(async () => {
    salidaPedida.current = true;
    setSaliendo(true);
    // Primero lo recordado: si la red tarda, esta cuenta ya no vuelve al recargar.
    recordar(null);
    olvidarVencida();
    let cerrada = false;
    // Sin red no se llama: supabase-js intentaría renovar el token durante medio minuto antes de rendirse.
    if (estaEnLinea()) {
      try {
        // "local": cierra este dispositivo. Los otros siguen con su sesión y con lo que tengan por subir.
        const { error } = await limiteRed(supabase.auth.signOut({ scope: "local" }), LIMITE_SALIR_MS);
        if (error) console.error("[sesion] cerrar", error.message);
        else cerrada = true;
      } catch (e) {
        console.error("[sesion] cerrar", e);
      }
    }
    if (!cerrada) quitarSesionGuardada();
    limpiarSesion();
    setSaliendo(false);
  }, [limpiarSesion, olvidarVencida]);

  const cambiarClave = useCallback(async (nueva: string) => {
    const { error } = await supabase.auth.updateUser({ password: nueva });
    return error ? traducir(error.message) : null;
  }, []);

  const valor = useMemo<Auth>(
    () => ({ sesion, email: sesion?.user.email ?? null, editor, cargando, saliendo, cuentaVencida, entrar, salir, cambiarClave }),
    [sesion, editor, cargando, saliendo, cuentaVencida, entrar, salir, cambiarClave],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAuth(): Auth {
  const c = useContext(Contexto);
  if (!c) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return c;
}
