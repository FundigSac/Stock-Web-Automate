import { HardDrive, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useEnLinea } from "../lib/offline/conexion";
import { consultarUso, fraccionUso, hayQueAvisar, leerUsoGuardado, textoLimite, textoMb, type UsoAlmacen } from "../lib/usoAlmacen";
import { cn } from "../lib/utils";
import { Card, Kicker } from "./ui";

/** El espacio del servidor: se pide con conexión; sin ella queda el último valor conocido, o nada si nunca se leyó. */
function useUsoAlmacen(): UsoAlmacen | null {
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

  return uso;
}

/** Las partes que ya pasaron el 80 %, dichas en una frase. */
function partesLlenas(uso: UsoAlmacen): string[] {
  return [
    hayQueAvisar(uso.fotos_bytes, uso.fotos_limite) && `las fotos ocupan el ${Math.round(fraccionUso(uso.fotos_bytes, uso.fotos_limite) * 100)} %`,
    hayQueAvisar(uso.base_bytes, uso.base_limite) && `la base ocupa el ${Math.round(fraccionUso(uso.base_bytes, uso.base_limite) * 100)} %`,
  ].filter((t): t is string => Boolean(t));
}

function Aviso({ llenos, className }: { llenos: string[]; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-[13px] font-medium text-warn", className)}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="flex-1">Queda poco espacio: {llenos.join(" y ")}. Avisa a quien administra la app antes de que se llene, porque sin espacio las fotos nuevas no se pueden subir.</p>
    </div>
  );
}

function Barra({ etiqueta, usado, limite }: { etiqueta: string; usado: number; limite: number }) {
  const pct = Math.min(100, Math.round(fraccionUso(usado, limite) * 100));
  const lleno = hayQueAvisar(usado, limite);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="num text-left text-[13.5px] font-semibold">
          {etiqueta}: {textoMb(usado)} de {textoLimite(limite)}
        </p>
        <span className={cn("num text-[12.5px] font-semibold", lleno ? "text-red" : "text-muted")}>{pct} %</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-ground" role="img" aria-label={`${etiqueta}: ${pct} % usado`}>
        <div className={cn("h-full rounded-full", lleno ? "bg-red" : "bg-ink")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Tarjeta de Respaldo: cuánto ocupan las fotos y la base en el servidor. */
export function EspacioUsado() {
  const uso = useUsoAlmacen();
  if (!uso) return null;
  const llenos = partesLlenas(uso);
  return (
    <section aria-label="Espacio usado">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Kicker>Servidor</Kicker>
            <h2 className="display mt-1 text-lg font-semibold">Espacio usado</h2>
          </div>
          <HardDrive className="size-4 shrink-0 text-faint" aria-hidden />
        </div>
        <div className="mt-4 space-y-4">
          <Barra etiqueta="Fotos" usado={uso.fotos_bytes} limite={uso.fotos_limite} />
          <Barra etiqueta="Base" usado={uso.base_bytes} limite={uso.base_limite} />
        </div>
        {llenos.length > 0 && <Aviso llenos={llenos} className="mt-4" />}
      </Card>
    </section>
  );
}

/** Aviso de Resumen: solo aparece desde el 80 % de las fotos o de la base. */
export function AvisoEspacio() {
  const uso = useUsoAlmacen();
  const llenos = uso ? partesLlenas(uso) : [];
  if (llenos.length === 0) return null;
  return <Aviso llenos={llenos} className="no-print" />;
}
