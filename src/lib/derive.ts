import type { Datos, Estado, Movimiento, Salida, StockItem } from "./types";
import { entero, fechaCorta, fechaLarga, hoyISO, sumarDias, nombreTalla } from "./format";
import { fechaLima, horaLima } from "./tiempo";

export const ESTADO_TEXTO: Record<Estado, string> = {
  ok: "Con stock",
  bajo: "Por agotarse",
  sin: "Sin stock",
  revisar: "Saldo negativo",
};

export function estadoDe(queda: number, minimo: number): Estado {
  if (queda < 0) return "revisar";
  if (queda === 0) return "sin";
  if (queda <= minimo) return "bajo";
  return "ok";
}

const ORDEN_TALLA = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];
export function rangoTalla(t: string | null): number {
  if (!t) return 9999;
  const u = nombreTalla(t).toUpperCase().trim();
  const i = ORDEN_TALLA.indexOf(u);
  if (i >= 0) return i;
  const n = u.match(/(\d+)/);
  if (n) return 100 + Number(n[1]);
  if (u.includes("ESPECIAL")) return 900;
  return 1000;
}

/** Porcentaje que no engaña en los extremos: 100 solo si son todos y 0 solo si no hay ninguno. */
export function porcentaje(parte: number, total: number): number {
  if (total <= 0 || parte <= 0) return 0;
  if (parte >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((parte / total) * 100)));
}

export type Resumen = {
  articulos: number;
  unidades: number;
  ok: number;
  bajo: number;
  sin: number;
  revisar: number;
  disponibles: number; // articulos con stock > 0
  pctDisponible: number; // 0..100
  ultima: string | null;
};

export function resumir(items: StockItem[], minimo: number): Resumen {
  let unidades = 0;
  let ok = 0;
  let bajo = 0;
  let sin = 0;
  let revisar = 0;
  let ultima: string | null = null;
  for (const it of items) {
    unidades += Math.max(0, it.queda);
    const e = estadoDe(it.queda, minimo);
    if (e === "ok") ok++;
    else if (e === "bajo") bajo++;
    else if (e === "sin") sin++;
    else revisar++;
    if (it.ultimo_movimiento && (!ultima || it.ultimo_movimiento > ultima)) ultima = it.ultimo_movimiento;
  }
  const disponibles = ok + bajo;
  return {
    articulos: items.length,
    unidades,
    ok,
    bajo,
    sin,
    revisar,
    disponibles,
    pctDisponible: porcentaje(disponibles, items.length),
    ultima,
  };
}

export type FilaEmpresa = Resumen & { empresa: string };

export function porEmpresa(items: StockItem[], minimo: number): FilaEmpresa[] {
  const mapa = new Map<string, StockItem[]>();
  for (const it of items) {
    const l = mapa.get(it.empresa) ?? [];
    l.push(it);
    mapa.set(it.empresa, l);
  }
  return Array.from(mapa, ([empresa, l]) => ({ empresa, ...resumir(l, minimo) })).sort(
    (a, b) => b.unidades - a.unidades || a.empresa.localeCompare(b.empresa, "es"),
  );
}

export type GrupoProducto = {
  clave: string;
  empresa: string;
  producto: string;
  genero: string | null;
  tallas: StockItem[];
  unidades: number;
  peor: Estado;
};

/** Gravedad de cada estado: menor es peor. Un saldo negativo pesa más que una talla agotada. */
export const GRAVEDAD: Record<Estado, number> = { revisar: 0, sin: 1, bajo: 2, ok: 3 };

export type EstadoProducto = {
  /** El estado de la peor talla. */
  estado: Estado;
  /** Tallas que están en ese estado. */
  afectadas: number;
  total: number;
};

/** El estado de un producto es el de su peor talla, y se dice cuántas tallas lo tienen. */
export function estadoProducto(tallas: Pick<StockItem, "queda">[], minimo: number): EstadoProducto {
  let estado: Estado = "ok";
  let afectadas = 0;
  for (const t of tallas) {
    const e = estadoDe(t.queda, minimo);
    if (GRAVEDAD[e] < GRAVEDAD[estado]) {
      estado = e;
      afectadas = 1;
    } else if (e === estado) afectadas++;
  }
  return { estado, afectadas, total: tallas.length };
}

