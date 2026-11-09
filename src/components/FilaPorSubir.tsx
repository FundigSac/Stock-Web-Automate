import { AlertTriangle, Download, ImageOff, RotateCcw, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { entero, nombreProducto } from "../lib/format";
import { descargarBlob, nombreEvidencia } from "../lib/foto";
import type { ItemRespaldo } from "../lib/offline/almacen";
import { faltaSubir } from "../lib/offline/respaldo";
import type { Respaldo } from "../lib/offline/useRespaldo";
import { selloLima } from "../lib/tiempo";
import { cn } from "../lib/utils";
import { estadoPorSubir, type TonoFila } from "./estadoPorSubir";
import { Boton } from "./ui";

export { estadoPorSubir, type EstadoFila } from "./estadoPorSubir";

const TONO: Record<TonoFila, string> = { ok: "text-ok", info: "text-info", warn: "text-warn", red: "text-red" };

/** Botón de fila: 56 px siempre, también en escritorio. Al presionar, scale(0.98) en 100 ms. */
const BOTON_FILA = "min-h-14 lg:min-h-14 w-full duration-100";

function Miniatura({ foto }: { foto: Blob | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!foto) return;
    const u = URL.createObjectURL(foto);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [foto]);
  return url ? (
    <img src={url} alt="Foto guardada" width={56} height={56} className="size-14 shrink-0 rounded-xl border border-line object-cover" />
  ) : (
    <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-ground text-muted">
      <ImageOff className="size-6" aria-hidden />
      <span className="sr-only">Sin foto</span>
    </span>
  );
}

/**
 * Ids que pasaron a "Subido" con la pantalla abierta. Al confirmarse, la fila cambia de grupo y se monta de nuevo:
 * por eso el cambio se recuerda aquí y no dentro de la fila.
 */
export function useRecienSubidos(items: ItemRespaldo[]): ReadonlySet<string> {
  const previos = useRef<Map<string, ItemRespaldo["estado"]> | null>(null);
  const recien = useRef(new Set<string>());
  return useMemo(() => {
    const antes = previos.current;
    if (antes) {
      for (const i of items) {
        const p = antes.get(i.id);
        if (p !== undefined && p !== "confirmado" && i.estado === "confirmado") recien.current.add(i.id);
      }
    }
    previos.current = new Map(items.map((i) => [i.id, i.estado]));
    return recien.current;
  }, [items]);
}

/** Confirmación: el icono de "Subido" entra con opacidad y escala de 0,8 a 1 en 200 ms. Sin movimiento reducido, nada más. */
function LineaEstado({ i, subiendo, enLinea, recienSubido = false }: { i: ItemRespaldo; subiendo: boolean; enLinea: boolean; recienSubido?: boolean }) {
  const e = estadoPorSubir(i, subiendo, enLinea);
  const Icono = e.icono;
  return (
    <div className={cn("flex items-center gap-2 text-left text-[16px] font-semibold leading-6", TONO[e.tono])}>
      <Icono
        key={e.texto}
        className={cn("size-5 shrink-0", recienSubido && i.estado === "confirmado" && "transition-[opacity,scale] duration-200 ease-out starting:scale-80 starting:opacity-0")}
        aria-hidden
      />
      {e.texto}
    </div>
  );
}

/** Hora, arriba y grande; fecha debajo. La hora es la de la foto o la del registro, y no cambia al subir. */
function Momento({ capturadoEn }: { capturadoEn: string }) {
  const { fecha, hora } = selloLima(capturadoEn);
  return (
    <div className="shrink-0 text-right">
      <span className="num block text-[18px] font-semibold leading-6">{hora}</span>
      <span className="num block text-[14px] leading-5 text-muted">{fecha}</span>
    </div>
  );
}

const unidadesDe = (i: ItemRespaldo) => i.lineas.reduce((a, l) => a + l.cantidad, 0);
const productosDe = (i: ItemRespaldo) => Array.from(new Set(i.lineas.map((l) => nombreProducto(l.producto)))).join(", ");

/** Solo se dice de dónde salió la hora cuando no es la de la cámara. */
function origenDe(i: ItemRespaldo): string | null {
  if (i.origenHora === "archivo") return "Hora del archivo";
  if (i.origenHora === "ahora") return "Hora elegida";
  if (i.fotoOrigen === "galeria") return "Foto de la galería";
  return null;
}

function Detalle({ i, extra }: { i: ItemRespaldo; extra?: string }) {
  const n = unidadesDe(i);
  const partes = [`${i.tipo === "entrada" ? "Entrada" : "Salida"} · ${entero(n)} ${n === 1 ? "unidad" : "unidades"}`];
  if (i.trabajador) partes.push(nombreProducto(i.trabajador));
  if (extra) partes.push(extra);
  const origen = origenDe(i);
  if (origen) partes.push(origen);
  return <div className="text-left text-[16px] leading-6 text-muted">{partes.join(" · ")}</div>;
}

