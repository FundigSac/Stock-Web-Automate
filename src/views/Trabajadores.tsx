import { ChevronRight, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, Chip, Vacio, presion } from "../components/ui";
import { entero, fechaLarga, iniciales, titulo } from "../lib/format";
import { cn } from "../lib/utils";
import type { VistaProps } from "./tipos";

const personas = (n: number) => `${entero(n)} ${n === 1 ? "persona" : "personas"}`;

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
  const sinEntregas = lista.length - conEntregas;
  const maxArea = Math.max(1, ...areas.map((a) => a.prendas));

  return (
    <div className="space-y-5">
      {/* Las cifras van en una línea: lo que se busca aquí es a la persona. */}
      <p className="text-[16px] leading-6 text-muted">
        <b className="num text-ink">{entero(lista.length)}</b> {lista.length === 1 ? "trabajador" : "trabajadores"} en {entero(areas.length)} {areas.length === 1 ? "área" : "áreas"} ·{" "}
        <b className="num text-ink">{entero(totalPrendas)}</b> unidades entregadas desde que se llevan registros ·{" "}
        {sinEntregas === 0 ? "todos ya recibieron algo" : `${personas(sinEntregas)} sin entregas todavía`}
      </p>

      {editor && (
        <button
          type="button"
          onClick={abrirNuevoTrabajador}
          className={cn("flex min-h-16 w-full items-center gap-4 rounded-lg border-2 border-action bg-surface px-4 py-3 text-left text-action sm:w-auto sm:min-w-[22rem]", presion)}
        >
          <UserPlus className="size-7 shrink-0" aria-hidden />
          <span>
            <span className="block text-[18px] font-semibold leading-[26px]">Trabajador nuevo</span>
            <span className="block text-[16px] leading-6 text-muted">Agrégalo para poder anotarle entregas</span>
          </span>
        </button>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex flex-wrap gap-3" role="group" aria-label="Filtrar por área">
            <Chip activo={area === "TODAS"} onClick={() => setArea("TODAS")}>
              Todas las áreas
            </Chip>
            {areas.map((a) => (
              <Chip key={a.area} activo={area === a.area} onClick={() => setArea(a.area)}>
                {titulo(a.area)}
              </Chip>
            ))}
          </div>

          <Card className="overflow-hidden">
            {visibles.length === 0 ? (
              <Vacio icono={<Users className="size-6" />} titulo="No hay trabajadores aquí" texto="Todavía no hay personal cargado." />
            ) : (
              <>
              {/* En escritorio, tabla para comparar de un vistazo; en el celular, la lista de abajo. */}
              <table className="hidden w-full text-left lg:table" aria-label="Trabajadores y unidades recibidas">
                <thead className="border-b border-line-2 text-[14px] text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Trabajador</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Área</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Unidades recibidas</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Última entrega</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-2">
                  {visibles.map((t) => (
                    <tr key={t.trabajador} className="hover:bg-ground">
                      <td className="px-4 py-2">
                        <button type="button" onClick={() => abrirTrabajador(t.trabajador)} className="flex min-h-12 items-center gap-3 text-left text-[16px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action">
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ground text-[14px] text-muted" aria-hidden>{iniciales(t.trabajador)}</span>
                          <span className="[overflow-wrap:anywhere]">{titulo(t.trabajador)}</span>
                        </button>
                      </td>
                      <td className="px-4 py-2 text-[16px] text-muted">{titulo(t.area ?? "Sin área")}</td>
                      <td className="num px-4 py-2 text-right text-[18px] font-semibold">{entero(t.prendas_recibidas)}</td>
                      <td className="px-4 py-2 text-[16px] text-muted">{t.ultima_entrega ? fechaLarga(t.ultima_entrega) : "Sin entregas"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="divide-y divide-line-2 lg:hidden" aria-label="Trabajadores y unidades recibidas">
                {visibles.map((t) => (
                  <li key={t.trabajador}>
                    <button type="button" onClick={() => abrirTrabajador(t.trabajador)} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-ground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-ground text-[14px] font-semibold text-muted" aria-hidden>
                        {iniciales(t.trabajador)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[18px] font-semibold leading-[26px] [overflow-wrap:anywhere]">{titulo(t.trabajador)}</span>
                        {/* Baja de línea en vez de cortarse: la fecha de la última entrega es lo que se viene a mirar. */}
                        <span className="block text-[16px] leading-6 text-muted [overflow-wrap:anywhere]">
                          {titulo(t.area ?? "Sin área")}
                          {t.ultima_entrega ? ` · última entrega ${fechaLarga(t.ultima_entrega)}` : t.prendas_recibidas === 0 ? " · sin entregas" : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="num block text-[24px] font-semibold leading-[26px]">{entero(t.prendas_recibidas)}</span>
                        <span className="block text-[14px] leading-5 text-muted">{t.prendas_recibidas === 1 ? "unidad" : "unidades"}</span>
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-faint" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              </>
            )}
          </Card>
        </div>

        {/* Comparar áreas es tarea de escritorio. En el celular las áreas ya están en los filtros. */}
        <Card className="hidden p-6 lg:block">
          <h2 className="text-[18px] font-semibold leading-[26px]">Unidades entregadas por área</h2>
          <ul className="mt-4 space-y-2">
            {areas.map((a) => (
              <li key={a.area}>
                <button
                  type="button"
                  onClick={() => setArea(area === a.area ? "TODAS" : a.area)}
                  aria-pressed={area === a.area}
                  className={cn("-mx-2 block min-h-14 w-[calc(100%+16px)] rounded-lg px-2 py-2 text-left hover:bg-ground", area === a.area && "bg-ground")}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[16px] font-semibold">{titulo(a.area)}</span>
                    <span className="num text-[16px] font-semibold">{entero(a.prendas)}</span>
                  </span>
                  <span className="mt-2 block h-2 overflow-hidden bg-line-2" aria-hidden>
                    <span className="block h-full origin-left bg-action" style={{ transform: `scaleX(${a.prendas / maxArea})` }} />
                  </span>
                  <span className="mt-1.5 block text-[14px] text-muted">{personas(a.personas)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
