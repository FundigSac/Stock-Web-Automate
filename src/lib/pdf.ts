import type { jsPDF as JsPDF } from "jspdf";
import { ESTADO_TEXTO, estadoDe, movimientosDe, porcentaje, porEmpresa, rangoTalla, resumir, sumaMovs, type FilaEmpresa, type Resumen } from "./derive";
import { entero, etiquetaTalla, fechaLarga, nombreProducto, nombreTallaEn, partirMovimiento, sumarDias, titulo } from "./format";
import { urlFoto } from "./foto";
import type { EstadoItem, OrigenHora } from "./offline/almacen";
import { ahoraServidor } from "./offline/reloj";
import { esDeCuenta, listarRespaldo } from "./offline/respaldo";
import { movimientosTardios } from "./reporteSemanal";
import { fechaLima, hoyLima, partesLima } from "./tiempo";
import type { Datos, Estado, Movimiento } from "./types";

export type SeccionesPDF = {
  resumen: boolean;
  stock: boolean;
  movimientos: boolean;
  trabajadores: boolean;
  /** Fotos de evidencia, cada una junto a su movimiento. */
  fotos: boolean;
};

/** Una linea guardada en este equipo, con o sin foto. */
export type FotoEnBandeja = {
  id: string;
  /** Las lineas de un mismo registro comparten la foto. */
  fotoId: string;
  /** Ruta que tendra (o ya tiene) la foto en el servidor. */
  ruta: string | null;
  /** Llave de la linea: une este registro con su fila provisional en los datos. */
  clientId: string | null;
  /** true si el servidor ya lo recibio y solo queda la copia local. */
  confirmada: boolean;
  tipo: "entrada" | "salida";
  fecha: string;
  codigo: string;
  producto: string;
  cantidad: number;
  persona: string | null;
  area: string | null;
  nota: string | null;
  registradoPor: string | null;
  /** Momento en que se anoto (ISO). */
  creado: string;
  /** Momento en que se tomo la foto (ISO), si se conoce. */
  capturadoEn: string | null;
  origenHora?: OrigenHora | null;
  estado?: EstadoItem;
  revision?: string | null;
  /** null: el registro no lleva foto, como una entrada. */
  foto: Blob | null;
};

export type LectorBandeja = () => Promise<FotoEnBandeja[]>;

export type ProgresoPDF = {
  fase: "preparando" | "fotos" | "armando" | "listo";
  hechas: number;
  total: number;
  fallidas: number;
  texto: string;
};

export type ResultadoPDF = {
  paginas: number;
  fotos: number;
  fallidas: number;
  bytes: number;
};

export type OpcionesPDF = {
  /** Datos filtrados por la empresa elegida. */
  datos: Datos;
  /** Datos completos (el personal no depende de la empresa). */
  todos: Datos;
  empresa: string;
  secciones: SeccionesPDF;
  /** Quien genera el informe (se imprime en la portada y en las firmas). */
  usuario: string;
  /** Periodo de los movimientos y las entregas (null = sin limite). */
  desde: string | null;
  hasta: string | null;
  /** Agrega un anexo con los movimientos anulados (auditoria). */
  incluirAnulados: boolean;
  /** Si se pasa, el PDF se abre ahi en vez de descargarse (vista previa). */
  ventana?: Window | null;
  /** Nombre del informe en la portada (por defecto se deduce de las secciones). */
  titulo?: string;
  /** Avisa como va la carga de fotos y el armado del PDF. */
  alProgreso?: (p: ProgresoPDF) => void;
  /** Lee las fotos guardadas en este equipo. Por defecto, el respaldo offline. */
  bandeja?: LectorBandeja;
  /** Cuenta con sesión. Si se indica, del dispositivo solo entra lo suyo y lo guardado sin sesión. */
  dueno?: string | null;
  /** Desde qué momento una fila que subió con fecha anterior al periodo cuenta como llegada tarde. */
  tardeDesde?: string | null;
  /** Hora con la que se fecha el informe. Por defecto, la del servidor según el último contacto. */
  ahora?: number;
};

/** Convierte el respaldo offline en una linea por producto. Lo que no lleva foto también entra: sigue sin estar en el servidor. */
export const leerRespaldoLocal = async (dueno?: string | null): Promise<FotoEnBandeja[]> =>
  (await listarRespaldo()).flatMap((it) => {
    if (dueno !== undefined && !esDeCuenta(it, dueno)) return [];
    return it.lineas.map((l, i) => ({
      id: `${it.id}-${i}`,
      fotoId: it.id,
      ruta: it.fotoRuta,
      clientId: l.clientId,
      confirmada: it.estado === "confirmado",
      tipo: it.tipo,
      fecha: it.fecha,
      codigo: l.codigo,
      producto: l.talla ? `${l.producto}  ·  Talla ${l.talla}` : l.producto,
      cantidad: l.cantidad,
      persona: it.trabajador,
      area: it.area,
      nota: it.nota,
      registradoPor: it.quien,
      creado: it.guardadoEn,
      capturadoEn: it.capturadoEn,
      origenHora: it.origenHora,
      estado: it.estado,
      revision: it.revision,
      foto: it.foto,
    }));
  });

type RGB = [number, number, number];
const INK: RGB = [14, 15, 17];
const RED: RGB = [215, 38, 30];
const MUTED: RGB = [107, 112, 120];
const FAINT: RGB = [154, 160, 168];
const LINE: RGB = [226, 228, 232];
const GROUND: RGB = [241, 242, 244];
const OK: RGB = [15, 123, 78];
const WARN: RGB = [168, 106, 8];

const ML = 14; // margen lateral
const ANCHO = 210;
const ALTO = 297;
const UTIL = ANCHO - ML * 2;
const TOPE = 24; // margen superior de las paginas interiores (deja sitio al encabezado)
const BASE = 280; // limite inferior del contenido

/** jsPDF usa fuentes estandar (Latin-1): sustituye o quita lo que no existe en ellas. */
const t = (s: string | null | undefined): string =>
  (s ?? "")
    .replace(/[\t\r]/g, " ")
    .replace(/[—−–]/g, "-")
    .replace(/·/g, "-")
    .replace(/✔\s*/g, "")
    .replace(/⚠\s*/g, "! ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "");

const SIN_AREA = "Cliente o sin área";

const COLOR_ESTADO: Record<Estado, RGB> = { ok: OK, bajo: WARN, sin: MUTED, revisar: RED };

type Doc = JsPDF & { lastAutoTable?: { finalY: number } };

const plural = (n: number, uno: string, varios: string) => `${entero(n)} ${n === 1 ? uno : varios}`;

const dos = (n: number) => String(n).padStart(2, "0");

/** Fecha y hora de Lima, para que el informe no dependa de la zona horaria del equipo. */
function enLima(valor: string | number | null | undefined): { fecha: string; hora: string } | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "string" && Number.isNaN(Date.parse(valor))) return null;
  const p = partesLima(valor);
  return { fecha: `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`, hora: `${dos(p.hora)}:${dos(p.minuto)}` };
}

/** Lo que entra en los totales. Los cambios de prenda no son compras ni entregas, igual que en pantalla. */
const suma = (m: Movimiento) => !m.anulado && m.cantidad > 0 && !m.etiqueta;

function nombreInforme(s: SeccionesPDF): string {
  const n = Object.values(s).filter(Boolean).length;
  if (n === 5) return "Informe completo";
  if (s.fotos && n === 1) return "Fotos de evidencia";
  if (n === 4) return "Informe de stock";
  if (s.resumen && n === 1) return "Resumen";
  if (s.stock && n === 1) return "Stock actual";
  if (s.movimientos && n === 1) return "Informe de movimientos";
  if (s.trabajadores && n === 1) return "Entregas por trabajador";
  return "Informe de stock";
}

function textoPeriodo(desde: string | null, hasta: string | null): string {
  if (desde && hasta) return desde === hasta ? fechaLarga(desde) : `${fechaLarga(desde)} al ${fechaLarga(hasta)}`;
  if (desde) return `Desde el ${fechaLarga(desde)}`;
  if (hasta) return `Hasta el ${fechaLarga(hasta)}`;
  return "Todo el historial";
}

/** El periodo dentro de una frase: "del 1 nov 2026 al 9 nov 2026". */
function fraseDePeriodo(desde: string | null, hasta: string | null): string {
  if (desde && hasta) return desde === hasta ? `del ${fechaLarga(desde)}` : `del ${fechaLarga(desde)} al ${fechaLarga(hasta)}`;
  if (desde) return `desde el ${fechaLarga(desde)}`;
  if (hasta) return `hasta el ${fechaLarga(hasta)}`;
  return "de todo el historial";
}

/** Marca de la app (cuadrado con tres barras), dibujada como vector. */
function marca(doc: Doc, x: number, y: number, tam: number, fondo: RGB, barras: RGB) {
  const u = tam / 32;
  doc.setFillColor(...fondo).roundedRect(x, y, tam, tam, 9 * u, 9 * u, "F");
  doc.setFillColor(...barras).roundedRect(x + 7 * u, y + 7 * u, 18 * u, 5 * u, 2 * u, 2 * u, "F");
  doc.roundedRect(x + 7 * u, y + 14 * u, 12 * u, 5 * u, 2 * u, 2 * u, "F");
  doc.setFillColor(...RED).roundedRect(x + 7 * u, y + 21 * u, 18 * u, 4 * u, 2 * u, 2 * u, "F");
}

/** jsPDF guarda los anchos de Helvetica con dos cifras y mide las lineas cerca de 0,6% mas cortas de lo que salen. */
const AJUSTE_ANCHO = 0.9945;

/**
 * Escribe lineas ya cortadas con justificado.
 * jsPDF divide el sobrante entre los espacios de cada linea menos la ultima: una linea de una sola
 * palabra daria una division entre cero y una muy corta quedaria con huecos enormes, asi que esas
 * cierran su tramo y van a la izquierda.
 */
