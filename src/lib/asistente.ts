import type { GrupoProducto } from "./derive";
import { nombreProducto, nombreTalla, titulo } from "./format";

export type Genero = "HOMBRE" | "MUJER" | "UNISEX";

/** Lo que entendio el asistente de una frase como "pide 20 polo manga larga fundigsac talla M". */
export type Orden = {
  accion:
    | "agregar"
    | "pedir"
    | "crear"
    | "crear_trabajador"
    | "salida"
    | "anular"
    | "bajo"
    | "consultar"
    | "ver_pedidos"
    | "recibir_pedido"
    | "cancelar_pedido"
    | "resumen"
    | "ayuda";
  cantidad: number | null;
  /** "5 M y 3 L": unidades por talla. */
  porTalla: { talla: string; n: number }[];
  /** "talla M": tallas nombradas sin cantidad propia. */
  tallas: string[];
  /** "en todas las tallas". */
  todas: boolean;
  /** "anula lo ultimo": se refiere al movimiento mas reciente. */
  ultimo: boolean;
  /** Empresas nombradas ("fundigsac", "cosegen"...). */
  empresas: string[];
  /** "para mujer", "de hombre". */
  genero: Genero | null;
  /** "sin stock / agotados" ademas de los "por agotarse". */
  incluirSin: boolean;
  /** "a Diego": a quien se entrega (palabras de su nombre). */
  persona: string[];
  /** Palabras que describen el producto (o el nombre, al crear). */
  palabras: string[];
};

export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const set = (...a: string[]) => new Set(a);

const V_AGREGAR = set(
  "agrega", "agregar", "agregame", "agregue", "agregamos", "anade", "anadir", "anadele", "suma", "sumar", "sumale", "ingresa", "ingresar", "ingreso",
  "llegaron", "llego", "llegan", "recibi", "recibimos", "recibio", "repon", "aumenta", "aumentar", "pon", "poner", "ponle", "registra", "registrar",
  "anota", "anotar", "compre", "compramos", "carga", "cargar", "actualiza", "actualizar",
);
const V_PEDIR = set("pide", "pedir", "pidele", "pedime", "pidamos", "ordena", "ordenar", "encarga", "encargar", "solicita", "solicitar", "compra", "comprar", "requiero", "necesito", "necesitamos");
const V_RECIBIDO = set("llego", "llegaron", "llegado", "recibi", "recibimos", "recibido", "recibio", "entro", "entraron", "ya");
const V_SALIDA = set("saca", "sacar", "resta", "restar", "entrega", "entregar", "entregue", "entrego", "entregan", "entregaron", "entregamos", "entregado", "vendi", "vendimos", "vender", "descuenta", "descontar", "salida", "dale", "dar", "damos", "di", "dio", "regale", "saque", "sacamos", "saco", "entregando", "dandole", "sale", "salio", "salieron");
const V_ANULAR = set("borra", "borrar", "borrame", "elimina", "eliminar", "eliminame", "anula", "anular", "anulame", "deshaz", "deshacer", "cancela", "cancelar", "revierte", "revertir");
const V_CREAR = set("crea", "crear", "creame", "nuevo", "nueva", "registrar", "registra", "agrega", "agregar", "anade", "anadir");
const BAJO = set("bajo", "bajos", "baja", "agotar", "agotarse", "agotando", "agotan", "agotado", "agotados", "acabando", "acabar", "faltan", "falta", "faltantes", "escaso", "escasos", "poco", "pocos", "reponer", "reposicion", "critico", "criticos");
const CONSULTA = set("cuanto", "cuantos", "cuantas", "hay", "ay", "ahy", "tenemos", "tengo", "queda", "quedan", "stock", "disponible", "disponibles", "existencia", "existencias");
const V_PEDI_PASADO = set("pedi", "pedimos", "pedia", "pedian");
const RESUMEN = set("resumen", "situacion", "panorama", "general", "estado");
const STOP = set(
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "en", "por", "para", "a", "al", "y", "e", "o", "con", "sin", "que", "se", "lo", "le",
  "unidad", "unidades", "uds", "ud", "prenda", "prendas", "pieza", "piezas", "stock", "mas", "favor", "quiero", "necesito", "puedes", "podrias", "me", "mi",
  "inventario", "entrada", "entradas", "producto", "productos", "articulo", "articulos", "talla", "tallas", "cada", "todas", "todos", "hay", "tengo", "tenemos",
  "ahora", "hoy", "quita", "quitar", "nuevo", "nueva", "otro", "otra", "ultimo", "ultima", "ultimos", "reciente", "movimiento", "registro", "algo", "eso", "esto",
  "pedido", "pedidos", "pendiente", "pendientes", "cuanto", "cuantos", "cuantas", "como", "esta", "estan", "estamos", "tiene", "tienen", "cual", "cuales", "ver",
  "muestrame", "dime", "dame", "lista", "listar", "mostrar", "muestra", "si", "ya", "gracias", "porfa", "por", "favor", "hola", "buenas", "tambien",
  "color", "colores", "modelo", "tipo", "marca", "diseno",
  "acabo", "acabamos", "acabe", "acabar", "recien", "apenas", "hace", "rato", "momento", "minutos", "queria", "quisiera", "voy", "vamos", "estoy", "haz", "hacer", "hazme", "hagan",
  "equivoque", "perdon", "oye", "oiga", "buenos", "dias", "tardes", "noches", "unas", "veces", "nomas", "pues", "entonces", "bueno", "ok", "okey", "vale", "joven", "senor", "sra",
  "mejor", "peor", "solo", "solamente", "igual", "nuevamente", "vez", "siempre", "nunca", "tal", "asi", "bien", "mal", "muy", "menos", "mucho", "mucha", "todo", "toda", "nada",
  "algun", "alguna", "ningun", "ninguna", "disculpa", "disculpe", "ayudame", "ayuda", "podria", "puede", "pueden", "quieres", "quiere", "queremos", "deseo", "desea", "quedo", "luego",
  "despues", "antes", "primero", "segundo", "ahorita", "ayer", "manana", "semana", "mes", "dia", "pa", "pq", "porque", "xq", "q", "x", "k", "d", "del", "al", "unos", "mismo",
  "unidad", "que", "cuando", "donde", "fue", "era", "son", "es", "soy", "estaba", "estuvo", "esa", "ese", "estos", "estas", "aqui", "alli", "mismo", "misma", "otros", "otras",
);
const TALLA_LETRA = /^(xs|s|m|l|xl|xxl|xxxl|unica)$/;
const TALLA_NUM = /^(2[6-9]|3\d|4[0-6])$/;
const ES_NUM = /^\d{1,6}$/;

