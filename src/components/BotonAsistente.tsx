import { Bot } from "lucide-react";

export function BotonAsistente({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Abrir el asistente de stock"
      className="no-print fixed bottom-[10.25rem] right-4 z-40 grid size-14 place-items-center rounded-full border border-line bg-surface text-ink shadow-pop transition active:scale-95 sm:bottom-24 lg:bottom-8 lg:right-8"
    >
      <Bot className="size-6" />
    </button>
  );
}
