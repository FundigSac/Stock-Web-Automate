import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fechaCorta } from "../lib/format";
import type { Dia } from "../lib/derive";

/** Mismos tokens que index.css (7.7): entradas en el color de acción, salidas en rojo, ejes en el gris de texto secundario. */
const COLOR = { entradas: "#004257", salidas: "#b3261e", eje: "#3f4f59", rejilla: "#dfe6ea" };
const MARCA_EJE = { fill: COLOR.eje, fontSize: 14 };

type TipProps = { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string };

function Tip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  const ent = payload.find((p) => p.dataKey === "entradas")?.value ?? 0;
  const sal = payload.find((p) => p.dataKey === "salidas")?.value ?? 0;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-[14px]">
      <p className="mb-1 text-left font-semibold text-ink">{fechaCorta(label)}</p>
      <p className="flex items-center gap-2 text-muted">
        <span className="size-2 rounded-full bg-action" /> Entradas <b className="num ml-auto pl-4 text-ink">{ent}</b>
      </p>
      <p className="flex items-center gap-2 text-muted">
        <span className="size-2 rounded-full bg-red" /> Salidas <b className="num ml-auto pl-4 text-ink">{sal}</b>
      </p>
    </div>
  );
}

/**
 * Barras agrupadas por día: entradas y salidas. Sin animación: recharts anima el alto por JavaScript,
 * que no es transform ni opacity y no respeta el movimiento reducido. Las barras salen ya dibujadas.
 */
export function MovChart({ serie, alto = 260 }: { serie: Dia[]; alto?: number }) {
  const paso = Math.max(1, Math.round(serie.length / 7));
  return (
    <div style={{ height: alto }} className="w-full" role="img" aria-label="Gráfico de entradas y salidas por día">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={1} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={COLOR.rejilla} strokeDasharray="3 4" />
          <XAxis dataKey="fecha" tickFormatter={fechaCorta} interval={paso - 1} tickLine={false} axisLine={false} tick={MARCA_EJE} tickMargin={8} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} tick={MARCA_EJE} />
          <Tooltip content={<Tip />} cursor={{ fill: "rgb(11 29 38 / 0.06)" }} isAnimationActive={false} />
          <Bar dataKey="entradas" fill={COLOR.entradas} radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          <Bar dataKey="salidas" fill={COLOR.salidas} radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