function textoJustificado(doc: Doc, lineas: string[], x: number, y: number, ancho: number, alto: number) {
  const limpias = lineas.map((l) => l.trim());
  const factor = (alto * doc.internal.scaleFactor) / doc.getFontSize();
  // Nunca menos que la linea mas larga: con menos ancho, jsPDF la volveria a partir.
  const meta = Math.max(ancho * AJUSTE_ANCHO, ...limpias.map((l) => doc.getTextWidth(l)));
  let desde = 0;
  limpias.forEach((l, i) => {
    const ultima = i === limpias.length - 1;
    const estirable = l.includes(" ") && doc.getTextWidth(l) >= ancho * 0.62;
    if (!ultima && estirable) return;
    doc.text(limpias.slice(desde, i + 1), x, y + desde * alto, { align: "justify", maxWidth: meta, lineHeightFactor: factor });
    desde = i + 1;
  });
}

/** Frases de lectura rapida, referidas solo a lo que cubre el informe. */
function frasesDeLectura(r: Resumen, filas: FilaEmpresa[], movs: Movimiento[]): string[] {
  if (r.articulos === 0) return ["Todavía no hay productos en el catálogo."];
  const out: string[] = [];
  if (r.disponibles === 0) out.push(`Ninguna de las ${entero(r.articulos)} tallas tiene stock.`);
  else out.push(`Hay stock en ${entero(r.disponibles)} de ${plural(r.articulos, "talla", "tallas")} (${r.pctDisponible}%).`);
  if (r.bajo > 0) out.push(`${plural(r.bajo, "talla está por agotarse", "tallas están por agotarse")} y conviene reponer pronto.`);
  if (r.revisar > 0)
    out.push(`${plural(r.revisar, "talla tiene", "tallas tienen")} saldo negativo porque se anotó más salida de la que había. Hay que revisar esas salidas y anular las que estén mal.`);
  const peor = [...filas].filter((f) => f.articulos > 0).sort((a, b) => a.pctDisponible - b.pctDisponible)[0];
  if (peor && peor.pctDisponible < 100 && filas.length > 1 && r.disponibles > 0)
    out.push(`${titulo(peor.empresa)} es la empresa con menos disponibilidad: ${peor.pctDisponible}% de sus tallas tiene stock.`);
  const conCantidad = movs.filter((m) => !m.anulado && m.cantidad > 0);
  if (conCantidad.length === 0) out.push("En este periodo no hubo movimientos.");
  else out.push(`El último movimiento del periodo es del ${fechaLarga(conCantidad[0].fecha)}.`);
  return out;
}

/** Fotos distintas que llevaria un informe, para avisar del peso antes de generarlo. */
export function contarFotos(datos: Datos, desde: string | null, hasta: string | null, extra: { bandeja?: FotoEnBandeja[]; conAnulados?: boolean; secciones?: SeccionesPDF } = {}): number {
  const fuera = (f: string) => (desde && f < desde) || (hasta && f > hasta);
  const rutas = new Set<string>();
  const sec = extra.secciones;
  const conTarjetas = !sec || sec.movimientos || sec.fotos;
  for (const m of movimientosDe(datos, true)) {
    if (!m.foto || fuera(m.fecha)) continue;
    if (m.anulado ? extra.conAnulados : conTarjetas || (sec?.trabajadores && m.tipo === "salida" && !suma(m))) rutas.add(m.foto);
  }
  if (!conTarjetas) return rutas.size;
  const enDatos = new Set([...datos.entradas, ...datos.salidas].flatMap((r) => (r.client_id ? [r.client_id] : [])));
  const codigos = new Set(datos.stock.map((s) => s.codigo));
  for (const p of extra.bandeja ?? []) {
    if (!p.foto || p.confirmada || fuera(p.fecha) || !codigos.has(p.codigo) || (p.clientId && enDatos.has(p.clientId))) continue;
    rutas.add(p.ruta ?? `local:${p.fotoId}`);
  }
  return rutas.size;
}

/** Cuanto mas larga la lista de fotos, mas se comprime cada una, para que el PDF siga siendo manejable. */
function calidadSegun(total: number) {
  if (total <= 60) return { lado: 900, calidad: 0.72, kb: 95 };
  if (total <= 250) return { lado: 720, calidad: 0.62, kb: 58 };
  return { lado: 600, calidad: 0.55, kb: 38 };
}

/** Peso aproximado en MB de un PDF con esa cantidad de fotos. */
export function estimarPesoMB(fotos: number): number {
  return Math.max(1, Math.round((fotos * calidadSegun(fotos).kb) / 1024));
}