/** "Sin stock · 1 de 3 tallas" cuando no todas las tallas comparten el estado. */
export function textoEstadoProducto(ep: EstadoProducto): string {
  const base = ESTADO_TEXTO[ep.estado];
  if (ep.total <= 1 || ep.afectadas === ep.total) return base;
  return `${base} · ${ep.afectadas} de ${ep.total} tallas`;
}

export function agruparProductos(items: StockItem[], minimo: number): GrupoProducto[] {
  const mapa = new Map<string, GrupoProducto>();
  for (const it of items) {
    const clave = `${it.empresa}||${it.producto}`;
    let g = mapa.get(clave);
    if (!g) {
      g = { clave, empresa: it.empresa, producto: it.producto, genero: it.genero, tallas: [], unidades: 0, peor: "ok" };
      mapa.set(clave, g);
    }
    g.tallas.push(it);
    g.unidades += Math.max(0, it.queda);
    const e = estadoDe(it.queda, minimo);
    if (GRAVEDAD[e] < GRAVEDAD[g.peor]) g.peor = e;
  }
  const grupos = Array.from(mapa.values());
  for (const g of grupos) g.tallas.sort((a, b) => rangoTalla(a.talla) - rangoTalla(b.talla));
  return grupos;
}

export function movimientosDe(d: Datos, conAnulados = false): Movimiento[] {
  const out: Movimiento[] = [];
  for (const e of d.entradas) {
    if (e.anulado && !conAnulados) continue;
    out.push({
      key: `e${e.id}`,
      id: e.id,
      tipo: "entrada",
      fecha: e.fecha,
      codigo: e.codigo,
      producto: e.producto,
      cantidad: e.cantidad,
      persona: null,
      area: null,
      nota: e.proveedor_nota,
      anulado: e.anulado,
      motivo: e.anulado_motivo,
      anuladoPor: e.anulado_por,
      registradoPor: e.creado_por,
      creado: e.capturado_en ?? e.created_at,
      capturado: e.capturado_en ?? null,
      origenHora: e.capturado_origen ?? null,
      subido: e.subido_en ?? null,
      foto: e.foto_path ?? null,
      etiqueta: e.etiqueta ?? null,
      cambioRef: e.cambio_ref ?? null,
      revisar: e.revisar_motivo ?? null,
      pendiente: e.pendiente === true,
      sinCopia: e.sinCopia === true,
    });
  }
  for (const s of d.salidas) {
    if (s.anulado && !conAnulados) continue;
    out.push({
      key: `s${s.id}`,
      id: s.id,
      tipo: "salida",
      fecha: s.fecha,
      codigo: s.codigo,
      producto: s.producto,
      cantidad: s.cantidad,
      persona: s.trabajador_cliente,
      area: s.area,
      nota: s.nota,
      anulado: s.anulado,
      motivo: s.anulado_motivo,
      anuladoPor: s.anulado_por,
      registradoPor: s.creado_por,
      creado: s.capturado_en ?? s.created_at,
      capturado: s.capturado_en ?? null,
      origenHora: s.capturado_origen ?? null,
      subido: s.subido_en ?? null,
      foto: s.foto_path ?? null,
      etiqueta: s.etiqueta ?? null,
      cambioRef: s.cambio_ref ?? null,
      revisar: s.revisar_motivo ?? null,
      pendiente: s.pendiente === true,
      sinCopia: s.sinCopia === true,
    });
  }
  // Mas recientes primero (por fecha y, dentro del dia, por la hora de la foto o del registro).
  // Se comparan instantes y no textos: unas horas vienen con -05:00 y otras en UTC.
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha) || Date.parse(b.creado) - Date.parse(a.creado));
}

/** Cuándo pasó un movimiento. La hora de la foto y la fecha del registro son dos datos y no se mezclan. */
export function momentoMovimiento(m: Pick<Movimiento, "fecha" | "creado" | "foto" | "capturado" | "origenHora" | "pendiente">): string {
  if (m.capturado && m.origenHora !== "registro" && (m.foto || m.pendiente)) {
    const de = m.origenHora === "archivo" ? "Archivo del" : m.origenHora === "ahora" ? "Elegida el" : "Foto del";
    return `${de} ${fechaCorta(fechaLima(m.capturado))}, ${horaLima(m.capturado)} · Registrado ${fechaLarga(m.fecha)}`;
  }
  return `${fechaLarga(m.fecha)} · registrado a las ${horaLima(m.creado)}`;
}

