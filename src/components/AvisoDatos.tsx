import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { textoAvisoDatos } from "../lib/avisoDatos";

/**
 * X10-4 OfflineBanner. Sin señal dice de cuándo son los datos guardados que se ven
 * ("Sin conexión — mostrando datos guardados a las 14:05"); con registros sin subir avisa que las cifras son provisionales.
 */
export function AvisoDatos({ enLinea, sinSubir, provisionales, guardadoEn }: { enLinea: boolean; sinSubir: number; provisionales: number; guardadoEn: number | null }) {
  // La fecha solo cambia de "a las" a "el 7 nov a las" al pasar la medianoche: basta con mirar cada minuto.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const texto = textoAvisoDatos({ enLinea, sinSubir, provisionales, guardadoEn, ahora });
  if (!texto) return null;
  return (
    // Sin role="status": ese papel es de la pastilla de conexión de la cabecera. aria-live basta para que se anuncie.
    <div aria-live="polite" className="no-print mb-5 flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-justify text-[13px] font-medium text-warn" data-testid="aviso-provisional">
      <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{texto}</span>
    </div>
  );
}
