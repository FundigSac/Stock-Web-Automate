import { Camera, Image as ImagenIcono, ImageOff, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { prepararFoto, urlFoto, type FotoCapturada, type OrigenFoto } from "../lib/foto";
import { useEnLinea } from "../lib/offline/conexion";
import { hayEspacioPara } from "../lib/offline/respaldo";
import { selloLima } from "../lib/tiempo";
import { cn } from "../lib/utils";
import { Ventana } from "./Ventana";

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

  const boton =
    "inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-md border-2 border-line bg-surface px-3 text-[18px] font-semibold transition-transform duration-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-action";

  return (
    <div>
      {entrada(camara, true, "foto-camara")}
      {entrada(galeria, false, "foto-galeria")}
      {/* La cámara va primero: queda a la vista sin desplazar, también en pantallas de 640 px con el aviso de borrador. */}
      <button
        type="button"
        onClick={() => abrir(camara)}
        disabled={procesando}
        className="flex h-[120px] w-full items-center justify-center gap-4 rounded-lg border-2 border-action bg-surface px-6 text-[22px] font-semibold text-action transition-transform duration-100 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        <Camera className="size-10 shrink-0" aria-hidden /> {foto ? "Tomar otra foto" : "Tomar foto"}
      </button>
      <div className="mt-3 flex flex-col gap-3 min-[420px]:flex-row">
        <button type="button" onClick={() => abrir(galeria)} disabled={procesando} className={cn(boton, "text-ink disabled:opacity-60")}>
          <ImagenIcono className="size-5 shrink-0" aria-hidden /> Elegir de la galería
        </button>
        {foto && (
          <button type="button" onClick={() => alCambiar(null)} disabled={procesando} className={cn(boton, "text-red disabled:opacity-60")}>
            <Trash2 className="size-5 shrink-0" aria-hidden /> Quitar
          </button>
        )}
      </div>
      {/* La vista previa tiene su alto desde el principio: al llegar la foto nada se mueve. */}
      <div className="mt-4 grid h-64 place-items-center overflow-hidden rounded-lg border border-line bg-surface" aria-busy={procesando}>
        {procesando ? (
          <span className="inline-flex items-center gap-2 text-[16px] text-muted">
            <Loader2 className="size-5 animate-spin" aria-hidden /> Preparando la foto…
          </span>
        ) : vista ? (
          <img src={vista} alt="Foto de la entrega" className="size-full bg-ground object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-2 text-[16px] text-muted">
            <ImagenIcono className="size-8" aria-hidden /> Todavía no hay foto
          </span>
        )}
      </div>
      <div className="min-h-12 py-2">
        {foto && !procesando && (
          <p className="num text-left text-[16px] text-muted">
            {foto.origenHora === "archivo" ? "Fecha del archivo:" : foto.origenHora === "ahora" ? "Elegida el" : foto.origen === "galeria" ? "De la galería, tomada el" : "Tomada el"} <b className="text-ink">{selloLima(foto.capturadoEn).fecha}</b> a las <b className="text-ink">{selloLima(foto.capturadoEn).hora}</b>
            {foto.dudosa && <span className="mt-1 block font-semibold text-warn">Esta fecha no es segura. Revísala antes de guardar.</span>}
          </p>
        )}
      </div>
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
          <p className="text-center text-[14px] font-medium">La foto necesita conexión</p>
        </div>
      ) : url ? (
        <>
          <a href={url} target="_blank" rel="noreferrer" className="block" aria-label="Abrir la foto en otra pestaña">
            <img src={url} alt={titulo} onError={() => setRota(true)} className="mx-auto max-h-[62vh] w-full rounded-2xl bg-ground object-contain" />
          </a>
          <p className="mt-3 text-center text-[14px] text-faint">Toca la foto para abrirla a tamaño completo.</p>
        </>
      ) : null}
    </Ventana>
  );
}
