import { Activity, ArrowDownToLine, ArrowUpFromLine, ChevronRight, Package } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Card, Chip, CountUp, Vacio, useEsEscritorio } from "../components/ui";
import { MovChart } from "../components/MovChartDiferido";
import { agruparProductos, estadoDe, lecturas, movimientosDe, porEmpresa, resumir, serieDiaria } from "../lib/derive";
import { entero, fechaCorta, fechaLarga, nombreProducto, nombreTallaEn, partirMovimiento, tallaEnFrase, titulo } from "../lib/format";
import { cn } from "../lib/utils";
import type { VistaProps } from "./tipos";

const enlace = "inline-flex min-h-14 items-center gap-1 text-[16px] font-semibold text-action underline decoration-line underline-offset-4 hover:decoration-action";

/** Vista de escritorio: qué reponer, cuánto hay y cómo se movió el almacén. */
export function Resumen({ todos, datos, minimo, empresa, cambiarEmpresa, abrirProducto, irA }: VistaProps) {
  // En escritorio el gráfico se monta de una vez; en el celular, cuando se pide (dibujarlo con recharts es costoso).
  const escritorio = useEsEscritorio();
  const [verGrafico, setVerGrafico] = useState(false);
  const r = useMemo(() => resumir(datos.stock, minimo), [datos.stock, minimo]);
  const filasEmpresa = useMemo(() => porEmpresa(todos.stock, minimo), [todos.stock, minimo]);
  const movs = useMemo(() => movimientosDe(datos), [datos]);
  const serie = useMemo(() => serieDiaria(movs, 30), [movs]);
  const grupos = useMemo(() => agruparProductos(datos.stock, minimo), [datos.stock, minimo]);
  const frases = useMemo(() => lecturas(r, empresa === "TODAS" ? filasEmpresa : [], movs), [r, empresa, filasEmpresa, movs]);

  const totEntradas = serie.reduce((a, d) => a + d.entradas, 0);
  const totSalidas = serie.reduce((a, d) => a + d.salidas, 0);
  const hayMovs = totEntradas + totSalidas > 0;

  type Prioridad = "revisar" | "bajo" | "sin";
  const [eleccion, setEleccion] = useState<Prioridad | null>(null);
  // Por defecto muestra lo mas urgente que exista.
  const pestana: Prioridad = eleccion ?? (r.revisar > 0 ? "revisar" : r.bajo > 0 || r.sin === 0 ? "bajo" : "sin");
  const atencion = useMemo(() => {
    return grupos
      .map((g) => ({ g, afectadas: g.tallas.filter((t) => estadoDe(t.queda, minimo) === pestana) }))
      .filter((x) => x.afectadas.length > 0)
      .sort((a, b) => b.afectadas.length - a.afectadas.length || a.g.producto.localeCompare(b.g.producto, "es"));
  }, [grupos, pestana, minimo]);
  const explicacion: Record<Prioridad, string> = {
    revisar: "Saldo negativo: se entregó más de lo registrado. Revisa las salidas en Movimientos y anula las que estén mal.",
    bajo: `Les quedan ${minimo} o menos unidades y conviene reponerlas.`,
    sin: "No queda ninguna unidad de estas tallas.",
  };

  const ultimos = movs.slice(0, 6);
  const maxUnidades = Math.max(1, ...filasEmpresa.map((f) => f.unidades));

  const cifras: { etiqueta: string; valor: ReactNode; nota: string; alClic: () => void; tono?: string }[] = [
    {
      etiqueta: "Unidades en almacén",
      valor: <CountUp value={r.unidades} />,
      nota: r.unidades === 0 ? "No hay unidades disponibles ahora" : `En ${entero(r.disponibles)} ${r.disponibles === 1 ? "talla" : "tallas"}`,
      alClic: () => irA("stock", "todos"),
    },
    {
      etiqueta: "Sin stock",
      valor: <CountUp value={r.sin} />,
      nota: `De ${entero(r.articulos)} ${r.articulos === 1 ? "talla" : "tallas"} en total`,
      alClic: () => irA("stock", "sin"),
    },
    {
      etiqueta: "Por agotarse",
      valor: <CountUp value={r.bajo} />,
      nota: `Les quedan ${minimo} o menos unidades`,
      alClic: () => irA("stock", "bajo"),
      tono: r.bajo > 0 ? "text-warn" : undefined,
    },
    {
      etiqueta: "Último movimiento",
      valor: r.ultima ? fechaLarga(r.ultima) : "Ninguno",
      nota: r.ultima ? "Fecha del último registro" : "Todavía no hay movimientos",
      alClic: () => irA("movimientos"),
    },
  ];

  // Sobre el fondo de acción: blanco, ámbar de la banda y rojo, siempre con su texto al lado.
  const segmentos = [
    { clave: "ok", etiqueta: "Con stock", n: r.ok, color: "#ffffff" },
    { clave: "bajo", etiqueta: "Por agotarse", n: r.bajo, color: "var(--color-band-offline)" },
    { clave: "sin", etiqueta: "Sin stock", n: r.sin, color: "rgb(255 255 255 / 0.28)" },
    { clave: "revisar", etiqueta: "Saldo negativo", n: r.revisar, color: "var(--color-red)" },
  ].filter((s) => s.n > 0 || s.clave !== "revisar");

  return (
    <div className="space-y-5">
      {/* Lo primero: qué hay que reponer y qué quedó en negativo */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="p-6 xl:col-span-2">
          <h2 className="text-[18px] font-semibold leading-[26px]">Qué hay que reponer</h2>
          <div className="mt-3 flex flex-wrap gap-3" role="group" aria-label="Situación">
            {r.revisar > 0 && (
              <Chip activo={pestana === "revisar"} onClick={() => setEleccion("revisar")}>
                Saldo negativo ({r.revisar})
              </Chip>
            )}
            <Chip activo={pestana === "bajo"} onClick={() => setEleccion("bajo")}>
              Por agotarse ({r.bajo})
            </Chip>
            <Chip activo={pestana === "sin"} onClick={() => setEleccion("sin")}>
              Sin stock ({r.sin})
            </Chip>
          </div>
          <p className="mt-3 text-[16px] leading-6 text-muted">{explicacion[pestana]}</p>
          {atencion.length === 0 ? (
            <Vacio icono={<Package className="size-6" />} titulo="Todo en orden aquí" texto="Ninguna talla está en esta situación ahora mismo." />
          ) : (
            <>
              <ul className="mt-3 divide-y divide-line-2">
                {atencion.slice(0, 6).map(({ g, afectadas }) => (
                  <li key={g.clave}>
                    <button type="button" onClick={() => abrirProducto(g)} className="flex min-h-16 w-full items-center gap-3 py-2 text-left hover:bg-ground">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[18px] font-semibold leading-[26px]">{nombreProducto(g.producto, g.empresa)}</span>
                        <span className="block truncate text-[16px] leading-6 text-muted">
                          {titulo(g.empresa)} · {afectadas.length === 1 ? "talla" : "tallas"} {afectadas.map((t) => nombreTallaEn(t.talla, g.tallas)).join(", ")}
                        </span>
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-faint" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              {atencion.length > 6 && (
                <button type="button" onClick={() => irA("stock", pestana)} className={cn(enlace, "mt-1")}>
                  Ver los {atencion.length} productos
                </button>
              )}
            </>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-[18px] font-semibold leading-[26px]">Lectura rápida</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[16px] leading-6 text-ink-2 marker:text-faint">
            {frases.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Cifras principales en una sola franja: cada una lleva a su lista. */}
      <Card className="grid grid-cols-2 overflow-hidden xl:grid-cols-4">
        {cifras.map((k, i) => (
          <button
            key={k.etiqueta}
            type="button"
            onClick={k.alClic}
            className={cn(
              "border-line-2 p-5 text-left hover:bg-ground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action",
              i > 0 && "xl:border-l",
              i % 2 === 1 && "border-l",
              i >= 2 && "border-t xl:border-t-0",
            )}
          >
            <span className="block text-[14px] font-semibold leading-5 text-faint">{k.etiqueta}</span>
            <span className={cn("num mt-2 block text-[40px] font-semibold leading-[44px]", typeof k.valor === "string" && "text-[24px] leading-[44px]", k.tono)}>{k.valor}</span>
            <span className="mt-1 block text-[16px] leading-6 text-muted">{k.nota}</span>
          </button>
        ))}
      </Card>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-[18px] font-semibold leading-[26px]">Stock por empresa</h2>
          <p className="mt-1 text-left text-[14px] text-muted">Toca una empresa para ver el resumen solo de ella.</p>
          <ul className="mt-3 space-y-2">
            {filasEmpresa.map((f) => (
              <li key={f.empresa}>
                <button
                  type="button"
                  onClick={() => cambiarEmpresa(empresa === f.empresa ? "TODAS" : f.empresa)}
                  aria-pressed={empresa === f.empresa}
                  className={cn("-mx-2 block min-h-14 w-[calc(100%+16px)] rounded-lg px-2 py-2 text-left hover:bg-ground", empresa === f.empresa && "bg-ground")}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[16px] font-semibold">{titulo(f.empresa)}</span>
                    <span className="num text-[16px] font-semibold">{entero(f.unidades)} uds</span>
                  </span>
                  <span className="mt-2 block h-2 overflow-hidden bg-line-2" aria-hidden>
                    <span className="block h-full origin-left bg-action" style={{ transform: `scaleX(${f.unidades / maxUnidades})` }} />
                  </span>
                  <span className="mt-1.5 block text-[14px] text-muted">
                    {entero(f.disponibles)} de {entero(f.articulos)} {f.articulos === 1 ? "talla" : "tallas"} con stock
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="text-[18px] font-semibold leading-[26px]">Últimos movimientos</h2>
          {ultimos.length === 0 ? (
            <Vacio icono={<Activity className="size-6" />} titulo="Sin movimientos todavía" texto="Cuando registres una entrada o una salida, aparecerá aquí." />
          ) : (
            <>
              <ul className="mt-3 divide-y divide-line-2">
                {ultimos.map((m) => (
                  <li key={m.key} className="flex min-h-16 items-center gap-3 py-2">
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", m.tipo === "entrada" ? "bg-ground text-action" : "bg-red-soft text-red")} aria-hidden>
                      {m.tipo === "entrada" ? <ArrowDownToLine className="size-5" /> : <ArrowUpFromLine className="size-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold leading-6">
                        {m.producto ? `${nombreProducto(partirMovimiento(m.producto).nombre)} · ${tallaEnFrase(partirMovimiento(m.producto).talla)}` : m.codigo || "Sin producto"}
                      </span>
                      <span className="block truncate text-[14px] leading-5 text-muted">
                        {m.tipo === "entrada" ? "Entrada" : "Salida"} · {m.fecha ? fechaCorta(m.fecha) : "Sin fecha"}
                        {m.persona ? ` · ${titulo(m.persona)}` : ""}
                      </span>
                    </span>
                    <b className={cn("num text-[18px]", m.tipo === "salida" && "text-red")}>
                      {m.tipo === "entrada" ? "+" : "−"}
                      {entero(m.cantidad)}
                    </b>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => irA("movimientos")} className={cn(enlace, "mt-1")}>
                Ver todos los movimientos
              </button>
            </>
          )}
        </Card>
      </div>

      {/* Gráfico y tallas con stock */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="p-6 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-semibold leading-[26px]">Lo que entra y lo que sale</h2>
              <p className="text-left text-[14px] text-muted">Unidades por día en los últimos 30 días</p>
            </div>
            <div className="flex flex-wrap gap-3 text-[16px]">
              <span className="inline-flex min-h-10 items-center gap-2 rounded-md bg-ground px-3 font-semibold">
                <span className="size-3 bg-action" aria-hidden /> Entradas <b className="num">{entero(totEntradas)}</b>
              </span>
              <span className="inline-flex min-h-10 items-center gap-2 rounded-md bg-ground px-3 font-semibold">
                <span className="size-3 bg-red" aria-hidden /> Salidas <b className="num">{entero(totSalidas)}</b>
              </span>
            </div>
          </div>
          <div className="mt-4">
            {!hayMovs ? (
              <div className="grid h-[260px] place-items-center rounded-lg border border-dashed border-line">
                <Vacio icono={<Activity className="size-6" />} titulo="Aún no hay movimientos en estos 30 días" texto="Cuando registres una entrada o una salida, aparecerá en el gráfico." />
              </div>
            ) : escritorio || verGrafico ? (
              <MovChart serie={serie} />
            ) : (
              // En el celular el gráfico se dibuja solo si se pide: la pantalla abre sin el costo de recharts en el hilo principal.
              <div className="grid h-[260px] place-items-center rounded-lg bg-ground px-6 text-center">
                <button type="button" onClick={() => setVerGrafico(true)} className="inline-flex min-h-14 items-center gap-2 rounded-md border border-line bg-surface px-5 text-[16px] font-semibold text-ink">
                  <Activity className="size-5 shrink-0" aria-hidden /> Ver gráfico de 30 días
                </button>
              </div>
            )}
          </div>
        </Card>

        <div className="rounded-2xl bg-action p-6 text-white">
          <h2 className="text-[18px] font-semibold leading-[26px]">Tallas con stock</h2>
          <p className="text-left text-[16px] text-white/80">Tienen al menos una unidad</p>
          <p className="mt-5 flex items-baseline gap-1 font-semibold leading-none">
            <CountUp value={r.pctDisponible} className="text-[64px]" />
            <span className="text-[32px] text-white/70">%</span>
          </p>
          <div className="mt-6 flex h-3 w-full overflow-hidden bg-white/10" role="img" aria-label={`${r.pctDisponible}% de las tallas tiene stock`}>
            {segmentos.map((s) => (
              <div key={s.clave} style={{ width: `${r.articulos ? (s.n / r.articulos) * 100 : 0}%`, background: s.color }} />
            ))}
          </div>
          <ul className="mt-5 space-y-2.5 text-[16px]">
            {segmentos.map((s) => (
              <li key={s.clave} className="flex items-center gap-3 text-left">
                <span className="size-3 shrink-0" style={{ background: s.color }} aria-hidden />
                <span className="text-white/90">{s.etiqueta}</span>
                <b className="num ml-auto">{entero(s.n)}</b>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
