import { Camera, Image as ImagenIcono, ImageOff, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { prepararFoto, urlFoto, type FotoCapturada, type OrigenFoto } from "../lib/foto";
import { useEnLinea } from "../lib/offline/conexion";
import { hayEspacioPara } from "../lib/offline/respaldo";
import { selloLima } from "../lib/tiempo";
import { cn } from "../lib/utils";
import { Ventana } from "./ui";

/** Toma o elige la foto de la entrega, la comprime y muestra la vista previa. */
export function CampoFoto({
  foto,
  alCambiar,
  alFallar,
  antesDeElegir,
}: {
  foto: FotoCapturada | null;
  alCambiar: (f: FotoCapturada | null) => void;
  alFallar: (mensaje: string) => void;
  /** Justo antes de abrir la cámara o la galería: el teléfono puede cerrar la página mientras están abiertas. */
  antesDeElegir?: () => void;
}) {
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const abrir = (entrada: RefObject<HTMLInputElement>) => {
    antesDeElegir?.();
    entrada.current?.click();
  };
  const [procesando, setProcesando] = useState(false);
  const [vista, setVista] = useState<string | null>(null);

  useEffect(() => {
    if (!foto) {
      setVista(null);
      return;
    }
    const url = URL.createObjectURL(foto.blob);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  async function elegido(archivo: File | undefined, origen: OrigenFoto, ahora: number) {
    if (!archivo) return;
    setProcesando(true);
    try {
      const lista = await prepararFoto(archivo, origen, ahora);
      if (!(await hayEspacioPara(lista.blob.size))) alFallar("Queda poco espacio en este dispositivo. Libera espacio antes de seguir registrando sin conexión.");
      alCambiar(lista);
    } catch (e) {
      alFallar(e instanceof Error ? e.message : "No se pudo leer la foto.");
    } finally {
      setProcesando(false);
    }
  }

  const entrada = (ref: RefObject<HTMLInputElement>, capture: boolean, id: string) => (
    <input
      ref={ref}
      id={id}
      type="file"
      accept="image/*"
      {...(capture ? { capture: "environment" as const } : {})}
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        // La hora se toma aquí, en el instante de elegir, antes de cualquier proceso.
        void elegido(e.target.files?.[0], capture ? "camara" : "galeria", Date.now());
        e.target.value = "";
      }}
    />
  );

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted">Foto de la entrega (obligatoria)</p>
      {entrada(camara, true, "foto-camara")}
      {entrada(galeria, false, "foto-galeria")}
      {procesando ? (
        <div className="grid h-40 place-items-center rounded-2xl border border-dashed border-line bg-ground text-[13px] text-muted">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Preparando la foto…
          </span>
        </div>
      ) : vista ? (
        <div className="overflow-hidden rounded-2xl border border-line">
          <img src={vista} alt="Foto de la entrega" className="max-h-64 w-full bg-ground object-contain" />
          {foto && (
            <p className="border-t border-line-2 px-3 py-2 text-[12px] text-muted">
              {foto.origenHora === "archivo" ? "Fecha del archivo:" : foto.origenHora === "ahora" ? "Elegida el" : foto.origen === "galeria" ? "De la galería, tomada el" : "Tomada el"} <b className="text-ink">{selloLima(foto.capturadoEn).fecha}</b> a las <b className="text-ink">{selloLima(foto.capturadoEn).hora}</b>
              {foto.dudosa && <span className="mt-1 block font-medium text-warn">Esta fecha no es segura. Revísala antes de guardar.</span>}
            </p>
          )}
          <div className="flex gap-2 border-t border-line-2 p-2">
            <button
              type="button"
              onClick={() => abrir(camara)}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition hover:bg-ground"
            >
              <Camera className="size-4" /> Tomar otra
            </button>
            <button
              type="button"
              onClick={() => alCambiar(null)}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-[13px] font-semibold text-red transition hover:bg-red-soft"
            >
              <Trash2 className="size-4" /> Quitar
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 rounded-2xl border border-dashed border-faint/60 bg-ground/60 p-3">
          <button
            type="button"
            onClick={() => abrir(camara)}
            className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-xl bg-ink text-[13px] font-semibold text-white transition active:scale-[0.98]"
          >
            <Camera className="size-5" /> Tomar foto
          </button>
          <button
            type="button"
            onClick={() => abrir(galeria)}
            className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-[13px] font-semibold transition active:scale-[0.98]"
          >
            <ImagenIcono className="size-5" /> Elegir de galería
          </button>
        </div>
      )}
    </div>
  );
}

/** Miniatura de la foto de una entrega: al tocarla se abre grande. */
export function MiniFoto({ ruta, onAbrir, className }: { ruta: string | null; onAbrir: (ruta: string) => void; className?: string }) {
  const [rota, setRota] = useState(false);
  const url = urlFoto(ruta);
  const enLinea = useEnLinea();
  // Una miniatura que falló sin señal se vuelve a pedir cuando regresa la conexión.
  useEffect(() => {
    if (enLinea) setRota(false);
  }, [enLinea, ruta]);
  if (!ruta || !url) {
    return (
      <span className={cn("grid size-11 place-items-center rounded-lg bg-ground text-faint", className)} title="Sin foto">
        <ImageOff className="size-4" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onAbrir(ruta)}
      aria-label="Ver la foto de la entrega"
      className={cn("group relative size-11 shrink-0 overflow-hidden rounded-lg border border-line bg-ground transition hover:border-ink", className)}
    >
      {rota ? (
        <ImageOff className="m-auto size-4 text-faint" />
      ) : (
        <img src={url} alt="" loading="lazy" onError={() => setRota(true)} className="size-full object-cover transition group-hover:scale-105" />
      )}
    </button>
  );
}

/** Foto grande con los datos de la entrega. */
export function VisorFoto({ ruta, titulo, detalle, alCerrar }: { ruta: string | null; titulo: string; detalle?: ReactNode; alCerrar: () => void }) {
  const url = urlFoto(ruta);
  const enLinea = useEnLinea();
  const [rota, setRota] = useState(false);
  useEffect(() => setRota(false), [ruta]);
  // Las fotos viven en el servidor: sin conexión no hay nada que abrir.
  const noDisponible = rota || !enLinea;
  return (
    <Ventana abierta={ruta !== null} alCerrar={alCerrar} titulo={titulo} subtitulo={detalle}>
      {noDisponible ? (
        <div className="grid place-items-center gap-2 rounded-2xl bg-ground px-6 py-14 text-center text-muted">
          <ImageOff className="size-6" />
          <p className="text-center text-[13px] font-medium">La foto necesita conexión</p>
        </div>
      ) : url ? (
        <>
          <a href={url} target="_blank" rel="noreferrer" className="block" aria-label="Abrir la foto en otra pestaña">
            <img src={url} alt={titulo} onError={() => setRota(true)} className="mx-auto max-h-[62vh] w-full rounded-2xl bg-ground object-contain" />
          </a>
          <p className="mt-3 text-center text-[12px] text-faint">Toca la foto para abrirla a tamaño completo.</p>
        </>
      ) : null}
    </Ventana>
  );
}