export async function generarPDF(o: OpcionesPDF): Promise<ResultadoPDF> {
  const { datos, todos, empresa, secciones, usuario, desde, hasta, incluirAnulados, ventana, alProgreso } = o;
  alProgreso?.({ fase: "preparando", hechas: 0, total: 0, fallidas: 0, texto: "Preparando el informe" });
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  // Segun el empaquetador, `default` es la funcion o un objeto que la contiene.
  const crudo = autoTableMod.default as unknown;
  const autoTable = (typeof crudo === "function" ? crudo : (crudo as { default: unknown }).default) as typeof autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" }) as Doc;

  const minimo = todos.sync?.stock_minimo ?? 2;
  // Un reloj equivocado no puede fechar mal el informe.
  const ahoraMs = o.ahora ?? (await ahoraServidor());
  const ahora = enLima(ahoraMs);
  const hoy = hoyLima(ahoraMs);
  const generado = `${fechaLarga(hoy)}, ${ahora?.hora ?? ""}`;
  const codigoInforme = `INF-${hoy.replace(/-/g, "")}-${(ahora?.hora ?? "0000").replace(":", "")}`;
  const etiquetaEmpresa = empresa === "TODAS" ? "Todas las empresas" : titulo(empresa);
  const tituloInforme = o.titulo ?? nombreInforme(secciones);
  const periodo = textoPeriodo(desde, hasta);
  const enFrase = fraseDePeriodo(desde, hasta);
  const enPeriodo = (f: string) => (!desde || f >= desde) && (!hasta || f <= hasta);

  const resumen = resumir(datos.stock, minimo);
  const filasEmpresa = porEmpresa(todos.stock, minimo);
  const filasMostradas = empresa === "TODAS" ? filasEmpresa : filasEmpresa.filter((f) => f.empresa === empresa);

  // La llave local se lee de la fila original.
  type FilaOriginal = { client_id?: string | null };
  const originales = new Map<string, FilaOriginal>();
  for (const e of datos.entradas) originales.set(`e${e.id}`, e);
  for (const s of datos.salidas) originales.set(`s${s.id}`, s);
  const idsEnDatos = new Set<string>();
  for (const f of originales.values()) if (f.client_id) idsEnDatos.add(f.client_id);

  // Dos tallas pueden llamarse igual ("C/F - 30" y "S/F - 30"): la variante no se puede perder en un documento de control.
  const hermanas = new Map<string, Datos["stock"]>();
  for (const s of todos.stock) hermanas.set(`${s.empresa}||${s.producto}`, [...(hermanas.get(`${s.empresa}||${s.producto}`) ?? []), s]);
  const tallaDe = (s: Datos["stock"][number]) => nombreTallaEn(s.talla, hermanas.get(`${s.empresa}||${s.producto}`) ?? [s]);
  const porCodigo = new Map(todos.stock.map((s) => [s.codigo, s]));

  // Se lee siempre: cualquier informe tiene que decir si hay registros que todavía no están en sus cifras.
  let bandeja: FotoEnBandeja[] = [];
  let bandejaFallo = false;
  try {
    bandeja = await (o.bandeja ?? (() => leerRespaldoLocal(o.dueno)))();
  } catch (e) {
    console.error(e);
    bandejaFallo = true;
  }
  const rutaLocal = (p: FotoEnBandeja) => p.ruta ?? `local:${p.fotoId}`;
  const porClientId = new Map(bandeja.flatMap((p) => (p.clientId ? [[p.clientId, p] as const] : [])));

  const movsTodos = movimientosDe(datos, true)
    .filter((m) => enPeriodo(m.fecha))
    .map((m) => {
      // Una fila provisional llega sin foto: la foto esta en el respaldo de este equipo.
      const id = m.pendiente ? originales.get(m.key)?.client_id : null;
      const local = id ? porClientId.get(id) : undefined;
      return local ? { ...m, foto: rutaLocal(local) } : m;
    });
  const movs = movsTodos.filter((m) => !m.anulado);
  const anulados = movsTodos.filter((m) => m.anulado);
  const noSuman = movs.filter((m) => !suma(m));
  const tot = sumaMovs(movs);
  const tardios = movimientosTardios(movimientosDe(datos, false), desde, o.tardeDesde);

  // Lo que sigue en este equipo y no esta en los datos del informe va aparte: todavia no cuenta en el stock.
  // Lo ya confirmado solo aporta su copia local, que evita bajar la foto (y sirve sin conexion).
  const locales = new Map(bandeja.flatMap((p) => (p.foto ? [[rutaLocal(p), p.foto] as const] : [])));
  const codigos = empresa === "TODAS" ? null : new Set(datos.stock.map((s) => s.codigo));
  const enServidor = new Set(movs.flatMap((m) => (m.foto ? [m.foto] : [])));
  const rechazadas = new Set<string>();
  const esperanServidor = new Set<string>();
  // Una misma foto puede servir a varios registros: lo que identifica a una línea es su clientId.
  const yaEnServidor = (p: FotoEnBandeja) => (p.clientId ? idsEnDatos.has(p.clientId) : p.foto !== null && enServidor.has(rutaLocal(p)));
  const sinSubir = bandeja.filter((p) => !p.confirmada && !yaEnServidor(p) && (!codigos || codigos.has(p.codigo)));
  const registrosSinSubir = new Set(sinSubir.map((p) => p.fotoId)).size;
  const pendientes: Movimiento[] = sinSubir
    .filter((p) => enPeriodo(p.fecha))
    .map((p) => {
      if (p.estado === "rechazado") rechazadas.add(`p${p.id}`);
      if (p.estado === "sin_migracion") esperanServidor.add(`p${p.id}`);
      return {
        key: `p${p.id}`,
        id: 0,
        tipo: p.tipo,
        fecha: p.fecha,
        codigo: p.codigo,
        producto: p.producto,
        cantidad: p.cantidad,
        persona: p.persona,
        area: p.area,
        nota: p.nota,
        anulado: false,
        motivo: null,
        anuladoPor: null,
        registradoPor: p.registradoPor,
        // Las tarjetas se ordenan por la hora de la foto, no por cuándo se pulsó Guardar.
        creado: p.capturadoEn ?? p.creado,
        capturado: p.capturadoEn,
        origenHora: p.origenHora ?? null,
        foto: p.foto ? rutaLocal(p) : null,
        etiqueta: null,
        cambioRef: null,
        revisar: p.revision ?? null,
        pendiente: true,
      };
    });

  // Todas las fotos se cargan antes de armar el PDF. La lista cubre cada tabla que dibuja miniaturas, no solo la sección de fotos.
  const conMiniatura = [
    ...(secciones.movimientos || secciones.fotos ? [...movs, ...pendientes] : []),
    ...(secciones.trabajadores ? noSuman.filter((m) => m.tipo === "salida") : []),
    ...tardios,
    ...(incluirAnulados ? anulados : []),
  ];
  const rutas = Array.from(new Set(conMiniatura.flatMap((m) => (m.foto ? [m.foto] : []))));
  const cargas = await cargarFotos(rutas, locales, alProgreso);
  const fallidas = Array.from(cargas.values()).filter((c) => !c.ok).length;
  alProgreso?.({ fase: "armando", hechas: rutas.length, total: rutas.length, fallidas, texto: "Armando el PDF" });
  await new Promise((ok) => setTimeout(ok)); // deja que la pantalla muestre el aviso

  let y = 0;
  let nSeccion = 0;
  const finalY = () => doc.lastAutoTable?.finalY ?? y;
  const asegurar = (alto: number) => {
    if (y + alto > BASE) {
      doc.addPage();
      y = TOPE;
    }
  };
  const partir = (texto: string, ancho: number) => doc.splitTextToSize(t(texto).replace(/\s+/g, " ").trim(), ancho * AJUSTE_ANCHO) as string[];

  /** Parrafo justificado en la posicion actual. Si no cabe entero, pasa a la pagina siguiente. */
  const parrafo = (texto: string, op: { x?: number; ancho?: number; tam?: number; color?: RGB; alto?: number } = {}) => {
    const { x = ML, ancho = UTIL, tam = 8.8, color = INK, alto = 4.4 } = op;
    doc.setFont("helvetica", "normal").setFontSize(tam);
    const lineas = partir(texto, ancho);
    asegurar(lineas.length * alto + 1);
    doc.setFont("helvetica", "normal").setFontSize(tam).setTextColor(...color);
    textoJustificado(doc, lineas, x, y, ancho, alto);
    y += lineas.length * alto;
  };

  const tituloSeccion = (texto: string, nota?: string, numerada = true) => {
    doc.setFont("helvetica", "normal").setFontSize(8.5);
    const lineas = nota ? partir(nota, UTIL - 4.5) : [];
    asegurar(24 + lineas.length * 4);
    if (numerada) nSeccion++;
    doc.setFillColor(...RED).rect(ML, y - 4.4, 1.6, 6.6, "F");
    doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(13);
    doc.text(t(numerada ? `${nSeccion}. ${texto}` : texto), ML + 4.5, y);
    y += 2;
    if (nota) {
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED);
      textoJustificado(doc, lineas, ML + 4.5, y + 3.2, UTIL - 4.5, 4);
      y += 1 + lineas.length * 4;
    }
    y += 5;
  };

  const subtitulo = (texto: string, derecha?: string) => {
    asegurar(26);
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK);
    doc.text(t(texto), ML, y);
    if (derecha) {
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
      doc.text(t(derecha), ANCHO - ML, y, { align: "right" });
    }
    y += 3;
  };

  const vacio = (texto: string) => {
    asegurar(14);
    doc.setFont("helvetica", "normal").setFontSize(8.8).setTextColor(...MUTED);
    doc.setFillColor(...GROUND).roundedRect(ML, y, UTIL, 10, 2, 2, "F");
    doc.text(t(texto), ML + 4, y + 6.2);
    y += 16;
  };

  const dibujarFoto = (carga: Extract<CargaFoto, { ok: true }>, ruta: string, x: number, yy: number, w: number, h: number) => {
    const k = Math.min(w / carga.w, h / carga.h);
    const iw = carga.w * k;
    const ih = carga.h * k;
    // Con el alias, una foto repetida se guarda una sola vez dentro del PDF.
    doc.addImage(carga.data, "JPEG", x + (w - iw) / 2, yy + (h - ih) / 2, iw, ih, ruta);
  };

  type OpcionesTabla = Parameters<typeof autoTable>[1] & {
    /** Columnas de texto largo: cuando ocupan varias lineas van justificadas. */
    justificar?: number[];
    /** Columna donde va la miniatura de la foto de cada fila. */
    miniaturas?: { columna: number; filas: Movimiento[] };
  };

  const tabla = ({ justificar = [], miniaturas, didParseCell, willDrawCell, didDrawCell, ...opts }: OpcionesTabla) => {
    const porJustificar = new WeakMap<object, string[]>();
    autoTable(doc, {
      startY: y,
      margin: { top: TOPE, left: ML, right: ML, bottom: 18 },
      theme: "striped",
      styles: { font: "helvetica", fontSize: 7.8, cellPadding: 1.8, textColor: INK, lineColor: LINE, lineWidth: 0 },
      headStyles: { fillColor: INK, textColor: 255, fontSize: 7.4, fontStyle: "bold", halign: "left" },
      alternateRowStyles: { fillColor: [247, 248, 249] },
      footStyles: { fillColor: GROUND, textColor: INK, fontStyle: "bold", fontSize: 8 },
      showFoot: "lastPage",
      ...opts,
      rowPageBreak: miniaturas ? "avoid" : opts.rowPageBreak,
      didParseCell: (d) => {
        didParseCell?.(d);
        if (miniaturas && d.section === "body" && d.column.index === miniaturas.columna && miniaturas.filas[d.row.index]?.foto) d.cell.styles.minCellHeight = 17;
      },
      willDrawCell: (d) => {
        if (willDrawCell?.(d) === false) return false;
        // autoTable divide entre cero con lineas de una palabra: el texto se escribe despues, con textoJustificado.
        if (d.section === "body" && justificar.includes(d.column.index) && d.cell.text.length > 1) {
          porJustificar.set(d.cell, d.cell.text);
          d.cell.text = [""];
        }
      },
      didDrawCell: (d) => {
        didDrawCell?.(d);
        const c = d.cell;
        const lineas = porJustificar.get(c);
        if (lineas) {
          const fuente = doc.getFontSize() / doc.internal.scaleFactor;
          // autoTable corta con un punto de holgura; con menos ancho, jsPDF volveria a partir la linea.
          const ancho = c.width - c.padding("horizontal") + 1 / doc.internal.scaleFactor;
          textoJustificado(doc, lineas, c.x + c.padding("left"), c.y + c.padding("top") + fuente * 0.85, ancho, fuente * doc.getLineHeightFactor());
        }
        if (!miniaturas || d.section !== "body" || d.column.index !== miniaturas.columna) return;
        const ruta = miniaturas.filas[d.row.index]?.foto;
        if (!ruta) return;
        const carga = cargas.get(ruta);
        if (carga?.ok) {
          dibujarFoto(carga, ruta, c.x + 1, c.y + 1, c.width - 2, c.height - 2);
        } else {
          const cx = c.x + c.width / 2;
          doc.setDrawColor(...RED).setLineWidth(0.25).rect(c.x + 1, c.y + 1, c.width - 2, c.height - 2, "S");
          doc.setFont("helvetica", "bold").setFontSize(6).setTextColor(...RED);
          doc.text("No cargó", cx, c.y + c.height / 2 - 0.6, { align: "center" });
          doc.setFont("helvetica", "normal").setFontSize(5.6);
          doc.text(t(carga?.corto ?? "Sin datos"), cx, c.y + c.height / 2 + 2, { align: "center" });
        }
      },
    });
    y = finalY() + 8;
  };

  /** "NOMBRE  ·  Talla M" -> "Nombre - Talla M" */
  const nombreMov = (snapshot: string, codigo: string) => {
    const p = partirMovimiento(snapshot);
    const fila = porCodigo.get(codigo);
    const variante = (fila ? tallaDe(fila).match(/ ([CS]\/F)$/)?.[1] : p.talla.match(/^([CS]\/F)\b/i)?.[1]?.toUpperCase()) ?? "";
    return `${nombreProducto(p.nombre, fila?.empresa)}${p.talla ? ` - ${etiquetaTalla(p.talla)}${variante ? ` ${variante}` : ""}` : ""}`;
  };
  const nombreCorto = (s: string | null) => t(titulo((s ?? "").split("@")[0].replace(/[._]+/g, " ")));
  const celdaFoto = (m: Movimiento) => (m.foto ? "" : "-");
  const celdaRegistro = (m: Movimiento) => `${nombreCorto(m.registradoPor)}${m.pendiente ? " (sin sincronizar)" : ""}`;

  /** Filas que no entran en los totales pero tampoco deben perderse de vista. */
  const tablaNoSuman = (filas: Movimiento[]) => {
    const cambios = filas.filter((m) => m.etiqueta).length;
    subtitulo(`Registros fuera de los totales (${entero(filas.length)})`);
    y += 2;
    const partes = [
      cambios > 0 ? "Un cambio de prenda anota una entrada y una salida a la vez, por eso no se cuenta como compra ni como entrega." : "",
      filas.length > cambios ? "Los registros con cantidad cero tampoco suman." : "",
    ];
    parrafo(partes.filter(Boolean).join(" "), { tam: 8.2, color: MUTED, alto: 4 });
    y += 2;
    tabla({
      head: [["Fecha", "Tipo", "Producto", "Código", "Cant.", "Persona o nota", "Foto"]],
      body: filas.map((m) => [
        fechaLarga(m.fecha),
        m.etiqueta ? "Cambio" : m.tipo === "entrada" ? "Entrada" : "Salida",
        t(nombreMov(m.producto, m.codigo)),
        m.codigo,
        String(m.cantidad),
        t(m.persona ? titulo(m.persona) : m.nota),
        celdaFoto(m),
      ]),
      columnStyles: { 0: { cellWidth: 21 }, 4: { halign: "right" }, 6: { cellWidth: 18 } },
      justificar: [2, 5],
      miniaturas: { columna: 6, filas },
    });
  };

  // ================================================================ PORTADA
  doc.setFillColor(...INK).rect(0, 0, ANCHO, 54, "F");
  doc.setFillColor(...RED).rect(0, 54, ANCHO, 1.4, "F");
  marca(doc, ML, 14, 15, [255, 255, 255], INK);
  doc.setTextColor(170, 174, 182).setFont("helvetica", "bold").setFontSize(7.5);
  doc.text("FUNDIGSAC  -  CONTROL DE STOCK", ML + 20, 20, { charSpace: 0.5 });
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(23);
  doc.text(t(tituloInforme), ML + 20, 31);
  doc.setFont("helvetica", "normal").setFontSize(10.5).setTextColor(210, 212, 216);
  doc.text(t(`EPP y uniformes  -  ${etiquetaEmpresa}`), ML + 20, 39);
  doc.setFontSize(8).setTextColor(150, 154, 162);
  doc.text(codigoInforme, ANCHO - ML, 20, { align: "right" });

  // Datos del informe
  const meta: [string, string][] = [
    ["EMPRESA", etiquetaEmpresa],
    ["PERIODO", periodo],
    ["GENERADO", generado],
    ["ELABORADO POR", nombreCorto(usuario) || "-"],
  ];
  const colW = UTIL / 4;
  meta.forEach(([k, v], i) => {
    const x = ML + i * colW;
    doc.setTextColor(...FAINT).setFont("helvetica", "bold").setFontSize(6.5);
    doc.text(k, x, 66, { charSpace: 0.4 });
    doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(8.6);
    const lineas = doc.splitTextToSize(t(v), colW - 4) as string[];
    doc.text(lineas.slice(0, 2), x, 71.5);
  });
  doc.setDrawColor(...LINE).setLineWidth(0.25).line(ML, 80, ANCHO - ML, 80);
  y = 94;

  // Las cifras vienen del servidor. Si este equipo tiene registros que aún no llegan, el documento lo dice en la primera hoja.
  const avisoCola = bandejaFallo
    ? "No se pudo leer lo guardado en este equipo: puede haber registros sin subir que las cifras de este informe no incluyen."
    : registrosSinSubir > 0
      ? `${registrosSinSubir === 1 ? "Hay 1 registro guardado en este equipo que todavía no llega" : `Hay ${entero(registrosSinSubir)} registros guardados en este equipo que todavía no llegan`} al servidor. Las cifras de este informe no ${registrosSinSubir === 1 ? "lo incluyen" : "los incluyen"}.`
      : null;
  if (avisoCola) {
    doc.setFont("helvetica", "bold").setFontSize(8.8);
    const lineas = partir(avisoCola, UTIL - 8);
    const alto = lineas.length * 4.4 + 5;
    doc.setFillColor(251, 240, 219).roundedRect(ML, 85, UTIL, alto, 2, 2, "F");
    doc.setFont("helvetica", "bold").setFontSize(8.8).setTextColor(...WARN);
    textoJustificado(doc, lineas, ML + 4, 90, UTIL - 8, 4.4);
    y = 85 + alto + 12;
  }

  // ================================================================ RESUMEN
  if (secciones.resumen) {
    tituloSeccion("Resumen", `Así está el almacén al ${fechaLarga(hoy)}. Las entradas y salidas son ${enFrase}.`);

    const caja = (x: number, w: number, c: { etiqueta: string; valor: string; nota: string; color?: RGB }) => {
      doc.setFillColor(...GROUND).roundedRect(x, y, w, 24, 2.5, 2.5, "F");
      doc.setTextColor(...MUTED).setFont("helvetica", "bold").setFontSize(6.5);
      doc.text(t(c.etiqueta), x + 3.5, y + 6, { charSpace: 0.3 });
      doc.setTextColor(...(c.color ?? INK)).setFontSize(19);
      doc.text(c.valor, x + 3.5, y + 15.5);
      doc.setTextColor(...MUTED).setFont("helvetica", "normal").setFontSize(7);
      doc.text(t(c.nota), x + 3.5, y + 21);
    };
    const gap = 3;
    const w4 = (UTIL - gap * 3) / 4;
    [
      { etiqueta: "UNIDADES EN ALMACÉN", valor: entero(resumen.unidades), nota: `${plural(resumen.disponibles, "talla", "tallas")} con stock` },
      { etiqueta: "SIN STOCK", valor: entero(resumen.sin), nota: `de ${plural(resumen.articulos, "talla", "tallas")}` },
      { etiqueta: "POR AGOTARSE", valor: entero(resumen.bajo), nota: `quedan ${minimo} o menos`, color: resumen.bajo ? WARN : undefined },
      { etiqueta: "SALDO NEGATIVO", valor: entero(resumen.revisar), nota: "hay que revisarlas", color: resumen.revisar ? RED : undefined },
    ].forEach((c, i) => caja(ML + i * (w4 + gap), w4, c));
    y += 28;

    const nEnt = movs.filter((m) => suma(m) && m.tipo === "entrada").length;
    const nSal = movs.filter((m) => suma(m) && m.tipo === "salida").length;
    const w3 = (UTIL - gap * 2) / 3;
    [
      { etiqueta: "ENTRADAS DEL PERIODO", valor: `+${entero(tot.entradas)}`, nota: plural(nEnt, "registro", "registros") },
      { etiqueta: "SALIDAS DEL PERIODO", valor: tot.salidas ? `-${entero(tot.salidas)}` : "0", nota: plural(nSal, "registro", "registros"), color: tot.salidas ? RED : undefined },
      {
        etiqueta: "BALANCE",
        valor: `${tot.neto > 0 ? "+" : tot.neto < 0 ? "-" : ""}${entero(Math.abs(tot.neto))}`,
        nota: tot.neto > 0 ? "entró más de lo que salió" : tot.neto < 0 ? "salió más de lo que entró" : "entró lo mismo que salió",
      },
    ].forEach((c, i) => caja(ML + i * (w3 + gap), w3, c));
    y += 33;

    // Barra de disponibilidad
    doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(9);
    doc.text(`El ${resumen.pctDisponible}% de las tallas tiene stock`, ML, y);
    y += 3;
    const total = Math.max(1, resumen.articulos);
    let bx = ML;
    const segs: [number, RGB][] = [
      [resumen.ok, OK],
      [resumen.bajo, WARN],
      [resumen.sin, [200, 203, 209]],
      [resumen.revisar, RED],
    ];
    for (const [n, color] of segs) {
      if (n <= 0) continue;
      const sw = (n / total) * UTIL;
      doc.setFillColor(...color).rect(bx, y, sw, 4, "F");
      bx += sw;
    }
    y += 9;
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(
      t(`Con stock ${resumen.ok}   |   Por agotarse ${resumen.bajo}   |   Sin stock ${resumen.sin}${resumen.revisar ? `   |   Saldo negativo ${resumen.revisar}` : ""}`),
      ML,
      y,
    );
    y += 9;

    // Lectura rapida
    doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(9);
    doc.text("Qué mirar primero", ML, y);
    y += 5;
    for (const f of frasesDeLectura(resumen, filasMostradas, movs)) {
      doc.setFont("helvetica", "normal").setFontSize(8.8);
      asegurar(partir(f, UTIL - 4).length * 4.4 + 2);
      doc.setFillColor(...RED).circle(ML + 1, y - 1, 0.7, "F");
      parrafo(f, { x: ML + 4, ancho: UTIL - 4 });
      y += 1;
    }
    y += 5;

    // Por empresa
    subtitulo("Stock por empresa");
    const sum = (f: (x: (typeof filasMostradas)[number]) => number) => filasMostradas.reduce((a, x) => a + f(x), 0);
    const totArt = sum((x) => x.articulos);
    const totDisp = sum((x) => x.disponibles);
    tabla({
      head: [["Empresa", "Tallas", "Con stock", "Por agotarse", "Sin stock", "Saldo neg.", "Unidades", "% disp."]],
      body: filasMostradas.map((f) => [titulo(f.empresa), entero(f.articulos), entero(f.ok), entero(f.bajo), entero(f.sin), entero(f.revisar), entero(f.unidades), `${f.pctDisponible}%`]),
      foot: [["Total", entero(totArt), entero(sum((x) => x.ok)), entero(sum((x) => x.bajo)), entero(sum((x) => x.sin)), entero(sum((x) => x.revisar)), entero(sum((x) => x.unidades)), `${porcentaje(totDisp, totArt)}%`]],
      columnStyles: { 0: { cellWidth: 44, fontStyle: "bold" }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right", fontStyle: "bold" }, 7: { halign: "right" } },
      justificar: [0],
      didParseCell: (d) => {
        if (d.section === "foot" && d.column.index > 0) d.cell.styles.halign = "right";
      },
    });

    // Grafico del periodo: el texto suma exactamente las barras que se ven.
    const { serie, recortada } = serieRango(movs, desde, hasta, hoy);
    const enBarras = serie.reduce((a, d) => ({ e: a.e + d.entradas, s: a.s + d.salidas }), { e: 0, s: 0 });
    asegurar(66);
    subtitulo(recortada ? `Movimiento por día (últimos ${serie.length} días)` : `Movimiento por día (${serie.length} ${serie.length === 1 ? "día" : "días"})`, `En estos días: entradas ${entero(enBarras.e)}   |   salidas ${entero(enBarras.s)}`);
    dibujarSerie(doc, serie, ML, y + 1, UTIL, 38);
    y += 38 + 6;
    doc.setFont("helvetica", "normal").setFontSize(7.2).setTextColor(...MUTED);
    doc.text("Barras negras: entradas. Barras rojas: salidas.", ML, y);
    y += 9;
  }

  // ================================================================ STOCK
  if (secciones.stock) {
    const alertas = datos.stock
      .filter((s) => ["bajo", "revisar"].includes(estadoDe(s.queda, minimo)))
      .sort((a, b) => a.queda - b.queda || a.producto.localeCompare(b.producto, "es"));

    tituloSeccion("Stock actual", `Datos al ${fechaLarga(hoy)}. Queda es lo que había al inicio, más lo que entró, menos lo que salió. Los movimientos anulados no cuentan.`);

    if (alertas.length > 0) {
      subtitulo("Necesita atención", `${plural(alertas.length, "talla", "tallas")} por agotarse o con saldo negativo`);
      tabla({
        head: [["Empresa", "Producto", "Talla", "Código", "Queda", "Estado"]],
        body: alertas.map((s) => [titulo(s.empresa), t(nombreProducto(s.producto, s.empresa)), t(tallaDe(s)), s.codigo, String(s.queda), ESTADO_TEXTO[estadoDe(s.queda, minimo)]]),
        columnStyles: { 4: { halign: "right", fontStyle: "bold" } },
        justificar: [0, 1],
        didParseCell: (d) => {
          if (d.section === "body" && d.column.index === 5) {
            d.cell.styles.textColor = COLOR_ESTADO[estadoDe(alertas[d.row.index].queda, minimo)];
            d.cell.styles.fontStyle = "bold";
          }
        },
      });
    }

    const empresas = Array.from(new Set(datos.stock.map((s) => s.empresa))).sort((a, b) => a.localeCompare(b, "es"));
    for (const emp of empresas) {
      const filas = datos.stock
        .filter((s) => s.empresa === emp)
        .sort((a, b) => a.producto.localeCompare(b.producto, "es") || rangoTalla(a.talla) - rangoTalla(b.talla));
      const r = resumir(filas, minimo);
      // Mismo total que en pantalla: las tallas con saldo negativo no restan y se avisan aparte.
      const aRevisar = r.revisar > 0 ? ` + ${entero(r.revisar)} a revisar` : "";
      // El total de "Queda" tiene que cuadrar con Inicio + Entró - Salió, así que lleva los negativos; lo disponible se dice aparte.
      const neto = filas.reduce((a, s) => a + s.queda, 0);
      const enNegativo = filas.reduce((a, s) => a + Math.max(0, -s.queda), 0);
      const notaNegativo = enNegativo > 0 ? `. Disponibles: ${entero(r.unidades)}; ${entero(enNegativo)} en saldo negativo` : "";
      subtitulo(titulo(emp), `${plural(r.unidades, "unidad", "unidades")}${aRevisar}  -  ${entero(r.sin)} sin stock  -  ${entero(r.bajo)} por agotarse`);
      const suma = (c: "tenia_al_inicio" | "entro" | "salio") => filas.reduce((a, s) => a + s[c], 0);
      tabla({
        head: [["Producto", "Talla", "Código", "Inicio", "Entró", "Salió", "Queda", "Estado", "Últ. mov."]],
        body: filas.map((s) => [
          t(nombreProducto(s.producto, s.empresa)),
          t(tallaDe(s)),
          s.codigo,
          String(s.tenia_al_inicio),
          String(s.entro),
          String(s.salio),
          String(s.queda),
          ESTADO_TEXTO[estadoDe(s.queda, minimo)],
          s.ultimo_movimiento ? fechaLarga(s.ultimo_movimiento) : "-",
        ]),
        foot: [[{ content: `Total ${t(titulo(emp))}${notaNegativo}`, colSpan: 3 }, entero(suma("tenia_al_inicio")), entero(suma("entro")), entero(suma("salio")), entero(neto), "", ""]],
        justificar: [0],
        styles: { font: "helvetica", fontSize: 7.3, cellPadding: 1.5, textColor: INK, lineWidth: 0 },
        columnStyles: {
          0: { cellWidth: 54 },
          8: { cellWidth: 22 },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
          6: { halign: "right", fontStyle: "bold" },
        },
        didParseCell: (d) => {
          if (d.section === "body" && d.column.index === 7) {
            d.cell.styles.textColor = COLOR_ESTADO[estadoDe(filas[d.row.index].queda, minimo)];
            d.cell.styles.fontStyle = "bold";
          }
          if (d.section === "foot" && [3, 4, 5, 6].includes(d.column.index)) d.cell.styles.halign = "right";
        },
      });
    }
  }

  // ================================================================ TARJETAS DE FOTOS
  const FOTO_W = 66;
  const FOTO_H = 44.5;
  const ALTO_MIN = 48.5;
  const ITEMS_POR_TARJETA = 24;
  type Tarjeta = { ruta: string; items: Movimiento[]; pendiente: boolean; parte: number; partes: number };

  /** Una tarjeta por foto y persona: una foto compartida entre varios trabajadores sale para cada uno. */
  const armarTarjetas = (lista: Movimiento[], pendiente: boolean): Tarjeta[] => {
    const grupos = new Map<string, { ruta: string; items: Movimiento[] }>();
    for (const m of lista) {
      if (!m.foto) continue;
      const k = `${m.foto}||${m.persona ?? ""}`;
      const g = grupos.get(k);
      if (g) g.items.push(m);
      else grupos.set(k, { ruta: m.foto, items: [m] });
    }
    const ordenados = Array.from(grupos.values()).sort((a, b) => b.items[0].fecha.localeCompare(a.items[0].fecha) || Date.parse(b.items[0].creado) - Date.parse(a.items[0].creado));
    return ordenados.flatMap((g) => {
      const partes = Math.ceil(g.items.length / ITEMS_POR_TARJETA);
      return Array.from({ length: partes }, (_, i) => ({ ruta: g.ruta, items: g.items.slice(i * ITEMS_POR_TARJETA, (i + 1) * ITEMS_POR_TARJETA), pendiente: pendiente || Boolean(g.items[0].pendiente), parte: i + 1, partes }));
    });
  };

  const textoCaptura = (m: Movimiento) => {
    const foto = enLima(m.capturado);
    // Solo la cámara y el EXIF dicen cuándo se tomó. La fecha de un archivo es la de la copia que llegó al teléfono.
    if (foto && m.origenHora === "archivo") return `Fecha del archivo: ${fechaLarga(foto.fecha)}, ${foto.hora}`;
    if (foto && m.origenHora === "ahora") return `Elegida: ${fechaLarga(foto.fecha)}, ${foto.hora} (la foto no traía fecha)`;
    if (foto && m.origenHora === "registro") return `Registrada: ${fechaLarga(foto.fecha)}, ${foto.hora}`;
    if (foto) return `Foto tomada: ${fechaLarga(foto.fecha)}, ${foto.hora}`;
    const registro = enLima(m.creado);
    if (registro) return `Registrada: ${fechaLarga(registro.fecha)}, ${registro.hora} (no se guardó la hora de la foto)`;
    return `Movimiento del ${fechaLarga(m.fecha)}`;
  };

  const dibujarTarjeta = (tar: Tarjeta, n: number, total: number) => {
    const p = tar.items[0];
    const esSalida = p.tipo === "salida";
    const tx = ML + FOTO_W + 6;
    const tw = ANCHO - ML - 3 - tx;
    const quien = t(titulo(p.persona ?? "")) || (esSalida ? "Sin nombre" : "Mercadería recibida");
    const encabezado = tar.partes > 1 ? `${quien} (parte ${tar.parte} de ${tar.partes})` : quien;

    // Primero se mide, para que la tarjeta no quede partida entre dos paginas.
    doc.setFont("helvetica", "bold").setFontSize(10);
    const lineasQuien = doc.splitTextToSize(encabezado, tw) as string[];
    doc.setFont("helvetica", "bold").setFontSize(8);
    // El código identifica la prenda exacta: el nombre solo no distingue todas las variantes.
    const bloquesItems = tar.items.map((m) => doc.splitTextToSize(t(`${m.cantidad} x ${nombreMov(m.producto, m.codigo)} (${m.codigo})`), tw * AJUSTE_ANCHO) as string[]);
    const lineasItems = bloquesItems.flat();
    doc.setFont("helvetica", "normal").setFontSize(7.4);
    const notas = Array.from(new Set(tar.items.flatMap((m) => [(m.nota ?? "").trim(), m.revisar ? `Por revisar: ${m.revisar}` : ""]).filter(Boolean))).join(" ");
    const MAX_NOTA = 12;
    const todasNota = notas ? partir(`Nota: ${notas}`, tw) : [];
    const lineasNota = todasNota.length > MAX_NOTA ? [...todasNota.slice(0, MAX_NOTA - 1), `${todasNota[MAX_NOTA - 1].replace(/\s*\S+$/, "")}...`] : todasNota;
    // Un nombre o un área largos no se salen de la tarjeta: estas líneas también se cortan y cuentan en el alto.
    doc.setFont("helvetica", "normal").setFontSize(7.6);
    const lineasArea = p.area ? partir(`Área: ${titulo(p.area)}`, tw) : [];
    const lineasRegistro = partir(`Movimiento del ${fechaLarga(p.fecha)}  -  Registró: ${nombreCorto(p.registradoPor) || "sin dato"}`, tw);
    doc.setFont("helvetica", "bold").setFontSize(7.6);
    const lineasCaptura = partir(textoCaptura(p), tw);
    const altoTexto = 6.5 + lineasQuien.length * 4.6 + lineasArea.length * 4 + lineasCaptura.length * 4.2 + lineasRegistro.length * 4.2 + 1.4 + lineasItems.length * 3.8 + (lineasNota.length ? 1.2 + lineasNota.length * 3.3 : 0) + 2.5;
    const alto = Math.max(ALTO_MIN, altoTexto);
    asegurar(alto + 2.5);

    doc.setDrawColor(...LINE).setLineWidth(0.25).roundedRect(ML, y, UTIL, alto, 2, 2, "S");

    // Foto, o un recuadro con el motivo si no cargo.
    const fx = ML + 2;
    const fy = y + 2;
    const carga = cargas.get(tar.ruta);
    if (carga?.ok) {
      doc.setFillColor(...GROUND).roundedRect(fx, fy, FOTO_W, FOTO_H, 1.6, 1.6, "F");
      dibujarFoto(carga, tar.ruta, fx, fy, FOTO_W, FOTO_H);
    } else {
      const cx = fx + FOTO_W / 2;
      doc.setDrawColor(...RED).setLineWidth(0.35);
      doc.setLineDashPattern([1.2, 1], 0);
      doc.roundedRect(fx, fy, FOTO_W, FOTO_H, 1.6, 1.6, "S");
      doc.setLineDashPattern([], 0);
      doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...RED);
      doc.text("Foto no disponible", cx, fy + FOTO_H / 2 - 3, { align: "center" });
      doc.setFont("helvetica", "normal").setFontSize(7.2).setTextColor(...INK);
      doc.text(doc.splitTextToSize(t(carga?.motivo ?? "No se intentó cargar esta foto."), FOTO_W - 8) as string[], cx, fy + FOTO_H / 2 + 1.5, { align: "center" });
    }

    // Datos del movimiento, al lado de la foto.
    let ty = y + 6;
    const etiqueta = esSalida ? "SALIDA" : "ENTRADA";
    const wEtiqueta = esSalida ? 13 : 14.5;
    doc.setFillColor(...(esSalida ? RED : INK)).roundedRect(tx, ty - 3.3, wEtiqueta, 4.6, 1, 1, "F");
    doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(6.3);
    doc.text(etiqueta, tx + wEtiqueta / 2, ty - 0.1, { align: "center" });
    if (tar.pendiente) {
      const rechazada = rechazadas.has(p.key);
      doc.setFillColor(...(rechazada ? RED : WARN)).roundedRect(tx + wEtiqueta + 2, ty - 3.3, 25, 4.6, 1, 1, "F");
      doc.setTextColor(255, 255, 255);
      doc.text(rechazada ? "RECHAZADO" : "SIN SINCRONIZAR", tx + wEtiqueta + 14.5, ty - 0.1, { align: "center" });
    }
    doc.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...MUTED);
    doc.text(`Evidencia ${entero(n)} de ${entero(total)}`, ANCHO - ML - 3, ty, { align: "right" });
    ty += 5.5;

    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK);
    doc.text(lineasQuien, tx, ty, { lineHeightFactor: (4.6 * doc.internal.scaleFactor) / 10 });
    ty += lineasQuien.length * 4.6 - 0.4;
    doc.setFont("helvetica", "normal").setFontSize(7.6).setTextColor(...MUTED);
    if (lineasArea.length > 0) {
      textoJustificado(doc, lineasArea, tx, ty, tw, 4);
      ty += lineasArea.length * 4;
    }
    doc.setFont("helvetica", "bold").setTextColor(...INK);
    textoJustificado(doc, lineasCaptura, tx, ty, tw, 4.2);
    ty += lineasCaptura.length * 4.2;
    doc.setFont("helvetica", "normal").setTextColor(...MUTED);
    textoJustificado(doc, lineasRegistro, tx, ty, tw, 4.2);
    ty += lineasRegistro.length * 4.2 + 1;

    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...INK);
    for (const bloque of bloquesItems) {
      textoJustificado(doc, bloque, tx, ty, tw, 3.8);
      ty += bloque.length * 3.8;
    }
    if (lineasNota.length > 0) {
      ty += 0.2;
      doc.setFont("helvetica", "normal").setFontSize(7.4).setTextColor(...MUTED);
      textoJustificado(doc, lineasNota, tx, ty, tw, 3.3);
    }
    y += alto + 2.5;
  };

  const seccionPendientes = () => {
    if (bandejaFallo) {
      parrafo("No se pudo leer lo guardado en este equipo, así que aquí pueden faltar registros que aún no se enviaron.", { color: RED });
      y += 4;
    }
    const bloque = (lista: Movimiento[], encabezado: string, texto: string) => {
      if (lista.length === 0) return;
      subtitulo(`${encabezado} (${entero(lista.length)})`);
      y += 2;
      parrafo(texto, { tam: 8.2, color: MUTED, alto: 4 });
      y += 3;
      const tarjetas = armarTarjetas(lista, true);
      tarjetas.forEach((c, i) => dibujarTarjeta(c, i + 1, tarjetas.length));
      const sinFoto = lista.filter((m) => !m.foto);
      if (sinFoto.length > 0) {
        tabla({
          head: [["Fecha", "Tipo", "Producto", "Código", "Cant.", "Persona o nota", "Registró"]],
          body: sinFoto.map((m) => [fechaLarga(m.fecha), m.tipo === "entrada" ? "Entrada" : "Salida", t(nombreMov(m.producto, m.codigo)), m.codigo, `${m.tipo === "entrada" ? "+" : "-"}${m.cantidad}`, t(m.persona ? titulo(m.persona) : m.nota), nombreCorto(m.registradoPor)]),
          columnStyles: { 0: { cellWidth: 21 }, 4: { halign: "right", fontStyle: "bold" } },
          justificar: [2, 5],
        });
      }
      y += 4;
    };
    const porSubir = pendientes.filter((m) => !rechazadas.has(m.key));
    const esperan = porSubir.filter((m) => esperanServidor.has(m.key)).length;
    const comoSigue = esperan === 0 ? "Se enviarán solos en cuanto este equipo pueda subirlos." : esperan === porSubir.length ? "Esperan una actualización del servidor y se enviarán solos cuando esté lista." : "Algunos esperan una actualización del servidor. Los demás se enviarán solos en cuanto este equipo pueda subirlos.";
    bloque(porSubir, "En este equipo, sin sincronizar", `Estos registros se guardaron en este equipo y todavía no llegan al servidor, así que no suman en el stock ni en los totales de este informe. ${comoSigue}`);
    bloque(pendientes.filter((m) => rechazadas.has(m.key)), "En este equipo, rechazados por el servidor", "El servidor no aceptó estos registros, así que no suman en el stock ni en los totales. No se envían solos: hay que revisarlos en Respaldo.");
  };

  // ================================================================ MOVIMIENTOS
  if (secciones.movimientos) {
    const ent = movs.filter((m) => suma(m) && m.tipo === "entrada");
    const sal = movs.filter((m) => suma(m) && m.tipo === "salida");
    const balance = tot.neto > 0 ? `El almacén ganó ${plural(tot.neto, "unidad", "unidades")}.` : tot.neto < 0 ? `El almacén perdió ${plural(-tot.neto, "unidad", "unidades")}.` : "Entró lo mismo que salió.";
    tituloSeccion("Movimientos del periodo", `Entraron ${entero(tot.entradas)} y salieron ${plural(tot.salidas, "unidad", "unidades")} ${enFrase}. ${balance}`);

    subtitulo(`Entradas (${entero(ent.length)})`, `Total +${entero(tot.entradas)} unidades`);
    if (ent.length === 0) vacio("No se registraron entradas en este periodo.");
    else {
      tabla({
        head: [["Fecha", "Producto", "Código", "Cant.", "Proveedor o nota", "Registró", "Foto"]],
        body: ent.map((m) => [fechaLarga(m.fecha), t(nombreMov(m.producto, m.codigo)), m.codigo, `+${m.cantidad}`, t(m.nota), celdaRegistro(m), celdaFoto(m)]),
        foot: [["Total", "", "", `+${entero(tot.entradas)}`, "", "", ""]],
        columnStyles: { 0: { cellWidth: 21 }, 1: { cellWidth: 46 }, 3: { halign: "right", fontStyle: "bold" }, 5: { cellWidth: 22 }, 6: { cellWidth: 18 } },
        justificar: [1, 4],
        miniaturas: { columna: 6, filas: ent },
        didParseCell: (d) => {
          if (d.section === "foot" && d.column.index === 3) d.cell.styles.halign = "right";
        },
      });
    }

    subtitulo(`Salidas (${entero(sal.length)})`, `Total ${tot.salidas ? "-" : ""}${entero(tot.salidas)} unidades`);
    if (sal.length === 0) vacio("No se registraron salidas en este periodo.");
    else {
      tabla({
        head: [["Fecha", "Producto", "Código", "Cant.", "Trabajador o cliente", "Área", "Nota / revisar", "Registró", "Foto"]],
        body: sal.map((m) => [fechaLarga(m.fecha), t(nombreMov(m.producto, m.codigo)), m.codigo, `-${m.cantidad}`, t(titulo(m.persona)), t(titulo(m.area)), t([m.nota, m.revisar ? `Por revisar: ${m.revisar}` : ""].filter(Boolean).join(" ")), celdaRegistro(m), celdaFoto(m)]),
        foot: [["Total", "", "", `${tot.salidas ? "-" : ""}${entero(tot.salidas)}`, "", "", "", "", ""]],
        columnStyles: { 0: { cellWidth: 19 }, 3: { halign: "right", fontStyle: "bold", cellWidth: 11 }, 7: { cellWidth: 17 }, 8: { cellWidth: 18 } },
        justificar: [1, 4, 5, 6],
        miniaturas: { columna: 8, filas: sal },
        didParseCell: (d) => {
          if (d.section === "foot" && d.column.index === 3) d.cell.styles.halign = "right";
        },
      });
    }

    if (noSuman.length > 0) tablaNoSuman(noSuman);

    // Lo mas entregado
    const porProducto = new Map<string, number>();
    for (const m of sal) {
      const nombre = nombreProducto(partirMovimiento(m.producto).nombre, porCodigo.get(m.codigo)?.empresa);
      porProducto.set(nombre, (porProducto.get(nombre) ?? 0) + m.cantidad);
    }
    const top = Array.from(porProducto, ([producto, cant]) => ({ producto, cant })).sort((a, b) => b.cant - a.cant).slice(0, 10);
    if (top.length > 0) {
      subtitulo("Lo más entregado del periodo", `Los ${top.length} productos con más unidades`);
      tabla({
        head: [["#", "Producto", "Unidades"]],
        body: top.map((x, i) => [String(i + 1), t(x.producto), entero(x.cant)]),
        columnStyles: { 0: { cellWidth: 10 }, 2: { halign: "right", fontStyle: "bold", cellWidth: 28 } },
        justificar: [1],
      });
    }

    if (!secciones.fotos) seccionPendientes();
  }

  // ================================================================ TRABAJADORES
  if (secciones.trabajadores) {
    const entregas = movs.filter((m) => suma(m) && m.tipo === "salida");
    const porPersona = new Map<string, { area: string | null; prendas: number; ultima: string }>();
    for (const p of todos.trabajadores) porPersona.set(p.trabajador, { area: p.area, prendas: 0, ultima: "" });
    for (const s of entregas) {
      const nombre = s.persona ?? "";
      const a = porPersona.get(nombre) ?? { area: s.area, prendas: 0, ultima: "" };
      a.prendas += s.cantidad;
      if (s.fecha > a.ultima) a.ultima = s.fecha;
      porPersona.set(nombre, a);
    }
    const lista = Array.from(porPersona, ([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.prendas - a.prendas || a.nombre.localeCompare(b.nombre, "es"));
    const totalPrendas = lista.reduce((a, x) => a + x.prendas, 0);
    // Los clientes reciben prendas, pero no son personal registrado.
    const registrados = new Set(todos.trabajadores.map((p) => p.trabajador));
    const conEntregas = lista.filter((x) => x.prendas > 0 && registrados.has(x.nombre)).length;
    const clientes = lista.filter((x) => x.prendas > 0 && !registrados.has(x.nombre)).length;
    const aClientes = clientes > 0 ? ` y a ${plural(clientes, "cliente", "clientes")}` : "";

    tituloSeccion("Entregas por trabajador", `Se entregaron ${plural(totalPrendas, "prenda", "prendas")} a ${plural(conEntregas, "persona", "personas")} de las ${entero(registrados.size)} registradas${aClientes}, ${enFrase}.`);
    tabla({
      head: [["Trabajador", "Área", "Prendas recibidas", "Última entrega"]],
      body: lista.map((x) => [t(titulo(x.nombre)), t(x.area ? titulo(x.area) : SIN_AREA), entero(x.prendas), x.ultima ? fechaLarga(x.ultima) : "-"]),
      foot: [["Total", "", entero(totalPrendas), ""]],
      columnStyles: { 2: { halign: "right", fontStyle: "bold" } },
      justificar: [0, 1],
      didParseCell: (d) => {
        if (d.section === "foot" && d.column.index === 2) d.cell.styles.halign = "right";
      },
    });

    const porArea = new Map<string, { personas: number; prendas: number }>();
    for (const x of lista) {
      const k = x.area ? titulo(x.area) : SIN_AREA;
      const a = porArea.get(k) ?? { personas: 0, prendas: 0 };
      a.personas++;
      a.prendas += x.prendas;
      porArea.set(k, a);
    }
    subtitulo("Por área");
    tabla({
      head: [["Área", "Personas", "Prendas entregadas"]],
      body: Array.from(porArea, ([area, v]) => ({ area, ...v }))
        .sort((a, b) => b.prendas - a.prendas || a.area.localeCompare(b.area, "es"))
        .map((v) => [t(v.area), entero(v.personas), entero(v.prendas)]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right", fontStyle: "bold" } },
      justificar: [0],
    });

    const detalle = [...entregas].sort((a, b) => (a.persona ?? "").localeCompare(b.persona ?? "", "es") || b.fecha.localeCompare(a.fecha));
    if (detalle.length > 0) {
      subtitulo("Detalle de entregas", plural(detalle.length, "registro", "registros"));
      tabla({
        head: [["Trabajador", "Fecha", "Producto", "Código", "Cant."]],
        body: detalle.map((s) => [t(titulo(s.persona)), fechaLarga(s.fecha), t(nombreMov(s.producto, s.codigo)), s.codigo, String(s.cantidad)]),
        columnStyles: { 1: { cellWidth: 21 }, 4: { halign: "right", fontStyle: "bold" } },
        justificar: [0, 2],
      });
    }

    const salidasFuera = noSuman.filter((m) => m.tipo === "salida");
    if (!secciones.movimientos && salidasFuera.length > 0) tablaNoSuman(salidasFuera);
  }

  // ================================================================ FOTOS
  if (secciones.fotos) {
    const tarjetas = armarTarjetas(movs, false);
    const unicas = new Set(tarjetas.map((c) => c.ruta));
    const deEntregas = new Set(tarjetas.filter((c) => c.items[0].tipo === "salida").map((c) => c.ruta)).size;
    const falladas = Array.from(unicas).filter((r) => !cargas.get(r)?.ok).length;
    asegurar(90);
    tituloSeccion(
      "Fotos de evidencia",
      `${plural(unicas.size, "foto", "fotos")} ${enFrase}: ${entero(deEntregas)} de entregas y ${entero(unicas.size - deEntregas)} de entradas. Cada foto va junto a su movimiento, con la persona, la prenda, la cantidad y la fecha y hora en que se tomó. Si no se guardó esa hora, figura la del registro. ${incluirAnulados ? "Los anulados van en el anexo, cada uno con su foto." : "Los movimientos anulados no salen aquí."}`,
    );
    if (falladas > 0) {
      parrafo(`${plural(falladas, "foto no se pudo cargar", "fotos no se pudieron cargar")}. En su lugar hay un recuadro rojo con el motivo, y el movimiento sigue en la lista con todos sus datos.`, { color: RED, tam: 8.5, alto: 4.2 });
      y += 4;
    }
    if (tarjetas.length === 0) vacio("No hay fotos registradas en este periodo.");
    else tarjetas.forEach((c, i) => dibujarTarjeta(c, i + 1, tarjetas.length));
    y += 4;
    seccionPendientes();
  }

  // ================================================================ LLEGARON TARDE
  if (tardios.length > 0) {
    tituloSeccion("Llegaron después del último reporte", `${plural(tardios.length, "registro", "registros")} con fecha anterior a este periodo ${tardios.length === 1 ? "subió" : "subieron"} al servidor después del reporte anterior, así que no ${tardios.length === 1 ? "salió" : "salieron"} en ninguno. No ${tardios.length === 1 ? "suma" : "suman"} en los totales del periodo.`);
    tabla({
      head: [["Fecha", "Producto", "Código", "Cant.", "Persona o nota", "Llegó", "Foto"]],
      body: tardios.map((m) => [fechaLarga(m.fecha), t(nombreMov(m.producto, m.codigo)), m.codigo, `${m.tipo === "entrada" ? "+" : "-"}${m.cantidad}`, t(m.persona ? titulo(m.persona) : m.nota), m.subido ? fechaLarga(fechaLima(m.subido)) : "-", celdaFoto(m)]),
      columnStyles: { 0: { cellWidth: 21 }, 3: { halign: "right", fontStyle: "bold" }, 5: { cellWidth: 21 }, 6: { cellWidth: 18 } },
      justificar: [1, 4],
      miniaturas: { columna: 6, filas: tardios },
    });
    if (secciones.fotos) {
      const tarjetas = armarTarjetas(tardios, false);
      tarjetas.forEach((c, i) => dibujarTarjeta(c, i + 1, tarjetas.length));
      y += 4;
    }
  }

  // ================================================================ ANEXO: ANULADOS
  if (incluirAnulados) {
    tituloSeccion("Anexo: movimientos anulados", `Van solo para control y no cuentan en el stock. Periodo: ${periodo}.`, false);
    if (anulados.length === 0) vacio("No hay movimientos anulados en este periodo.");
    else
      tabla({
        head: [["Tipo", "Fecha", "Producto", "Cant.", "Registró", "Anuló", "Motivo", "Foto"]],
        body: anulados.map((m: Movimiento) => [
          m.tipo === "entrada" ? "Entrada" : "Salida",
          fechaLarga(m.fecha),
          t(nombreMov(m.producto, m.codigo)),
          String(m.cantidad),
          nombreCorto(m.registradoPor),
          nombreCorto(m.anuladoPor),
          t(m.motivo),
          celdaFoto(m),
        ]),
        columnStyles: { 1: { cellWidth: 20 }, 2: { cellWidth: 38 }, 3: { halign: "right" }, 6: { cellWidth: 44 }, 7: { cellWidth: 18 } },
        justificar: [2, 6],
        miniaturas: { columna: 7, filas: anulados },
      });
  }

  // ================================================================ FIRMAS
  asegurar(48);
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...INK);
  doc.text("Conformidad", ML, y);
  y += 22;
  const roles = ["Elaborado por", "Revisado por", "Recibido conforme"];
  const wFirma = (UTIL - 12) / 3;
  roles.forEach((rol, i) => {
    const x = ML + i * (wFirma + 6);
    doc.setDrawColor(...MUTED).setLineWidth(0.3).line(x, y, x + wFirma, y);
    doc.setFont("helvetica", "bold").setFontSize(7.8).setTextColor(...INK);
    doc.text(rol, x, y + 4.5);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED);
    doc.text(i === 0 && usuario ? nombreCorto(usuario) : "Nombre y firma", x, y + 8.5);
    doc.text("Fecha: ____ / ____ / ________", x, y + 13);
  });

  // ================================================================ ENCABEZADO Y PIE DE CADA PAGINA
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    if (i > 1) {
      marca(doc, ML, 8.2, 6, INK, [255, 255, 255]);
      doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...INK);
      doc.text(t(tituloInforme), ML + 9, 12.3);
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
      doc.text(t(`${etiquetaEmpresa}  -  ${periodo}`), ANCHO - ML, 12.3, { align: "right" });
      doc.setDrawColor(...LINE).setLineWidth(0.25).line(ML, 16, ANCHO - ML, 16);
    }
    doc.setDrawColor(...LINE).setLineWidth(0.25).line(ML, ALTO - 12, ANCHO - ML, ALTO - 12);
    doc.setFont("helvetica", "normal").setFontSize(7.2).setTextColor(...MUTED);
    doc.text("FUNDIGSAC  -  Control de stock de EPP y uniformes", ML, ALTO - 7.5);
    doc.text(codigoInforme, ANCHO / 2, ALTO - 7.5, { align: "center" });
    doc.text(`Página ${i} de ${paginas}`, ANCHO - ML, ALTO - 7.5, { align: "right" });
  }

  const nombre = `Informe-Stock_${tituloInforme.replace(/[^\w]+/g, "-")}_${empresa === "TODAS" ? "Todas" : empresa.replace(/[^\w]+/g, "-")}_${hoy}.pdf`;
  const archivo = doc.output("blob");
  if (ventana && !ventana.closed) {
    ventana.location.href = URL.createObjectURL(archivo);
  } else {
    doc.save(nombre);
  }
  alProgreso?.({ fase: "listo", hechas: rutas.length, total: rutas.length, fallidas, texto: "Informe listo" });
  return { paginas, fotos: rutas.length, fallidas, bytes: archivo.size };
}

