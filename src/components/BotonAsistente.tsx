import { Bot } from "lucide-react";

/** Solo en escritorio. En el celular el asistente se abre desde Registrar. */
export function BotonAsistente({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Abrir el asistente de stock"
      className="no-print fixed bottom-8 right-8 z-40 hidden size-14 place-items-center rounded-full border border-line bg-surface text-ink transition-transform duration-100 ease-out active:scale-[0.98] lg:grid"
    >
      <Bot className="size-6" />
    </button>
  );
}
