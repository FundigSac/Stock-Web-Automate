import { useState } from "react";

export const etiquetaCampo = "mb-1.5 block text-xs font-semibold text-muted";
export const estiloCampo =
  "h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm outline-none transition focus:border-ink placeholder:text-faint";

/** "Registrando como Diego · Cambiar": pide el nombre solo la primera vez en este dispositivo. */
export function CampoAutor({ autor, setAutor, id }: { autor: string; setAutor: (v: string) => void; id: string }) {
  const [editando, setEditando] = useState(false);
  if (autor.trim().length >= 2 && !editando) {
    return (
      <p className="flex items-center justify-between gap-3 rounded-xl bg-ground px-3.5 py-2.5 text-[13px] text-muted">
        <span className="min-w-0 truncate">
          Registrando como <b className="text-ink">{autor.trim()}</b>
        </span>
        <button type="button" onClick={() => setEditando(true)} className="shrink-0 font-semibold text-ink underline-offset-2 hover:underline">
          Cambiar
        </button>
      </p>
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
        onBlur={() => autor.trim().length >= 2 && setEditando(false)}
        maxLength={60}
        autoComplete="name"
        placeholder="Por ejemplo: Cristhian"
        className={estiloCampo}
      />
    </div>
  );
}
