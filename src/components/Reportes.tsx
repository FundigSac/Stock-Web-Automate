import { ChevronDown, FileDown, Eye, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { entero, sumarDias, titulo } from "../lib/format";
import { contarFotos, estimarPesoMB, generarPDF, leerRespaldoLocal, type FotoEnBandeja, type ProgresoPDF, type SeccionesPDF } from "../lib/pdf";
import { ahoraServidor } from "../lib/offline/reloj";
import { hoyLima } from "../lib/tiempo";
import type { Datos } from "../lib/types";
import { cn } from "../lib/utils";
import { filtrarPorEmpresa } from "../lib/derive";
import { Boton, Chip, presion } from "./ui";
import { Ventana } from "./Ventana";

const todas = (v: boolean): SeccionesPDF => ({ resumen: v, stock: v, movimientos: v, trabajadores: v, fotos: v });

const TIPOS: { id: string; texto: string; sub: string; secciones: SeccionesPDF }[] = [
  { id: "completo", texto: "Todo", sub: "Stock, movimientos, entregas, anulados y todas las fotos", secciones: todas(true) },
  { id: "stock", texto: "Stock", sub: "Cuánto queda de cada talla", secciones: { ...todas(false), stock: true } },
  { id: "movimientos", texto: "Movimientos", sub: "Entradas y salidas, con su foto", secciones: { ...todas(false), movimientos: true } },
  { id: "trabajadores", texto: "Entregas", sub: "Qué recibió cada trabajador", secciones: { ...todas(false), trabajadores: true } },
  { id: "resumen", texto: "Resumen", sub: "Solo lo principal, 1 o 2 hojas", secciones: { ...todas(false), resumen: true } },
  { id: "fotos", texto: "Fotos", sub: "Cada foto junto a su movimiento", secciones: { ...todas(false), fotos: true } },
];

const PERIODOS = [
  { id: "todo", texto: "Todo" },
  { id: "hoy", texto: "Hoy" },
  { id: "7", texto: "7 días" },
  { id: "30", texto: "30 días" },
  { id: "mes", texto: "Este mes" },
  { id: "otro", texto: "Elegir fechas" },
] as const;
type PeriodoId = (typeof PERIODOS)[number]["id"];

function rango(p: PeriodoId, d: string, h: string, hoy: string): { desde: string | null; hasta: string | null } {
  if (p === "hoy") return { desde: hoy, hasta: hoy };
  if (p === "7") return { desde: sumarDias(hoy, -6), hasta: hoy };
  if (p === "30") return { desde: sumarDias(hoy, -29), hasta: hoy };
  if (p === "mes") return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  if (p === "otro") return { desde: d || null, hasta: h || null };
  return { desde: null, hasta: null };
}

const campo = "h-14 w-full rounded-lg border border-line bg-surface px-3 text-[18px] outline-none focus:border-action focus:outline-2 focus:outline-offset-2 focus:outline-action";
const etiqueta = "mb-2 block text-left text-[16px] font-semibold text-ink-2";

export function ReportesDialog({
  abierto,
  alCerrar,
  todos,
  empresas,
  empresaInicial,
  usuario,
  dueno,
  avisar,
  errorDatos,
}: {
  abierto: boolean;
  alCerrar: () => void;
  todos: Datos;
  empresas: string[];
  empresaInicial: string;
  usuario: string;
  /** Cuenta con sesión: del dispositivo solo entra lo suyo. */
  dueno: string | null;
  avisar: (texto: string, error?: boolean) => void;
  /** Alguna tabla no cargó: un informe saldría con cifras incompletas. */
  errorDatos: boolean;
}) {
  const [empresa, setEmpresa] = useState(empresaInicial);
  const [tipo, setTipo] = useState("completo");
  const [periodo, setPeriodo] = useState<PeriodoId>("todo");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  // null: lo decide el tipo de informe. "Todo" incluye también los anulados, con sus fotos.
  const [eleccionAnulados, setAnulados] = useState<boolean | null>(null);
  const [masOpciones, setMasOpciones] = useState(false);
  const [trabajando, setTrabajando] = useState<"bajar" | "ver" | null>(null);
  const [progreso, setProgreso] = useState<ProgresoPDF | null>(null);
  const [bandeja, setBandeja] = useState<FotoEnBandeja[]>([]);
  const [hoy, setHoy] = useState(hoyLima);

  useEffect(() => {
    if (abierto) setEmpresa(empresaInicial);
  }, [abierto, empresaInicial]);

  const t = TIPOS.find((x) => x.id === tipo)!;
  const anulados = eleccionAnulados ?? tipo === "completo";
  const usaPeriodo = t.secciones.movimientos || t.secciones.trabajadores || t.secciones.resumen || t.secciones.fotos;
  const { desde: d, hasta: h } = rango(periodo, desde, hasta, hoy);
  const fechasMal = periodo === "otro" && d !== null && h !== null && d > h;

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    void ahoraServidor().then((ms) => vivo && setHoy(hoyLima(ms)));
    leerRespaldoLocal(dueno)
      .then((b) => vivo && setBandeja(b))
      .catch(() => vivo && setBandeja([]));
    return () => {
      vivo = false;
    };
  }, [abierto, dueno]);

  const nFotos = useMemo(
    () => (abierto ? contarFotos(filtrarPorEmpresa(todos, empresa), usaPeriodo ? d : null, usaPeriodo ? h : null, { bandeja, conAnulados: anulados, secciones: t.secciones }) : 0),
    [abierto, todos, empresa, d, h, bandeja, anulados, t.secciones, usaPeriodo],
  );

  async function hacer(modo: "bajar" | "ver") {
    if (fechasMal || errorDatos) return;
    // En "ver" se abre la pestana antes de generar, para que el navegador no la bloquee.
    const ventana = modo === "ver" ? window.open("", "_blank") : null;
    ventana?.document.write("<p style='font:16px system-ui;padding:24px'>Armando el informe...</p>");
    setTrabajando(modo);
    setProgreso(null);
    try {
      const r = await generarPDF({
        datos: filtrarPorEmpresa(todos, empresa),
        todos,
        empresa,
        secciones: t.secciones,
        usuario,
        desde: usaPeriodo ? d : null,
        hasta: usaPeriodo ? h : null,
        incluirAnulados: anulados,
        dueno,
        ventana,
        alProgreso: setProgreso,
      });
      const listo = modo === "ver" && ventana ? "Informe abierto en otra pestaña" : "PDF descargado";
      avisar(r.fallidas > 0 ? `${listo}. ${entero(r.fallidas)} de ${entero(r.fotos)} fotos no cargaron y salen marcadas con el motivo.` : listo, r.fallidas > 0);
      alCerrar();
    } catch (e) {
      console.error(e);
      ventana?.close();
      avisar("No se pudo generar el PDF", true);
    } finally {
      setTrabajando(null);
      setProgreso(null);
    }
  }

  const pct = progreso?.fase === "fotos" && progreso.total > 0 ? Math.round((progreso.hechas / progreso.total) * 100) : progreso?.fase === "armando" || progreso?.fase === "listo" ? 100 : 0;

  const botones = (
    <div className="space-y-3">
      {errorDatos && (
        <p role="alert" className="rounded-lg bg-red-soft px-4 py-3 text-justify text-[16px] font-medium leading-6 text-red">
          El servidor no entregó todos los datos y el informe saldría incompleto. Inténtalo cuando carguen.
        </p>
      )}
      {progreso && (
        <div role="status" aria-live="polite">
          {/* Solo transform: la barra crece desde la izquierda sin recalcular el diseño. */}
          <div className="h-2 overflow-hidden bg-line-2">
            <div className="h-full origin-left bg-action transition-transform duration-200 ease-out" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <p className="mt-1.5 text-left text-[16px] font-medium text-muted">{progreso.texto}</p>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <Boton variante="ink" className="min-h-16 shrink-0 text-[18px] sm:flex-1" onClick={() => hacer("bajar")} disabled={trabajando !== null || fechasMal || errorDatos}>
          {trabajando === "bajar" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <FileDown className="size-5" aria-hidden />} Descargar PDF
        </Boton>
        <Boton className="shrink-0 sm:flex-1" onClick={() => hacer("ver")} disabled={trabajando !== null || fechasMal || errorDatos}>
          {trabajando === "ver" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Eye className="size-5" aria-hidden />} Ver en pantalla
        </Boton>
      </div>
    </div>
  );

  return (
    <Ventana abierta={abierto} alCerrar={alCerrar} titulo="Descargar informe" subtitulo={`Un PDF para guardar o enviar. Incluye ${t.sub.charAt(0).toLowerCase()}${t.sub.slice(1)}.`} pie={botones}>
      <div className="space-y-6">
        <div>
          <p className={etiqueta}>1. Empresa</p>
          <div className="flex flex-wrap gap-3">
            <Chip activo={empresa === "TODAS"} onClick={() => setEmpresa("TODAS")}>
              Todas
            </Chip>
            {empresas.map((e) => (
              <Chip key={e} activo={empresa === e} onClick={() => setEmpresa(e)}>
                {titulo(e)}
              </Chip>
            ))}
          </div>
        </div>

        {usaPeriodo && (
          <div>
            <p className={etiqueta}>2. Periodo</p>
            <div className="flex flex-wrap gap-3">
              {PERIODOS.map((p) => (
                <Chip key={p.id} activo={periodo === p.id} onClick={() => setPeriodo(p.id)}>
                  {p.texto}
                </Chip>
              ))}
            </div>
            {periodo === "otro" && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rep-desde" className={etiqueta}>
                    Desde
                  </label>
                  <input id="rep-desde" type="date" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} className={campo} />
                </div>
                <div>
                  <label htmlFor="rep-hasta" className={etiqueta}>
                    Hasta
                  </label>
                  <input id="rep-hasta" type="date" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)} className={campo} />
                </div>
              </div>
            )}
            {fechasMal && <p role="alert" className="mt-2 text-left text-[16px] font-medium text-red">La fecha "Desde" no puede ser después de "Hasta".</p>}
          </div>
        )}

        {nFotos > 0 && (
          <p className="rounded-lg bg-ground px-4 py-3 text-justify text-[16px] leading-6 text-ink-2">
            Lleva {entero(nFotos)} {nFotos === 1 ? "foto" : "fotos"}. El PDF pesará unos {entero(estimarPesoMB(nFotos))} MB
            {nFotos > 100 ? " y puede tardar un par de minutos: deja esta ventana abierta." : "."}
          </p>
        )}

        <div>
          <button
            type="button"
            onClick={() => setMasOpciones((v) => !v)}
            aria-expanded={masOpciones}
            className="-ml-1 flex min-h-14 items-center gap-2 rounded-lg px-1 text-[16px] font-semibold text-action hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
          >
            <ChevronDown className={cn("size-5 transition-transform duration-150 ease-out", masOpciones && "rotate-180")} aria-hidden /> Más opciones
          </button>

          {masOpciones && (
            <div className="paso-entra mt-3 space-y-4">
              <div>
                <p className={etiqueta}>Qué incluye</p>
                <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                  {TIPOS.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => setTipo(x.id)}
                      aria-pressed={tipo === x.id}
                      className={cn(
                        "min-h-16 rounded-lg border px-4 py-3 text-left",
                        presion,
                        tipo === x.id ? "border-action bg-action text-white" : "border-line bg-surface hover:border-faint",
                      )}
                    >
                      <span className="block text-[16px] font-semibold leading-6">{x.texto}</span>
                      <span className={cn("block text-[14px] leading-5", tipo === x.id ? "text-white/85" : "text-muted")}>{x.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex min-h-16 cursor-pointer items-start gap-3 rounded-lg bg-ground px-4 py-3">
                <input type="checkbox" checked={anulados} onChange={(e) => setAnulados(e.target.checked)} className="mt-0.5 size-6 shrink-0 accent-action" />
                <span>
                  <span className="block text-[16px] font-semibold leading-6">Incluir movimientos anulados</span>
                  <span className="block text-justify text-[16px] leading-6 text-muted">{tipo === "completo" ? "«Todo» los incluye con sus fotos, al final y como anexo de control. No cuentan en el stock." : "Salen al final con sus fotos, como anexo de control. No cuentan en el stock."}</span>
                </span>
              </label>
            </div>
          )}
        </div>
      </div>
    </Ventana>
  );
}