type CargaFoto = { ok: true; data: string; w: number; h: number } | { ok: false; motivo: string; corto: string };
type FalloFoto = Extract<CargaFoto, { ok: false }>;

const FOTOS_A_LA_VEZ = 4;
const ESPERA_FOTO_MS = 25_000;

const fallo = (motivo: string, corto: string): FalloFoto => ({ ok: false, motivo, corto });

function falloHttp(status: number): FalloFoto {
  if (status === 400 || status === 404) return fallo(`El archivo ya no está en el almacén de fotos (error ${status}).`, `Error ${status}`);
  if (status === 401 || status === 403) return fallo(`No hay permiso para ver esta foto (error ${status}).`, `Error ${status}`);
  return fallo(`El servidor de fotos falló (error ${status}).`, `Error ${status}`);
}

/** Baja una foto con un intento extra si el problema parece pasajero. */
async function bajarFoto(url: string): Promise<Blob | FalloFoto> {
  for (let intento = 0; ; intento++) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), ESPERA_FOTO_MS);
    let problema: FalloFoto;
    let reintentar: boolean;
    try {
      const r = await fetch(url, { signal: control.signal });
      if (r.ok) return await r.blob();
      problema = falloHttp(r.status);
      reintentar = r.status >= 500 || r.status === 408 || r.status === 429;
    } catch {
      const sinRed = typeof navigator !== "undefined" && navigator.onLine === false;
      if (control.signal.aborted) problema = fallo("La foto tardó demasiado en descargarse.", "Tardó mucho");
      else if (sinRed) problema = fallo("No hay conexión a internet y esta foto no está guardada en el equipo.", "Sin conexión");
      else problema = fallo("No se pudo descargar la foto.", "Sin descarga");
      reintentar = !sinRed;
    } finally {
      clearTimeout(reloj);
    }
    if (!reintentar || intento >= 1) return problema;
    await new Promise((ok) => setTimeout(ok, 700));
  }
}

