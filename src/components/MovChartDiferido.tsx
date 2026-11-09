import { lazy, Suspense, type ComponentProps } from "react";
import { LimiteError } from "./LimiteError";
import type { MovChart as Grafico } from "./MovChart";

const Real = lazy(() => import("./MovChart").then((m) => ({ default: m.MovChart })));

/** La librería de gráficos pesa mucho: se carga aparte para que la pantalla aparezca antes. */
export function MovChart(p: ComponentProps<typeof Grafico>) {
  const alto = p.alto ?? 260;
  return (
    <LimiteError reserva={<div className="grid place-items-center rounded-2xl bg-ground text-[13px] text-muted" style={{ height: alto }}>El gráfico necesita conexión</div>}>
      <Suspense fallback={<div className="skeleton rounded-2xl" style={{ height: alto }} aria-hidden />}>
        <Real {...p} />
      </Suspense>
    </LimiteError>
  );
}
