import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fechaCorta } from "../lib/format";
import type { Dia } from "../lib/derive";

type TipProps = { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string };

function Tip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  const ent = payload.find((p) => p.dataKey === "entradas")?.value ?? 0;
  const sal = payload.find((p) => p.dataKey === "salidas")?.value ?? 0;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-ink">{fechaCorta(label)}</p>
      <p className="flex items-center gap-2 text-muted">
        <span className="size-2 rounded-full bg-ink" /> Entradas <b className="num ml-auto pl-4 text-ink">{ent}</b>
      </p>
      <p className="flex items-center gap-2 text-muted">
        <span className="size-2 rounded-full bg-red" /> Salidas <b className="num ml-auto pl-4 text-ink">{sal}</b>
      </p>
    </div>
  );
}

/** Barras agrupadas por dia: entradas (tinta) y salidas (rojo). */
export function MovChart({ serie, alto = 260 }: { serie: Dia[]; alto?: number }) {
  const paso = Math.max(1, Math.round(serie.length / 7));
  return (
    <div style={{ height: alto }} className="w-full" role="img" aria-label="Gráfico de entradas y salidas por día">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barGap={1} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="#e2e4e8" strokeDasharray="3 4" />
          <XAxis
            dataKey="fecha"
            tickFormatter={fechaCorta}
            interval={paso - 1}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#9aa0a8", fontSize: 11 }}
            tickMargin={8}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={42} tick={{ fill: "#9aa0a8", fontSize: 11 }} />
          <Tooltip content={<Tip />} cursor={{ fill: "rgb(14 15 17 / 0.05)", radius: 6 }} />
          <Bar dataKey="entradas" fill="#0e0f11" radius={[4, 4, 0, 0]} maxBarSize={14} animationDuration={800} />
          <Bar dataKey="salidas" fill="#d7261e" radius={[4, 4, 0, 0]} maxBarSize={14} animationDuration={800} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
