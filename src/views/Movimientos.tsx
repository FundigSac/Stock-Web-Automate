import { Activity, ArrowDown, ArrowUp, Ban, PackageMinus, PackagePlus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { MovChart } from "../components/MovChartDiferido";
import { MiniFoto, VisorFoto } from "../components/Evidencia";
import { Boton, CantidadMov, Card, Chip, Kicker, MarcaAnulado, Vacio } from "../components/ui";
import { momentoMovimiento, movimientosDe, serieDiaria, sumaMovs } from "../lib/derive";
import { entero, etiquetaTalla, fechaLarga, hoyISO, norm, nombreProducto, partirMovimiento, sumarDias, titulo } from "../lib/format";
import type { Movimiento } from "../lib/types";
import { cn } from "../lib/utils";
import type { VistaProps } from "./tipos";

type Tipo = "todos" | "entrada" | "salida";
const RANGOS = [
  { dias: 7, texto: "7 días" },
  { dias: 30, texto: "30 días" },
  { dias: 90, texto: "90 días" },
  { dias: 0, texto: "Todo" },
];
const PAGINA = 100;

const nombreDe = (email: string | null) => (email ? titulo(email.split("@")[0]) : "");

/** "Hoy", "Ayer" o "Jueves 29 oct 2026". */
function encabezadoDia(iso: string): string {
  const hoy = hoyISO();
  if (iso === hoy) return "Hoy · " + fechaLarga(iso);
  if (iso === sumarDias(hoy, -1)) return "Ayer · " + fechaLarga(iso);
  const [y, m, d] = iso.split("-").map(Number);
  const dia = new Date(y, m - 1, d).toLocaleDateString("es-PE", { weekday: "long" });
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} · ${fechaLarga(iso)}`;
}

type Fila = { clave: string; mov: Movimiento };

export function Movimientos({ todos, datos, editor, pedirAnular, abrirRegistro, faltanDatos }: VistaProps) {
  const historialIncompleto = faltanDatos.includes("entradas") || faltanDatos.includes("salidas");
  const [tipo, setTipo] = useState<Tipo>("todos");
  const [dias, setDias] = useState(0);
  const [q, setQ] = useState("");
  const [limite, setLimite] = useState(PAGINA);
  const [conAnulados, setConAnulados] = useState(false);
  const [foto, setFoto] = useState<Movimiento | null>(null);

  const empresaDe = useMemo(() => new Map(todos.stock.map((s) => [s.codigo, s.empresa])), [todos.stock]);
  const todosMovs = useMemo(() => movimientosDe(datos, true), [datos]);
  const hayAnulados = todosMovs.some((m) => m.anulado);

  const enRango = useMemo(() => {
    if (dias === 0) return todosMovs;
    const desde = sumarDias(hoyISO(), -(dias - 1));
    return todosMovs.filter((m) => m.fecha >= desde);
  }, [todosMovs, dias]);

  const visibles = useMemo(() => {
    const b = norm(q.trim());
    return enRango.filter((m) => {
      if (m.anulado && !conAnulados) return false;
      if (tipo !== "todos" && m.tipo !== tipo) return false;
      if (!b) return true;
      const nombre = nombreProducto(partirMovimiento(m.producto).nombre, empresaDe.get(m.codigo));
      return norm(`${nombre} ${m.producto} ${m.codigo} ${empresaDe.get(m.codigo) ?? ""} ${m.persona ?? ""} ${m.area ?? ""} ${m.nota ?? ""} ${m.registradoPor ?? ""}`).includes(b);
    });
  }, [enRango, tipo, q, conAnulados, empresaDe]);

  // Los totales y el grafico siguen la busqueda y los filtros, y nunca cuentan los anulados.
  const tot = useMemo(() => sumaMovs(visibles), [visibles]);
  const serie = useMemo(() => serieDiaria(visibles, dias === 0 ? 90 : dias), [visibles, dias]);
  const hayDatos = tot.entradas + tot.salidas > 0;

  const dibujados: Fila[] = useMemo(() => visibles.map((m) => ({ clave: m.key, mov: m })), [visibles]);

  const porDia = useMemo(() => {
    const grupos: { fecha: string; filas: Fila[] }[] = [];
    for (const f of dibujados.slice(0, limite)) {
      const ult = grupos[grupos.length - 1];
      if (ult && ult.fecha === f.mov.fecha) ult.filas.push(f);
      else grupos.push({ fecha: f.mov.fecha, filas: [f] });
    }
    return grupos;
  }, [dibujados, limite]);

  const resumen = [
    { etiqueta: "Entraron", valor: `+${entero(tot.entradas)}`, nota: "unidades compradas o repuestas", icono: <ArrowUp className="size-4" />, tono: "" },
    { etiqueta: "Salieron", valor: tot.salidas ? `−${entero(tot.salidas)}` : "0", nota: "unidades vendidas o entregadas", icono: <ArrowDown className="size-4" />, tono: "text-red" },
    {
      etiqueta: "Diferencia",
      valor: `${tot.neto > 0 ? "+" : tot.neto < 0 ? "−" : ""}${entero(Math.abs(tot.neto))}`,
      nota: tot.neto === 0 ? "el almacén quedó igual" : tot.neto > 0 ? "el almacén ganó unidades" : "el almacén perdió unidades",
      icono: <Activity className="size-4" />,
      tono: "",
    },
  ];

  const fotoDe = foto ? partirMovimiento(foto.producto) : null;
  return (
    <div className="space-y-5">
      {/* Los totales y el gráfico siguen a los filtros. Con el historial a medias, un total sería falso: no se muestran. */}
      {!historialIncompleto && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {resumen.map((s) => (
              <Card key={s.etiqueta} className="p-5">
                <div className="flex items-center justify-between text-faint">
                  <Kicker>{s.etiqueta}</Kicker>
                  {s.icono}
                </div>
                <p className={cn("display num mt-3 text-4xl font-semibold leading-none", s.tono)}>{s.valor}</p>
                <p className="mt-2.5 text-[12.5px] text-muted">{s.nota}</p>
              </Card>
            ))}
          </div>

          <Card className="p-6">
            <Kicker>Evolución</Kicker>
            <h2 className="display mt-1 text-lg font-semibold">Movimiento por día</h2>
            <div className="mt-4">
              {hayDatos ? (
                <MovChart serie={serie} alto={220} />
              ) : (
                <Vacio
                  icono={<Activity className="size-5" />}
                  titulo="No hay movimientos en este periodo"
                  texto="Prueba con un periodo más largo o registra un movimiento."
                />
              )}
            </div>
          </Card>
        </>
      )}

      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-11 min-w-[220px] flex-1 items-center gap-3 rounded-xl border border-line bg-ground/60 px-3.5 focus-within:border-ink focus-within:bg-surface">
            <Search className="size-4 text-faint" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimite(PAGINA);
              }}
              placeholder="Buscar producto, persona, empresa o quién registró…"
              aria-label="Buscar movimientos"
              className="h-full w-full bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {RANGOS.map((r) => (
              <Chip key={r.dias} activo={dias === r.dias} onClick={() => setDias(r.dias)}>
                {r.texto}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ["todos", "Todos"],
            ["entrada", "Entradas"],
            ["salida", "Salidas"],
          ] as const).map(([t, texto]) => (
            <Chip key={t} activo={tipo === t} onClick={() => setTipo(t)}>
              {texto}
            </Chip>
          ))}
          {hayAnulados && (
            <Chip activo={conAnulados} onClick={() => setConAnulados((v) => !v)} className="ml-auto">
              <Ban className="size-3.5" /> {conAnulados ? "Ocultar anulados" : "Mostrar anulados"}
            </Chip>
          )}
        </div>
      </Card>

      {historialIncompleto && (
        <p role="alert" className="rounded-2xl bg-warn-soft px-4 py-3 text-justify text-[13px] font-medium text-warn">
          Los movimientos no alcanzaron a descargarse antes de perder la señal, así que esta lista está incompleta. Se completa sola cuando vuelva la conexión.
        </p>
      )}

      {historialIncompleto && dibujados.length === 0 ? null : dibujados.length === 0 ? (
        <Card>
          <Vacio
            icono={<Activity className="size-5" />}
            titulo="Sin movimientos para mostrar"
            texto={editor ? "Registra una entrada o una salida y la verás aquí con su fecha, producto, persona y quién lo anotó." : "Cuando se registren entradas o salidas, las verás aquí."}
          />
          {editor && (
            <div className="flex justify-center pb-8">
              <Boton variante="ink" onClick={abrirRegistro}>
                <Plus className="size-4" /> Registrar movimiento
              </Boton>
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          <p className="px-1 text-[12.5px] text-muted">
            {entero(dibujados.length)} {dibujados.length === 1 ? "registro" : "registros"} · del más reciente al más antiguo
          </p>
          {porDia.map((g) => {
            // Se cuenta el día completo, no solo lo que ya se cargó en pantalla.
            const delDia = dibujados.filter((f) => f.mov.fecha === g.fecha && !f.mov.anulado);
            const ent = delDia.filter((f) => f.mov.tipo === "entrada").length;
            const sal = delDia.filter((f) => f.mov.tipo === "salida").length;
            const partes = [ent && `${ent} ${ent === 1 ? "entrada" : "entradas"}`, sal && `${sal} ${sal === 1 ? "salida" : "salidas"}`].filter(Boolean);
            return (
              <section key={g.fecha} aria-label={encabezadoDia(g.fecha)}>
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
                  <h3 className="display text-[17px] font-semibold">{encabezadoDia(g.fecha)}</h3>
                  <p className="text-[12px] text-muted">{partes.join(" · ")}</p>
                </div>
                <Card className="divide-y divide-line-2 overflow-hidden">
                  {g.filas.map(({ clave, mov: m }) => {
                    const { nombre, talla } = partirMovimiento(m.producto);
                    const empresa = empresaDe.get(m.codigo) ?? null;
                    const esEntrada = m.tipo === "entrada";
                    return (
                      <div key={clave} className={cn("flex items-start gap-3 p-4", m.anulado && "opacity-55")}>
                        <span
                          className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-full", esEntrada ? "bg-ground text-ink" : "bg-red-soft text-red")}
                          aria-hidden
                        >
                          {esEntrada ? <PackagePlus className="size-[18px]" /> : <PackageMinus className="size-[18px]" />}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <p className={cn("text-[14.5px] font-semibold leading-snug", m.anulado && "line-through")}>{nombreProducto(nombre, empresa)}</p>
                            <CantidadMov tipo={m.tipo} cantidad={m.cantidad} anulado={m.anulado} className="display text-[20px] leading-none" />
                          </div>

                          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                            {m.anulado && <MarcaAnulado />}
                            <span className="font-semibold text-ink">{esEntrada ? "Entrada" : "Salida"}</span>
                            {m.etiqueta && <span className="rounded-md bg-ground px-1.5 py-0.5 font-semibold text-ink">Cambio de prenda</span>}
                            {talla && <span className="rounded-md bg-ground px-1.5 py-0.5 font-semibold text-ink">{etiquetaTalla(talla)}</span>}
                            {empresa && <span>{titulo(empresa)}</span>}
                          </p>

                          {!esEntrada && m.persona && (
                            <p className="mt-1.5 text-[13px]">
                              Entregado a <b>{titulo(m.persona)}</b>
                              {m.area && <span className="text-muted"> · {titulo(m.area)}</span>}
                            </p>
                          )}
                          {esEntrada && m.nota && <p className="mt-1.5 text-[13px]">Proveedor / nota: {m.nota}</p>}
                          {!esEntrada && m.nota && <p className="mt-1 text-[13px] text-muted">Nota: {m.nota}</p>}

                          <p className="mt-1.5 text-[11.5px] text-faint">
                            {momentoMovimiento(m)}
                            {m.registradoPor ? ` por ${nombreDe(m.registradoPor)}` : ""}
                          </p>
                          {m.pendiente && <p className="mt-1.5 inline-flex rounded-md bg-warn-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-warn">{m.sinCopia ? "Ya subido: falta actualizar los datos de este dispositivo" : "Por subir: está guardado en este dispositivo"}</p>}
                          {m.revisar && <p className="mt-1.5 text-[12px] font-semibold text-warn">Por revisar: {m.revisar}</p>}
                          {m.anulado && (
                            <p className="mt-1.5 text-[12px] font-semibold text-red">
                              Anulado por {nombreDe(m.anuladoPor) || "—"}: {m.motivo}
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-2">
                          {(!esEntrada || m.foto) && !m.pendiente && <MiniFoto ruta={m.foto} onAbrir={() => setFoto(m)} className="size-14" />}
                          {editor && !m.anulado && !m.pendiente && (
                            <button
                              type="button"
                              onClick={() => pedirAnular(m)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-muted transition hover:border-red hover:text-red"
                            >
                              <Ban className="size-3.5" /> Anular
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </Card>
              </section>
            );
          })}
          {dibujados.length > limite && (
            <div className="flex justify-center">
              <Boton onClick={() => setLimite((l) => l + PAGINA)}>Mostrar más ({entero(dibujados.length - limite)} restantes)</Boton>
            </div>
          )}
        </div>
      )}

      <VisorFoto
        ruta={foto?.foto ?? null}
        titulo={foto ? `${nombreProducto(fotoDe?.nombre, foto ? empresaDe.get(foto.codigo) : null)}${fotoDe?.talla ? ` · ${etiquetaTalla(fotoDe.talla).toLowerCase()}` : ""}` : "Evidencia"}
        detalle={
          foto ? (
            <>
              {foto.tipo === "entrada" ? "Entrada" : <>Entregado a <b className="text-ink">{titulo(foto.persona)}</b></>} · {fechaLarga(foto.fecha)}
            </>
          ) : undefined
        }
        alCerrar={() => setFoto(null)}
      />
    </div>
  );
}
