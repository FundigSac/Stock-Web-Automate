import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { titulo } from "../lib/format";

export function SelectorEmpresa({ empresa, empresas, alCambiar, className }: { empresa: string; empresas: string[]; alCambiar: (e: string) => void; className?: string }) {
  return (
    <div className={clsx("relative", className)}>
      <select
        value={empresa}
        onChange={(e) => alCambiar(e.target.value)}
        aria-label="Empresa"
        className="h-14 w-full appearance-none rounded-md border border-line bg-surface py-0 pl-4 pr-10 text-[16px] font-semibold outline-none focus-visible:border-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        <option value="TODAS">Todas las empresas</option>
        {empresas.map((e) => (
          <option key={e} value={e}>
            {titulo(e)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
    </div>
  );
}