/** Achica la foto y la recomprime en JPEG para que el PDF no pese de mas. */
async function aJpeg(blob: Blob, lado: number, calidad: number): Promise<CargaFoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return fallo("El archivo está dañado o no es una imagen.", "Archivo dañado");
  }
  try {
    const k = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(bitmap.width * k));
    lienzo.height = Math.max(1, Math.round(bitmap.height * k));
    const ctx = lienzo.getContext("2d");
    if (!ctx) return fallo("El equipo no pudo procesar la imagen.", "Sin memoria");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    const data = lienzo.toDataURL("image/jpeg", calidad);
    if (!data.startsWith("data:image/jpeg")) return fallo("El equipo no pudo procesar la imagen.", "Sin memoria");
    return { ok: true, data, w: lienzo.width, h: lienzo.height };
  } finally {
    bitmap.close();
  }
}

async function cargarFoto(ruta: string, locales: Map<string, Blob>, lado: number, calidad: number): Promise<CargaFoto> {
  const local = locales.get(ruta);
  if (local) return aJpeg(local, lado, calidad);
  const url = urlFoto(ruta);
  if (!url) return fallo("La foto no tiene una ruta válida.", "Sin ruta");
  const bajada = await bajarFoto(url);
  return bajada instanceof Blob ? aJpeg(bajada, lado, calidad) : bajada;
}

