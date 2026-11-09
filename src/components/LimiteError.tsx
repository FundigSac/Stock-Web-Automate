import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Si se pasa, no se muestra la pantalla de error: quien lo usa decide qué hacer (por ejemplo, cerrar una ventana). */
  alFallar?: () => void;
  /** Lo que se muestra en el lugar de la parte que falló, sin afectar al resto de la pantalla. */
  reserva?: ReactNode;
};

/** Si algo se rompe al dibujar, la persona ve qué pasó y puede recargar, en vez de quedarse con la página en blanco. */
export class LimiteError extends Component<Props, { fallo: boolean }> {
  state = { fallo: false };

  static getDerivedStateFromError() {
    return { fallo: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[app]", error, info.componentStack);
    this.props.alFallar?.();
  }

  render() {
    if (!this.state.fallo) return this.props.children;
    if (this.props.reserva) return this.props.reserva;
    if (this.props.alFallar) return null;
    return (
      <div className="mx-auto mt-16 max-w-md rounded-3xl border border-line-2 bg-surface px-6 py-10 text-center" role="alert">
        <p className="text-base font-semibold">Algo falló al mostrar esta pantalla</p>
        <p className="mt-2 text-justify text-[14px] leading-relaxed text-muted">Lo que ya guardaste sigue en este dispositivo. Recarga la página para continuar.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-5 inline-flex h-14 items-center justify-center rounded-md bg-action px-6 text-[18px] font-semibold text-white">
          Recargar
        </button>
      </div>
    );
  }
}