const GENEROS: Record<string, Genero> = {
  hombre: "HOMBRE", hombres: "HOMBRE", varon: "HOMBRE", varones: "HOMBRE", caballero: "HOMBRE", caballeros: "HOMBRE", masculino: "HOMBRE",
  mujer: "MUJER", mujeres: "MUJER", dama: "MUJER", damas: "MUJER", femenino: "MUJER",
  unisex: "UNISEX",
};

/** `nombres`: palabras de los nombres de los trabajadores (en minusculas, sin tildes), para reconocer "a Diego". */
const UNIDADES: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300, quinientos: 500, mil: 1000 };

/** "cinco" -> 5, "treinta y cinco" -> 35 (lo que escribe el dictado por voz). "un/una" no se tocan: son articulos. */
function numerosEnLetras(s: string): string {
  const t = s.split(" ").map((w) => (UNIDADES[w] !== undefined ? String(UNIDADES[w]) : w));
  const out: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const a = Number(t[i]);
    const b = Number(t[i + 2]);
    if (/^\d+$/.test(t[i]) && a >= 30 && a <= 90 && a % 10 === 0 && t[i + 1] === "y" && /^\d$/.test(t[i + 2] ?? "") && b >= 1 && b <= 9) {
      out.push(String(a + b));
      i += 2;
    } else out.push(t[i]);
  }
  return out.join(" ");
}

function distancia(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[m][n];
}

/** Lo que el asistente sabe del negocio: nombres de la gente y palabras de los productos. */
export type Contexto = { nombres: Set<string>; vocab: Set<string> };

