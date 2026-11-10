import { Activity, ChevronRight, FileDown, LayoutDashboard, Users, type LucideIcon } from "lucide-react";
import { AvisoReporte } from "../components/CampanaReporte";
import { Cuenta } from "../components/Cuenta";
import { SelectorEmpresa } from "../components/SelectorEmpresa";
import { UsoAlmacen } from "../components/UsoAlmacen";
import type { Datos } from "../lib/types";
import type { Vista } from "./tipos";

function Fila({ icono: Icono, texto, onClick, disabled }: { icono: LucideIcon; texto: string; onClick: () => void; disabled?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} disabled={disabled} className="flex min-h-16 w-full items-center gap-4 px-4 text-left text-[18px] font-semibold hover:bg-ground disabled:opacity-50">
        <Icono className="size-6 shrink-0 text-action" aria-hidden />
        <span className="flex-1">{texto}</span>
        <ChevronRight className="size-5 shrink-0 text-faint" aria-hidden />
      </button>
    </li>
  );
}

export type MasProps = {
  irA: (v: Vista) => void;
  abrirPdf: () => void;
  cargando: boolean;
  /** Lo que llegó del servidor, sin lo que falta subir: es lo que entra en el reporte. */
  delServidor: Datos;
  autor: string;
  avisar: (texto: string, error?: boolean) => void;
  recargar: () => Promise<Datos | null>;
  errorDatos: boolean;
  dueno: string | null;
  mostrarCuenta: boolean;
  puede: boolean;
  porSubir: number;
  empresa: string;
  empresas: string[];
  cambiarEmpresa: (e: string) => void;
};

export function Mas({ irA, abrirPdf, cargando, delServidor, autor, avisar, recargar, errorDatos, dueno, mostrarCuenta, puede, porSubir, empresa, empresas, cambiarEmpresa }: MasProps) {
  return (
    // Alineado a la izquierda, en el mismo eje que el título de la pantalla.
    <div className="max-w-2xl space-y-5">
      <ul className="divide-y divide-line-2 overflow-hidden rounded-2xl border border-line bg-surface">
        <Fila icono={LayoutDashboard} texto="Resumen" onClick={() => irA("resumen")} />
        <Fila icono={Activity} texto="Movimientos" onClick={() => irA("movimientos")} />
        <Fila icono={Users} texto="Trabajadores" onClick={() => irA("trabajadores")} />
        <Fila icono={FileDown} texto="Informes PDF" onClick={abrirPdf} disabled={cargando} />
      </ul>

      <section aria-label="Reporte semanal" className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[18px] font-semibold">Reporte semanal</h2>
        <div className="mt-3">
          {!cargando && <AvisoReporte todos={delServidor} autor={autor} avisar={avisar} recargar={recargar} errorDatos={errorDatos} dueno={dueno} sinPendiente={<p className="text-[16px] text-muted">No hay reporte pendiente.</p>} />}
        </div>
      </section>

      {mostrarCuenta && (
        <section aria-label="Cuenta" className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-[18px] font-semibold">Cuenta</h2>
          <Cuenta avisar={avisar} puede={puede} porSubir={porSubir} />
        </section>
      )}

      <section aria-label="Empresa" className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-3 text-[18px] font-semibold">Empresa</h2>
        <SelectorEmpresa empresa={empresa} empresas={empresas} alCambiar={cambiarEmpresa} />
      </section>

      <UsoAlmacen />
    </div>
  );
}
