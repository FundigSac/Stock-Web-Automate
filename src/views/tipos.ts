import type { GrupoProducto } from "../lib/derive";
import type { Datos, Estado, Movimiento } from "../lib/types";

export type Vista = "resumen" | "stock" | "movimientos" | "trabajadores";
export type FiltroEstado = Estado | "todos";

export type VistaProps = {
  /** Datos completos, sin filtrar por empresa. */
  todos: Datos;
  /** Datos ya filtrados por la empresa elegida arriba. */
  datos: Datos;
  minimo: number;
  empresa: string;
  cambiarEmpresa: (e: string) => void;
  abrirProducto: (g: GrupoProducto) => void;
  abrirTrabajador: (nombre: string) => void;
  irA: (vista: Vista, estado?: FiltroEstado) => void;
  filtroEstado: FiltroEstado;
  setFiltroEstado: (e: FiltroEstado) => void;
  /** true si quien mira puede registrar y anular. */
  editor: boolean;
  pedirAnular: (m: Movimiento) => void;
  abrirRegistro: () => void;
  abrirNuevoProducto: () => void;
  abrirNuevoTrabajador: () => void;
  /** Abre el asistente, opcionalmente con una pregunta ya hecha ("pedidos pendientes"). */
  abrirAsistente: (pregunta?: string) => void;
  pedidosPendientes: number;
};