const PALABRAS_CLAVE = [...V_AGREGAR, ...V_PEDIR, ...V_SALIDA, ...V_ANULAR, "pedido", "pedidos", "trabajador", "pendientes", "resumen", "agotarse", "agotado", "agotados", "acabando", "cuanto", "cuantos", "cuantas", "quedan", "tenemos", "ultimo", "ultima", "nuevo", "nueva", "pendiente"].filter((w) => w.length >= 6);
const CLAVE_EXACTA = ["fundigsac", "cosegen", "hombre", "mujer", "unisex", "talla", "tallas", "importado", "seguridad", "almacen", "pedido", "pedidos", "anula", "anular", "pide", "pedir"];
const CONOCIDAS = new Set<string>([...V_AGREGAR, ...V_PEDIR, ...V_SALIDA, ...V_ANULAR, ...V_CREAR, ...V_PEDI_PASADO, ...BAJO, ...CONSULTA, ...RESUMEN, ...STOP, ...PALABRAS_CLAVE]);
/** Un error de dedo en un verbo ("entrgue", "agragar") se corrige solo; los nombres de producto no se tocan aqui. */
function corregirVerbo(t: string, vocab?: Set<string>): string {
  if (t.length < 4 || CONOCIDAS.has(t) || /\d/.test(t) || /[&/]/.test(t)) return t;
  // Si es una palabra de un producto ("larga", "gorra") no se toca: no es un verbo mal escrito.
  if (vocab && (vocab.has(t) || vocab.has(t.replace(/(es|s)$/, "")))) return t;
  // empresas, hombre/mujer, "talla": se aceptan hasta 4 letras y un error
  for (const v of CLAVE_EXACTA) if (Math.abs(v.length - t.length) <= 1 && distancia(t, v) === 1 && t.length >= 4) return v;
  if (t.length < 5) return t;
  for (const v of PALABRAS_CLAVE) if (Math.abs(v.length - t.length) <= 1 && distancia(t, v) <= (v.length >= 8 ? 2 : 1)) return v;
  return t;
}

/** "dieg" / "gladis" -> el nombre real de un trabajador, solo despues de "a", "al" o "para". */
function corregirNombres(toks: string[], nombres: Set<string>): string[] {
  const lista = Array.from(nombres);
  return toks.map((t, i) => {
    const antes = toks[i - 1];
    if (!["a", "al", "para", "le"].includes(antes ?? "") && !(i > 1 && ["a", "al", "para", "le"].includes(toks[i - 2] ?? "") && nombres.has(antes ?? ""))) return t;
    if (t.length < 4 || nombres.has(t) || CONOCIDAS.has(t) || /\d/.test(t)) return t;
    let mejor = t;
    let md = t.length >= 7 ? 3 : 2;
    for (const n of lista) {
      if (Math.abs(n.length - t.length) > 2) continue;
      const d = distancia(t, n);
      if (d < md) {
        md = d;
        mejor = n;
      }
    }
    return mejor;
  });
}

