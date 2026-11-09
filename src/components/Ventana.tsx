import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { marcarEdicion } from "../lib/offline/recarga";
import { cn } from "../lib/utils";

/** Ventana de detalle accesible (Radix). Va en su propio archivo para no cargar Radix en la pantalla inicial. */
export function Ventana({
  abierta,
  alCerrar,
  titulo,
  subtitulo,
  children,
  pie,
}: {
  abierta: boolean;
  alCerrar: () => void;
  titulo: string;
  subtitulo?: ReactNode;
  children: ReactNode;
  /** Botones que quedan siempre a la vista, debajo del contenido que se desplaza. */
  pie?: ReactNode;
}) {
  // Con una ventana abierta, una versión nueva espera: recargar borraría lo que se está llenando.
  const clave = useId();
  useEffect(() => {
    marcarEdicion(clave, abierta);
    return () => marcarEdicion(clave, false);
  }, [clave, abierta]);

  return (
    <Dialog.Root open={abierta} onOpenChange={(o) => !o && alCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ov fixed inset-0 z-50 bg-ink/45" />
        <Dialog.Content
          className={cn(
            "sheet fixed z-50 flex flex-col overflow-hidden bg-surface outline-none",
            // Celular: hoja que sube desde abajo y deja a la vista la banda de estado.
            "inset-x-0 bottom-0 max-h-[calc(100dvh-64px)] w-full rounded-t-3xl",
            // Pantallas grandes: ventana centrada, debajo de la banda.
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[calc(50%+28px)] sm:max-h-[calc(100vh-88px)] sm:w-[min(720px,calc(100vw-24px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl",
          )}
          aria-describedby={undefined}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 border-b border-line-2 px-5 pb-4 pt-3 sm:px-6 sm:pt-5">
            <div className="min-w-0">
              {/* El título baja de línea en vez de cortarse: en el celular un nombre de producto largo no cabe en una. */}
              <Dialog.Title className="text-xl font-semibold leading-7 [overflow-wrap:anywhere]">{titulo}</Dialog.Title>
              {subtitulo && <div className="mt-1 text-justify text-[14px] text-muted">{subtitulo}</div>}
            </div>
            <Dialog.Close className="-mr-2 grid size-14 shrink-0 place-items-center rounded-md text-muted hover:bg-line-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-action" aria-label="Cerrar">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
          {pie && <div className="shrink-0 border-t border-line-2 bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4">{pie}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
