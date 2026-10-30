import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Eye, KeyRound, Loader2, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { iniciales } from "../lib/format";
import { Boton, Ventana } from "./ui";

function Campo({
  id,
  etiqueta,
  tipo = "text",
  valor,
  alCambiar,
  autoComplete,
}: {
  id: string;
  etiqueta: string;
  tipo?: string;
  valor: string;
  alCambiar: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-muted">
        {etiqueta}
      </label>
      <input
        id={id}
        type={tipo}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        required
        autoComplete={autoComplete}
        className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm outline-none focus:border-ink"
      />
    </div>
  );
}

export function EntrarDialog({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const { entrar } = useAuth();
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const err = await entrar(email, clave);
    setCargando(false);
    if (err) setError(err);
    else {
      setClave("");
      alCerrar();
    }
  }

  return (
    <Ventana abierta={abierto} alCerrar={alCerrar} titulo="Entrar para registrar" subtitulo="Ver el tablero no necesita cuenta. Registrar movimientos, sí.">
      <form onSubmit={enviar} className="space-y-4">
        <Campo id="entrar-email" etiqueta="Correo" tipo="email" valor={email} alCambiar={setEmail} autoComplete="email" />
        <Campo id="entrar-clave" etiqueta="Contraseña" tipo="password" valor={clave} alCambiar={setClave} autoComplete="current-password" />
        {error && (
          <p role="alert" className="rounded-xl bg-red-soft px-3.5 py-2.5 text-[13px] font-medium text-red">
            {error}
          </p>
        )}
        <Boton type="submit" variante="ink" className="h-12 w-full" disabled={cargando}>
          {cargando ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} Entrar
        </Boton>
      </form>
    </Ventana>
  );
}

function ClaveDialog({ abierto, alCerrar, avisar }: { abierto: boolean; alCerrar: () => void; avisar: (t: string) => void }) {
  const { cambiarClave } = useAuth();
  const [nueva, setNueva] = useState("");
  const [repite, setRepite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nueva.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (nueva !== repite) return setError("Las dos contraseñas no coinciden.");
    setCargando(true);
    setError(null);
    const err = await cambiarClave(nueva);
    setCargando(false);
    if (err) return setError(err);
    setNueva("");
    setRepite("");
    avisar("Contraseña cambiada");
    alCerrar();
  }

  return (
    <Ventana abierta={abierto} alCerrar={alCerrar} titulo="Cambiar contraseña">
      <form onSubmit={enviar} className="space-y-4">
        <Campo id="clave-nueva" etiqueta="Contraseña nueva (mínimo 8 caracteres)" tipo="password" valor={nueva} alCambiar={setNueva} autoComplete="new-password" />
        <Campo id="clave-repite" etiqueta="Repite la contraseña nueva" tipo="password" valor={repite} alCambiar={setRepite} autoComplete="new-password" />
        {error && (
          <p role="alert" className="rounded-xl bg-red-soft px-3.5 py-2.5 text-[13px] font-medium text-red">
            {error}
          </p>
        )}
        <Boton type="submit" variante="ink" className="h-12 w-full" disabled={cargando}>
          {cargando ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Guardar contraseña
        </Boton>
      </form>
    </Ventana>
  );
}

/** Boton "Entrar" o, con sesion iniciada, el menu de la cuenta. */
export function Cuenta({ avisar }: { avisar: (t: string) => void }) {
  const { sesion, email, editor, cargando, salir } = useAuth();
  const [entrando, setEntrando] = useState(false);
  const [claveAbierta, setClaveAbierta] = useState(false);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const fuera = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  if (cargando) return null;

  if (!sesion) {
    return (
      <>
        <Boton onClick={() => setEntrando(true)}>
          <LogIn className="size-4" /> Entrar
        </Boton>
        <EntrarDialog abierto={entrando} alCerrar={() => setEntrando(false)} />
      </>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menu}
        className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface pl-1.5 pr-3 text-sm font-semibold transition hover:bg-ground"
      >
        <span className="grid size-7 place-items-center rounded-lg bg-ink text-[11px] font-semibold text-white">{iniciales(email ?? "?")}</span>
        <span className="hidden max-w-[120px] truncate sm:inline">{(email ?? "").split("@")[0]}</span>
        <ChevronDown className="size-3.5 text-faint" />
      </button>
      <AnimatePresence>
        {menu && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-pop"
          >
            <div className="px-3 pb-2 pt-2.5">
              <p className="truncate text-[13px] font-semibold">{email}</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-muted">
                {editor ? <ShieldCheck className="size-3.5 text-ok" /> : <Eye className="size-3.5" />}
                {editor ? "Puede registrar y anular" : "Solo lectura: tu correo no está autorizado"}
              </p>
            </div>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenu(false);
                setClaveAbierta(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-semibold transition hover:bg-ground"
            >
              <KeyRound className="size-4 text-muted" /> Cambiar contraseña
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenu(false);
                salir();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-semibold transition hover:bg-ground"
            >
              <LogOut className="size-4 text-muted" /> Cerrar sesión
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <ClaveDialog abierto={claveAbierta} alCerrar={() => setClaveAbierta(false)} avisar={avisar} />
    </div>
  );
}
