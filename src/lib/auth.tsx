import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

type Auth = {
  sesion: Session | null;
  email: string | null;
  /** true si la cuenta puede registrar y anular movimientos. */
  editor: boolean;
  /** Mientras se comprueba si ya habia una sesion guardada. */
  cargando: boolean;
  entrar: (email: string, clave: string) => Promise<string | null>;
  salir: () => Promise<void>;
  cambiarClave: (nueva: string) => Promise<string | null>;
};

const Contexto = createContext<Auth | null>(null);

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
  const [sesion, setSesion] = useState<Session | null>(null);
  const [editor, setEditor] = useState(false);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session);
      if (!data.session) setCargando(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSesion(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Con cada cambio de usuario se vuelve a preguntar si es editor.
  const usuario = sesion?.user.id ?? null;
  useEffect(() => {
    if (!usuario) {
      setEditor(false);
      return;
    }
    let vivo = true;
    supabase.rpc("is_editor").then(({ data, error }) => {
      if (!vivo) return;
      setEditor(!error && data === true);
      setCargando(false);
    });
    return () => {
      vivo = false;
    };
  }, [usuario]);

  const entrar = useCallback(async (email: string, clave: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: clave });
    return error ? traducir(error.message) : null;
  }, []);

  const salir = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const cambiarClave = useCallback(async (nueva: string) => {
    const { error } = await supabase.auth.updateUser({ password: nueva });
    return error ? traducir(error.message) : null;
  }, []);

  const valor = useMemo<Auth>(
    () => ({ sesion, email: sesion?.user.email ?? null, editor, cargando, entrar, salir, cambiarClave }),
    [sesion, editor, cargando, entrar, salir, cambiarClave],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAuth(): Auth {
  const c = useContext(Contexto);
  if (!c) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return c;
}
