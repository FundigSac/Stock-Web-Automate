import { useEffect, useRef } from "react";
import { PantallaFlujo } from "../components/FlujoRegistro";
import type { Respaldo as DatosRespaldo } from "../lib/offline/useRespaldo";
import { Respaldo } from "./Respaldo";

/**
 * Por subir abierto desde la banda en medio de un registro. Va encima del registro, que queda oculto con lo escrito,
 * y Atrás devuelve al mismo paso.
 */
export function PorSubirEncima({ abierta, alAtras, r, autorizado }: { abierta: boolean; alAtras: () => void; r: DatosRespaldo; autorizado: boolean }) {
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (abierta) titulo.current?.focus({ preventScroll: true });
  }, [abierta]);

  return (
    <PantallaFlujo abierta={abierta} etiqueta="Por subir" alAtras={alAtras} claveContenido="por-subir">
      <h1 ref={titulo} tabIndex={-1} className="text-[24px] font-semibold leading-8 outline-none">
        Por subir
      </h1>
      <p className="mb-5 mt-1 text-left text-[16px] text-muted">Lo guardado en este celular. Atrás te devuelve al registro.</p>
      <Respaldo r={r} autorizado={autorizado} />
    </PantallaFlujo>
  );
}
