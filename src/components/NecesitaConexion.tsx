import { WifiOff } from "lucide-react";
import { Ventana } from "./ui";

/** Lo que de verdad no funciona sin red lo dice claro, sin errores raros. */
export function NecesitaConexion({ abierto, alCerrar, que, detalle }: { abierto: boolean; alCerrar: () => void; que: string; detalle: string }) {
  return (
    <Ventana abierta={abierto} alCerrar={alCerrar} titulo={`${que} necesita conexión`}>
      <div className="flex flex-col items-center px-2 py-6 text-center">
        <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-warn-soft text-warn">
          <WifiOff className="size-5" />
        </span>
        <p className="max-w-sm text-[13.5px] leading-relaxed text-muted">{detalle}</p>
      </div>
    </Ventana>
  );
}
