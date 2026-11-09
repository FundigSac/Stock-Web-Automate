import { ChevronDown, FileDown, Eye, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { entero, sumarDias, titulo } from "../lib/format";
import { contarFotos, estimarPesoMB, generarPDF, leerRespaldoLocal, type FotoEnBandeja, type ProgresoPDF, type SeccionesPDF } from "../lib/pdf";
import { ahoraServidor } from "../lib/offline/reloj";
import { hoyLima } from "../lib/tiempo";
import type { Datos } from "../lib/types";
import { cn } from "../lib/utils";
import { filtrarPorEmpresa } from "../lib/derive";
import { Boton, Chip, Ventana } from "./ui";

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

const campo = "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none transition focus:border-ink";
const etiqueta = "mb-2 block text-xs font-semibold text-muted";

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
        <p role="alert" className="rounded-xl bg-red-soft px-3.5 py-2.5 text-justify text-[13px] font-medium text-red">
          El servidor no entregó todos los datos y el informe saldría incompleto. Inténtalo cuando carguen.
        </p>
      )}
      {progreso && (
        <div role="status" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-ground">
            <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-[12.5px] font-medium text-muted">{progreso.texto}</p>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Boton variante="ink" className="h-12 shrink-0 sm:flex-1" onClick={() => hacer("bajar")} disabled={trabajando !== null || fechasMal || errorDatos}>
          {trabajando === "bajar" ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} Descargar PDF
        </Boton>
        <Boton className="h-12 shrink-0 sm:flex-1" onClick={() => hacer("ver")} disabled={trabajando !== null || fechasMal || errorDatos}>
          {trabajando === "ver" ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />} Ver en pantalla
        </Boton>
      </div>
    </div>
  );

  return (
    <Ventana abierta={abierto} alCerrar={alCerrar} titulo="Descargar informe" subtitulo={`${t.texto}: ${t.sub.charAt(0).toLowerCase()}${t.sub.slice(1)}.`} pie={botones}>
      <div className="space-y-6">
        <div>
          <p className={etiqueta}>1. Empresa</p>
          <div className="flex flex-wrap gap-2">
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
            <div className="flex flex-wrap gap-2">
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
            {fechasMal && <p className="mt-2 text-[12.5px] font-medium text-red">La fecha "Desde" no puede ser después de "Hasta".</p>}
          </div>
        )}

        {nFotos > 0 && (
          <p className="rounded-xl bg-ground px-3.5 py-3 text-justify text-[12.5px] text-muted">
            Lleva {entero(nFotos)} {nFotos === 1 ? "foto" : "fotos"}. El PDF pesará unos {entero(estimarPesoMB(nFotos))} MB
            {nFotos > 100 ? " y puede tardar un par de minutos: deja esta ventana abierta." : "."}
          </p>
        )}

        <div>
          <button
            type="button"
            onClick={() => setMasOpciones((v) => !v)}
            aria-expanded={masOpciones}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-muted transition hover:text-ink"
          >
            <ChevronDown className={cn("size-4 transition-transform", masOpciones && "rotate-180")} /> Más opciones
          </button>

          {masOpciones && (
            <div className="mt-3 space-y-4">
              <div>
                <p className={etiqueta}>Qué incluye</p>
                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                  {TIPOS.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => setTipo(x.id)}
                      aria-pressed={tipo === x.id}
                      className={cn(
                        "rounded-xl border px-3.5 py-2.5 text-left transition",
                        tipo === x.id ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-faint",
                      )}
                    >
                      <span className="block text-[13.5px] font-semibold">{x.texto}</span>
                      <span className={cn("block text-[11.5px]", tipo === x.id ? "text-white/70" : "text-muted")}>{x.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-ground px-3.5 py-3">
                <input type="checkbox" checked={anulados} onChange={(e) => setAnulados(e.target.checked)} className="mt-0.5 size-4 accent-[#0E0F11]" />
                <span>
                  <span className="block text-[13px] font-semibold">Incluir movimientos anulados</span>
                  <span className="block text-justify text-[11.5px] text-muted">{tipo === "completo" ? "«Todo» los incluye con sus fotos, al final y como anexo de control. No cuentan en el stock." : "Salen al final con sus fotos, como anexo de control. No cuentan en el stock."}</span>
                </span>
              </label>
            </div>
          )}
        </div>
      </div>
    </Ventana>
  );
}
