import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useEnLinea } from "../lib/offline/conexion";
import { consultarUso, fraccionUso, hayQueAvisar, leerUsoGuardado, textoLimite, textoMb } from "../lib/usoAlmacen";
import { cn } from "../lib/utils";

function Barra({ etiqueta, usado, limite }: { etiqueta: string; usado: number; limite: number }) {
  const pct = Math.min(100, Math.round(fraccionUso(usado, limite) * 100));
  const lleno = hayQueAvisar(usado, limite);
  return (
    <div>
      <p className="num text-left text-[16px] font-semibold">
        {etiqueta}: {textoMb(usado)} de {textoLimite(limite)}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-line-2" role="img" aria-label={`${etiqueta}: ${pct} % usado`}>
        <div className={cn("h-full rounded-full", lleno ? "bg-red" : "bg-action")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Cuánto queda en el almacén de fotos y en la base. Sin red muestra el último valor conocido o nada. */
export function UsoAlmacen() {
  const enLinea = useEnLinea();
  const [uso, setUso] = useState(leerUsoGuardado);

  useEffect(() => {
    if (!enLinea) return;
    let vivo = true;
    void consultarUso().then((u) => {
      if (vivo && u) setUso(u);
    });
    return () => {
      vivo = false;
    };
  }, [enLinea]);

  if (!uso) return null;

  const llenos = [
    hayQueAvisar(uso.fotos_bytes, uso.fotos_limite) && `las fotos ocupan el ${Math.round(fraccionUso(uso.fotos_bytes, uso.fotos_limite) * 100)} %`,
    hayQueAvisar(uso.base_bytes, uso.base_limite) && `la base ocupa el ${Math.round(fraccionUso(uso.base_bytes, uso.base_limite) * 100)} %`,
  ].filter(Boolean);

  return (
    <section aria-label="Espacio usado" className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-[18px] font-semibold">Espacio</h2>
      <div className="mt-3 space-y-4">
        <Barra etiqueta="Fotos" usado={uso.fotos_bytes} limite={uso.fotos_limite} />
        <Barra etiqueta="Base" usado={uso.base_bytes} limite={uso.base_limite} />
      </div>
      {llenos.length > 0 && (
        <p role="alert" className="mt-4 flex items-start gap-2.5 rounded-xl bg-warn-soft p-3 text-left text-[16px] font-semibold text-warn">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>Queda poco espacio: {llenos.join(" y ")}.</span>
        </p>
      )}
    </section>
  );
}
