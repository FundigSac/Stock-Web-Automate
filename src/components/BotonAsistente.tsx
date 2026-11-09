import { Bot } from "lucide-react";

export function BotonAsistente({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Abrir el asistente de stock"
      className="no-print fixed bottom-[8.75rem] right-4 z-40 hidden size-14 place-items-center rounded-full border border-line bg-surface text-ink shadow-pop transition active:scale-95 sm:grid lg:bottom-8 lg:right-8"
    >
      <Bot className="size-6" />
    </button>
  );
}