export function entender(texto: string, ctx?: Contexto): Orden {
  const nombres = ctx?.nombres;
  let toks = numerosEnLetras(norm(texto).replace(/([a-z])\1{2,}/g, "$1").replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2"))
    .replace(/\bc\/f\b/g, "con fundigsac")
    .replace(/\bs\/f\b/g, "sin fundigsac")
    .replace(/[^a-z0-9&/ ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => corregirVerbo(t, ctx?.vocab));
  if (nombres && nombres.size > 0) toks = corregirNombres(toks, nombres);
  const usado = new Set<number>();
  const orden: Orden = { accion: "agregar", cantidad: null, porTalla: [], tallas: [], todas: false, ultimo: false, empresas: [], genero: null, incluirSin: false, persona: [], palabras: [] };

  // ---- Empresas ("fundigsac", "cosegen", "m&l", "polo importado", "seguridad almacen")
  const agregarEmpresa = (e: string) => {
    if (!orden.empresas.includes(e)) orden.empresas.push(e);
  };
  toks.forEach((t, i) => {
    const antes = toks[i - 1];
    if (t === "fundigsac") {
      // "pantalon jeans con fundigsac" es una variante del producto, no la empresa
      if (antes === "con" || antes === "sin") return;
      agregarEmpresa("FUNDIGSAC");
      usado.add(i);
    } else if (t === "cosegen") {
      agregarEmpresa("COSEGEN");
      usado.add(i);
    } else if (t === "m&l" || t === "myl") {
      agregarEmpresa("M&L");
      usado.add(i);
    } else if (t === "importado" || t === "importados") {
      agregarEmpresa("POLO IMPORTADO");
      usado.add(i);
      if (antes === "polo" || antes === "polos") usado.add(i - 1);
    } else if (t === "seguridad") {
      agregarEmpresa("SEGURIDAD ALMACÉN");
      usado.add(i);
      if (toks[i + 1] === "almacen") usado.add(i + 1);
    }
  });
  // ---- A quien (solo si ya sabemos los nombres de la gente): "a diego", "para maria lopez"
  if (nombres && nombres.size > 0) {
    for (let i = 0; i < toks.length && orden.persona.length === 0; i++) {
      if (usado.has(i) || !["a", "al", "para", "entregado"].includes(toks[i])) continue;
      let j = i + 1;
      const trozo: number[] = [];
      while (j < toks.length && !usado.has(j) && nombres.has(toks[j])) trozo.push(j++);
      if (trozo.length === 0) continue;
      orden.persona = trozo.map((k) => toks[k]);
      usado.add(i);
      trozo.forEach((k) => usado.add(k));
    }
    if (orden.persona.length === 0) {
      // "diego" suelto, sin "a": solo si no es parte de una palabra del producto
      const k = toks.findIndex((t, i) => !usado.has(i) && t.length >= 4 && nombres.has(t));
      if (k >= 0) {
        orden.persona = [toks[k]];
        usado.add(k);
      }
    }
  }
  // ---- Genero ("para mujer", "de hombre")
  toks.forEach((t, i) => {
    if (GENEROS[t]) {
      orden.genero = GENEROS[t];
      usado.add(i);
    }
  });

  const hayNumero = toks.some((t, i) => ES_NUM.test(t) && !usado.has(i));
  const tiene = (c: Set<string>) => toks.some((t) => c.has(t));
  const hayPedido = toks.some((t) => t === "pedido" || t === "pedidos");
  const hayAnular = tiene(V_ANULAR) || (toks.some((t) => t === "quita" || t === "quitar") && !hayNumero);
  const hayPedir = tiene(V_PEDIR);
  const hayAgregar = tiene(V_AGREGAR);
  const haySalida = tiene(V_SALIDA) || (toks.some((t) => t === "quita" || t === "quitar") && hayNumero);
  const hayBajo = tiene(BAJO);
  const nombraTrabajador = toks.some((t) => ["trabajador", "trabajadora", "persona", "empleado", "empleada"].includes(t));
  const nombraProducto = toks.some((t) => ["producto", "prenda", "articulo"].includes(t));
  const dicePorNuevo = toks.some((t) => ["nuevo", "nueva", "crea", "crear", "creame"].includes(t));
  orden.ultimo = toks.some((t) => ["ultimo", "ultima", "reciente"].includes(t));
  orden.incluirSin = toks.includes("agotado") || toks.includes("agotados") || (toks.includes("sin") && (toks.includes("stock") || toks.includes("existencia")));

  // ---- Que quiere hacer (la primera regla que encaje)
  const acc = (() => {
    // "ya llegaron los cascos que pedí": lo que llegó es un pedido hecho antes
    if (tiene(V_PEDI_PASADO) && toks.some((t) => ["llego", "llegaron", "llegado", "recibi", "recibimos", "recibido", "recibio", "entro", "entraron"].includes(t)) && !hayNumero) return "recibir_pedido" as const;
    if (hayAnular && hayPedido) return "cancelar_pedido" as const;
    if (hayAnular && !nombraTrabajador) return "anular" as const;
    if (hayPedido && tiene(V_RECIBIDO) && !hayNumero) return "recibir_pedido" as const;
    if (hayPedido && (hayNumero || hayPedir || dicePorNuevo)) return "pedir" as const;
    if (hayPedido) return "ver_pedidos" as const;
    if (hayPedir) return "pedir" as const;
    if ((hayBajo || orden.incluirSin) && !hayNumero) return "bajo" as const;
    if (haySalida && !hayAgregar) return "salida" as const;
    if (nombraTrabajador && (dicePorNuevo || tiene(V_CREAR))) return "crear_trabajador" as const;
    if (dicePorNuevo && !hayNumero) return "crear" as const;
    if (tiene(V_CREAR) && nombraProducto && !hayNumero) return "crear" as const;
    if (hayAgregar || hayNumero) return "agregar" as const;
    if (tiene(CONSULTA)) return "consultar" as const;
    if (tiene(RESUMEN)) return "resumen" as const;
    return "ayuda" as const;
  })();
  // "Diego recibió un polo" / "agrega un polo para Diego": con una persona de por medio es una entrega.
  let accion: Orden["accion"] = acc;
  if (accion === "agregar" && orden.persona.length > 0 && !toks.includes("llegaron") && !toks.includes("llego") && !toks.includes("llegan")) accion = "salida";
  orden.accion = accion;

  // Entrega a alguien que no esta en la lista ("... a pedro ramos"): lo que sigue al ultimo "a" es la persona.
  if (accion === "salida" && orden.persona.length === 0) {
    const ia = Math.max(toks.lastIndexOf("a"), toks.lastIndexOf("al"));
    if (ia >= 0) {
      const cola = toks.map((t, i) => ({ t, i })).filter(({ t, i }) => i > ia && !usado.has(i) && !ES_NUM.test(t) && !STOP.has(t) && t !== "talla" && t !== "tallas" && !TALLA_LETRA.test(t) && !TALLA_NUM.test(t) && t.length >= 2);
      if (cola.length >= 1 && cola.length <= 4) {
        orden.persona = cola.map((x) => x.t);
        usado.add(ia);
        cola.forEach((x) => usado.add(x.i));
      }
    }
  }

  // ---- Tallas: "talla M", "tallas M y L", "talla 32"
  for (let i = 0; i < toks.length; i++) {
    if (usado.has(i) || (toks[i] !== "talla" && toks[i] !== "tallas")) continue;
    usado.add(i);
    for (let j = i + 1; j < toks.length; j++) {
      const t = toks[j];
      if (TALLA_LETRA.test(t) || TALLA_NUM.test(t)) {
        orden.tallas.push(t);
        usado.add(j);
      } else if (t === "y" || t === "e" || t === "o") usado.add(j);
      else break;
    }
  }
  // "5 M", "3 en L", "5 de talla M": unidades de esa talla
  for (let i = 0; i < toks.length; i++) {
    if (usado.has(i) || !ES_NUM.test(toks[i])) continue;
    let j = i + 1;
    while (j < toks.length && ["de", "en", "talla", "tallas", "la"].includes(toks[j])) j++;
    if (j < toks.length && TALLA_LETRA.test(toks[j]) && !usado.has(j)) {
      orden.porTalla.push({ talla: toks[j], n: Number(toks[i]) });
      for (let k = i; k <= j; k++) usado.add(k);
    }
  }
  if (toks.some((t) => t === "cada" || t === "todas" || t === "todos")) orden.todas = true;
  // Cantidad: el primer numero que quede
  for (let i = 0; i < toks.length; i++) {
    if (usado.has(i) || !ES_NUM.test(toks[i])) continue;
    const n = Number(toks[i]);
    if (n > 0 && n <= 100000) {
      orden.cantidad = n;
      usado.add(i);
      break;
    }
  }
  if (orden.cantidad === null && orden.porTalla.length === 0 && ["agregar", "salida", "pedir"].includes(accion)) {
    const k = toks.findIndex((t, i) => ["un", "una", "uno"].includes(t) && !usado.has(i) && toks[i + 1] !== undefined && !["producto", "trabajador", "pedido", "talla", "tallas"].includes(toks[i + 1]));
    if (k >= 0) {
      orden.cantidad = 1;
      usado.add(k);
    }
  }
  const relleno = accion === "crear_trabajador" ? new Set(["trabajador", "trabajadora", "persona", "empleado", "empleada", "llamado", "llamada"]) : new Set<string>();
  orden.palabras = toks.filter(
    (t, i) =>
      !usado.has(i) &&
      !ES_NUM.test(t) &&
      (!STOP.has(t) || ((t === "con" || t === "sin") && toks[i + 1] === "fundigsac")) &&
      !V_AGREGAR.has(t) &&
      !V_SALIDA.has(t) &&
      !V_CREAR.has(t) &&
      !V_ANULAR.has(t) &&
      !V_PEDIR.has(t) &&
      !V_RECIBIDO.has(t) &&
      !(BAJO.has(t) && (acc === "bajo" || acc === "pedir")) &&
      !(CONSULTA.has(t) && acc === "consultar") &&
      !(RESUMEN.has(t) && acc === "resumen") &&
      !relleno.has(t),
  );
  return orden;
}

export const coincide = (haystack: string, palabra: string) =>
  haystack.includes(palabra) ||
  (palabra.length > 3 && palabra.endsWith("es") && haystack.includes(palabra.slice(0, -2))) ||
  (palabra.length > 2 && palabra.endsWith("s") && haystack.includes(palabra.slice(0, -1)));

/** Las prendas de seguridad (cascos, guantes...) sirven para cualquiera. */
export const esSeguridad = (g: GrupoProducto) => norm(g.empresa).includes("seguridad");

export type Filtro = { palabras: string[]; empresas: string[]; genero: Genero | null };

/** Productos que encajan: cada palabra debe estar en el nombre; la empresa y el genero filtran. */
export function filtrarCatalogo(grupos: GrupoProducto[], f: Filtro): GrupoProducto[] {
  if (f.palabras.length === 0) return [];
  return grupos
    .filter((g) => f.empresas.length === 0 || f.empresas.includes(g.empresa))
    .filter((g) => !f.genero || g.genero === f.genero || !g.genero || g.genero === "UNISEX" || esSeguridad(g))
    .filter((g) => {
      const hay = norm(nombreProducto(g.producto, g.empresa));
      return f.palabras.every((p) => coincide(hay, p));
    })
    .sort((a, b) => nombreProducto(a.producto, a.empresa).length - nombreProducto(b.producto, b.empresa).length || a.empresa.localeCompare(b.empresa, "es"));
}

/** Si nada encaja, productos que tienen al menos una de las palabras (para sugerir). */
export function sugerirProductos(grupos: GrupoProducto[], palabras: string[]): GrupoProducto[] {
  return grupos
    .map((g) => {
      const hay = norm(nombreProducto(g.producto, g.empresa));
      return { g, score: palabras.filter((p) => coincide(hay, p)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.g);
}

/** Talla del producto que corresponde a "m", "xl", "32", "unica". */
export function tallaDe(g: GrupoProducto, pedida: string) {
  const p = norm(pedida);
  return g.tallas.find((t) => norm(nombreTalla(t.talla)) === p) ?? null;
}

const TALLA_SUELTA = "(?:xs|s|m|l|xl|xxl|xxxl|unica)";

/**
 * Una frase puede traer varios pedidos: "agrega 5 polo manga larga fundigsac talla M y 3 camisero blanco hombre talla L".
 * Se corta cuando, despues de "y" o de una coma, empieza otra cantidad con otro producto
 * ("5 M y 3 L" NO se corta: es la misma prenda en dos tallas).
 */
export function entenderVarios(texto: string, ctx?: Contexto): Orden[] {
  const base = entender(texto, ctx);
  if (base.accion !== "agregar" && base.accion !== "pedir") return [base];
  const limpio = norm(texto)
    .replace(/[^a-z0-9&/,;+ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const corte = new RegExp(String.raw`\s*(?:,|;|\+|\sy\s|\s(?:ademas|tambien|luego|despues)\s)\s*(?=\d+\s+(?!` + TALLA_SUELTA + String.raw`\b))`, "g");
  const partes = limpio.replace(corte, "|").split("|").map((p) => p.trim()).filter(Boolean);
  if (partes.length <= 1) return [base];
  const ordenes = partes.map((p) => entender(p, ctx));
  // La primera parte manda: si dice "pide", todas son pedidos.
  const accion = ordenes[0].accion === "pedir" ? "pedir" : "agregar";
  return ordenes.map((o) => ({ ...o, accion: o.accion === "agregar" || o.accion === "pedir" ? accion : o.accion }));
}

/** Trabajadores cuyo nombre contiene TODAS las palabras dichas ("diego" -> Diego Ulises Soto Quispe). */
export function buscarPersona<T extends { trabajador: string }>(trabajadores: T[], palabras: string[]): T[] {
  if (palabras.length === 0) return [];
  return trabajadores.filter((t) => {
    const hay = norm(t.trabajador);
    return palabras.every((w) => hay.includes(w));
  });
}

/** Palabras sueltas de los nombres de todos los trabajadores. */
export function nombresConocidos(trabajadores: { trabajador: string }[]): Set<string> {
  const out = new Set<string>();
  for (const t of trabajadores) for (const w of norm(t.trabajador).split(/\s+/)) if (w.length >= 3) out.add(w);
  return out;
}

/** Palabras del nombre de todos los productos (para corregir errores de dedo: "camsiero" -> "camisero"). */
function vocabulario(grupos: GrupoProducto[]): string[] {
  const v = new Set<string>();
  for (const g of grupos) for (const w of norm(nombreProducto(g.producto, g.empresa)).split(/[^a-z0-9&]+/)) if (w.length >= 3) v.add(w);
  return Array.from(v);
}

/** Cada palabra que no existe se cambia por la parecida mas cercana del catalogo (una letra de diferencia, dos si es larga). */
export function corregirPalabras(grupos: GrupoProducto[], palabras: string[]): string[] {
  const vocab = vocabulario(grupos);
  return palabras.map((w) => {
    if (w.length < 4 || vocab.some((x) => coincide(x, w))) return w;
    let mejor = w;
    let mejorD = w.length >= 7 ? 3 : 2;
    const sing = w.replace(/s$/, "");
    for (const x of vocab) {
      if (Math.abs(x.length - w.length) > 2) continue;
      const d = Math.min(distancia(w, x), distancia(sing, x));
      if (d < mejorD) {
        mejorD = d;
        mejor = x;
      }
    }
    return mejor;
  });
}

/**
 * Como filtrarCatalogo, pero tolerante: arregla errores de dedo y, si alguna palabra no existe en el catalogo
 * ("acabo", "ayer"), la ignora y busca con las demas.
 */
export function buscarFlexible(grupos: GrupoProducto[], f: Filtro): { grupos: GrupoProducto[]; palabras: string[]; ignoradas: string[] } {
  const corregidas = corregirPalabras(grupos, f.palabras);
  let c = filtrarCatalogo(grupos, { ...f, palabras: corregidas });
  if (c.length > 0) return { grupos: c, palabras: corregidas, ignoradas: [] };
  const utiles = corregidas.filter((w) => grupos.some((g) => coincide(norm(nombreProducto(g.producto, g.empresa)), w)));
  if (utiles.length > 0 && utiles.length < corregidas.length) {
    c = filtrarCatalogo(grupos, { ...f, palabras: utiles });
    if (c.length > 0) return { grupos: c, palabras: utiles, ignoradas: corregidas.filter((w) => !utiles.includes(w)) };
  }
  return { grupos: [], palabras: corregidas, ignoradas: [] };
}

/** Todas las palabras de los nombres de producto (para no confundirlas con verbos mal escritos). */
export function vocabularioCatalogo(grupos: GrupoProducto[]): Set<string> {
  const v = new Set<string>();
  for (const g of grupos) for (const w of norm(nombreProducto(g.producto, g.empresa)).split(/[^a-z0-9&]+/)) if (w.length >= 3) v.add(w);
  return v;
}

const PALABRAS_GENERO = new Set(["hombre", "mujer", "unisex"]);
const LIGERAS = new Set(["de", "del", "la", "el", "los", "las", "para", "en", "y"]);
const EMPRESAS_EN_NOMBRE = new Set(["fundigsac", "cosegen", "m&l"]);
export type Tipo = { clave: string; etiqueta: string; palabras: string[]; grupos: GrupoProducto[] };

/**
 * Los "tipos" de una prenda: Polo Manga Larga, Polo Manga Corta... (sin contar empresa ni hombre/mujer).
 * `especificado` es true cuando lo que escribiste ya nombra el tipo completo ("polo manga larga") y no hay otros
 * tipos que lo continúen ("pantalon jeans" -> azul, gris, negro...). Si solo dijiste "polo", hay que preguntar de qué tipo.
 */
export function tiposDe(candidatos: GrupoProducto[], escritas: string[]): { tipos: Tipo[]; especificado: boolean } {
  const m = new Map<string, Tipo>();
  for (const g of candidatos) {
    const nombre = nombreProducto(g.producto, g.empresa);
    const todas = norm(nombre)
      .split(/[^a-z0-9&]+/)
      .filter((w) => w && !PALABRAS_GENERO.has(w));
    // "- Fundigsac" al final del nombre es la empresa, no un tipo; "con/sin Fundigsac" si lo es
    const palabras = todas.filter((w, i) => !LIGERAS.has(w) && !(EMPRESAS_EN_NOMBRE.has(w) && todas[i - 1] !== "con" && todas[i - 1] !== "sin"));
    const clave = palabras.join(" ");
    const etiqueta = titulo(
      nombre
        .split(/\s+/)
        .filter((w) => !PALABRAS_GENERO.has(norm(w)))
        .join(" ")
        .replace(/\s+-\s+\S+$/, ""),
    );
    const t = m.get(clave) ?? { clave, etiqueta, palabras, grupos: [] };
    t.grupos.push(g);
    m.set(clave, t);
  }
  const tipos = Array.from(m.values()).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
  const cubre = (t: Tipo) => t.palabras.every((pw) => escritas.some((w) => coincide(pw, w) || coincide(w, pw)));
  return { tipos, especificado: tipos.length > 0 && tipos.every(cubre) };
}
