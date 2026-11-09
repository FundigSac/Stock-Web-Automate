import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Bot, LogIn } from "lucide-react";
import clsx from "clsx";
import { useMemo, type ReactNode } from "react";
import { estadoPorSubir, type EstadoFila, type TonoFila } from "../components/estadoPorSubir";
import { entero, nombreProducto } from "../lib/format";
import type { ItemRespaldo } from "../lib/offline/almacen";
import type { Respaldo } from "../lib/offline/useRespaldo";
import { selloLima } from "../lib/tiempo";

const TONO: Record<TonoFila, string> = { ok: "text-ok", info: "text-info", warn: "text-warn", red: "text-red" };
const BOTON_APOYO = "mt-3 flex min-h-14 w-full items-center justify-center gap-2.5 rounded-md border border-line bg-surface px-4 text-[16px] font-semibold text-action";

/** Mismo texto que en Por subir. Lo subido que quedó con una observación se dice aparte, porque hay que mirarlo. */
function estadoDe(i: ItemRespaldo, subiendo: boolean, enLinea: boolean): EstadoFila {
  if (i.estado === "confirmado" && i.revision) return { texto: "Por revisar", tono: "red", icono: AlertTriangle };
  return estadoPorSubir(i, subiendo, enLinea);
}

/** El producto ocupa todo el ancho; el estado va debajo, junto a quién y a qué hora, y baja de línea si no cabe. */
function Ultimo({ i, subiendo, enLinea }: { i: ItemRespaldo; subiendo: boolean; enLinea: boolean }) {
  const estado = estadoDe(i, subiendo, enLinea);
  const Icono = estado.icono;
  const unidades = i.lineas.reduce((a, l) => a + l.cantidad, 0);
  const nombres = Array.from(new Set(i.lineas.map((l) => nombreProducto(l.producto)))).join(", ");
  return (
    <li className="min-h-16 px-4 py-2.5">
      <p className="line-clamp-2 text-left text-[16px] font-semibold leading-6 [overflow-wrap:anywhere]">
        {i.tipo === "entrada" ? "Entrada" : "Salida"} de {entero(unidades)} · {nombres}
      </p>
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
        <span className="num min-w-0 text-[14px] leading-5 text-muted [overflow-wrap:anywhere]">
          {i.trabajador ? `${nombreProducto(i.trabajador)} · ` : ""}
          {selloLima(i.capturadoEn).hora}
        </span>
        <span className={clsx("inline-flex items-center gap-1.5 text-[14px] font-semibold leading-5", TONO[estado.tono])}>
          <Icono className="size-4 shrink-0" aria-hidden />
          {estado.texto}
        </span>
      </div>
    </li>
  );
}

/** Pantalla inicial. Lo que se ve aquí también está en index.html para la primera pintura. */
export function PantallaRegistrar({
  r,
  puede,
  cerrado,
  conSesion,
  alElegir,
  alPrepararse,
  abrirAsistente,
  alEntrar,
  children,
}: {
  r: Respaldo;
  puede: boolean;
  /** Ya se sabe que en este momento no se puede registrar. Mientras carga, los botones solo esperan. */
  cerrado: boolean;
  /** Hay una cuenta dentro, pero no está autorizada: entrar otra vez no cambia nada. */
  conSesion: boolean;
  alElegir: (tipo: "entrada" | "salida") => void;
  alPrepararse: () => void;
  abrirAsistente: () => void;
  /** Abre la misma ventana Entrar de Más › Cuenta. */
  alEntrar: () => void;
  /** Avisos sobre los datos, debajo de los botones. */
  children?: ReactNode;
}) {
  const ultimos = useMemo(() => [...r.items].reverse().slice(0, 3), [r.items]);
  // Todavía no llegan los ajustes: no se sabe si el registro está abierto.
  const esperando = !puede && !cerrado;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[24px] font-semibold leading-8">¿Qué vas a registrar?</h1>
      <div className="mt-5 grid grid-cols-1 gap-3">
        <button type="button" disabled={!puede} onClick={() => alElegir("salida")} onPointerDown={alPrepararse} className={clsx("registrar-opcion registrar-salida", !puede && "opacity-60")}>
          <ArrowUpFromLine className="size-10 shrink-0" aria-hidden />
          Entregar a un trabajador
        </button>
        <button type="button" disabled={!puede} onClick={() => alElegir("entrada")} onPointerDown={alPrepararse} className={clsx("registrar-opcion registrar-entrada", !puede && "opacity-60")}>
          <ArrowDownToLine className="size-10 shrink-0" aria-hidden />
          Ingresar a almacén
        </button>
      </div>
      {/* Mismo alto que el botón del asistente que ocupa este lugar después: al cambiar no se mueve nada. */}
      {esperando && <p className="mt-3 flex min-h-14 items-center text-[16px] leading-6 text-muted">Cargando los datos. Los botones se activan cuando lleguen.</p>}
      {cerrado && (
        <div className="mt-3">
          <p className="text-[16px] text-muted">
            {conSesion ? "El registro está cerrado por ahora y tu cuenta solo puede ver el stock." : "El registro está cerrado por ahora. Si tienes una cuenta autorizada, entra para registrar."}
          </p>
          {!conSesion && (
            <button type="button" onClick={alEntrar} className={BOTON_APOYO}>
              <LogIn className="size-5 shrink-0" aria-hidden />
              Entrar con tu cuenta
            </button>
          )}
        </div>
      )}

      {puede && (
        <button type="button" disabled={!r.enLinea} onClick={abrirAsistente} className={clsx(BOTON_APOYO, "disabled:text-muted lg:hidden")}>
          <Bot className="size-5 shrink-0" aria-hidden />
          {r.enLinea ? "Preguntar al asistente" : "Asistente · Necesita conexión"}
        </button>
      )}

      {children && <div className="mt-5">{children}</div>}

      <section aria-label="Últimos registros" className="mt-6">
        <h2 className="text-[18px] font-semibold">Últimos registros de este celular</h2>
        {ultimos.length === 0 ? (
          <p className="mt-2 text-[16px] text-muted">Todavía no hay registros aquí.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line-2 overflow-hidden rounded-2xl border border-line bg-surface">
            {ultimos.map((i) => (
              <Ultimo key={i.id} i={i} subiendo={r.subiendo} enLinea={r.enLinea} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
