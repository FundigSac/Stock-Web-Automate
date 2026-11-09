import { WifiOff } from "lucide-react";
import { lazy, Suspense, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { LimiteError } from "./LimiteError";

type Control = {
  /** Se monta la primera vez que pasa a true. Sin pasarlo, se monta de una vez, como una pantalla. */
  activo?: boolean;
  /** Lo que se ve mientras llega el código. */
  espera?: ReactNode;
  /** Para ventanas: quien la abrió decide qué decir. Sin esto se muestra el aviso con Reintentar en su lugar. */
  alFallar?: () => void;
};

function FalloCarga({ alReintentar }: { alReintentar: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-line bg-surface px-5 py-8 text-center">
      <WifiOff className="mx-auto mb-3 size-7 text-warn" aria-hidden />
      <p className="text-[18px] font-semibold">Esta pantalla no se pudo abrir</p>
      <p className="mx-auto mt-1 max-w-md text-[16px] text-muted">Se descarga la primera vez que la abres con señal. Lo que ya guardaste sigue en este celular.</p>
      <button type="button" onClick={alReintentar} className="mt-4 inline-flex h-14 items-center justify-center rounded-xl bg-action px-6 text-[18px] font-semibold text-white">
        Reintentar
      </button>
    </div>
  );
}

/**
 * Carga una parte de la app cuando hace falta. El service worker las guarda todas, así que sin red se abren igual.
 * Si el código no llega, lo dice y se puede reintentar.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function crearDiferido<C extends ComponentType<any>>(importar: () => Promise<{ default: C }>) {
  type P = ComponentProps<C>;
  // Un import que falló queda recordado por React.lazy: para reintentar hay que crear otro.
  let Perezoso = lazy(importar) as unknown as ComponentType<object>;
  const renovar = () => {
    Perezoso = lazy(importar) as unknown as ComponentType<object>;
  };

  function Diferido({ activo, espera = null, alFallar, ...resto }: P & Control) {
    const [usado, setUsado] = useState(activo ?? true);
    const [intento, setIntento] = useState(0);
    if (activo && !usado) setUsado(true);
    if (!usado) return null;

    const fallo = alFallar
      ? () => {
          renovar();
          setUsado(false);
          setIntento((n) => n + 1);
          alFallar();
        }
      : renovar;

    return (
      <LimiteError key={intento} alFallar={fallo} reserva={alFallar ? undefined : <FalloCarga alReintentar={() => setIntento((n) => n + 1)} />}>
        <Suspense fallback={espera}>
          <Perezoso {...(resto as object)} />
        </Suspense>
      </LimiteError>
    );
  }

  /** Adelanta la descarga sin mostrar nada. */
  Diferido.precargar = () => {
    void importar().catch(() => undefined);
  };

  return Diferido;
}