/** Carga las fotos con un tope de descargas simultaneas y avisa el avance. Un fallo no detiene a las demas. */
async function cargarFotos(rutas: string[], locales: Map<string, Blob>, alProgreso?: (p: ProgresoPDF) => void): Promise<Map<string, CargaFoto>> {
  const salida = new Map<string, CargaFoto>();
  if (rutas.length === 0) return salida;
  const { lado, calidad } = calidadSegun(rutas.length);
  let siguiente = 0;
  let hechas = 0;
  let fallidas = 0;
  const avisar = () =>
    alProgreso?.({ fase: "fotos", hechas, total: rutas.length, fallidas, texto: `Cargando fotos: ${entero(hechas)} de ${entero(rutas.length)}${fallidas ? ` (${entero(fallidas)} con problema)` : ""}` });
  avisar();
  const obrero = async () => {
    while (siguiente < rutas.length) {
      const ruta = rutas[siguiente++];
      let carga: CargaFoto;
      try {
        carga = await cargarFoto(ruta, locales, lado, calidad);
      } catch (e) {
        console.error(e);
        carga = fallo("No se pudo procesar la foto.", "Error");
      }
      salida.set(ruta, carga);
      hechas++;
      if (!carga.ok) fallidas++;
      avisar();
    }
  };
  await Promise.all(Array.from({ length: Math.min(FOTOS_A_LA_VEZ, rutas.length) }, obrero));
  return salida;
}

