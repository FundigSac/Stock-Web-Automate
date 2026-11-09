import { Activity, ArrowDownToLine, ArrowUpFromLine, Ban, BarChart3, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { MovChart } from "../components/MovChartDiferido";
import { MiniFoto, VisorFoto } from "../components/Evidencia";
import { Boton, Card, Chip, Vacio, presion, useEsEscritorio } from "../components/ui";
import { momentoMovimiento, movimientosDe, serieDiaria, sumaMovs } from "../lib/derive";
import { entero, etiquetaTalla, fechaLarga, hoyISO, norm, nombreProducto, partirMovimiento, sumarDias, tallaEnFrase, titulo } from "../lib/format";
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
  const [verGrafico, setVerGrafico] = useState(false);
  // El gráfico es de escritorio: en el celular ni se ofrece ni se descarga.
  const escritorio = useEsEscritorio();

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

  const fotoDe = foto ? partirMovimiento(foto.producto) : null;
  return (
    <div className="space-y-5">
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex min-h-14 items-center gap-3 rounded-lg border border-line bg-surface px-4 focus-within:border-action focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action">
          <Search className="size-5 shrink-0 text-faint" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimite(PAGINA);
            }}
            placeholder="Producto, trabajador, empresa o quién lo anotó"
            aria-label="Buscar movimientos"
            className="h-14 w-full bg-transparent text-[18px] outline-none placeholder:text-faint"
          />
        </div>
        <div className="flex flex-wrap gap-3" role="group" aria-label="Periodo">
          {RANGOS.map((r) => (
            <Chip key={r.dias} activo={dias === r.dias} onClick={() => setDias(r.dias)}>
              {r.texto}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-3" role="group" aria-label="Tipo de movimiento">
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
            <Chip activo={conAnulados} onClick={() => setConAnulados((v) => !v)} className="sm:ml-auto">
              <Ban className="size-5" aria-hidden /> {conAnulados ? "Ocultar anulados" : "Mostrar anulados"}
            </Chip>
          )}
        </div>
      </Card>

      {historialIncompleto && (
        <p role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-[16px] font-medium leading-6 text-warn">
          Los movimientos no alcanzaron a descargarse antes de perder la señal, así que esta lista está incompleta. Se completa sola cuando vuelva la conexión.
        </p>
      )}

      {/* Los totales siguen a los filtros y el gráfico se abre solo si se pide. Con el historial a medias, un total sería falso. */}
      {!historialIncompleto && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[16px] leading-6">
            <span>
              Entraron <b className="num text-[18px]">+{entero(tot.entradas)}</b>
            </span>
            <span>
              Salieron <b className="num text-[18px] text-red">{tot.salidas ? `−${entero(tot.salidas)}` : "0"}</b>
            </span>
            <span className="text-muted">
              {tot.neto === 0 ? "El almacén quedó igual" : `El almacén ${tot.neto > 0 ? "ganó" : "perdió"} ${entero(Math.abs(tot.neto))} ${Math.abs(tot.neto) === 1 ? "unidad" : "unidades"}`}
            </span>
            {hayDatos && escritorio && (
              <Boton onClick={() => setVerGrafico((v) => !v)} aria-expanded={verGrafico} className="ml-auto">
                <BarChart3 className="size-5" aria-hidden /> {verGrafico ? "Ocultar gráfico" : "Ver gráfico por día"}
              </Boton>
            )}
          </div>
          {hayDatos && escritorio && verGrafico && (
            <div className="paso-entra mt-4">
              <p className="mb-2 text-left text-[14px] text-muted">Movimiento por día{dias === 0 ? ", últimos 90 días" : ""}</p>
              <MovChart serie={serie} alto={220} />
            </div>
          )}
        </Card>
      )}

      {historialIncompleto && dibujados.length === 0 ? null : dibujados.length === 0 ? (
        <Card>
          <Vacio
            icono={<Activity className="size-6" />}
            titulo="Sin movimientos para mostrar"
            texto={editor ? "Cuando registres una entrada o una salida, aparecerá aquí con su fecha, producto, trabajador y quién la anotó." : "Cuando se registren entradas o salidas, aparecerán aquí."}
          />
          {editor && (
            <div className="flex justify-center px-4 pb-8">
              <Boton variante="ink" onClick={abrirRegistro}>
                <Plus className="size-5" aria-hidden /> Registrar movimiento
              </Boton>
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          <p className="px-1 text-left text-[16px] text-muted">
            {entero(dibujados.length)} {dibujados.length === 1 ? "registro" : "registros"}, del más reciente al más antiguo
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
                  <h3 className="text-[18px] font-semibold leading-[26px]">{encabezadoDia(g.fecha)}</h3>
                  <p className="text-left text-[14px] text-muted">{partes.join(" · ")}</p>
                </div>
                <Card className="divide-y divide-line-2 overflow-hidden">
                  {g.filas.map(({ clave, mov: m }) => {
                    const { nombre, talla } = partirMovimiento(m.producto);
                    const empresa = empresaDe.get(m.codigo) ?? null;
                    const esEntrada = m.tipo === "entrada";
                    return (
                      // En el celular la foto y Anular bajan a su propia fila: el texto usa todo el ancho.
                      <div key={clave} className={cn("grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 p-4 sm:grid-cols-[40px_minmax(0,1fr)_auto]", m.anulado && "opacity-60")}>
                        <span className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg", esEntrada ? "bg-ground text-action" : "bg-red-soft text-red")} aria-hidden>
                          {esEntrada ? <ArrowDownToLine className="size-5" /> : <ArrowUpFromLine className="size-5" />}
                        </span>

                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <p className={cn("text-left text-[18px] font-semibold leading-[26px]", m.anulado && "line-through")}>{nombreProducto(nombre, empresa)}</p>
                            <p className={cn("num shrink-0 text-[24px] font-semibold leading-[26px]", !esEntrada && "text-red", m.anulado && "line-through")}>
                              {esEntrada ? "+" : "−"}
                              {entero(m.cantidad)}
                            </p>
                          </div>

                          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[16px] leading-6 text-muted">
                            <span className="font-semibold text-ink">{esEntrada ? "Entrada" : "Salida"}</span>
                            {m.etiqueta && <span className="rounded-md bg-ground px-2 py-0.5 text-[14px] font-semibold text-ink">Cambio de prenda</span>}
                            {talla && <span className="rounded-md bg-ground px-2 py-0.5 text-[14px] font-semibold text-ink">{etiquetaTalla(talla)}</span>}
                            {empresa && <span>{titulo(empresa)}</span>}
                          </p>

                          {!esEntrada && m.persona && (
                            <p className="mt-1.5 text-left text-[16px] leading-6">
                              Entregado a <b>{titulo(m.persona)}</b>
                              {m.area && <span className="text-muted"> · {titulo(m.area)}</span>}
                            </p>
                          )}
                          {esEntrada && m.nota && <p className="mt-1.5 text-left text-[16px] leading-6">Proveedor o nota: {m.nota}</p>}
                          {!esEntrada && m.nota && <p className="mt-1 text-left text-[16px] leading-6 text-muted">Nota: {m.nota}</p>}

                          <p className="mt-1.5 text-left text-[14px] leading-5 text-faint">
                            {momentoMovimiento(m)}
                            {m.registradoPor ? ` por ${nombreDe(m.registradoPor)}` : ""}
                          </p>
                          {m.pendiente && (
                            <p className="mt-1.5 inline-flex rounded-md bg-warn-soft px-2 py-0.5 text-left text-[14px] font-semibold text-warn">
                              {m.sinCopia ? "Ya subido: falta actualizar los datos de este dispositivo" : "Por subir: está guardado en este dispositivo"}
                            </p>
                          )}
                          {m.revisar && <p className="mt-1.5 text-left text-[16px] font-semibold text-warn">Por revisar: {m.revisar}</p>}
                          {m.anulado && (
                            <p className="mt-1.5 text-left text-[16px] font-semibold text-red">
                              Anulado{nombreDe(m.anuladoPor) ? ` por ${nombreDe(m.anuladoPor)}` : ""}: {m.motivo}
                            </p>
                          )}
                        </div>

                        <div className="col-start-2 mt-3 flex items-center gap-3 empty:hidden sm:col-start-3 sm:row-start-1 sm:mt-0 sm:flex-col sm:items-end">
                          {(!esEntrada || m.foto) && !m.pendiente && <MiniFoto ruta={m.foto} onAbrir={() => setFoto(m)} className="size-14" />}
                          {editor && !m.anulado && !m.pendiente && (
                            <button
                              type="button"
                              onClick={() => pedirAnular(m)}
                              className={cn("inline-flex min-h-14 items-center gap-2 rounded-lg border border-line px-3 text-[16px] font-semibold text-muted hover:border-red hover:text-red", presion)}
                            >
                              <Ban className="size-5" aria-hidden /> Anular
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
        titulo={foto ? `${nombreProducto(fotoDe?.nombre, foto ? empresaDe.get(foto.codigo) : null)}${fotoDe?.talla ? ` · ${tallaEnFrase(fotoDe.talla)}` : ""}` : "Evidencia"}
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
