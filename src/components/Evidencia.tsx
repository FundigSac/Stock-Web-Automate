import { Camera, Image as ImagenIcono, ImageOff, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { comprimirFoto, urlFoto } from "../lib/foto";
import { cn } from "../lib/utils";
import { Ventana } from "./ui";

/** Toma o elige la foto de la entrega, la comprime y muestra la vista previa. */
export function CampoFoto({
  foto,
  alCambiar,
  alFallar,
}: {
  foto: Blob | null;
  alCambiar: (b: Blob | null) => void;
  alFallar: (mensaje: string) => void;
}) {
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const [procesando, setProcesando] = useState(false);
  const [vista, setVista] = useState<string | null>(null);

  useEffect(() => {
    if (!foto) {
      setVista(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  async function elegido(archivo: File | undefined) {
    if (!archivo) return;
    setProcesando(true);
    try {
      alCambiar(await comprimirFoto(archivo));
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
        elegido(e.target.files?.[0]);
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
          <div className="flex gap-2 border-t border-line-2 p-2">
            <button
              type="button"
              onClick={() => camara.current?.click()}
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
            onClick={() => camara.current?.click()}
            className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-xl bg-ink text-[13px] font-semibold text-white transition active:scale-[0.98]"
          >
            <Camera className="size-5" /> Tomar foto
          </button>
          <button
            type="button"
            onClick={() => galeria.current?.click()}
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
  return (
    <Ventana abierta={ruta !== null} alCerrar={alCerrar} titulo={titulo} subtitulo={detalle}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block" aria-label="Abrir la foto en otra pestaña">
          <img src={url} alt={titulo} className="mx-auto max-h-[62vh] w-full rounded-2xl bg-ground object-contain" />
        </a>
      ) : null}
      <p className="mt-3 text-center text-[12px] text-faint">Toca la foto para abrirla a tamaño completo.</p>
    </Ventana>
  );
}
