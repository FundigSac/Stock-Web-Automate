import { useState } from "react";

/** Mismas medidas que los campos del registro: 56 px de alto, etiqueta de 16 px y texto de 18 px. */
export const etiquetaCampo = "mb-2 block text-left text-[16px] font-semibold text-muted";
export const estiloCampo =
  "h-14 w-full rounded-md border border-line bg-surface px-4 text-[18px] text-ink outline-none transition focus:border-action placeholder:text-faint";

/**
 * "Registrando como Diego · Cambiar": pide el nombre solo la primera vez en este dispositivo.
 * Mientras el campo tiene el foco no se pliega: se escribe letra a letra y la firma tiene que quedar completa.
 */
export function CampoAutor({ autor, setAutor, id }: { autor: string; setAutor: (v: string) => void; id: string }) {
  const [editando, setEditando] = useState(false);
  const corto = autor.trim().length < 2;
  if (!corto && !editando) {
    return (
      <div className="flex min-h-14 items-center justify-between gap-3 rounded-md bg-ground pl-4 pr-1 text-[16px] text-muted">
        <p className="min-w-0 truncate text-left">
          Registrando como <b className="text-ink">{autor.trim()}</b>
        </p>
        <button
          type="button"
          onClick={() => setEditando(true)}
          aria-label="Cambiar tu nombre"
          className="inline-flex min-h-14 min-w-14 shrink-0 items-center justify-center rounded-md px-3 text-[16px] font-semibold text-action underline underline-offset-4 hover:bg-surface focus-visible:outline-2 focus-visible:outline-action"
        >
          Cambiar
        </button>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className={etiquetaCampo}>
        Tu nombre (queda anotado en cada registro)
      </label>
      <input
        id={id}
        value={autor}
        onChange={(e) => setAutor(e.target.value)}
        onFocus={() => setEditando(true)}
        // Se pliega al salir del campo, nunca mientras se escribe.
        onBlur={() => setEditando(false)}
        // Solo al tocar Cambiar: abrir una ventana no debe sacar el teclado.
        autoFocus={editando}
        maxLength={60}
        autoComplete="name"
        placeholder="Por ejemplo: Cristhian"
        className={estiloCampo}
      />
    </div>
  );
}
