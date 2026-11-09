import { ChevronDown, Eye, KeyRound, Loader2, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { iniciales } from "../lib/format";
import { cn } from "../lib/utils";
import { Boton, presion } from "./ui";
import { Ventana } from "./Ventana";

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
      <label htmlFor={id} className="mb-1.5 block text-left text-[16px] font-semibold text-ink-2">
        {etiqueta}
      </label>
      <input
        id={id}
        type={tipo}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        required
        autoComplete={autoComplete}
        className="h-14 w-full rounded-lg border border-line bg-surface px-4 text-[18px] outline-none focus:border-action focus:outline-2 focus:outline-offset-2 focus:outline-action"
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
    <Ventana abierta={abierto} alCerrar={alCerrar} titulo="Entrar para registrar" subtitulo="Entra con la cuenta autorizada para registrar. Ver el stock no necesita cuenta.">
      <form onSubmit={enviar} className="space-y-4">
        <Campo id="entrar-email" etiqueta="Correo" tipo="email" valor={email} alCambiar={setEmail} autoComplete="email" />
        <Campo id="entrar-clave" etiqueta="Contraseña" tipo="password" valor={clave} alCambiar={setClave} autoComplete="current-password" />
        {error && (
          <p role="alert" className="rounded-lg bg-red-soft px-4 py-3 text-[16px] font-medium leading-6 text-red">
            {error}
          </p>
        )}
        <Boton type="submit" variante="ink" className="min-h-16 w-full text-[18px]" disabled={cargando}>
          {cargando ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <LogIn className="size-5" aria-hidden />} Entrar
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
    <Ventana abierta={abierto} alCerrar={alCerrar} titulo="Cambiar contraseña" subtitulo="Cambia la contraseña con la que entras a registrar.">
      <form onSubmit={enviar} className="space-y-4">
        <Campo id="clave-nueva" etiqueta="Contraseña nueva (mínimo 8 caracteres)" tipo="password" valor={nueva} alCambiar={setNueva} autoComplete="new-password" />
        <Campo id="clave-repite" etiqueta="Repite la contraseña nueva" tipo="password" valor={repite} alCambiar={setRepite} autoComplete="new-password" />
        {error && (
          <p role="alert" className="rounded-lg bg-red-soft px-4 py-3 text-[16px] font-medium leading-6 text-red">
            {error}
          </p>
        )}
        <Boton type="submit" variante="ink" className="min-h-16 w-full text-[18px]" disabled={cargando}>
          {cargando ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <KeyRound className="size-5" aria-hidden />} Guardar contraseña
        </Boton>
      </form>
    </Ventana>
  );
}

/** Boton "Entrar" o, con sesion iniciada, el menu de la cuenta. */
export function Cuenta({ avisar, puede, porSubir }: { avisar: (t: string) => void; puede: boolean; porSubir: number }) {
  const { sesion, email, cargando, saliendo, salir } = useAuth();
  const [entrando, setEntrando] = useState(false);
  const [claveAbierta, setClaveAbierta] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmarSalida, setConfirmarSalida] = useState(false);
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
          <LogIn className="size-5" aria-hidden /> Entrar
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
        disabled={saliendo}
        className={cn("flex min-h-14 items-center gap-3 rounded-lg border border-line bg-surface pl-2 pr-4 text-[16px] font-semibold hover:bg-ground disabled:opacity-60", presion)}
      >
        <span className="grid size-10 place-items-center rounded-md bg-action text-[14px] font-semibold text-white">{saliendo ? <Loader2 className="size-5 animate-spin" aria-hidden /> : iniciales(email ?? "?")}</span>
        <span className="max-w-[160px] truncate">{saliendo ? "Cerrando sesión…" : (email ?? "").split("@")[0]}</span>
        <ChevronDown className={cn("size-5 text-faint transition-transform duration-150 ease-out", menu && "rotate-180")} aria-hidden />
      </button>
      {menu && (
          <div
            role="menu"
            className="paso-entra absolute left-0 top-16 z-50 w-72 max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-line bg-surface p-2"
          >
            <div className="px-3 pb-2 pt-2">
              <p className="truncate text-left text-[16px] font-semibold">{email}</p>
              <p className="mt-1 flex items-start gap-2 text-left text-[14px] leading-5 text-muted">
                {puede ? <ShieldCheck className="size-5 shrink-0 text-ok" aria-hidden /> : <Eye className="size-5 shrink-0" aria-hidden />}
                {puede ? "Puede registrar y anular" : "Solo lectura: tu correo no está autorizado"}
              </p>
            </div>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenu(false);
                setClaveAbierta(true);
              }}
              className="flex min-h-14 w-full items-center gap-3 rounded-md px-3 text-left text-[16px] font-semibold hover:bg-ground"
            >
              <KeyRound className="size-5 text-muted" aria-hidden /> Cambiar contraseña
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenu(false);
                if (porSubir > 0) setConfirmarSalida(true);
                else void salir();
              }}
              className="flex min-h-14 w-full items-center gap-3 rounded-md px-3 text-left text-[16px] font-semibold hover:bg-ground"
            >
              <LogOut className="size-5 text-muted" aria-hidden /> Cerrar sesión
            </button>
          </div>
      )}
      <ClaveDialog abierto={claveAbierta} alCerrar={() => setClaveAbierta(false)} avisar={avisar} />
      <Ventana abierta={confirmarSalida} alCerrar={() => setConfirmarSalida(false)} titulo="Tienes registros sin subir">
        <p className="text-[18px] leading-[26px] text-ink-2">
          {porSubir === 1 ? "Hay 1 registro" : `Hay ${porSubir} registros`} en este dispositivo que todavía no llegan al servidor. Si cierras sesión se quedan guardados aquí, pero solo se subirán cuando vuelvas a entrar con esta cuenta.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row-reverse">
          <Boton
            variante="ink"
            className="sm:flex-1"
            onClick={() => {
              setConfirmarSalida(false);
              void salir();
            }}
          >
            Cerrar sesión igual
          </Boton>
          <Boton className="sm:flex-1" onClick={() => setConfirmarSalida(false)}>
            Seguir con la sesión
          </Boton>
        </div>
      </Ventana>
    </div>
  );
}