/** Entregas de una persona, las más recientes primero. Un cambio de prenda no cuenta como entrega, igual que en el PDF. Dentro del día manda la hora real: el id solo dice en qué orden subieron. */
export function entregasDe(salidas: Salida[], nombre: string | null): Salida[] {
  return salidas
    .filter((s) => s.trabajador_cliente === nombre && !s.anulado && !s.etiqueta)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || Date.parse(b.capturado_en ?? b.created_at) - Date.parse(a.capturado_en ?? a.created_at));
}

export type Dia = { fecha: string; entradas: number; salidas: number };

export function serieDiaria(movs: Movimiento[], dias: number): Dia[] {
  const hoy = hoyISO();
  const serie: Dia[] = [];
  const idx = new Map<string, Dia>();
  for (let i = dias - 1; i >= 0; i--) {
    const f = sumarDias(hoy, -i);
    const d = { fecha: f, entradas: 0, salidas: 0 };
    serie.push(d);
    idx.set(f, d);
  }
  for (const m of movs) {
    if (m.anulado || m.cantidad <= 0 || m.etiqueta) continue; // los cambios no son compras ni ventas
    const d = idx.get(m.fecha);
    if (!d) continue;
    if (m.tipo === "entrada") d.entradas += m.cantidad;
    else d.salidas += m.cantidad;
  }
  return serie;
}

export function sumaMovs(movs: Movimiento[]) {
  let entradas = 0;
  let salidas = 0;
  for (const m of movs) {
    if (m.anulado || m.cantidad <= 0 || m.etiqueta) continue; // los cambios no son compras ni ventas
    if (m.tipo === "entrada") entradas += m.cantidad;
    else salidas += m.cantidad;
  }
  return { entradas, salidas, neto: entradas - salidas };
}

/** Frases de analisis en espanol claro, segun los datos actuales. */
export function lecturas(r: Resumen, filas: FilaEmpresa[], movs: Movimiento[]): string[] {
  const out: string[] = [];
  if (r.articulos === 0) return ["Todavía no hay productos en el catálogo."];
  if (r.disponibles === 0) {
    out.push(
      `Las ${entero(r.articulos)} tallas están sin stock. Registra una entrada con el botón Registrar y aparecerá aquí al instante.`,
    );
  } else {
    out.push(`${entero(r.disponibles)} de ${entero(r.articulos)} tallas tienen stock (${r.pctDisponible}%).`);
  }
  if (r.bajo > 0) out.push(`${entero(r.bajo)} ${r.bajo === 1 ? "talla está" : "tallas están"} por agotarse: hay que reponerlas pronto.`);
  if (r.revisar > 0)
    out.push(`${entero(r.revisar)} ${r.revisar === 1 ? "talla tiene" : "tallas tienen"} saldo negativo: se entregó más de lo registrado. Revisa las salidas en Movimientos y anula las que estén mal.`);
  const peor = [...filas].filter((f) => f.articulos > 0).sort((a, b) => a.pctDisponible - b.pctDisponible)[0];
  if (peor && peor.pctDisponible < 100 && filas.length > 1 && r.disponibles > 0)
    out.push(`${peor.empresa} es la empresa con menos tallas con stock (${peor.pctDisponible}%).`);
  const conFecha = movs.filter((m) => !m.anulado && m.cantidad > 0);
  if (conFecha.length === 0) out.push("Aún no hay movimientos registrados.");
  else out.push(`Último movimiento anotado: ${fechaLarga(conFecha[0].fecha)}.`);
  return out;
}

export function filtrarPorEmpresa(d: Datos, empresa: string): Datos {
  if (empresa === "TODAS") return d;
  const stock = d.stock.filter((s) => s.empresa === empresa);
  const codigos = new Set(stock.map((s) => s.codigo));
  return {
    ...d,
    stock,
    entradas: d.entradas.filter((e) => codigos.has(e.codigo)),
    salidas: d.salidas.filter((s) => codigos.has(s.codigo)),
  };
}
