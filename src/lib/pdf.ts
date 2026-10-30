import type { jsPDF as JsPDF } from "jspdf";
import { ESTADO_TEXTO, estadoDe, lecturas, movimientosDe, porEmpresa, rangoTalla, resumir, sumaMovs } from "./derive";
import { entero, etiquetaTalla, fechaLarga, hoyISO, nombreProducto, nombreTalla, partirMovimiento, sumarDias, titulo } from "./format";
import { urlFoto } from "./foto";
import type { Datos, Estado, Movimiento } from "./types";

export type SeccionesPDF = {
  resumen: boolean;
  stock: boolean;
  movimientos: boolean;
  trabajadores: boolean;
  /** Reporte de fotos de evidencia (entregas y entradas con foto). */
  fotos: boolean;
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
};

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

/** jsPDF usa fuentes estandar (Latin-1): sustituye simbolos que no existen en ellas. */
const t = (s: string | null | undefined): string =>
  (s ?? "")
    .replace(/[—−–]/g, "-")
    .replace(/·/g, "-")
    .replace(/✔\s*/g, "")
    .replace(/⚠\s*/g, "! ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

const COLOR_ESTADO: Record<Estado, RGB> = { ok: OK, bajo: WARN, sin: MUTED, revisar: RED };

type Doc = JsPDF & { lastAutoTable?: { finalY: number } };

function nombreInforme(s: SeccionesPDF): string {
  const n = Object.values(s).filter(Boolean).length;
  if (s.fotos && n === 1) return "Reporte de fotos";
  if (n === 4) return "Informe de stock";
  if (s.resumen && n === 1) return "Resumen ejecutivo";
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

/** Marca de la app (cuadrado con tres barras), dibujada como vector. */
function marca(doc: Doc, x: number, y: number, tam: number, fondo: RGB, barras: RGB) {
  const u = tam / 32;
  doc.setFillColor(...fondo).roundedRect(x, y, tam, tam, 9 * u, 9 * u, "F");
  doc.setFillColor(...barras).roundedRect(x + 7 * u, y + 7 * u, 18 * u, 5 * u, 2 * u, 2 * u, "F");
  doc.roundedRect(x + 7 * u, y + 14 * u, 12 * u, 5 * u, 2 * u, 2 * u, "F");
  doc.setFillColor(...RED).roundedRect(x + 7 * u, y + 21 * u, 18 * u, 4 * u, 2 * u, 2 * u, "F");
}

export async function generarPDF(o: OpcionesPDF): Promise<void> {
  const { datos, todos, empresa, secciones, usuario, desde, hasta, incluirAnulados, ventana } = o;
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  // Segun el empaquetador, `default` es la funcion o un objeto que la contiene.
  const crudo = autoTableMod.default as unknown;
  const autoTable = (typeof crudo === "function" ? crudo : (crudo as { default: unknown }).default) as typeof autoTableMod.default;
  const doc = new jsPDF({ unit: "mm", format: "a4" }) as Doc;

  const minimo = todos.sync?.stock_minimo ?? 2;
  const ahora = new Date();
  const generado = ahora.toLocaleString("es-PE", { dateStyle: "long", timeStyle: "short" });
  const codigoInforme = `INF-${hoyISO().replace(/-/g, "")}-${String(ahora.getHours()).padStart(2, "0")}${String(ahora.getMinutes()).padStart(2, "0")}`;
  const etiquetaEmpresa = empresa === "TODAS" ? "Todas las empresas" : titulo(empresa);
  const tituloInforme = o.titulo ?? nombreInforme(secciones);
  const periodo = textoPeriodo(desde, hasta);
  const enPeriodo = (f: string) => (!desde || f >= desde) && (!hasta || f <= hasta);

  const resumen = resumir(datos.stock, minimo);
  const filasEmpresa = porEmpresa(todos.stock, minimo);
  const filasMostradas = empresa === "TODAS" ? filasEmpresa : filasEmpresa.filter((f) => f.empresa === empresa);
  const movsTodos = movimientosDe(datos, true).filter((m) => enPeriodo(m.fecha));
  const movs = movsTodos.filter((m) => !m.anulado);
  const anulados = movsTodos.filter((m) => m.anulado);

  let y = 0;
  let nSeccion = 0;
  const finalY = () => doc.lastAutoTable?.finalY ?? y;
  const asegurar = (alto: number) => {
    if (y + alto > BASE) {
      doc.addPage();
      y = TOPE;
    }
  };

  const tituloSeccion = (texto: string, nota?: string, numerada = true) => {
    asegurar(24);
    if (numerada) nSeccion++;
    doc.setFillColor(...RED).rect(ML, y - 4.4, 1.6, 6.6, "F");
    doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(13);
    doc.text(t(numerada ? `${nSeccion}. ${texto}` : texto), ML + 4.5, y);
    y += 2;
    if (nota) {
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED);
      const lineas = doc.splitTextToSize(t(nota), UTIL - 6) as string[];
      doc.text(lineas, ML + 4.5, y + 3.2);
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

  const tabla = (opts: Parameters<typeof autoTable>[1]) => {
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
    });
    y = finalY() + 8;
  };

  /** "NOMBRE  ·  Talla M" -> "Nombre - Talla M" */
  const nombreMov = (snapshot: string) => {
    const p = partirMovimiento(snapshot);
    return `${nombreProducto(p.nombre)}${p.talla ? ` - ${etiquetaTalla(p.talla)}` : ""}`;
  };
  const nombreCorto = (s: string | null) => t(titulo((s ?? "").split("@")[0]));

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
    ["ELABORADO POR", usuario ? titulo(usuario.split("@")[0]) : "-"],
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

  // ================================================================ 1. RESUMEN
  if (secciones.resumen) {
    tituloSeccion("Resumen ejecutivo", `Situacion del inventario al ${fechaLarga(hoyISO())} y movimiento del periodo: ${periodo}.`);

    const caja = (x: number, w: number, c: { etiqueta: string; valor: string; nota: string; color?: RGB }) => {
      doc.setFillColor(...GROUND).roundedRect(x, y, w, 24, 2.5, 2.5, "F");
      doc.setTextColor(...MUTED).setFont("helvetica", "bold").setFontSize(6.5);
      doc.text(c.etiqueta, x + 3.5, y + 6, { charSpace: 0.3 });
      doc.setTextColor(...(c.color ?? INK)).setFontSize(19);
      doc.text(c.valor, x + 3.5, y + 15.5);
      doc.setTextColor(...MUTED).setFont("helvetica", "normal").setFontSize(7);
      doc.text(t(c.nota), x + 3.5, y + 21);
    };
    const gap = 3;
    const w4 = (UTIL - gap * 3) / 4;
    [
      { etiqueta: "UNIDADES EN ALMACEN", valor: entero(resumen.unidades), nota: `${entero(resumen.disponibles)} articulos con stock` },
      { etiqueta: "SIN STOCK", valor: entero(resumen.sin), nota: `de ${entero(resumen.articulos)} articulos` },
      { etiqueta: "POR AGOTARSE", valor: entero(resumen.bajo), nota: `quedan ${minimo} o menos`, color: resumen.bajo ? WARN : undefined },
      { etiqueta: "A REVISAR", valor: entero(resumen.revisar), nota: "saldo negativo", color: resumen.revisar ? RED : undefined },
    ].forEach((c, i) => caja(ML + i * (w4 + gap), w4, c));
    y += 28;

    const tot = sumaMovs(movs);
    const w3 = (UTIL - gap * 2) / 3;
    [
      { etiqueta: "ENTRADAS DEL PERIODO", valor: `+${entero(tot.entradas)}`, nota: `${entero(movs.filter((m) => m.tipo === "entrada").length)} registros` },
      { etiqueta: "SALIDAS DEL PERIODO", valor: tot.salidas ? `-${entero(tot.salidas)}` : "0", nota: `${entero(movs.filter((m) => m.tipo === "salida").length)} registros`, color: tot.salidas ? RED : undefined },
      { etiqueta: "DIFERENCIA", valor: `${tot.neto > 0 ? "+" : tot.neto < 0 ? "-" : ""}${entero(Math.abs(tot.neto))}`, nota: tot.neto >= 0 ? "el almacen gano unidades" : "el almacen perdio unidades" },
    ].forEach((c, i) => caja(ML + i * (w3 + gap), w3, c));
    y += 33;

    // Barra de disponibilidad
    doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(9);
    doc.text(`Disponibilidad: ${resumen.pctDisponible}% de los articulos tiene stock`, ML, y);
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
      t(`Stock normal ${resumen.ok}   |   Por agotarse ${resumen.bajo}   |   Sin stock ${resumen.sin}${resumen.revisar ? `   |   Revisar ${resumen.revisar}` : ""}`),
      ML,
      y,
    );
    y += 9;

    // Lectura rapida
    doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(9);
    doc.text("Lectura rapida", ML, y);
    y += 5;
    doc.setFont("helvetica", "normal").setFontSize(8.8).setTextColor(...INK);
    for (const f of lecturas(resumen, filasMostradas, movs)) {
      const lineas = doc.splitTextToSize(t(f), UTIL - 5) as string[];
      asegurar(lineas.length * 4.4 + 2);
      doc.setFillColor(...RED).circle(ML + 1, y - 1, 0.7, "F");
      doc.setFont("helvetica", "normal").setFontSize(8.8).setTextColor(...INK);
      doc.text(lineas, ML + 4, y);
      y += lineas.length * 4.4 + 1;
    }
    y += 5;

    // Por empresa
    subtitulo("Stock por empresa");
    const sum = (f: (x: (typeof filasMostradas)[number]) => number) => filasMostradas.reduce((a, x) => a + f(x), 0);
    const totArt = sum((x) => x.articulos);
    const totDisp = sum((x) => x.disponibles);
    tabla({
      head: [["Empresa", "Articulos", "Normal", "Por agotarse", "Sin stock", "Revisar", "Unidades", "% disp."]],
      body: filasMostradas.map((f) => [titulo(f.empresa), entero(f.articulos), entero(f.ok), entero(f.bajo), entero(f.sin), entero(f.revisar), entero(f.unidades), `${f.pctDisponible}%`]),
      foot: [["Total", entero(totArt), entero(sum((x) => x.ok)), entero(sum((x) => x.bajo)), entero(sum((x) => x.sin)), entero(sum((x) => x.revisar)), entero(sum((x) => x.unidades)), `${totArt ? Math.round((totDisp / totArt) * 100) : 0}%`]],
      columnStyles: { 0: { cellWidth: 44, fontStyle: "bold" }, 6: { fontStyle: "bold" } },
    });

    // Grafico del periodo
    const serie = serieRango(movs, desde, hasta);
    asegurar(62);
    subtitulo(`Movimiento por dia (${serie.length} dias)`, `Entradas ${entero(tot.entradas)}   |   Salidas ${entero(tot.salidas)}`);
    dibujarSerie(doc, serie, ML, y + 1, UTIL, 38);
    y += 38 + 14;
  }

  // ================================================================ 2. STOCK
  if (secciones.stock) {
    const alertas = datos.stock
      .filter((s) => ["bajo", "revisar"].includes(estadoDe(s.queda, minimo)))
      .sort((a, b) => a.queda - b.queda || a.producto.localeCompare(b.producto, "es"));

    tituloSeccion("Stock actual", `Situacion al ${fechaLarga(hoyISO())}. Queda = Inicio + Entro - Salio. Los movimientos anulados no cuentan.`);

    if (alertas.length > 0) {
      subtitulo("Necesita atencion", `${entero(alertas.length)} articulos por agotarse o con saldo negativo`);
      tabla({
        head: [["Empresa", "Producto", "Talla", "Codigo", "Queda", "Estado"]],
        body: alertas.map((s) => [titulo(s.empresa), t(nombreProducto(s.producto, s.empresa)), t(nombreTalla(s.talla)), s.codigo, String(s.queda), ESTADO_TEXTO[estadoDe(s.queda, minimo)]]),
        columnStyles: { 4: { halign: "right", fontStyle: "bold" } },
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
      subtitulo(titulo(emp), `${entero(r.unidades)} unidades  -  ${entero(r.sin)} sin stock  -  ${entero(r.bajo)} por agotarse`);
      const suma = (c: "tenia_al_inicio" | "entro" | "salio" | "queda") => filas.reduce((a, s) => a + s[c], 0);
      tabla({
        head: [["Producto", "Talla", "Codigo", "Inicio", "Entro", "Salio", "Queda", "Estado", "Ult. mov."]],
        body: filas.map((s) => [
          t(nombreProducto(s.producto, s.empresa)),
          t(nombreTalla(s.talla)),
          s.codigo,
          String(s.tenia_al_inicio),
          String(s.entro),
          String(s.salio),
          String(s.queda),
          ESTADO_TEXTO[estadoDe(s.queda, minimo)],
          s.ultimo_movimiento ? fechaLarga(s.ultimo_movimiento) : "-",
        ]),
        foot: [["Total " + t(titulo(emp)), "", "", String(suma("tenia_al_inicio")), String(suma("entro")), String(suma("salio")), String(suma("queda")), "", ""]],
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
          if (d.section === "foot") {
            if ([3, 4, 5, 6].includes(d.column.index)) d.cell.styles.halign = "right";
            if (d.column.index === 0) d.cell.colSpan = 3;
          }
        },
      });
    }
  }

  // ================================================================ 3. MOVIMIENTOS
  if (secciones.movimientos) {
    const ent = movs.filter((m) => m.tipo === "entrada");
    const sal = movs.filter((m) => m.tipo === "salida");
    const tot = sumaMovs(movs);
    tituloSeccion(
      "Movimientos del periodo",
      `${periodo}. Entraron ${entero(tot.entradas)} unidades y salieron ${entero(tot.salidas)} (diferencia ${tot.neto >= 0 ? "+" : "-"}${entero(Math.abs(tot.neto))}).`,
    );

    subtitulo(`Entradas (${entero(ent.length)})`, `Total +${entero(tot.entradas)} unidades`);
    if (ent.length === 0) vacio("No hay entradas registradas en este periodo.");
    else {
      tabla({
        head: [["Fecha", "Producto", "Codigo", "Cant.", "Proveedor / nota", "Registro"]],
        body: ent.map((m) => [fechaLarga(m.fecha), t(nombreMov(m.producto)), m.codigo, `+${m.cantidad}`, t(m.nota), nombreCorto(m.registradoPor)]),
        foot: [["Total", "", "", `+${entero(tot.entradas)}`, "", ""]],
        columnStyles: { 0: { cellWidth: 24 }, 3: { halign: "right", fontStyle: "bold" } },
        didParseCell: (d) => {
          if (d.section === "foot" && d.column.index === 3) d.cell.styles.halign = "right";
        },
      });
    }

    subtitulo(`Salidas (${entero(sal.length)})`, `Total ${tot.salidas ? "-" : ""}${entero(tot.salidas)} unidades`);
    if (sal.length === 0) vacio("No hay salidas registradas en este periodo.");
    else {
      tabla({
        head: [["Fecha", "Producto", "Codigo", "Cant.", "Trabajador / cliente", "Area", "Registro", "Foto"]],
        body: sal.map((m) => [fechaLarga(m.fecha), t(nombreMov(m.producto)), m.codigo, `-${m.cantidad}`, t(titulo(m.persona)), t(titulo(m.area)), nombreCorto(m.registradoPor), m.foto ? "Si" : "-"]),
        foot: [["Total", "", "", `${tot.salidas ? "-" : ""}${entero(tot.salidas)}`, "", "", "", ""]],
        columnStyles: { 0: { cellWidth: 24 }, 3: { halign: "right", fontStyle: "bold" } },
        didParseCell: (d) => {
          if (d.section === "foot" && d.column.index === 3) d.cell.styles.halign = "right";
        },
      });
    }

    // Lo mas entregado
    const porProducto = new Map<string, number>();
    for (const m of sal) {
      const nombre = nombreProducto(partirMovimiento(m.producto).nombre);
      porProducto.set(nombre, (porProducto.get(nombre) ?? 0) + m.cantidad);
    }
    const top = Array.from(porProducto, ([producto, cant]) => ({ producto, cant })).sort((a, b) => b.cant - a.cant).slice(0, 10);
    if (top.length > 0) {
      subtitulo("Lo mas entregado del periodo", "Top 10 por unidades");
      tabla({
        head: [["#", "Producto", "Unidades"]],
        body: top.map((x, i) => [String(i + 1), t(x.producto), entero(x.cant)]),
        columnStyles: { 0: { cellWidth: 10 }, 2: { halign: "right", fontStyle: "bold", cellWidth: 28 } },
      });
    }
  }

  // ================================================================ 4. TRABAJADORES
  if (secciones.trabajadores) {
    const entregas = datos.salidas.filter((s) => !s.anulado && enPeriodo(s.fecha));
    const porPersona = new Map<string, { area: string | null; prendas: number; ultima: string }>();
    for (const p of todos.trabajadores) porPersona.set(p.trabajador, { area: p.area, prendas: 0, ultima: "" });
    for (const s of entregas) {
      const a = porPersona.get(s.trabajador_cliente) ?? { area: s.area, prendas: 0, ultima: "" };
      a.prendas += s.cantidad;
      if (s.fecha > a.ultima) a.ultima = s.fecha;
      porPersona.set(s.trabajador_cliente, a);
    }
    const lista = Array.from(porPersona, ([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.prendas - a.prendas || a.nombre.localeCompare(b.nombre, "es"));
    const totalPrendas = lista.reduce((a, x) => a + x.prendas, 0);
    const conEntregas = lista.filter((x) => x.prendas > 0).length;

    tituloSeccion(
      "Entregas por trabajador",
      `${periodo}. ${entero(totalPrendas)} prendas entregadas a ${entero(conEntregas)} de ${entero(lista.length)} personas.`,
    );
    tabla({
      head: [["Trabajador", "Area", "Prendas recibidas", "Ultima entrega"]],
      body: lista.map((x) => [t(titulo(x.nombre)), t(titulo(x.area ?? "Cliente / sin area")), String(x.prendas), x.ultima ? fechaLarga(x.ultima) : "-"]),
      foot: [["Total", "", entero(totalPrendas), ""]],
      columnStyles: { 2: { halign: "right", fontStyle: "bold" } },
      didParseCell: (d) => {
        if (d.section === "foot" && d.column.index === 2) d.cell.styles.halign = "right";
      },
    });

    const porArea = new Map<string, { personas: number; prendas: number }>();
    for (const x of lista) {
      const k = titulo(x.area ?? "Cliente / sin area");
      const a = porArea.get(k) ?? { personas: 0, prendas: 0 };
      a.personas++;
      a.prendas += x.prendas;
      porArea.set(k, a);
    }
    subtitulo("Resumen por area");
    tabla({
      head: [["Area", "Personas", "Prendas entregadas"]],
      body: Array.from(porArea, ([area, v]) => [t(area), String(v.personas), entero(v.prendas)]).sort((a, b) => Number(b[2].replace(/\D/g, "")) - Number(a[2].replace(/\D/g, ""))),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right", fontStyle: "bold" } },
    });

    const detalle = [...entregas].sort((a, b) => a.trabajador_cliente.localeCompare(b.trabajador_cliente, "es") || b.fecha.localeCompare(a.fecha));
    if (detalle.length > 0) {
      subtitulo("Detalle de entregas", `${entero(detalle.length)} registros`);
      tabla({
        head: [["Trabajador", "Fecha", "Producto", "Codigo", "Cant."]],
        body: detalle.map((s) => [t(titulo(s.trabajador_cliente)), fechaLarga(s.fecha), t(nombreMov(s.producto)), s.codigo, String(s.cantidad)]),
        columnStyles: { 1: { cellWidth: 24 }, 4: { halign: "right", fontStyle: "bold" } },
      });
    }
  }

  // ================================================================ 5. FOTOS
  if (secciones.fotos) {
    const grupos = new Map<string, Movimiento[]>();
    for (const m of movs) {
      if (!m.foto) continue;
      const g = grupos.get(m.foto);
      if (g) g.push(m);
      else grupos.set(m.foto, [m]);
    }
    // Una foto puede respaldar varias lineas (una entrega con varias prendas): sale una sola vez.
    const lista = Array.from(grupos, ([ruta, items]) => ({ ruta, items })).sort(
      (a, b) => b.items[0].fecha.localeCompare(a.items[0].fecha) || b.items[0].creado.localeCompare(a.items[0].creado),
    );
    const MAX_FOTOS = 150;
    const mostrar = lista.slice(0, MAX_FOTOS);
    const nSal = lista.filter((g) => g.items[0].tipo === "salida").length;
    tituloSeccion(
      "Reporte de fotos",
      `${periodo}. ${entero(lista.length)} fotos de evidencia: ${entero(nSal)} de entregas y ${entero(lista.length - nSal)} de entradas.${lista.length > MAX_FOTOS ? ` Se muestran las ${MAX_FOTOS} mas recientes.` : ""}`,
    );

    if (mostrar.length === 0) vacio("No hay fotos registradas en este periodo.");
    else {
      const imagenes = await cargarFotos(mostrar.map((g) => g.ruta));
      const sep = 6;
      const cw = (UTIL - sep) / 2;
      const ih = 52; // alto de la foto
      const ch = 80; // alto de cada tarjeta
      mostrar.forEach((g, i) => {
        const col = i % 2;
        if (col === 0) asegurar(ch);
        const x = ML + col * (cw + sep);
        const img = imagenes[i];
        const primero = g.items[0];
        const esSalida = primero.tipo === "salida";

        doc.setDrawColor(...LINE).setLineWidth(0.25).roundedRect(x, y, cw, ch, 2, 2, "S");
        doc.setFillColor(...GROUND).roundedRect(x + 0.6, y + 0.6, cw - 1.2, ih, 1.6, 1.6, "F");
        if (img) {
          const k = Math.min((cw - 1.2) / img.w, ih / img.h);
          const iw = img.w * k;
          const ialto = img.h * k;
          doc.addImage(img.data, "JPEG", x + (cw - iw) / 2, y + 0.6 + (ih - ialto) / 2, iw, ialto);
        } else {
          doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
          doc.text("Foto no disponible", x + cw / 2, y + ih / 2, { align: "center" });
        }

        let ty = y + ih + 6;
        const etiq = esSalida ? "SALIDA" : "ENTRADA";
        const wEtiq = esSalida ? 13 : 14.5;
        doc.setFillColor(...(esSalida ? RED : INK)).roundedRect(x + 2, ty - 3.3, wEtiq, 4.6, 1, 1, "F");
        doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(6.3);
        doc.text(etiq, x + 2 + wEtiq / 2, ty - 0.1, { align: "center" });
        const quien = esSalida ? t(titulo(primero.persona ?? "")) || "Sin nombre" : t(titulo(primero.persona ?? "")) || "Mercaderia recibida";
        doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(8.4);
        doc.text((doc.splitTextToSize(quien, cw - wEtiq - 7) as string[])[0], x + 2 + wEtiq + 2.5, ty);
        ty += 4.8;
        doc.setFont("helvetica", "normal").setFontSize(7.2).setTextColor(...MUTED);
        doc.text((doc.splitTextToSize(t(`${fechaLarga(primero.fecha)}  -  Registro: ${nombreCorto(primero.registradoPor) || "-"}`), cw - 4) as string[])[0], x + 2, ty);
        ty += 4.2;
        doc.setFontSize(7.4).setTextColor(...INK);
        const maxLineas = 3;
        const visibles = g.items.length > maxLineas ? maxLineas - 1 : g.items.length;
        for (const m of g.items.slice(0, visibles)) {
          doc.text((doc.splitTextToSize(t(`${m.cantidad} x ${nombreMov(m.producto)}`), cw - 4) as string[])[0], x + 2, ty);
          ty += 3.6;
        }
        if (g.items.length > visibles) {
          doc.setTextColor(...MUTED);
          doc.text(`+ ${g.items.length - visibles} mas`, x + 2, ty);
        }

        if (col === 1 || i === mostrar.length - 1) y += ch + 4;
      });
    }
  }

  // ================================================================ ANEXO: ANULADOS
  if (incluirAnulados) {
    tituloSeccion("Anexo: movimientos anulados", `Registro de auditoria. Estos movimientos NO cuentan en el stock. Periodo: ${periodo}.`, false);
    if (anulados.length === 0) vacio("No hay movimientos anulados en este periodo.");
    else
      tabla({
        head: [["Tipo", "Fecha", "Producto", "Cant.", "Registro", "Anulo", "Motivo"]],
        body: anulados.map((m: Movimiento) => [
          m.tipo === "entrada" ? "Entrada" : "Salida",
          fechaLarga(m.fecha),
          t(titulo(m.producto)),
          String(m.cantidad),
          nombreCorto(m.registradoPor),
          nombreCorto(m.anuladoPor),
          t(m.motivo),
        ]),
        columnStyles: { 3: { halign: "right" } },
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
    doc.text(i === 0 && usuario ? t(titulo(usuario.split("@")[0])) : "Nombre y firma", x, y + 8.5);
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
    doc.text(`Pagina ${i} de ${paginas}`, ANCHO - ML, ALTO - 7.5, { align: "right" });
  }

  const nombre = `Informe-Stock_${tituloInforme.replace(/[^\w]+/g, "-")}_${empresa === "TODAS" ? "Todas" : empresa.replace(/[^\w]+/g, "-")}_${hoyISO()}.pdf`;
  if (ventana) {
    ventana.location.href = URL.createObjectURL(doc.output("blob"));
  } else {
    doc.save(nombre);
  }
}

type FotoPDF = { data: string; w: number; h: number };

/** Baja una foto de evidencia y la achica (max 900 px) para que el PDF no pese demasiado. */
async function cargarFoto(ruta: string): Promise<FotoPDF | null> {
  try {
    const url = urlFoto(ruta);
    if (!url) return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    const bitmap = await createImageBitmap(await r.blob());
    const k = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(bitmap.width * k);
    lienzo.height = Math.round(bitmap.height * k);
    const ctx = lienzo.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    bitmap.close();
    return { data: lienzo.toDataURL("image/jpeg", 0.78), w: lienzo.width, h: lienzo.height };
  } catch {
    return null;
  }
}

/** Baja varias fotos a la vez (6 en paralelo) respetando el orden. */
async function cargarFotos(rutas: string[]): Promise<(FotoPDF | null)[]> {
  const salida: (FotoPDF | null)[] = new Array(rutas.length).fill(null);
  let siguiente = 0;
  const obrero = async () => {
    while (siguiente < rutas.length) {
      const i = siguiente++;
      salida[i] = await cargarFoto(rutas[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, rutas.length) }, obrero));
  return salida;
}

type Dia = { fecha: string; entradas: number; salidas: number };

/** Serie diaria del periodo (maximo 92 dias: si es mas largo, se muestran los ultimos). */
function serieRango(movs: Movimiento[], desde: string | null, hasta: string | null): Dia[] {
  const fin = hasta ?? hoyISO();
  const ini0 = desde ?? sumarDias(fin, -29);
  let ini = ini0 < sumarDias(fin, -91) ? sumarDias(fin, -91) : ini0;
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
    if (!d || m.cantidad <= 0) continue;
    if (m.tipo === "entrada") d.entradas += m.cantidad;
    else d.salidas += m.cantidad;
  }
  return serie;
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