/** Cabecera común: foto, producto, detalle, estado y hora. Mide 72 px como mínimo. */
function Cuerpo({ i, subiendo, enLinea, recienSubido, extra, children }: { i: ItemRespaldo; subiendo: boolean; enLinea: boolean; recienSubido?: boolean; extra?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-14 items-start gap-3">
      <Miniatura foto={i.foto} />
      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-start gap-3">
          <div className="line-clamp-2 min-w-0 flex-1 text-[18px] font-semibold leading-6 [overflow-wrap:anywhere]">{productosDe(i)}</div>
          <Momento capturadoEn={i.capturadoEn} />
        </div>
        <Detalle i={i} extra={extra} />
        <LineaEstado i={i} subiendo={subiendo} enLinea={enLinea} recienSubido={recienSubido} />
        {children}
      </div>
    </div>
  );
}

function BotonFoto({ foto, capturadoEn }: { foto: Blob; capturadoEn: string }) {
  return (
    <Boton className={BOTON_FILA} onClick={() => descargarBlob(foto, nombreEvidencia(capturadoEn))}>
      <Download className="size-5" aria-hidden /> Descargar foto
    </Boton>
  );
}

/** Un registro de este celular. Lo rechazado se puede reintentar o descartar. */
export function FilaPorSubir({ i, r, recienSubido }: { i: ItemRespaldo; r: Respaldo; recienSubido?: boolean }) {
  const [descartando, setDescartando] = useState(false);
  const rechazado = i.estado === "rechazado";
  return (
    <li className="min-h-18 px-4 py-2">
      <Cuerpo i={i} subiendo={r.subiendo} enLinea={r.enLinea} recienSubido={recienSubido}>
        {i.revision && (
          <p className="mt-1 text-[16px] font-medium leading-6 text-red">
            {!rechazado && <AlertTriangle className="mr-1.5 inline size-4 align-[-2px]" aria-hidden />}
            {i.revision}
          </p>
        )}
        {!i.revision && i.ultimoError && faltaSubir(i) && <p className="mt-1 text-[16px] leading-6 text-muted">{i.ultimoError}</p>}
      </Cuerpo>
      {rechazado && !descartando && (
        <div className="mt-3 grid grid-cols-2 gap-3 pb-1">
          <Boton variante="ink" className={BOTON_FILA} onClick={() => void r.reintentar(i.id)}>
            <RotateCcw className="size-5" aria-hidden /> Reintentar
          </Boton>
          <Boton className={BOTON_FILA} onClick={() => setDescartando(true)}>
            Descartar
          </Boton>
        </div>
      )}
      {descartando && (
        <div role="alert" className="mt-3 mb-1 rounded-2xl bg-red-soft p-4 text-red">
          <p className="text-[16px] font-medium leading-6">Se borra de este celular y no llegará al servidor.{i.foto ? " Si te sirve la foto, descárgala antes." : ""}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {i.foto && <BotonFoto foto={i.foto} capturadoEn={i.capturadoEn} />}
            <Boton variante="ink" className={cn(BOTON_FILA, "bg-red")} onClick={() => void r.descartar(i.id)}>
              Sí, descartar
            </Boton>
            <Boton className={BOTON_FILA} onClick={() => setDescartando(false)}>
              No
            </Boton>
          </div>
        </div>
      )}
    </li>
  );
}

/** Un registro que otra cuenta dejó aquí: se puede rescatar la foto o, con confirmación, subirlo con la cuenta que está dentro. */
export function FilaOtraCuenta({ i, r, puedeSubir }: { i: ItemRespaldo; r: Respaldo; puedeSubir: boolean }) {
  const [confirmando, setConfirmando] = useState(false);
  return (
    <li className="min-h-18 px-4 py-2">
      <Cuerpo i={i} subiendo={false} enLinea={r.enLinea} extra={`Guardado por ${i.quien}`} />
      {!confirmando && (i.foto || puedeSubir) && (
        <div className="mt-3 grid grid-cols-1 gap-3 pb-1 sm:grid-cols-2">
          {i.foto && <BotonFoto foto={i.foto} capturadoEn={i.capturadoEn} />}
          {puedeSubir && (
            <Boton className={BOTON_FILA} onClick={() => setConfirmando(true)}>
              <UploadCloud className="size-5" aria-hidden /> Subir con mi cuenta
            </Boton>
          )}
        </div>
      )}
      {confirmando && (
        <div role="alert" className="mt-3 mb-1 rounded-2xl bg-warn-soft p-4 text-warn">
          <p className="text-[16px] font-medium leading-6">Se sube con tu cuenta y conserva la firma de {i.quien}. Hazlo solo si esa persona ya no va a entrar en este celular.</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Boton variante="ink" className={BOTON_FILA} onClick={() => void r.adoptar(i.id)}>
              Sí, subir
            </Boton>
            <Boton className={BOTON_FILA} onClick={() => setConfirmando(false)}>
              No
            </Boton>
          </div>
        </div>
      )}
    </li>
  );
}
