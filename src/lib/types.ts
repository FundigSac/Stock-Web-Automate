import type { OrigenHora } from "./offline/almacen";

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
  /** "CAMBIO" en las filas históricas de un cambio de prenda. Hoy no se registran nuevas; siguen sin contar como compra ni entrega. */
  etiqueta: "CAMBIO" | null;
  /** Une las dos mitades de un mismo cambio. */
  cambio_ref: string | null;
  /** Instante de la foto o del registro en el dispositivo. Las filas antiguas no lo tienen: vale created_at. */
  capturado_en?: string | null;
  /** De dónde salió esa hora: la foto (exif, camara), la fecha del archivo o el momento de registrar. */
  capturado_origen?: OrigenHora | null;
  /** Cuándo llegó la fila al servidor. Sirve para encontrar lo que subió tarde. */
  subido_en?: string | null;
  /** UUID generado en el dispositivo: llave contra duplicados. */
  client_id?: string | null;
  /** Por qué alguien debe mirar esta fila (saldo negativo, reloj desfasado). */
  revisar_motivo?: string | null;
  /** Solo en este dispositivo: todavía no llegó al servidor. */
  pendiente?: true;
  /** Ya llegó al servidor, pero la copia de este dispositivo aún no lo trae. */
  sinCopia?: true;
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
  /** Último sábado ya reportado. No existe hasta aplicar la migración de reportes. */
  reporte_sabado?: string | null;
  /** Momento exacto del último reporte, para saber qué llegó después. Misma migración. */
  reporte_ultimo_en?: string | null;
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
  revisar?: string | null;
  /** Todavía no llegó al servidor: no se puede anular ni tiene foto en línea. */
  pendiente?: boolean;
  /** Ya está en el servidor, pero la copia local todavía no lo trae. */
  sinCopia?: boolean;
  /** Hora guardada con la foto. Las filas antiguas no la tienen. */
  capturado?: string | null;
  origenHora?: OrigenHora | null;
  subido?: string | null;
};

export type Datos = {
  stock: StockItem[];
  entradas: Entrada[];
  salidas: Salida[];
  trabajadores: Trabajador[];
  pedidos: Pedido[];
  sync: SyncState | null;
};
