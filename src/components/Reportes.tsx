import { FileDown, Eye, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { hoyISO, sumarDias, titulo } from "../lib/format";
import { generarPDF, type SeccionesPDF } from "../lib/pdf";
import type { Datos } from "../lib/types";
import { cn } from "../lib/utils";
import { filtrarPorEmpresa } from "../lib/derive";
import { Boton, Chip, Ventana } from "./ui";

// "Completo" no incluye las fotos (hacen el PDF mucho mas pesado): tienen su propio informe.
const todas = (v: boolean): SeccionesPDF => ({ resumen: v, stock: v, movimientos: v, trabajadores: v, fotos: false });

const TIPOS: { id: string; texto: string; sub: string; secciones: SeccionesPDF }[] = [
  { id: "completo", texto: "Completo", sub: "Todo en un solo PDF", secciones: todas(true) },
  { id: "stock", texto: "Stock", sub: "Cuánto queda de cada talla", secciones: { ...todas(false), stock: true } },
  { id: "movimientos", texto: "Movimientos", sub: "Entradas y salidas", secciones: { ...todas(false), movimientos: true } },
  { id: "trabajadores", texto: "Entregas", sub: "Qué recibió cada trabajador", secciones: { ...todas(false), trabajadores: true } },
  { id: "resumen", texto: "Resumen", sub: "Solo lo principal, 1–2 hojas", secciones: { ...todas(false), resumen: true } },
  { id: "fotos", texto: "Fotos", sub: "Evidencias de entregas y entradas", secciones: { ...todas(false), fotos: true } },
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

function rango(p: PeriodoId, d: string, h: string): { desde: string | null; hasta: string | null } {
  const hoy = hoyISO();
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
  avisar,
}: {
  abierto: boolean;
  alCerrar: () => void;
  todos: Datos;
  empresas: string[];
  empresaInicial: string;
  usuario: string;
  avisar: (texto: string, error?: boolean) => void;
}) {
  const [empresa, setEmpresa] = useState(empresaInicial);
  const [tipo, setTipo] = useState("completo");
  const [periodo, setPeriodo] = useState<PeriodoId>("todo");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [anulados, setAnulados] = useState(false);
  const [trabajando, setTrabajando] = useState<"bajar" | "ver" | null>(null);

  useEffect(() => {
    if (abierto) setEmpresa(empresaInicial);
  }, [abierto, empresaInicial]);

  const t = TIPOS.find((x) => x.id === tipo)!;
  const usaPeriodo = t.secciones.movimientos || t.secciones.trabajadores || t.secciones.resumen || t.secciones.fotos;
  const { desde: d, hasta: h } = rango(periodo, desde, hasta);
  const fechasMal = periodo === "otro" && d !== null && h !== null && d > h;

  async function hacer(modo: "bajar" | "ver") {
    if (fechasMal) return;
    // En "ver" se abre la pestana antes de generar, para que el navegador no la bloquee.
    const ventana = modo === "ver" ? window.open("", "_blank") : null;
    setTrabajando(modo);
    try {
      await generarPDF({
        datos: filtrarPorEmpresa(todos, empresa),
        todos,
        empresa,
        secciones: t.secciones,
        usuario,
        desde: usaPeriodo ? d : null,
        hasta: usaPeriodo ? h : null,
        incluirAnulados: anulados,
        ventana,
      });
      avisar(modo === "ver" && ventana ? "Informe abierto en otra pestaña" : "PDF descargado");
      alCerrar();
    } catch (e) {
      console.error(e);
      ventana?.close();
      avisar("No se pudo generar el PDF", true);
    } finally {
      setTrabajando(null);
    }
  }

  return (
    <Ventana abierta={abierto} alCerrar={alCerrar} titulo="Descargar informe" subtitulo="PDF listo para imprimir o enviar.">
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

        <div>
          <p className={etiqueta}>2. Qué quieres ver</p>
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

        {usaPeriodo && (
          <div>
            <p className={etiqueta}>3. Periodo</p>
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
                  <input id="rep-desde" type="date" value={desde} max={hoyISO()} onChange={(e) => setDesde(e.target.value)} className={campo} />
                </div>
                <div>
                  <label htmlFor="rep-hasta" className={etiqueta}>
                    Hasta
                  </label>
                  <input id="rep-hasta" type="date" value={hasta} max={hoyISO()} onChange={(e) => setHasta(e.target.value)} className={campo} />
                </div>
              </div>
            )}
            {fechasMal && <p className="mt-2 text-[12.5px] font-medium text-red">La fecha "Desde" no puede ser después de "Hasta".</p>}
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-ground px-3.5 py-3">
          <input type="checkbox" checked={anulados} onChange={(e) => setAnulados(e.target.checked)} className="mt-0.5 size-4 accent-[#0E0F11]" />
          <span>
            <span className="block text-[13px] font-semibold">Incluir movimientos anulados</span>
            <span className="block text-[11.5px] text-muted">Se agregan al final como anexo de control. No cuentan en el stock.</span>
          </span>
        </label>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Boton variante="ink" className="h-12 shrink-0 sm:flex-1" onClick={() => hacer("bajar")} disabled={trabajando !== null || fechasMal}>
            {trabajando === "bajar" ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} Descargar PDF
          </Boton>
          <Boton className="h-12 shrink-0 sm:flex-1" onClick={() => hacer("ver")} disabled={trabajando !== null || fechasMal}>
            {trabajando === "ver" ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />} Ver en pantalla
          </Boton>
        </div>
      </div>
    </Ventana>
  );
}