type Dia = { fecha: string; entradas: number; salidas: number };

const DIAS_MAX_GRAFICO = 92;

/** Serie diaria del periodo. Sin fecha inicial se muestran 90 dias, como en la pantalla de Movimientos. */
function serieRango(movs: Movimiento[], desde: string | null, hasta: string | null, hoy: string): { serie: Dia[]; recortada: boolean } {
  const fin = hasta ?? hoy;
  const ini0 = desde ?? sumarDias(fin, -89);
  const limite = sumarDias(fin, -(DIAS_MAX_GRAFICO - 1));
  let ini = ini0 < limite ? limite : ini0;
  if (ini > fin) ini = fin; // periodo al reves: al menos un dia, para que el grafico no quede vacio
  const serie: Dia[] = [];
  const idx = new Map<string, Dia>();
  for (let f = ini; f <= fin; f = sumarDias(f, 1)) {
    const d = { fecha: f, entradas: 0, salidas: 0 };
    serie.push(d);
    idx.set(f, d);
  }
  for (const m of movs) {
    const d = idx.get(m.fecha);
    if (!d || !suma(m)) continue;
    if (m.tipo === "entrada") d.entradas += m.cantidad;
    else d.salidas += m.cantidad;
  }
  return { serie, recortada: !desde || ini0 < limite };
}

