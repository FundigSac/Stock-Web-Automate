export type StockItem = {
  codigo: string;
  empresa: string;
  producto: string;
  talla: string | null;
  genero: string | null;
  tenia_al_inicio: number;
  entro: number;
  salio: number;
  queda: number;
  aviso: string | null;
  ultimo_movimiento: string | null;
};

type Auditoria = {
  anulado: boolean;
  anulado_motivo: string | null;
  anulado_por: string | null;
  anulado_at: string | null;
  creado_por: string | null;
  created_at: string;
  /** "CAMBIO" cuando es una de las dos mitades de un cambio de prenda. */
  etiqueta: "CAMBIO" | null;
  /** Une las dos mitades de un mismo cambio. */
  cambio_ref: string | null;
};

export type Entrada = Auditoria & {
  id: number;
  fecha: string;
  codigo: string;
  producto: string;
  cantidad: number;
  proveedor_nota: string | null;
  /** Foto opcional de lo que llego. */
  foto_path: string | null;
};

export type Salida = Auditoria & {
  id: number;
  fecha: string;
  codigo: string;
  producto: string;
  cantidad: number;
  trabajador_cliente: string;
  area: string | null;
  nota: string | null;
  /** Ruta de la foto de evidencia en el bucket "evidencias". */
  foto_path: string | null;
};

export type Trabajador = {
  trabajador: string;
  nombres: string | null;
  apellidos: string | null;
  area: string | null;
  prendas_recibidas: number;
  ultima_entrega: string | null;
  genero: "HOMBRE" | "MUJER" | null;
};

/** Ajustes globales (fila unica de sync_state). */
export type SyncState = {
  stock_minimo: number;
  /** true = cualquiera puede registrar; false = solo cuentas autorizadas. */
  registro_abierto: boolean;
  /** Desde cuando corre el reporte semanal (el primero toca el primer sabado desde esta fecha). */
  reporte_inicio: string;
  /** Dia en que se saco el ultimo reporte semanal. */
  reporte_ultimo: string | null;
  reporte_por: string | null;
};

/** Pedido de reposicion: se pide al proveedor y, cuando llega, se convierte en una entrada. */
export type Pedido = {
  id: number;
  fecha: string;
  codigo: string;
  producto: string;
  cantidad: number;
  estado: "pendiente" | "recibido" | "cancelado";
  nota: string | null;
  creado_por: string | null;
  created_at: string;
  cantidad_recibida: number | null;
  cerrado_por: string | null;
  cerrado_at: string | null;
};

export type Estado = "ok" | "bajo" | "sin" | "revisar";

/** Un movimiento unificado (entrada o salida) para listas y graficos. */
export type Movimiento = {
  key: string;
  id: number;
  tipo: "entrada" | "salida";
  fecha: string;
  codigo: string;
  producto: string;
  cantidad: number;
  persona: string | null; // proveedor/nota (entrada) o trabajador/cliente (salida)
  area: string | null;
  nota: string | null;
  anulado: boolean;
  motivo: string | null;
  anuladoPor: string | null;
  registradoPor: string | null;
  creado: string;
  foto: string | null;
  etiqueta: "CAMBIO" | null;
  cambioRef: string | null;
};

export type Datos = {
  stock: StockItem[];
  entradas: Entrada[];
  salidas: Salida[];
  trabajadores: Trabajador[];
  pedidos: Pedido[];
  sync: SyncState | null;
};
