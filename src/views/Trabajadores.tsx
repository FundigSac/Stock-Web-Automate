import { motion } from "framer-motion";
import { ChevronRight, Shirt, UserCheck, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, Chip, CountUp, Kicker, Tabla, Vacio, td, th } from "../components/ui";
import { entero, fechaLarga, iniciales, titulo } from "../lib/format";
import { cn } from "../lib/utils";
import type { VistaProps } from "./tipos";

export function Trabajadores({ todos, abrirTrabajador, editor, abrirNuevoTrabajador }: VistaProps) {
  const [area, setArea] = useState("TODAS");
  const lista = todos.trabajadores;

  const areas = useMemo(() => {
    const m = new Map<string, { area: string; personas: number; prendas: number }>();
    for (const t of lista) {
      const a = t.area ?? "Sin área";
      const f = m.get(a) ?? { area: a, personas: 0, prendas: 0 };
      f.personas++;
      f.prendas += t.prendas_recibidas;
      m.set(a, f);
    }
    return Array.from(m.values()).sort((a, b) => b.prendas - a.prendas || a.area.localeCompare(b.area, "es"));
  }, [lista]);

  const visibles = useMemo(
    () =>
      lista
        .filter((t) => area === "TODAS" || (t.area ?? "Sin área") === area)
        .sort((a, b) => b.prendas_recibidas - a.prendas_recibidas || a.trabajador.localeCompare(b.trabajador, "es")),
    [lista, area],
  );

  const totalPrendas = lista.reduce((a, t) => a + t.prendas_recibidas, 0);
  const conEntregas = lista.filter((t) => t.prendas_recibidas > 0).length;
  const maxPrendas = Math.max(1, ...visibles.map((t) => t.prendas_recibidas));
  const maxArea = Math.max(1, ...areas.map((a) => a.prendas));

  const kpis = [
    { etiqueta: "Trabajadores", valor: lista.length, nota: `en ${areas.length} áreas`, icono: <Users className="size-4" /> },
    { etiqueta: "Prendas entregadas", valor: totalPrendas, nota: "en total, desde que se llevan registros", icono: <Shirt className="size-4" /> },
    {
      etiqueta: "Con entregas",
      valor: conEntregas,
      nota: lista.length - conEntregas === 0 ? "todos ya recibieron algo" : `${lista.length - conEntregas} aún no reciben nada`,
      icono: <UserCheck className="size-4" />,
    },
  ];

  return (
    <div className="space-y-5">
      {editor && (
        <button
          type="button"
          onClick={abrirNuevoTrabajador}
          className="flex w-full items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition hover:border-faint active:scale-[0.99] sm:w-auto sm:min-w-[22rem]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink text-white">
            <UserPlus className="size-5" />
          </span>
          <span>
            <span className="block text-[14.5px] font-semibold">Trabajador nuevo</span>
            <span className="block text-[12px] text-muted">Agrégalo para poder anotarle entregas</span>
          </span>
        </button>
      )}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.etiqueta} className="p-5">
            <div className="flex items-center justify-between text-faint">
              <Kicker>{k.etiqueta}</Kicker>
              {k.icono}
            </div>
            <p className="display mt-3 text-4xl font-semibold leading-none">
              <CountUp value={k.valor} />
            </p>
            <p className="mt-2.5 text-[12.5px] text-muted">{k.nota}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="p-6 order-2">
          <Kicker>Por área</Kicker>
          <h2 className="display mt-1 text-lg font-semibold">Prendas entregadas por área</h2>
          <ul className="mt-4 space-y-4">
            {areas.map((a) => (
              <li key={a.area}>
                <button
                  type="button"
                  onClick={() => setArea(area === a.area ? "TODAS" : a.area)}
                  className={cn(
                    "-mx-2 block w-[calc(100%+16px)] rounded-xl px-2 py-1.5 text-left transition hover:bg-ground",
                    area === a.area && "bg-ground",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13.5px] font-semibold">{titulo(a.area)}</span>
                    <span className="num text-[13px] font-semibold">{entero(a.prendas)}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-2">
                    <motion.div
                      className="h-full rounded-full bg-ink"
                      initial={{ width: 0 }}
                      animate={{ width: `${(a.prendas / maxArea) * 100}%` }}
                      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                  <p className="mt-1.5 text-[12px] text-muted">
                    {a.personas} {a.personas === 1 ? "persona" : "personas"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4 order-1 xl:col-span-2">
          <div className="flex flex-wrap gap-2">
            <Chip activo={area === "TODAS"} onClick={() => setArea("TODAS")}>
              Todas las áreas
            </Chip>
            {areas.map((a) => (
              <Chip key={a.area} activo={area === a.area} onClick={() => setArea(a.area)}>
                {titulo(a.area)}
              </Chip>
            ))}
          </div>
          <Card className="overflow-hidden p-2">
            {visibles.length === 0 ? (
              <Vacio icono={<Users className="size-5" />} titulo="No hay trabajadores aquí" texto="Todavía no hay personal cargado." />
            ) : (
              <Tabla etiqueta="Trabajadores y prendas recibidas" minAncho={560}>
                <thead className="border-b border-line-2">
                  <tr>
                    <th className={th} scope="col">Trabajador</th>
                    <th className={th} scope="col">Prendas recibidas</th>
                    <th className={th} scope="col">Última entrega</th>
                    <th className={th} scope="col"><span className="sr-only">Detalle</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((t) => (
                    <tr
                      key={t.trabajador}
                      onClick={() => abrirTrabajador(t.trabajador)}
                      className="cursor-pointer border-b border-line-2 transition-colors last:border-0 hover:bg-ground/70"
                    >
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ground text-[12px] font-semibold text-muted">
                            {iniciales(t.trabajador)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-semibold">{titulo(t.trabajador)}</p>
                            <p className="text-[12px] text-muted">{titulo(t.area ?? "Sin área")}</p>
                          </div>
                        </div>
                      </td>
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <span className="num w-8 text-right text-[15px] font-semibold">{entero(t.prendas_recibidas)}</span>
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line-2">
                            <div className="h-full rounded-full bg-ink" style={{ width: `${(t.prendas_recibidas / maxPrendas) * 100}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className={cn(td, "text-[13px] text-muted")}>{fechaLarga(t.ultima_entrega)}</td>
                      <td className={cn(td, "text-right")}>
                        <ChevronRight className="ml-auto size-4 text-faint" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