/** Grafico de barras de entradas (tinta) y salidas (rojo), dibujado como vector. */
function dibujarSerie(doc: Doc, serie: Dia[], x: number, y: number, w: number, h: number) {
  const max = Math.max(1, ...serie.map((d) => Math.max(d.entradas, d.salidas)));
  doc.setFillColor(...GROUND).roundedRect(x, y, w, h, 2, 2, "F");
  const pad = 4;
  const area = { x: x + pad + 6, y: y + pad, w: w - pad * 2 - 6, h: h - pad * 2 - 5 };
  doc.setDrawColor(...LINE).setLineWidth(0.15);
  for (let i = 0; i <= 2; i++) {
    const gy = area.y + (area.h * i) / 2;
    doc.line(area.x, gy, area.x + area.w, gy);
  }
  doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(...MUTED);
  doc.text(String(max), x + pad + 4.5, area.y + 1.5, { align: "right" });
  doc.text("0", x + pad + 4.5, area.y + area.h + 1, { align: "right" });
  const paso = area.w / serie.length;
  const bw = Math.min(2.2, paso * 0.36);
  serie.forEach((d, i) => {
    const cx = area.x + paso * i + paso / 2;
    const he = (d.entradas / max) * area.h;
    const hs = (d.salidas / max) * area.h;
    if (he > 0) doc.setFillColor(...INK).rect(cx - bw - 0.2, area.y + area.h - he, bw, he, "F");
    if (hs > 0) doc.setFillColor(...RED).rect(cx + 0.2, area.y + area.h - hs, bw, hs, "F");
  });
  for (const i of [0, Math.floor(serie.length / 2), serie.length - 1]) {
    const cx = area.x + paso * i + paso / 2;
    doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(...MUTED);
    doc.text(t(fechaLarga(serie[i].fecha)), cx, y + h - 1.5, { align: i === 0 ? "left" : i === serie.length - 1 ? "right" : "center" });
  }
  if (serie.every((d) => d.entradas === 0 && d.salidas === 0)) {
    doc.setFontSize(8).setTextColor(...MUTED);
    doc.text("Sin movimientos en este periodo", x + w / 2, y + h / 2, { align: "center" });
  }
}
