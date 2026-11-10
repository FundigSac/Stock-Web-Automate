import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  PackageMinus,
  PackagePlus,
  CalendarClock,
  ChevronRight,
  Package,
  PackageX,
  Sparkles,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { CantidadMov, Card, Chip, CountUp, EstadoBadge, FallaCarga, Kicker, Vacio } from "../components/ui";
import { estadoCarga } from "../lib/carga";
import { MovChart } from "../components/MovChartDiferido";
import { AvisoEspacio } from "../components/UsoAlmacen";
import {
  agruparProductos,
  estadoDe,
  estadoProducto,
  lecturas,
  movimientosDe,
  porEmpresa,
  resumir,
  serieDiaria,
  textoEstadoProducto,
} from "../lib/derive";
import { entero, etiquetaTalla, fechaCorta, fechaLarga, nombreProducto, nombreTallaEn, partirMovimiento, titulo } from "../lib/format";
import { cn } from "../lib/utils";
import type { VistaProps } from "./tipos";

const aparece = (i: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] as const },
});

export function Resumen({ todos, datos, minimo, empresa, cambiarEmpresa, abrirProducto, irA, faltanDatos, errorDatos }: VistaProps) {
  // Una tabla que no cargó no es una tabla vacía (X10-4).
  const cargaMovs = estadoCarga({ cargando: false, faltan: faltanDatos, campos: ["entradas", "salidas"], errorServidor: errorDatos, hayFilas: true });
  const fallaMovs = cargaMovs === "error" || cargaMovs === "incompleto" ? cargaMovs : null;
  const r = useMemo(() => resumir(datos.stock, minimo), [datos.stock, minimo]);
  const filasEmpresa = useMemo(() => porEmpresa(todos.stock, minimo), [todos.stock, minimo]);
  const movs = useMemo(() => movimientosDe(datos), [datos]);
  const serie = useMemo(() => serieDiaria(movs, 30), [movs]);
  const grupos = useMemo(() => agruparProductos(datos.stock, minimo), [datos.stock, minimo]);
  const frases = useMemo(() => lecturas(r, empresa === "TODAS" ? filasEmpresa : [], movs, fallaMovs !== null), [r, empresa, filasEmpresa, movs, fallaMovs]);

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
    bajo: `Les quedan ${minimo} o menos unidades: conviene reponerlos.`,
    sin: "No queda ninguna unidad de estas tallas.",
  };

  const ultimos = movs.slice(0, 6);
  const maxUnidades = Math.max(1, ...filasEmpresa.map((f) => f.unidades));

  const kpis: { icono: ReactNode; etiqueta: string; valor: ReactNode; nota: string; alClic: () => void; tono?: string }[] = [
    {
      icono: <Package className="size-4" />,
      etiqueta: "Unidades en almacén",
      valor: <CountUp value={r.unidades} />,
      nota: r.unidades === 0 ? "No hay unidades disponibles ahora" : `repartidas en ${entero(r.disponibles)} tallas`,
      alClic: () => irA("stock", "todos"),
    },
    {
      icono: <PackageX className="size-4" />,
      etiqueta: "Sin stock",
      valor: <CountUp value={r.sin} />,
      nota: `de ${entero(r.articulos)} tallas en total`,
      alClic: () => irA("stock", "sin"),
    },
    {
      icono: <AlertTriangle className="size-4" />,
      etiqueta: "Por agotarse",
      valor: <CountUp value={r.bajo} />,
      nota: `les quedan ${minimo} o menos unidades`,
      alClic: () => irA("stock", "bajo"),
      tono: r.bajo > 0 ? "text-warn" : undefined,
    },
    {
      icono: <CalendarClock className="size-4" />,
      etiqueta: "Última actividad",
      valor: <span className="text-3xl">{r.ultima ? fechaLarga(r.ultima) : "—"}</span>,
      nota: r.ultima ? "fecha del último movimiento anotado" : "todavía no hay movimientos",
      alClic: () => irA("movimientos"),
    },
  ];

  const segmentos = [
    { clave: "ok", etiqueta: "Con stock", n: r.ok, color: "#ffffff" },
    { clave: "bajo", etiqueta: "Por agotarse", n: r.bajo, color: "#e5a93a" },
    { clave: "sin", etiqueta: "Sin stock", n: r.sin, color: "rgb(255 255 255 / 0.22)" },
    { clave: "revisar", etiqueta: "Saldo negativo", n: r.revisar, color: "#d7261e" },
  ].filter((s) => s.n > 0 || s.clave !== "revisar");

  return (
    <div className="space-y-5">
      {/* Desde el 80 % del espacio del servidor (fotos o base) */}
      <AvisoEspacio />
      {/* Grafico + disponibilidad */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <motion.div {...aparece(0)} className="xl:col-span-2">
          <Card className="h-full p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Kicker>Movimiento · últimos 30 días</Kicker>
                <h2 className="display mt-1 text-xl font-semibold">Lo que entra y lo que sale</h2>
              </div>
              <div className="flex gap-2 text-[13px]">
                <span className="inline-flex items-center gap-2 rounded-full bg-ground px-3 py-1.5 font-semibold">
                  <span className="size-2 rounded-full bg-ink" /> Entradas <b className="num">{entero(totEntradas)}</b>
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-ground px-3 py-1.5 font-semibold">
                  <span className="size-2 rounded-full bg-red" /> Salidas <b className="num">{entero(totSalidas)}</b>
                </span>
              </div>
            </div>
            <div className="mt-4">
              {fallaMovs ? (
                <FallaCarga tipo={fallaMovs} que="Los movimientos" breve />
              ) : hayMovs ? (
                <MovChart serie={serie} />
              ) : (
                <div className="grid h-[260px] place-items-center rounded-2xl border border-dashed border-line">
                  <Vacio
                    icono={<Activity className="size-5" />}
                    titulo="Aún no hay movimientos en estos 30 días"
                    texto="Cuando registres una entrada o una salida, la verás dibujada aquí."
                  />
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div {...aparece(1)}>
          <div className="relative h-full overflow-hidden rounded-3xl bg-ink p-6 text-white shadow-pop">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full"
              style={{ background: "radial-gradient(closest-side, rgb(215 38 30 / 0.3), transparent)" }}
            />
            <Kicker className="text-white/70">Disponibilidad</Kicker>
            <p className="mt-1 text-sm text-white/65">Tallas que tienen al menos una unidad</p>
            <div className="display mt-5 flex items-baseline gap-1 text-7xl font-semibold leading-none">
              <CountUp value={r.pctDisponible} />
              <span className="text-4xl text-white/50">%</span>
            </div>
            <div className="mt-6 flex h-2.5 w-full overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${r.pctDisponible}% de las tallas tiene stock`}>
              {segmentos.map((s) => (
                <motion.div
                  key={s.clave}
                  initial={{ width: 0 }}
                  animate={{ width: `${r.articulos ? (s.n / r.articulos) * 100 : 0}%` }}
                  transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                  style={{ background: s.color }}
                />
              ))}
            </div>
            <ul className="mt-5 space-y-2.5 text-[13px]">
              {segmentos.map((s) => (
                <li key={s.clave} className="flex items-center gap-3">
                  <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-white/75">{s.etiqueta}</span>
                  <b className="num ml-auto">{entero(s.n)}</b>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
        {kpis.map((k, i) => (
          <motion.button
            key={k.etiqueta}
            type="button"
            onClick={k.alClic}
            {...aparece(2 + i)}
            whileHover={{ y: -2 }}
            className="rounded-3xl border border-line-2 bg-surface p-5 text-left shadow-card transition-colors hover:border-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <div className="flex items-center justify-between text-faint">
              <Kicker>{k.etiqueta}</Kicker>
              {k.icono}
            </div>
            <div className={cn("display mt-3 text-4xl font-semibold leading-none", k.tono)}>{k.valor}</div>
            <p className="mt-2.5 text-[12.5px] leading-snug text-muted">{k.nota}</p>
          </motion.button>
        ))}
      </div>

      {/* Lectura rapida */}
      <motion.div {...aparece(6)}>
        <Card className="flex gap-4 p-5">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-ground text-ink">
            <Sparkles className="size-[18px]" />
          </div>
          <div className="min-w-0">
            <Kicker>Lectura rápida</Kicker>
            <ul className="mt-2 space-y-1.5 text-[14px] leading-relaxed text-ink-2">
              {frases.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </Card>
      </motion.div>

      {/* Tres listas */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        <motion.div {...aparece(7)}>
          <Card className="h-full p-6">
            <Kicker>Por empresa</Kicker>
            <h2 className="display mt-1 text-lg font-semibold">Stock por empresa</h2>
            <ul className="mt-4 space-y-4">
              {filasEmpresa.map((f) => (
                <li key={f.empresa}>
                  <button
                    type="button"
                    onClick={() => cambiarEmpresa(empresa === f.empresa ? "TODAS" : f.empresa)}
                    className={cn(
                      "-mx-2 block w-[calc(100%+16px)] rounded-xl px-2 py-1.5 text-left transition hover:bg-ground",
                      empresa === f.empresa && "bg-ground",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[13.5px] font-semibold">{titulo(f.empresa)}</span>
                      <span className="num text-[13px] font-semibold">{entero(f.unidades)} uds</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-2">
                      <motion.div
                        className="h-full rounded-full bg-ink"
                        initial={{ width: 0 }}
                        animate={{ width: `${(f.unidades / maxUnidades) * 100}%` }}
                        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                    <p className="mt-1.5 text-[12px] text-muted">
                      {entero(f.disponibles)} de {entero(f.articulos)} tallas con stock
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </motion.div>

        <motion.div {...aparece(8)}>
          <Card className="h-full p-6">
            <Kicker>Prioridad</Kicker>
            <h2 className="display mt-1 text-lg font-semibold">Necesita atención</h2>
            <div className="mt-3 flex flex-wrap gap-2">
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
            <p className="mt-3 text-[12.5px] leading-snug text-muted">{explicacion[pestana]}</p>
            {atencion.length === 0 ? (
              <Vacio
                icono={<Package className="size-5" />}
                titulo="Todo en orden aquí"
                texto="Ninguna talla está en esta situación ahora mismo."
              />
            ) : (
              <>
                <ul className="mt-3 divide-y divide-line-2">
                  {atencion.slice(0, 6).map(({ g, afectadas }) => {
                    const ep = estadoProducto(g.tallas, minimo);
                    return (
                    <li key={g.clave}>
                      <button
                        type="button"
                        onClick={() => abrirProducto(g)}
                        className="group flex w-full items-center gap-3 py-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold">{nombreProducto(g.producto, g.empresa)}</p>
                          <p className="mt-0.5 truncate text-[12px] text-muted">
                            {titulo(g.empresa)} · tallas {afectadas.map((t) => nombreTallaEn(t.talla, g.tallas)).join(", ")}
                          </p>
                          <EstadoBadge estado={ep.estado} texto={textoEstadoProducto(ep)} className="mt-1.5" />
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
                      </button>
                    </li>
                    );
                  })}
                </ul>
                {atencion.length > 6 && (
                  <button
                    type="button"
                    onClick={() => irA("stock", pestana)}
                    className="mt-2 text-[13px] font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    Ver los {atencion.length} productos
                  </button>
                )}
              </>
            )}
          </Card>
        </motion.div>

        <motion.div {...aparece(9)} className="md:col-span-2 xl:col-span-1">
          <Card className="h-full p-6">
            <Kicker>Actividad</Kicker>
            <h2 className="display mt-1 text-lg font-semibold">Últimos movimientos</h2>
            {fallaMovs ? (
              <FallaCarga tipo={fallaMovs} que="Los movimientos" breve className="mt-3" />
            ) : ultimos.length === 0 ? (
              <Vacio
                icono={<Activity className="size-5" />}
                titulo="Sin movimientos todavía"
                texto="Registra una entrada o una salida y aparecerá aquí al instante."
              />
            ) : (
              <>
                <ul className="mt-3 divide-y divide-line-2">
                  {ultimos.map((m) => (
                    <li key={m.key} className="flex items-center gap-3 py-3">
                      <div
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-xl",
                          m.tipo === "entrada" ? "bg-ground text-ink" : "bg-red-soft text-red",
                        )}
                      >
                        {m.tipo === "entrada" ? <PackagePlus className="size-4" /> : <PackageMinus className="size-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold">{m.producto ? `${nombreProducto(partirMovimiento(m.producto).nombre)} · ${etiquetaTalla(partirMovimiento(m.producto).talla).toLowerCase()}` : m.codigo || "—"}</p>
                        <p className="truncate text-[12px] text-muted">
                          {m.fecha ? fechaCorta(m.fecha) : "Sin fecha"}
                          {m.persona ? ` · ${titulo(m.persona)}` : ""}
                        </p>
                      </div>
                      <CantidadMov tipo={m.tipo} cantidad={m.cantidad} anulado={m.anulado} className="text-[14px]" />
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => irA("movimientos")}
                  className="mt-2 text-[13px] font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                >
                  Ver todos los movimientos
                </button>
              </>
            )}
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
