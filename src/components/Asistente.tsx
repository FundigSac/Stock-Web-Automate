import { Bot, Camera, Loader2, Mic, Send, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  buscarFlexible,
  buscarPersona,
  coincide,
  entender,
  entenderVarios,
  esSeguridad,
  nombresConocidos,
  vocabularioCatalogo,
  type Contexto,
  norm,
  sugerirProductos,
  tiposDe,
  type Tipo,
  tallaDe,
  type Genero,
  type Orden,
} from "../lib/asistente";
import { agruparProductos, estadoDe, movimientosDe, type GrupoProducto } from "../lib/derive";
import { entero, etiquetaTalla, fechaCorta, hoyISO, nombreProducto, nombreTalla, partirMovimiento, titulo } from "../lib/format";
import { comprimirFoto, subirFoto } from "../lib/foto";
import { esImagen, esPdf, MAX_TEXTO, textoDeArchivo } from "../lib/archivo";
import { aBase64, consultarIA, type AccionIA, type AccionMov, type RespuestaIA, type TurnoIA } from "../lib/ia";
import { supabase } from "../lib/supabase";
import type { Datos, Movimiento, StockItem } from "../lib/types";
import { cn } from "../lib/utils";
import { Boton, Ventana } from "./ui";

type Opcion = { texto: string; accion: () => void };
type Mensaje = {
  id: number;
  de: "yo" | "bot";
  texto: string;
  imagen?: string;
  opciones?: Opcion[];
  /** Movimiento ya guardado: permite deshacerlo. */
  hecho?: { ids: number[]; tipo: "entrada" | "salida"; deshecho: boolean };
};

type Modo = "entrada" | "salida" | "pedido";
type Persona = { nombre: string; genero: Genero | null; area: string | null };
type Plan = { tipoOk?: boolean; modo: Modo; orden: Orden; empresas: string[]; genero: Genero | null; grupo: GrupoProducto | null; cantidad: number | null; codigos: string[] | null; todas: boolean };
type Linea = { g: GrupoProducto; t: StockItem; n: number };
type Paso = { modo: Modo; persona: Persona | null; ls: Linea[]; cliente: boolean };
type GrupoPedido = { clave: string; ids: number[]; nombre: string; empresa: string; fecha: string; por: string | null; lineas: { talla: string; cantidad: number }[]; total: number };

const EJEMPLOS = [
  "¿Qué está por agotarse?",
  "Agrega 10 polo manga larga fundigsac talla M",
  "Entregué un camisero blanco hombre talla M a Diego",
  "Pide 20 guantes de hilo",
  "Pedidos pendientes",
];

let contador = 0;

/** Reconocimiento de voz del navegador (Chrome/Android): convierte lo que dices en texto. */
type Reconocedor = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
const crearReconocedor = (): Reconocedor | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
};

const etiquetaGrupo = (g: GrupoProducto) =>
  `${nombreProducto(g.producto, g.empresa)} · ${titulo(g.empresa)}${g.genero && !esSeguridad(g) ? ` · ${titulo(g.genero)}` : ""} (${g.tallas
    .slice(0, 6)
    .map((t) => nombreTalla(t.talla))
    .join(" ")})`;

export function AsistenteDialog({
  abierto,
  alCerrar,
  datos,
  minimo,
  autor,
  avisar,
  crearProducto,
  crearTrabajador,
  iniciar,
  consumirIniciar,
}: {
  abierto: boolean;
  alCerrar: () => void;
  datos: Datos;
  minimo: number;
  autor: string;
  avisar: (texto: string, error?: boolean) => void;
  crearProducto: (inicial: { nombre?: string }) => void;
  crearTrabajador: (nombre: string) => void;
  iniciar: string | null;
  consumirIniciar: () => void;
}) {
  const stock = datos.stock;
  const trabajadores = datos.trabajadores;
  const grupos = useMemo(() => agruparProductos(stock, minimo), [stock, minimo]);
  const empresaDe = useMemo(() => new Map(stock.map((s) => [s.codigo, s.empresa])), [stock]);
  const nombres = useMemo(() => nombresConocidos(trabajadores), [trabajadores]);
  const contexto = useMemo<Contexto>(() => ({ nombres, vocab: vocabularioCatalogo(grupos) }), [nombres, grupos]);
  /** Movimientos que siguen vigentes, del mas reciente al mas antiguo. */
  const recientes = useMemo(() => movimientosDe(datos, false), [datos]);

  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const espera = useRef<{ tipo: "numero" | "texto"; fn: (v: never) => void } | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const alElegirFoto = useRef<((b: Blob) => void) | null>(null);
  /** Foto que ya mandaste por el chat (boton de la camara): se usa en la siguiente entrega o entrada. */
  const fotoRef = useRef<Blob | null>(null);
  const [fotoVista, setFotoVista] = useState<string | null>(null);
  const voz = useRef<Reconocedor | null>(null);
  const textoVoz = useRef("");
  const procesarRef = useRef<(t: string, eco?: boolean) => void>(() => {});
  /** Conversacion con la IA (para que entienda "sí", "el de mujer", etc.) y el documento que se está leyendo. */
  const historialIA = useRef<TurnoIA[]>([]);
  const docRef = useRef<{ blob: Blob | null; b64: string | null; media: string; texto: string | null } | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const modoDoc = useRef(false);

  const bot = (t: string, extra?: Partial<Mensaje>) => {
    const id = ++contador;
    setMensajes((m) => [...m, { id, de: "bot", texto: t, ...extra }]);
    return id;
  };
  const yo = (t: string, imagen?: string) => setMensajes((m) => [...m, { id: ++contador, de: "yo", texto: t, imagen }]);
  /** Boton que, al pulsarlo, queda escrito como si lo hubieras dicho tu. */
  const eligio = (t: string, fn: () => void) => () => {
    yo(t);
    fn();
  };
  const cerrarOpciones = () => setMensajes((ms) => ms.map((m) => (m.opciones ? { ...m, opciones: undefined } : m)));
  /** Cualquier boton que pulses deja de esperar lo que estabas escribiendo. */
  const op = (t: string, accion: () => void): Opcion => ({
    texto: t,
    accion: () => {
      espera.current = null;
      accion();
    },
  });
  const quitarFoto = () => {
    fotoRef.current = null;
    alElegirFoto.current = null;
    setFotoVista((v) => {
      if (v) URL.revokeObjectURL(v);
      return null;
    });
  };
  const cancelado = () => {
    cerrarOpciones();
    quitarFoto();
    docRef.current = null;
    modoDoc.current = false;
    bot("Listo, no toqué nada.");
  };

  useEffect(() => {
    if (abierto && mensajes.length === 0) {
      bot("Hola 👋 Soy tu asistente de stock. Escribe o dicta (🎤): agrego stock, registro entregas con foto, hago pedidos y te aviso qué se está agotando.", {
        opciones: EJEMPLOS.map((e) => op(e, () => procesarRef.current(e))),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes]);

  // Si lo abren desde otro sitio con una pregunta (por ejemplo "pedidos pendientes"), la responde sola.
  useEffect(() => {
    if (abierto && iniciar) {
      const t = iniciar;
      consumirIniciar();
      window.setTimeout(() => procesarRef.current(t), 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, iniciar]);

  useEffect(() => {
    if (!abierto) voz.current?.stop();
  }, [abierto]);

  // ---------------------------------------------------------------- entrada de texto
  function procesar(entrada: string, eco = true) {
    const t = entrada.trim();
    if (!t) return;
    cerrarOpciones();
    if (eco) yo(t);
    setTexto("");

    const e = espera.current;
    if (e) {
      if (/^\s*(cancela|cancelar|olvidalo|olvídalo|no)\s*$/i.test(t)) {
        espera.current = null;
        bot("Listo, lo dejamos ahí.");
        return;
      }
      if (e.tipo === "numero" && /^\d{1,6}$/.test(t.replace(/\s*(unidades|uds?)$/i, "").trim())) {
        espera.current = null;
        (e.fn as (n: number) => void)(Number.parseInt(t, 10));
        return;
      }
      if (e.tipo === "texto") {
        espera.current = null;
        (e.fn as (s: string) => void)(t);
        return;
      }
      espera.current = null;
    }

    const ordenes = entenderVarios(t, contexto);
    // Lo simple (qué se agota, pedidos, resumen) se responde al instante; lo demás lo entiende la IA.
    if (["bajo", "ver_pedidos", "resumen"].includes(ordenes[0].accion)) {
      procesarLocal(t, ordenes);
      return;
    }
    void preguntarIA(t);
  }

  /** Plan B sin IA: reglas del chat de siempre. */
  function procesarLocal(t: string, ordenes: Orden[] = entenderVarios(t, contexto)) {
    const o = ordenes[0];
    switch (o.accion) {
      case "agregar":
        iniciarCola("entrada", ordenes, null);
        break;
      case "pedir":
        if (o.palabras.length === 0 && o.cantidad === null && o.porTalla.length === 0) mostrarBajos(o, true);
        else iniciarCola("pedido", ordenes, null);
        break;
      case "salida":
        resolverPersona(o, (persona) => iniciarCola("salida", [o], persona));
        break;
      case "bajo":
        mostrarBajos(o, false);
        break;
      case "consultar":
        consultar(o);
        break;
      case "ver_pedidos":
        verPedidos();
        break;
      case "recibir_pedido":
        elegirPedido(o, "llegó", confirmarRecibir);
        break;
      case "cancelar_pedido":
        elegirPedido(o, "cancelo", confirmarCancelarPedido);
        break;
      case "resumen":
        resumen();
        break;
      case "anular":
        if (/\b(producto|productos|trabajador|trabajadora|persona|empleado)\b/i.test(norm(t))) {
          bot("Los productos y los trabajadores no se borran desde aquí, para no perder su historial. Sí puedo anular un movimiento (una entrada o una salida) si te equivocaste.");
        } else anularFlujo(o);
        break;
      case "crear": {
        const nombre = titulo(o.palabras.join(" "));
        bot(nombre ? `Abro el formulario para crear «${nombre}». Ahí eliges la empresa y las tallas.` : "Abro el formulario para crear el producto.");
        crearProducto({ nombre });
        break;
      }
      case "crear_trabajador": {
        const nombre = titulo(o.palabras.join(" "));
        bot(nombre ? `Abro el formulario para agregar a ${nombre}. Ahí eliges el área y si es hombre o mujer.` : "Abro el formulario para agregar al trabajador.");
        crearTrabajador(nombre);
        break;
      }
      default: {
        // Sin verbo claro pero con un producto ("polo manga larga fundigsac"): se pregunta que quiere hacer.
        const hallado = o.palabras.length > 0 ? buscarFlexible(grupos, { palabras: o.palabras, empresas: o.empresas, genero: o.genero }) : null;
        if (hallado && hallado.grupos.length > 0 && hallado.grupos.length <= 12) {
          const g1 = hallado.grupos[0];
          const nombreP = hallado.grupos.length === 1 ? `«${nombreProducto(g1.producto, g1.empresa)} · ${titulo(g1.empresa)}»` : `«${titulo(hallado.palabras.join(" "))}»`;
          const conPalabras = (accion: Orden["accion"]): Orden => ({ ...o, accion, palabras: hallado.palabras });
          bot(`Entendí que hablas de ${nombreP}. ¿Qué quieres hacer?`, {
            opciones: [
              op("Ver cuánto hay", eligio("Ver cuánto hay", () => consultar(conPalabras("consultar")))),
              op("Agregar stock", eligio("Agregar stock", () => iniciarCola("entrada", [conPalabras("agregar")], null))),
              op("Entregarlo a alguien", eligio("Entregarlo a alguien", () => resolverPersona(conPalabras("salida"), (persona) => iniciarCola("salida", [conPalabras("salida")], persona)))),
              op("Hacer un pedido", eligio("Hacer un pedido", () => iniciarCola("pedido", [conPalabras("pedir")], null))),
            ],
          });
          break;
        }
        bot("Puedo: agregar stock, registrar entregas con foto, hacer y recibir pedidos, decirte qué se agota o cuánto hay de algo, y anular un registro. Prueba así:", {
          opciones: EJEMPLOS.map((x) => op(x, () => procesarRef.current(x))),
        });
      }
    }
  }
  procesarRef.current = procesar;

  // ---------------------------------------------------------------- voz
  const ayudaMicrofono = () =>
    bot(
      "El micrófono está bloqueado para esta página. Para activarlo:\n1) Toca el candado 🔒 (o los ⋮) junto a la dirección de arriba.\n2) Entra a Permisos → Micrófono → Permitir.\n3) Recarga la página y toca 🎤 otra vez.\n\nSi usas iPhone: Ajustes → Safari → Micrófono → Preguntar, y Ajustes → General → Teclado → Activar dictado.\nMientras tanto puedes dictar con el micrófono del teclado del celular.",
    );

  /** Pide el permiso del microfono de forma explicita (sale la ventanita del navegador) antes de dictar. */
  async function permitirMicrofono(): Promise<boolean> {
    try {
      const estado = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      if (estado?.state === "denied") {
        ayudaMicrofono();
        return false;
      }
    } catch {
      /* algunos navegadores no soportan consultar el permiso */
    }
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try {
      const flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
      flujo.getTracks().forEach((t) => t.stop());
      return true;
    } catch (e) {
      const nombre = e instanceof DOMException ? e.name : "";
      if (nombre === "NotFoundError" || nombre === "OverconstrainedError") bot("No encuentro un micrófono en este dispositivo.");
      else ayudaMicrofono();
      return false;
    }
  }

  async function dictar() {
    if (escuchando) {
      voz.current?.stop();
      return;
    }
    const rec = crearReconocedor();
    if (!rec) {
      bot("Este navegador no permite el dictado por voz. En el celular abre la página en Chrome (no dentro de WhatsApp u otra app), o usa el micrófono del teclado.");
      return;
    }
    if (!(await permitirMicrofono())) return;
    rec.lang = "es-PE";
    rec.interimResults = true;
    rec.continuous = false;
    textoVoz.current = "";
    rec.onresult = (ev) => {
      let t = "";
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      textoVoz.current = t;
      setTexto(t);
    };
    rec.onend = () => {
      setEscuchando(false);
      const t = textoVoz.current.trim();
      textoVoz.current = "";
      if (t) procesarRef.current(t);
    };
    rec.onerror = (ev) => {
      setEscuchando(false);
      textoVoz.current = "";
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") ayudaMicrofono();
      else if (ev.error !== "no-speech" && ev.error !== "aborted") bot("No pude escucharte bien. Inténtalo otra vez o escribe tu pedido.");
    };
    voz.current = rec;
    try {
      rec.start();
      setEscuchando(true);
    } catch {
      setEscuchando(false);
    }
  }

  // ---------------------------------------------------------------- foto
  async function fotoElegida(archivo: File | undefined) {
    if (!archivo) return;
    setTrabajando(true);
    try {
      if (modoDoc.current) {
        modoDoc.current = false;
        const doc = await comprimirFoto(archivo, 1800);
        yo("📄 Documento enviado", URL.createObjectURL(doc));
        docRef.current = { blob: doc, b64: await aBase64(doc), media: "image/jpeg", texto: null };
        historialIA.current = [];
        await preguntarIA("");
        return;
      }
      const blob = await comprimirFoto(archivo);
      const url = URL.createObjectURL(blob);
      yo("📷 Foto enviada", url);
      const pedida = alElegirFoto.current;
      // Siempre queda guardada: si estaba esperando una foto la usa; si no, se usa en el siguiente pedido.
      fotoRef.current = blob;
      setFotoVista((v) => {
        if (v) URL.revokeObjectURL(v);
        return URL.createObjectURL(blob);
      });
      if (pedida) {
        alElegirFoto.current = null;
        pedida(blob);
      } else {
        bot("📎 Foto lista. Ahora dime qué entregas o qué llegó, por ejemplo «entregué 2 casco blanco a Diego», y la mando junto con el registro.");
      }
    } catch (e) {
      bot(`No pude leer la foto: ${e instanceof Error ? e.message : "inténtalo con otra"}`);
    } finally {
      setTrabajando(false);
    }
  }
  /** PDF, Excel, CSV o Word: se lee y la IA arma los movimientos como con la foto de una hoja. */
  async function archivoElegido(f: File | undefined) {
    if (!f) return;
    if (esImagen(f)) {
      modoDoc.current = true;
      await fotoElegida(f);
      return;
    }
    modoDoc.current = false;
    setTrabajando(true);
    try {
      if (esPdf(f)) {
        if (f.size > 5_000_000) throw new Error("El PDF pesa más de 5 MB. Sube uno más liviano o una foto.");
        docRef.current = { blob: null, b64: await aBase64(f), media: "application/pdf", texto: null };
      } else {
        const texto = await textoDeArchivo(f);
        if (!texto.trim()) throw new Error("El archivo está vacío.");
        if (texto.length > MAX_TEXTO) bot("El archivo es muy grande: leo solo las primeras filas. Si falta algo, súbelo en partes.");
        docRef.current = { blob: null, b64: null, media: "image/jpeg", texto: texto.slice(0, MAX_TEXTO) };
      }
      yo(`📎 ${f.name}`);
      historialIA.current = [];
      await preguntarIA("");
    } catch (e) {
      docRef.current = null;
      bot(`No pude leer el archivo: ${e instanceof Error ? e.message : "inténtalo con otro"}`);
    } finally {
      setTrabajando(false);
    }
  }

  /** Boton de la camara del chat: se puede mandar la foto antes de decir qué entregas. */
  function adjuntarFoto() {
    cerrarOpciones();
    alElegirFoto.current = null;
    bot("¿Qué foto mandas?", {
      opciones: [op("📄 Documento con cambios (foto, PDF, Excel o Word)", () => origenFoto(true)), op("📷 Evidencia de una entrega", () => origenFoto(false)), op("Cancelar", cancelado)],
    });
  }
  function origenFoto(documento: boolean) {
    cerrarOpciones();
    modoDoc.current = documento;
    bot(documento ? "Si es una hoja, ponla de frente y con buena luz. ¿Cómo la subes?" : "¿Cómo quieres mandar la foto?", {
      opciones: [
        op("📷 Tomar foto", () => camara.current?.click()),
        op("🖼️ Elegir de galería", () => galeria.current?.click()),
        ...(documento ? [op("📎 Archivo (PDF, Excel, Word)", () => archivo.current?.click())] : []),
        op("Cancelar", cancelado),
      ],
    });
  }

  function pedirFoto(t: string, alElegir: (b: Blob) => void) {
    modoDoc.current = false;
    alElegirFoto.current = alElegir;
    bot(t, { opciones: [op("📷 Tomar foto", () => camara.current?.click()), op("🖼️ Elegir de galería", () => galeria.current?.click()), op("Cancelar", cancelado)] });
  }

  // ---------------------------------------------------------------- utilidades de conversacion
  function pedirNumero(t: string, sugeridos: number[], fn: (n: number) => void) {
    espera.current = { tipo: "numero", fn };
    bot(t, {
      opciones: sugeridos.map((n) =>
        op(
          String(n),
          eligio(String(n), () => {
            espera.current = null;
            fn(n);
          }),
        ),
      ),
    });
  }

  const aPersona = (t: { trabajador: string; genero: Genero | null; area: string | null }): Persona => ({ nombre: t.trabajador, genero: t.genero ?? null, area: t.area });

  /** "a Diego": busca a la persona en la lista de trabajadores. */
  function resolverPersona(o: Orden, listo: (p: Persona) => void) {
    const buscar = (palabras: string[]) => {
      const c = buscarPersona(trabajadores, palabras);
      if (c.length === 1) {
        bot(`Entrega para ${titulo(c[0].trabajador)}${c[0].area ? ` · ${titulo(c[0].area)}` : ""}.`);
        listo(aPersona(c[0]));
      } else if (c.length > 1) {
        bot("¿A cuál de ellos?", {
          opciones: c.slice(0, 8).map((t) => op(`${titulo(t.trabajador)}${t.area ? ` · ${titulo(t.area)}` : ""}`, eligio(titulo(t.trabajador), () => listo(aPersona(t))))),
        });
      } else {
        const nombre = titulo(palabras.join(" "));
        bot(`No encuentro a «${nombre}» en la lista de trabajadores.`, {
          opciones: [
            op(`Registrar a «${nombre}» como cliente`, eligio("Como cliente", () => listo({ nombre: palabras.join(" ").toUpperCase(), genero: null, area: null }))),
            op("Agregar trabajador nuevo", () => crearTrabajador(nombre)),
          ],
        });
      }
    };
    if (o.persona.length > 0) buscar(o.persona);
    else {
      bot("¿A quién se lo entregas? Escribe su nombre.");
      espera.current = {
        tipo: "texto",
        fn: (t: string) => buscar(norm(t).split(/\s+/).filter((w) => w.length >= 2 && !["a", "al", "para", "el", "la", "de"].includes(w))),
      };
    }
  }

  // ---------------------------------------------------------------- elegir producto, talla y cantidad
  /** "42 uds (S 7, M 1, L 17)" o "sin stock" */
  function textoStock(gs: GrupoProducto[]) {
    const tallas = new Map<string, number>();
    for (const g of gs) for (const t of g.tallas) if (t.queda > 0) tallas.set(nombreTalla(t.talla), (tallas.get(nombreTalla(t.talla)) ?? 0) + t.queda);
    const total = Array.from(tallas.values()).reduce((a, n) => a + n, 0);
    return total > 0 ? `${total} uds (${Array.from(tallas, ([k, n]) => `${k} ${n}`).join(", ")})` : "sin stock";
  }
  function textoTipo(t: Tipo) {
    const porEmpresa = new Map<string, GrupoProducto[]>();
    for (const g of t.grupos) porEmpresa.set(g.empresa, [...(porEmpresa.get(g.empresa) ?? []), g]);
    return `${t.etiqueta} — ${Array.from(porEmpresa, ([e, gs]) => `${titulo(e)}: ${textoStock(gs)}`).join(" · ")}`;
  }

  /** Espera lo que escribas despues: si es solo el nombre del producto lo usa; si es una orden nueva la ejecuta. */
  function esperarProducto(p: Plan, alElegir: (p: Plan) => void) {
    espera.current = {
      tipo: "texto",
      fn: (t: string) => {
        const o2 = entender(t, contexto);
        // Una orden nueva (otro verbo) se ejecuta; un dato suelto ("fundigsac", "talla L", "1") completa la entrega que ya empezaste.
        const ordenNueva = !["ayuda", "consultar", "agregar"].includes(o2.accion) || (o2.accion === "agregar" && /^\s*(agrega|agregar|anade|añade|suma|sumale|ingresa|llegaron|recibi|recibí|pon)\b/i.test(t));
        if (ordenNueva) {
          procesarRef.current(t, false);
          return;
        }
        elegirGrupo(
          {
            ...p,
            orden: {
              ...p.orden,
              palabras: o2.palabras.length ? o2.palabras : p.orden.palabras,
              tallas: o2.tallas.length ? o2.tallas : p.orden.tallas,
              porTalla: o2.porTalla.length ? o2.porTalla : p.orden.porTalla,
            },
            cantidad: o2.cantidad ?? p.cantidad,
            empresas: o2.empresas.length ? o2.empresas : p.empresas,
            genero: o2.genero ?? p.genero,
          },
          alElegir,
        );
      },
    };
  }

  function elegirGrupo(p: Plan, alElegir: (p: Plan) => void) {
    cerrarOpciones();
    if (p.orden.palabras.length === 0) {
      bot("¿De qué prenda? Dime el nombre, por ejemplo «polo manga larga».");
      esperarProducto(p, alElegir);
      return;
    }
    // Arregla errores de dedo y deja de lado palabras que no son del catalogo ("acabo", "ayer").
    const flex = buscarFlexible(grupos, { palabras: p.orden.palabras, empresas: p.empresas, genero: p.genero });
    const filtro = { palabras: flex.palabras, empresas: p.empresas, genero: p.genero };
    const c = flex.grupos;
    const nombre = titulo(flex.palabras.join(" "));
    if (c.length === 0) {
      if (p.genero) {
        // Nunca se muestra ropa del otro genero: solo lo que hay para esa persona.
        const quien = p.genero === "MUJER" ? "mujer" : "hombre";
        const otro = p.genero === "MUJER" ? "hombre" : "mujer";
        // Solo la ropa pensada para ese genero (y la unisex que no sea de seguridad): sin cascos, cutters, etc.
        const delGenero = grupos.filter((g) => g.genero === p.genero || (g.genero === "UNISEX" && !esSeguridad(g)));
        const { tipos } = tiposDe(delGenero, []);
        bot(`No tengo «${nombre}» para ${quien}. Para ${quien} hay esto en el catálogo (con el stock de ahora):`, {
          opciones: [
            ...tipos.slice(0, 14).map((t) => op(textoTipo(t), eligio(t.etiqueta, () => elegirGrupo({ ...p, tipoOk: true, orden: { ...p.orden, palabras: t.palabras } }, alElegir)))),
            op(`Crear «${nombre}» para ${quien} como producto nuevo`, () => crearProducto({ nombre: `${nombre} ${quien}` })),
            op(`Ver también los de ${otro}`, eligio(`Ver también los de ${otro}`, () => elegirGrupo({ ...p, genero: null }, alElegir))),
          ],
        });
        esperarProducto(p, alElegir);
        return;
      }
      if (p.empresas.length > 0) {
        const alt = buscarFlexible(grupos, { ...filtro, empresas: [] }).grupos;
        if (alt.length > 0) {
          bot(`No hay «${nombre}» en ${p.empresas.map(titulo).join(", ")}. Sí hay en:`, {
            opciones: alt.slice(0, 6).map((g) => op(etiquetaGrupo(g), eligio(etiquetaGrupo(g), () => alElegir({ ...p, grupo: g, empresas: [] })))),
          });
          esperarProducto(p, alElegir);
          return;
        }
      }
      const sug = sugerirProductos(grupos, flex.palabras).slice(0, 6);
      bot(sug.length > 0 ? `No encontré «${nombre}». ¿Es alguno de estos? (o escribe el nombre de nuevo)` : `No encontré «${nombre}» en el catálogo. Escribe el nombre de nuevo.`, {
        opciones: [
          ...sug.map((g) => op(etiquetaGrupo(g), eligio(etiquetaGrupo(g), () => alElegir({ ...p, grupo: g })))),
          op(`Crear «${nombre}» como producto nuevo`, () => crearProducto({ nombre })),
        ],
      });
      esperarProducto(p, alElegir);
      return;
    }
    // Una palabra que no existe en el catalogo (ej. "manga corta") NUNCA se ignora en silencio: se pregunta.
    if (flex.ignoradas.length > 0) {
      bot(`No tengo «${titulo(flex.ignoradas.join(" "))}». Lo más parecido que hay es esto, ¿es alguno de estos?`, {
        opciones: [...c.slice(0, 6).map((g) => op(etiquetaGrupo(g), eligio(etiquetaGrupo(g), () => alElegir({ ...p, grupo: g })))), op("Ninguno, lo escribo de nuevo", () => { bot("Escribe el nombre de la prenda de nuevo."); esperarProducto(p, alElegir); })],
      });
      esperarProducto(p, alElegir);
      return;
    }
    // ¿De que TIPO? Si solo dijiste "polo", se pregunta cual (manga larga, manga corta...) antes de seguir.
    if (!p.tipoOk) {
      const { tipos, especificado } = tiposDe(c, flex.palabras);
      if (!especificado && tipos.length > 0) {
        const base = titulo(flex.palabras.join(" "));
        const elegirTipo = (t: Tipo) => elegirGrupo({ ...p, tipoOk: true, orden: { ...p.orden, palabras: t.palabras } }, alElegir);
        // Lo que hay en stock ahora de ese tipo, por empresa: "Fundigsac: 42 uds (S 7, M 1, L 17)"
        const stockDe = (gs: GrupoProducto[]) => {
          const tallas = new Map<string, number>();
          for (const g of gs) for (const t of g.tallas) if (t.queda > 0) tallas.set(nombreTalla(t.talla), (tallas.get(nombreTalla(t.talla)) ?? 0) + t.queda);
          const total = Array.from(tallas.values()).reduce((a, n) => a + n, 0);
          return total > 0 ? `${total} uds (${Array.from(tallas, ([k, n]) => `${k} ${n}`).join(", ")})` : "sin stock";
        };
        const resumenTipo = (t: Tipo) => {
          const porEmpresa = new Map<string, GrupoProducto[]>();
          for (const g of t.grupos) porEmpresa.set(g.empresa, [...(porEmpresa.get(g.empresa) ?? []), g]);
          return Array.from(porEmpresa, ([e, gs]) => `${titulo(e)}: ${stockDe(gs)}`).join(" · ");
        };
        const etiquetaTipo = (t: Tipo) => `${t.etiqueta} — ${resumenTipo(t)}`;
        const paraQuien = p.genero === "MUJER" ? " para mujer" : p.genero === "HOMBRE" ? " para hombre" : "";
        const otro = op("Otro tipo (no está en la lista)", eligio("Otro tipo", () => {
          bot(`Dime el tipo exacto (por ejemplo «${base.toLowerCase()} …») o créalo como producto nuevo:`, { opciones: [op(`Crear «${base}» como producto nuevo`, () => crearProducto({ nombre: base }))] });
          esperarProducto(p, alElegir);
        }));
        if (tipos.length === 1) {
          bot(`Solo tengo este tipo de «${base}»${paraQuien}:\n${etiquetaTipo(tipos[0])}\n¿Es ese?`, {
            opciones: [op(`Sí, ${tipos[0].etiqueta}`, eligio(tipos[0].etiqueta, () => elegirTipo(tipos[0]))), otro],
          });
        } else {
          bot(`¿Qué tipo de «${base}»${paraQuien}? Esto es lo que hay ahora en stock:`, {
            opciones: [...tipos.slice(0, 12).map((t) => op(etiquetaTipo(t), eligio(t.etiqueta, () => elegirTipo(t)))), otro],
          });
        }
        esperarProducto(p, alElegir);
        return;
      }
    }
    if (c.length === 1) {
      alElegir({ ...p, grupo: c[0] });
      return;
    }
    // Varias coincidencias: se va afinando por empresa, luego por hombre/mujer, luego por producto.
    const emps = Array.from(new Set(c.map((g) => g.empresa)));
    if (emps.length > 1 && p.empresas.length === 0) {
      const unidades = (gs: GrupoProducto[]) => gs.reduce((a, g) => a + g.tallas.reduce((b, t) => b + Math.max(0, t.queda), 0), 0);
      bot("¿De qué empresa? (te muestro cuánto hay en cada una)", {
        opciones: emps.map((e) => {
          const gs = c.filter((g) => g.empresa === e);
          const u = unidades(gs);
          return op(`${titulo(e)} — ${u > 0 ? `hay ${u} uds` : "sin stock"}`, eligio(titulo(e), () => elegirGrupo({ ...p, empresas: [e] }, alElegir)));
        }),
      });
      return;
    }
    const gens = Array.from(new Set(c.filter((g) => g.genero && g.genero !== "UNISEX" && !esSeguridad(g)).map((g) => g.genero as Genero)));
    if (gens.length > 1 && !p.genero) {
      bot("¿Es para hombre o para mujer?", {
        opciones: gens.map((x) => op(x === "MUJER" ? "Mujer" : "Hombre", eligio(x === "MUJER" ? "Mujer" : "Hombre", () => elegirGrupo({ ...p, genero: x }, alElegir)))),
      });
      return;
    }
    bot(`Encontré ${c.length} productos parecidos. ¿Cuál es?`, {
      opciones: c.slice(0, 8).map((g) => op(etiquetaGrupo(g), eligio(etiquetaGrupo(g), () => alElegir({ ...p, grupo: g })))),
    });
  }

  function resolverLineas(p: Plan, listo: (ls: Linea[]) => void) {
    const g = p.grupo!;
    const nom = nombreProducto(g.producto, g.empresa);
    const faltaTalla = (n: string) => bot(`«${nom}» no tiene la talla ${n.toUpperCase()}. Tiene: ${g.tallas.map((x) => nombreTalla(x.talla)).join(", ")}.`);

    if (p.orden.porTalla.length > 0) {
      const ls: Linea[] = [];
      for (const pt of p.orden.porTalla) {
        const t = tallaDe(g, pt.talla);
        if (!t) return faltaTalla(pt.talla);
        ls.push({ g, t, n: pt.n });
      }
      return listo(ls);
    }
    let objetivo: StockItem[] | null = null;
    if (p.codigos) objetivo = g.tallas.filter((t) => p.codigos!.includes(t.codigo));
    else if (p.orden.tallas.length > 0) {
      objetivo = [];
      for (const n of p.orden.tallas) {
        const t = tallaDe(g, n);
        if (!t) return faltaTalla(n);
        objetivo.push(t);
      }
    } else if (p.todas) objetivo = g.tallas;
    else if (g.tallas.length === 1) objetivo = g.tallas;

    if (!objetivo) {
      bot(`¿En qué talla de «${nom}»?`, {
        opciones: [
          ...g.tallas.map((t) => op(`${etiquetaTalla(t.talla)} · hay ${entero(t.queda)}`, eligio(etiquetaTalla(t.talla), () => resolverLineas({ ...p, codigos: [t.codigo] }, listo)))),
          op("Todas las tallas", eligio("Todas las tallas", () => resolverLineas({ ...p, todas: true }, listo))),
        ],
      });
      return;
    }
    if (p.cantidad === null) {
      const una = objetivo.length === 1;
      pedirNumero(`¿Cuántas unidades${una ? ` de la ${etiquetaTalla(objetivo[0].talla)}` : " en cada talla"}? Escribe el número.`, [1, 5, 10, 20], (n) => resolverLineas({ ...p, cantidad: n }, listo));
      return;
    }
    const n = p.cantidad;
    listo(objetivo.map((t) => ({ g, t, n })));
  }

  /** Uno o varios productos en una misma frase: se resuelven uno por uno y se confirman juntos. */
  function iniciarCola(modo: Modo, ordenes: Orden[], persona: Persona | null) {
    const planes: Plan[] = ordenes.map((o) => ({
      modo,
      orden: o,
      empresas: o.empresas,
      genero: o.genero ?? persona?.genero ?? null,
      grupo: null,
      cantidad: o.cantidad,
      codigos: null,
      todas: o.todas,
    }));
    if (planes.length > 1) bot(`Entendí ${planes.length} productos. Los voy resolviendo uno por uno.`);
    const acum: Linea[] = [];
    const siguiente = (i: number) => {
      if (i >= planes.length) {
        finalizar(modo, acum, persona);
        return;
      }
      elegirGrupo(planes[i], (pl) =>
        resolverLineas(pl, (ls) => {
          acum.push(...ls);
          siguiente(i + 1);
        }),
      );
    };
    siguiente(0);
  }

  // ---------------------------------------------------------------- confirmar y guardar
  function resumenLineas(modo: Modo, ls: Linea[]) {
    const porProducto = new Map<string, Linea[]>();
    for (const l of ls) porProducto.set(l.g.clave, [...(porProducto.get(l.g.clave) ?? []), l]);
    return Array.from(porProducto.values())
      .map((items) => {
        const g = items[0].g;
        const cab = `• ${nombreProducto(g.producto, g.empresa)} · ${titulo(g.empresa)}${g.genero && !esSeguridad(g) ? ` · ${titulo(g.genero)}` : ""}`;
        const filas = items.map((l) => {
          const quedaria = modo === "entrada" ? l.t.queda + l.n : modo === "salida" ? l.t.queda - l.n : null;
          return `\u00A0\u00A0\u00A0\u00A0${etiquetaTalla(l.t.talla)}: ${modo === "salida" ? "−" : modo === "entrada" ? "+" : ""}${entero(l.n)}${quedaria !== null ? ` (hay ${entero(l.t.queda)} → quedará ${entero(quedaria)})` : ` (hay ${entero(l.t.queda)})`}`;
        });
        return [cab, ...filas].join("\n");
      })
      .join("\n");
  }

  function finalizar(modo: Modo, ls: Linea[], persona: Persona | null) {
    if (ls.length === 0) return;
    if (modo === "salida") {
      if (fotoRef.current) confirmar(modo, ls, persona, fotoRef.current);
      else pedirFoto("📷 Para registrar la entrega necesito la foto de evidencia. Tómala o súbela:", (b) => confirmar(modo, ls, persona, b));
      return;
    }
    confirmar(modo, ls, persona, modo === "entrada" ? fotoRef.current : null);
  }

  function confirmar(modo: Modo, ls: Linea[], persona: Persona | null, foto: Blob | null) {
    cerrarOpciones();
    const unidades = ls.reduce((a, l) => a + l.n, 0);
    const u = `${entero(unidades)} ${unidades === 1 ? "unidad" : "unidades"}`;
    const negativo = modo === "salida" && ls.some((l) => l.t.queda - l.n < 0);
    const cabecera =
      modo === "entrada"
        ? `Voy a AGREGAR ${u} al stock:`
        : modo === "salida"
          ? `Voy a registrar una SALIDA de ${u} para ${titulo(persona?.nombre)}${persona?.area ? ` (${titulo(persona.area)})` : ""}:`
          : `Voy a hacer un PEDIDO de ${u}:`;
    const opciones: Opcion[] = [
      op(modo === "entrada" ? "✅ Sí, agregar al stock" : modo === "salida" ? "✅ Sí, registrar la salida" : "✅ Sí, hacer el pedido", () => ejecutar(modo, ls, persona, foto)),
    ];
    if (modo === "entrada") opciones.push(op(foto ? "📷 Cambiar la foto" : "📷 Agregar con foto (opcional)", () => pedirFoto("📷 Sube la foto de lo que llegó:", (b) => confirmar(modo, ls, persona, b))));
    if (modo === "salida") opciones.push(op("📷 Cambiar la foto", () => pedirFoto("📷 Sube la nueva foto:", (b) => confirmar(modo, ls, persona, b))));
    opciones.push(op("Cancelar", cancelado));
    bot(`${cabecera}\n${resumenLineas(modo, ls)}${negativo ? "\n\n⚠️ Ojo: alguna talla quedará en negativo (sacas más de lo que hay)." : ""}${foto ? "\n📎 Con foto." : ""}\n\n¿Lo registro?`, { opciones });
  }

  async function ejecutar(modo: Modo, ls: Linea[], persona: Persona | null, foto: Blob | null) {
    cerrarOpciones();
    espera.current = null;
    yo("Sí");
    setTrabajando(true);
    try {
      const items = ls.map((l) => ({ codigo: l.t.codigo, cantidad: l.n }));
      const total = ls.reduce((a, l) => a + l.n, 0);
      if (modo === "pedido") {
        // El servidor acepta hasta 40 lineas por pedido: los pedidos grandes se mandan por tandas.
        const ids: number[] = [];
        for (let i = 0; i < items.length; i += 40) {
          const { data, error } = await supabase.rpc("crear_pedido", { p_quien: autor.trim(), p_items: items.slice(i, i + 40), p_nota: "Asistente" });
          if (error) throw new Error(error.message);
          ids.push(...(((data as { ids?: number[] } | null)?.ids ?? []) as number[]));
        }
        bot(`Pedido registrado ✅ (${entero(total)} ${total === 1 ? "unidad" : "unidades"}, ${ids.length} ${ids.length === 1 ? "línea" : "líneas"}).\n${resumenLineas("pedido", ls)}\n\nCuando llegue, dime «llegó el pedido de …» y lo sumo al stock.`, {
          opciones: [op("Ver pedidos pendientes", eligio("Pedidos pendientes", verPedidos))],
        });
        avisar(`Pedido registrado (${entero(total)} unidades)`);
        return;
      }
      let ruta: string | null = null;
      if (foto) ruta = await subirFoto(foto, modo === "entrada" ? "entradas" : "salidas");
      const { data, error } = await supabase.rpc("registrar_lote", {
        p_quien: autor.trim(),
        p_tipo: modo,
        p_fecha: hoyISO(),
        p_items: items,
        p_trabajador: modo === "salida" ? persona?.nombre : null,
        p_nota: "Asistente",
        p_foto: ruta,
      });
      if (error) throw new Error(error.message && !/fetch|network/i.test(error.message) ? error.message : "Revisa tu conexión.");
      const res = ((data as { items?: { codigo: string; queda: number; id: number }[] } | null)?.items ?? []) as { codigo: string; queda: number; id: number }[];
      const detalle = ls
        .map((l) => {
          const queda = res.find((i) => i.codigo === l.t.codigo)?.queda;
          return `${nombreProducto(l.g.producto, l.g.empresa)} · ${etiquetaTalla(l.t.talla)}: ${modo === "entrada" ? "+" : "−"}${entero(l.n)}${queda !== undefined ? ` (ahora ${entero(queda)})` : ""}`;
        })
        .join("\n");
      bot(
        modo === "entrada"
          ? `Listo ✅ Agregué ${entero(total)} ${total === 1 ? "unidad" : "unidades"} al stock${ruta ? " con su foto" : ""}.\n${detalle}`
          : `Listo ✅ Salida registrada para ${titulo(persona?.nombre)} con su foto de evidencia.\n${detalle}`,
        { hecho: { ids: res.map((i) => i.id), tipo: modo === "entrada" ? "entrada" : "salida", deshecho: false } },
      );
      avisar(modo === "entrada" ? `Stock agregado (+${entero(total)})` : `Salida registrada para ${titulo(persona?.nombre)}`);
      quitarFoto();
    } catch (e) {
      bot(`No pude guardarlo: ${e instanceof Error ? e.message : "error desconocido"}`);
    } finally {
      setTrabajando(false);
    }
  }

  async function deshacer(m: Mensaje) {
    if (!m.hecho || m.hecho.deshecho) return;
    setTrabajando(true);
    try {
      for (const id of m.hecho.ids) {
        const { error } = await supabase.rpc("anular_movimiento", { p_quien: autor.trim(), p_tipo: m.hecho.tipo, p_id: id, p_motivo: "Deshecho desde el asistente" });
        if (error) throw new Error(error.message);
      }
      setMensajes((ms) => ms.map((x) => (x.id === m.id ? { ...x, hecho: { ...x.hecho!, deshecho: true } } : x)));
      bot("Deshecho. El stock volvió a como estaba.");
    } catch (e) {
      bot(`No pude deshacerlo: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setTrabajando(false);
    }
  }

  // ---------------------------------------------------------------- bajo stock
  const bajos = useMemo(
    () =>
      grupos
        .map((g) => ({ g, ts: g.tallas.filter((t) => estadoDe(t.queda, minimo) === "bajo") }))
        .filter((x) => x.ts.length > 0)
        .sort((a, b) => a.g.empresa.localeCompare(b.g.empresa, "es") || a.g.producto.localeCompare(b.g.producto, "es")),
    [grupos, minimo],
  );
  const sinStock = useMemo(
    () =>
      grupos
        .map((g) => ({ g, ts: g.tallas.filter((t) => t.queda === 0) }))
        .filter((x) => x.ts.length > 0)
        .sort((a, b) => a.g.empresa.localeCompare(b.g.empresa, "es") || a.g.producto.localeCompare(b.g.producto, "es")),
    [grupos],
  );

  const lineasDe = (items: { g: GrupoProducto; ts: StockItem[] }[], n: number): Linea[] => items.flatMap((x) => x.ts.map((t) => ({ g: x.g, t, n })));

  /** Lista legible agrupada por empresa:
   *  COSEGEN
   *  • Pantalón Jeans Hombre
   *     Talla 32 → queda 1
   */
  function textoPorEmpresa(items: { g: GrupoProducto; ts: StockItem[] }[], detalle: (x: { g: GrupoProducto; ts: StockItem[] }) => string[]) {
    const porEmpresa = new Map<string, { g: GrupoProducto; ts: StockItem[] }[]>();
    for (const x of items) porEmpresa.set(x.g.empresa, [...(porEmpresa.get(x.g.empresa) ?? []), x]);
    return Array.from(porEmpresa, ([empresa, xs]) => {
      const filas = xs.map((x) => {
        const nombre = nombreProducto(x.g.producto, x.g.empresa);
        const gen = x.g.genero && !esSeguridad(x.g) && !new RegExp(titulo(x.g.genero), "i").test(nombre) ? ` (${titulo(x.g.genero)})` : "";
        return `• ${nombre}${gen}\n${detalle(x).map((l) => `     ${l}`).join("\n")}`;
      });
      return `${titulo(empresa).toUpperCase()}\n${filas.join("\n")}`;
    }).join("\n\n");
  }

  type Item = { g: GrupoProducto; ts: StockItem[] };

  /** Una burbuja por empresa, con TODO lo que hay (sin "y X mas"). */
  function burbujasPorEmpresa(items: Item[], encabezado: (empresa: string, xs: Item[]) => string, detalle: (x: Item) => string[], opcionesDe: (empresa: string, xs: Item[]) => Opcion[]) {
    const porEmpresa = new Map<string, Item[]>();
    for (const x of items) porEmpresa.set(x.g.empresa, [...(porEmpresa.get(x.g.empresa) ?? []), x]);
    for (const [empresa, xs] of porEmpresa) bot(`${encabezado(empresa, xs)}\n\n${textoPorEmpresa(xs, detalle).split("\n").slice(1).join("\n")}`, { opciones: opcionesDe(empresa, xs) });
  }

  const pedirDe = (items: Item[], etiqueta: string, sugeridos: number[]) =>
    pedirNumero(`¿Cuántas unidades pido de cada talla (${etiqueta})?`, sugeridos, (n) => finalizar("pedido", lineasDe(items, n), null));

  function mostrarBajos(o: Orden, desdePedir: boolean) {
    const f = (x: { g: GrupoProducto }) =>
      (o.empresas.length === 0 || o.empresas.includes(x.g.empresa)) && (!o.genero || x.g.genero === o.genero || !x.g.genero || x.g.genero === "UNISEX" || esSeguridad(x.g));
    const lista = bajos.filter(f);
    const sin = sinStock.filter(f);
    // "¿qué está sin stock?": va directo a los que tienen alguna talla en 0
    if (o.incluirSin && !desdePedir) {
      if (sin.length > 0) verSinStock(sin);
      else bot("No hay productos sin stock 🎉");
      return;
    }
    const tallasBajas = lista.reduce((a, x) => a + x.ts.length, 0);
    if (lista.length === 0) {
      bot(`No hay productos por agotarse (con ${minimo} unidades o menos) 🎉`, {
        opciones: sin.length > 0 ? [op(`Ver los sin stock (${sin.length})`, eligio("Ver los sin stock", () => verSinStock(sin)))] : undefined,
      });
      return;
    }
    const empresas = Array.from(new Set(lista.map((x) => x.g.empresa)));
    bot(
      `⚠️ POR AGOTARSE: ${lista.length} ${lista.length === 1 ? "producto" : "productos"} (${tallasBajas} ${tallasBajas === 1 ? "talla" : "tallas"})\nA cada uno le quedan ${minimo} unidades o menos.\nTe los muestro todos, empresa por empresa:`,
    );
    burbujasPorEmpresa(
      lista,
      (empresa, xs) => `${titulo(empresa).toUpperCase()} · ${xs.length} ${xs.length === 1 ? "producto" : "productos"}`,
      (x) => x.ts.map((t) => `${etiquetaTalla(t.talla)} → ${t.queda === 1 ? "queda 1" : `quedan ${t.queda}`}`),
      (empresa, xs) => [op(`Pedir todo lo de ${titulo(empresa)} (${xs.length})`, eligio(`Pedir todo lo de ${titulo(empresa)}`, () => pedirDe(xs, `todas las tallas por agotarse de ${titulo(empresa)}`, [10, 20, 30, 50])))],
    );
    const opciones: Opcion[] = [];
    if (empresas.length > 1) opciones.push(op(`Pedir TODO lo que se agota (${lista.length})`, eligio("Pedir todo lo que se agota", () => pedirDe(lista, "todas las tallas por agotarse", [10, 20, 30, 50]))));
    if (sin.length > 0) opciones.push(op(`Ver los sin stock (${sin.length})`, eligio("Ver los sin stock", () => verSinStock(sin))));
    bot(`Para pedir un producto en particular escribe, por ejemplo: «pide 20 ${nombreProducto(lista[0].g.producto, lista[0].g.empresa).toLowerCase()} talla ${nombreTalla(lista[0].ts[0].talla)}».${desdePedir ? "" : "\nO elige:"}`, { opciones });
  }

  function verSinStock(lista: Item[]) {
    const tallas = lista.reduce((a, x) => a + x.ts.length, 0);
    bot(`🔴 SIN STOCK: ${lista.length} ${lista.length === 1 ? "producto" : "productos"} (${tallas} ${tallas === 1 ? "talla" : "tallas"} en 0).\nTe los muestro todos, empresa por empresa:`);
    burbujasPorEmpresa(
      lista,
      (empresa, xs) => `${titulo(empresa).toUpperCase()} · ${xs.length} ${xs.length === 1 ? "producto" : "productos"}`,
      (x) => [x.ts.length === x.g.tallas.length ? "Todas las tallas están en 0" : `En 0: ${x.ts.map((t) => etiquetaTalla(t.talla).replace("Talla ", "talla ")).join(", ")}`],
      (empresa, xs) => [op(`Pedir todo lo sin stock de ${titulo(empresa)} (${xs.length})`, eligio(`Pedir todo lo sin stock de ${titulo(empresa)}`, () => pedirDe(xs, `todas las tallas en 0 de ${titulo(empresa)}`, [5, 10, 20, 30])))],
    );
  }

  // ---------------------------------------------------------------- consultas
  function consultar(o: Orden) {
    const plan: Plan = { modo: "entrada", orden: o, empresas: o.empresas, genero: o.genero, grupo: null, cantidad: null, codigos: null, todas: false };
    elegirGrupo(plan, (p) => {
      const g = p.grupo!;
      const total = g.tallas.reduce((a, t) => a + Math.max(0, t.queda), 0);
      const filas = g.tallas.map((t) => {
        const e = estadoDe(t.queda, minimo);
        return `\u00A0\u00A0\u00A0\u00A0${etiquetaTalla(t.talla)}: ${entero(t.queda)}${e === "bajo" ? " ⚠️ por agotarse" : e === "sin" ? " · sin stock" : e === "revisar" ? " · revisar (negativo)" : ""}`;
      });
      const pend = datos.pedidos.filter((x) => x.estado === "pendiente" && g.tallas.some((t) => t.codigo === x.codigo));
      bot(
        `${nombreProducto(g.producto, g.empresa)} · ${titulo(g.empresa)}${g.genero && !esSeguridad(g) ? ` · ${titulo(g.genero)}` : ""}\n${filas.join("\n")}\nTotal: ${entero(total)} unidades${pend.length ? `\n📦 Hay ${pend.length} ${pend.length === 1 ? "línea" : "líneas"} de pedido pendiente.` : ""}`,
        { opciones: [op("Agregar stock", eligio("Agregar stock", () => iniciarConGrupo("entrada", g))), op("Hacer un pedido", eligio("Hacer un pedido", () => iniciarConGrupo("pedido", g)))] },
      );
    });
  }

  function iniciarConGrupo(modo: Modo, g: GrupoProducto) {
    const o: Orden = { accion: modo === "pedido" ? "pedir" : "agregar", cantidad: null, porTalla: [], tallas: [], todas: false, ultimo: false, empresas: [], genero: null, incluirSin: false, persona: [], palabras: [] };
    resolverLineas({ modo, orden: o, empresas: [], genero: null, grupo: g, cantidad: null, codigos: null, todas: false }, (ls) => finalizar(modo, ls, null));
  }

  function resumen() {
    const unidades = stock.reduce((a, s) => a + Math.max(0, s.queda), 0);
    const hoy = hoyISO();
    const hoyMovs = recientes.filter((m) => m.fecha === hoy);
    const pend = datos.pedidos.filter((p) => p.estado === "pendiente");
    bot(
      `📊 Resumen\n• ${entero(unidades)} unidades en ${entero(stock.length)} artículos\n• ${bajos.length} productos por agotarse\n• ${sinStock.length} productos con alguna talla sin stock\n• ${pend.length} pedidos pendientes\n• Hoy: ${hoyMovs.filter((m) => m.tipo === "entrada").length} entradas y ${hoyMovs.filter((m) => m.tipo === "salida").length} salidas`,
      { opciones: [op("¿Qué se agota?", eligio("¿Qué está por agotarse?", () => mostrarBajos(entender("por agotarse"), false)))] },
    );
  }

  // ---------------------------------------------------------------- pedidos
  const gruposPedido = useMemo<GrupoPedido[]>(() => {
    const m = new Map<string, GrupoPedido>();
    for (const p of datos.pedidos.filter((x) => x.estado === "pendiente")) {
      const sn = partirMovimiento(p.producto);
      const empresa = empresaDe.get(p.codigo) ?? "";
      const clave = `${sn.nombre}|${empresa}|${p.created_at.slice(0, 16)}`;
      const g = m.get(clave) ?? { clave, ids: [], nombre: nombreProducto(sn.nombre, empresa), empresa, fecha: p.fecha, por: p.creado_por, lineas: [], total: 0 };
      g.ids.push(p.id);
      g.lineas.push({ talla: nombreTalla(sn.talla), cantidad: p.cantidad });
      g.total += p.cantidad;
      m.set(clave, g);
    }
    return Array.from(m.values()).sort((a, b) => b.ids[0] - a.ids[0]);
  }, [datos.pedidos, empresaDe]);

  const descPedido = (g: GrupoPedido) => `${g.nombre} · ${titulo(g.empresa)} (${g.lineas.map((l) => `${l.talla} ×${l.cantidad}`).join(", ")})`;

  function verPedidos() {
    if (gruposPedido.length === 0) {
      bot("No hay pedidos pendientes. Para hacer uno: «pide 20 polo manga larga talla M».");
      return;
    }
    const opciones: Opcion[] = [];
    for (const g of gruposPedido.slice(0, 5)) {
      const tallas = g.lineas.map((l) => `${l.talla}×${l.cantidad}`).join(" ");
      opciones.push(op(`✔ Llegó: ${g.nombre} ${tallas}`, eligio(`Llegó ${g.nombre} ${tallas}`, () => confirmarRecibir(g))));
      opciones.push(op(`✖ Cancelar: ${g.nombre} ${tallas}`, eligio(`Cancelar ${g.nombre} ${tallas}`, () => confirmarCancelarPedido(g))));
    }
    bot(
      `📦 Pedidos pendientes (${gruposPedido.length}):\n${gruposPedido
        .slice(0, 12)
        .map((g) => `• ${descPedido(g)} · ${fechaCorta(g.fecha)}${g.por ? ` · ${titulo(g.por)}` : ""}`)
        .join("\n")}${gruposPedido.length > 12 ? `\n… y ${gruposPedido.length - 12} más` : ""}`,
      { opciones },
    );
  }

  function elegirPedido(o: Orden, accion: string, siguiente: (g: GrupoPedido) => void) {
    if (gruposPedido.length === 0) {
      bot("No hay pedidos pendientes.");
      return;
    }
    const c =
      o.palabras.length === 0 && o.empresas.length === 0
        ? gruposPedido
        : gruposPedido.filter((g) => {
            if (o.empresas.length && !o.empresas.includes(g.empresa)) return false;
            const hay = norm(`${g.nombre} ${g.lineas.map((l) => l.talla).join(" ")}`);
            return o.palabras.every((w) => coincide(hay, w));
          });
    if (c.length === 0) bot(`No encontré pedidos pendientes de «${titulo(o.palabras.join(" "))}».`, { opciones: [op("Ver pedidos pendientes", eligio("Pedidos pendientes", verPedidos))] });
    else if (c.length === 1 || o.ultimo) siguiente(c[0]);
    else bot(`Encontré ${c.length} pedidos. ¿Cuál ${accion}?`, { opciones: c.slice(0, 6).map((g) => op(descPedido(g), eligio(g.nombre, () => siguiente(g)))) });
  }

  function confirmarRecibir(g: GrupoPedido) {
    cerrarOpciones();
    const opciones: Opcion[] = [op("✅ Sí, llegó completo", () => hacerRecibir(g, null))];
    if (g.ids.length === 1) opciones.push(op("Llegó otra cantidad", eligio("Llegó otra cantidad", () => pedirNumero("¿Cuántas unidades llegaron?", [g.total], (n) => hacerRecibir(g, n)))));
    opciones.push(op("No", cancelado));
    bot(`Pedido: ${descPedido(g)}\n¿Llegó completo? Lo sumo al stock como entrada.`, { opciones });
  }

  async function hacerRecibir(g: GrupoPedido, cantidad: number | null) {
    cerrarOpciones();
    yo("Sí, llegó");
    setTrabajando(true);
    try {
      const lineas: string[] = [];
      for (const id of g.ids) {
        const { data, error } = await supabase.rpc("recibir_pedido", { p_quien: autor.trim(), p_id: id, p_cantidad: cantidad });
        if (error) throw new Error(error.message);
        const d = data as { queda: number; cantidad: number } | null;
        lineas.push(`+${entero(d?.cantidad ?? 0)} (ahora ${entero(d?.queda ?? 0)})`);
      }
      bot(`Listo ✅ Pedido recibido: ${g.nombre} · ${titulo(g.empresa)}.\n${g.lineas.map((l, i) => `\u00A0\u00A0\u00A0\u00A0${l.talla}: ${lineas[i]}`).join("\n")}\nYa está en el stock.`);
      avisar("Pedido recibido y sumado al stock");
    } catch (e) {
      bot(`No pude recibir el pedido: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setTrabajando(false);
    }
  }

  function confirmarCancelarPedido(g: GrupoPedido) {
    cerrarOpciones();
    bot(`Voy a cancelar el pedido: ${descPedido(g)}. No se suma nada al stock. ¿Confirmas?`, { opciones: [op("Sí, cancelar el pedido", () => hacerCancelar(g)), op("No", cancelado)] });
  }

  async function hacerCancelar(g: GrupoPedido) {
    cerrarOpciones();
    yo("Sí, cancelar");
    setTrabajando(true);
    try {
      for (const id of g.ids) {
        const { error } = await supabase.rpc("cancelar_pedido", { p_quien: autor.trim(), p_id: id });
        if (error) throw new Error(error.message);
      }
      bot(`Pedido cancelado ✅ ${g.nombre} · ${titulo(g.empresa)}.`);
      avisar("Pedido cancelado");
    } catch (e) {
      bot(`No pude cancelarlo: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setTrabajando(false);
    }
  }

  // ---------------------------------------------------------------- anular un movimiento
  function describir(m: Movimiento) {
    const p = partirMovimiento(m.producto);
    const hora = new Date(m.creado).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
    return `${m.tipo === "entrada" ? "Entrada" : "Salida"} de ${entero(m.cantidad)} · ${nombreProducto(p.nombre, empresaDe.get(m.codigo))} · ${etiquetaTalla(p.talla)} · ${fechaCorta(m.fecha)} ${hora}${m.persona && m.tipo === "salida" ? ` · a ${titulo(m.persona)}` : ""}${m.registradoPor ? ` · por ${titulo(m.registradoPor)}` : ""}`;
  }

  function anularFlujo(o: Orden) {
    if (recientes.length === 0) {
      bot("Todavía no hay movimientos para anular.");
      return;
    }
    if (o.palabras.length === 0 && !o.ultimo) {
      bot("¿Qué quieres anular? Dime el producto («anula la entrada de polo manga larga») o elige:", { opciones: [op("El último movimiento", () => confirmarAnular(recientes[0]))] });
      return;
    }
    const coinciden = recientes.filter((m) => {
      const p = partirMovimiento(m.producto);
      const hay = norm(`${nombreProducto(p.nombre, empresaDe.get(m.codigo))} ${p.talla} ${empresaDe.get(m.codigo) ?? ""} ${m.persona ?? ""} ${m.tipo}`);
      return o.palabras.every((w) => coincide(hay, w));
    });
    if (coinciden.length === 0) {
      bot(`No encontré movimientos de «${titulo(o.palabras.join(" "))}».`);
      return;
    }
    if (o.ultimo || coinciden.length === 1) {
      confirmarAnular(coinciden[0]);
      return;
    }
    bot(`Encontré ${coinciden.length} movimientos. ¿Cuál anulo? (los más recientes primero)`, {
      opciones: coinciden.slice(0, 6).map((m) => op(describir(m), eligio(describir(m), () => confirmarAnular(m)))),
    });
  }

  function confirmarAnular(m: Movimiento) {
    cerrarOpciones();
    bot(`Voy a anular:\n${describir(m)}\n\n${m.tipo === "entrada" ? "El stock bajará" : "El stock subirá"} ${entero(m.cantidad)}. No se borra: queda en el historial como anulado. ¿Confirmas?`, {
      opciones: [op("Sí, anular", () => hacerAnular(m)), op("No, dejarlo", cancelado)],
    });
  }

  async function hacerAnular(m: Movimiento) {
    cerrarOpciones();
    yo("Sí, anular");
    setTrabajando(true);
    try {
      const { error } = await supabase.rpc("anular_movimiento", { p_quien: autor.trim(), p_tipo: m.tipo, p_id: m.id, p_motivo: "Anulado desde el asistente" });
      if (error) throw new Error(error.message && !/fetch|network/i.test(error.message) ? error.message : "Revisa tu conexión.");
      bot(`Anulado ✅ ${describir(m)}`);
      avisar("Movimiento anulado");
    } catch (e) {
      bot(`No pude anularlo: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setTrabajando(false);
    }
  }


  // ---------------------------------------------------------------- IA (Claude Haiku 5.5)
  const recordar = (rol: "yo" | "asistente", t: string) => {
    historialIA.current = [...historialIA.current, { rol, texto: t }].slice(-10);
  };

  /** Manda lo que escribiste (y el documento, si hay uno) a la IA. Si la IA falla, responde con las reglas de siempre. */
  async function preguntarIA(t: string) {
    cerrarOpciones();
    const previo = historialIA.current;
    recordar("yo", t || "(documento)");
    setTrabajando(true);
    let r: RespuestaIA;
    try {
      r = await consultarIA({ texto: t, imagen: docRef.current?.b64 ?? null, media: docRef.current?.media, documento: docRef.current?.texto ?? null, historial: previo });
    } catch (e) {
      console.warn("IA no disponible", e);
      historialIA.current = previo;
      setTrabajando(false);
      if (docRef.current) {
        bot("No pude leer el documento con la IA ahora. Revisa tu conexión e inténtalo otra vez.", { opciones: [op("Reintentar", () => void preguntarIA(t)), op("Cancelar", cancelado)] });
      } else procesarLocal(t);
      return;
    }
    setTrabajando(false);
    mostrarIA(r);
  }

  function mostrarIA(r: RespuestaIA) {
    const q = r.aclarar;
    recordar("asistente", [r.mensaje, q?.pregunta, q && q.opciones.length > 0 ? `Opciones: ${q.opciones.join(" | ")}` : ""].filter(Boolean).join("\n"));
    const msg = r.mensaje.trim();
    if (msg) bot(msg);
    if (q) {
      // Mientras falte un dato no se registra nada: solo se muestran listas.
      for (const a of r.acciones) if (a.tipo === "ver") verIA(a.ver);
      bot(q.pregunta, { opciones: q.opciones.map((o) => op(o, eligio(o, () => void preguntarIA(o)))) });
      return;
    }
    if (r.acciones.length === 0) {
      if (!msg) bot("No te entendí bien. ¿Me lo dices de otra forma?");
      return;
    }
    aplicarAcciones(r.acciones);
  }

  function verIA(v: "por_agotarse" | "sin_stock" | "pedidos_pendientes" | "resumen") {
    if (v === "por_agotarse") mostrarBajos(entender("por agotarse"), false);
    else if (v === "sin_stock") {
      if (sinStock.length > 0) verSinStock(sinStock);
      else bot("No hay productos sin stock 🎉");
    } else if (v === "pedidos_pendientes") verPedidos();
    else resumen();
  }

  function aplicarAcciones(acs: AccionIA[]) {
    const movs: AccionMov[] = [];
    for (const a of acs) {
      if (a.tipo === "entrada" || a.tipo === "salida" || a.tipo === "pedido") movs.push(a);
      else if (a.tipo === "ver") verIA(a.ver);
      else if (a.tipo === "recibir_pedido" || a.tipo === "cancelar_pedido") {
        const recibir = a.tipo === "recibir_pedido";
        const siguiente = recibir ? confirmarRecibir : confirmarCancelarPedido;
        const gs = gruposPedido.filter((g) => g.ids.some((id) => a.pedido_ids.includes(id)));
        if (gs.length === 0) bot("No encontré ese pedido pendiente.");
        else if (gs.length === 1) siguiente(gs[0]);
        else bot(`Encontré ${gs.length} pedidos. ¿Cuál ${recibir ? "llegó" : "cancelo"}?`, { opciones: gs.slice(0, 8).map((g) => op(descPedido(g), eligio(g.nombre, () => siguiente(g)))) });
      } else if (a.tipo === "anular_movimiento") {
        const m = recientes.find((x) => x.tipo === a.movimiento.tipo && x.id === a.movimiento.id);
        if (m) confirmarAnular(m);
        else bot("No encontré ese movimiento (quizá ya está anulado).");
      } else if (a.tipo === "crear_producto") {
        const nombre = titulo(a.nombre);
        bot(nombre ? `Abro el formulario para crear «${nombre}». Ahí eliges la empresa y las tallas.` : "Abro el formulario para crear el producto.");
        crearProducto({ nombre });
      } else if (a.tipo === "crear_trabajador") {
        const nombre = titulo(a.nombre);
        bot(nombre ? `Abro el formulario para agregar a ${nombre}. Ahí eliges el área y si es hombre o mujer.` : "Abro el formulario para agregar al trabajador.");
        crearTrabajador(nombre);
      }
    }
    if (movs.length > 0) armarLote(movs);
  }

  /** Convierte lo que dijo la IA en movimientos reales (con las reglas de género) y pide UNA confirmación. */
  function armarLote(acs: AccionMov[]) {
    const pasos: Paso[] = [];
    const omitidas: string[] = [];
    for (const a of acs) {
      const modo: Modo = a.tipo;
      let persona: Persona | null = null;
      let cliente = false;
      if (modo === "salida") {
        const nombre = (a.trabajador ?? "").trim();
        const palabras = norm(nombre).split(/\s+/).filter(Boolean);
        const exacto = trabajadores.find((t) => norm(t.trabajador) === norm(nombre));
        const parecidos = exacto ? [exacto] : buscarPersona(trabajadores, palabras);
        if (parecidos.length === 1) persona = aPersona(parecidos[0]);
        else {
          persona = { nombre: nombre.toUpperCase(), genero: null, area: null };
          cliente = true;
        }
      }
      const ls: Linea[] = [];
      for (const it of a.items) {
        const t = stock.find((s) => s.codigo === it.codigo);
        const g = grupos.find((x) => x.tallas.some((s) => s.codigo === it.codigo));
        if (!t || !g) continue;
        const gg = g.genero as string | null;
        if (persona?.genero && gg && gg !== "UNISEX" && gg !== persona.genero && !esSeguridad(g)) {
          omitidas.push(`• ${nombreProducto(g.producto, g.empresa)} (${titulo(gg)}) para ${titulo(persona.nombre)}`);
          continue;
        }
        const previa = ls.find((l) => l.t.codigo === t.codigo);
        if (previa) previa.n += it.cantidad;
        else ls.push({ g, t, n: it.cantidad });
      }
      // Cada fila del documento es un movimiento propio (así se ve y se deshace uno por uno); los pedidos van juntos.
      if (modo === "pedido") {
        if (ls.length > 0) pasos.push({ modo, persona, ls, cliente });
      } else for (const l of ls) pasos.push({ modo, persona, ls: [l], cliente });
    }
    if (omitidas.length > 0) bot(`⚠️ No incluí esto porque es ropa del otro género:\n${omitidas.join("\n")}`);
    if (pasos.length === 0) {
      bot("No pude armar ningún movimiento con eso. Dímelo con producto, talla y cantidad.");
      return;
    }
    const foto = docRef.current?.blob ?? fotoRef.current;
    if (pasos.some((p) => p.modo === "salida") && !foto) pedirFoto("📷 Para registrar las entregas necesito la foto de evidencia. Tómala o súbela:", (b) => confirmarLote(pasos, b));
    else confirmarLote(pasos, foto);
  }

  function textoPaso(p: Paso) {
    const u = p.ls.reduce((a, l) => a + l.n, 0);
    const cab =
      p.modo === "entrada"
        ? `➕ ENTRADA de ${entero(u)} uds`
        : p.modo === "salida"
          ? `➖ SALIDA de ${entero(u)} uds a ${titulo(p.persona?.nombre)}${p.persona?.area ? ` (${titulo(p.persona.area)})` : p.cliente ? " — ⚠️ no está en la lista de trabajadores, se anota como cliente" : ""}`
          : `📦 PEDIDO de ${entero(u)} uds`;
    return `${cab}\n${resumenLineas(p.modo, p.ls)}`;
  }

  function confirmarLote(pasos: Paso[], foto: Blob | null) {
    cerrarOpciones();
    const queda = new Map<string, number>();
    let negativo = false;
    for (const p of pasos) {
      if (p.modo !== "salida") continue;
      for (const l of p.ls) {
        const q = (queda.get(l.t.codigo) ?? l.t.queda) - l.n;
        queda.set(l.t.codigo, q);
        if (q < 0) negativo = true;
      }
    }
    const n = pasos.length;
    const hayFoto = pasos.some((p) => p.modo !== "pedido");
    const opciones: Opcion[] = [op(n === 1 ? "✅ Sí, registrar" : `✅ Sí, registrar los ${n} movimientos`, () => void ejecutarLote(pasos, foto))];
    if (foto && hayFoto && !docRef.current?.blob) opciones.push(op("📷 Cambiar la foto", () => pedirFoto("📷 Sube la nueva foto:", (b) => confirmarLote(pasos, b))));
    opciones.push(op("Cancelar", cancelado));
    bot(
      `Esto entendí${docRef.current ? " del documento" : ""}:\n\n${pasos.map(textoPaso).join("\n\n")}${negativo ? "\n\n⚠️ Ojo: alguna talla quedará en negativo." : ""}${foto && hayFoto ? "\n\n📎 Con foto." : ""}\n\n¿Lo registro? Cada movimiento se guarda por separado.`,
      { opciones },
    );
  }

  /** Guarda cada movimiento por separado: si uno falla, los demás igual se registran. */
  async function ejecutarLote(pasos: Paso[], foto: Blob | null) {
    cerrarOpciones();
    espera.current = null;
    yo("Sí, registrar");
    setTrabajando(true);
    const rutas: Partial<Record<"entradas" | "salidas", string>> = {};
    const fallos: string[] = [];
    const hecho: Record<Modo, { ids: number[]; lineas: string[]; unidades: number }> = {
      entrada: { ids: [], lineas: [], unidades: 0 },
      salida: { ids: [], lineas: [], unidades: 0 },
      pedido: { ids: [], lineas: [], unidades: 0 },
    };
    let ok = 0;
    try {
      for (const p of pasos) {
        const quien = p.modo === "salida" ? ` a ${titulo(p.persona?.nombre)}` : "";
        try {
          const items = p.ls.map((l) => ({ codigo: l.t.codigo, cantidad: l.n }));
          let res: { codigo: string; queda: number; id: number }[] = [];
          if (p.modo === "pedido") {
            for (let i = 0; i < items.length; i += 40) {
              const { error } = await supabase.rpc("crear_pedido", { p_quien: autor.trim(), p_items: items.slice(i, i + 40), p_nota: "Asistente" });
              if (error) throw new Error(error.message);
            }
          } else {
            const carpeta = p.modo === "entrada" ? "entradas" : "salidas";
            if (foto && !rutas[carpeta]) rutas[carpeta] = await subirFoto(foto, carpeta);
            const { data, error } = await supabase.rpc("registrar_lote", {
              p_quien: autor.trim(),
              p_tipo: p.modo,
              p_fecha: hoyISO(),
              p_items: items,
              p_trabajador: p.modo === "salida" ? p.persona?.nombre : null,
              p_nota: "Asistente",
              p_foto: rutas[carpeta] ?? null,
            });
            if (error) throw new Error(error.message && !/fetch|network/i.test(error.message) ? error.message : "Revisa tu conexión.");
            res = ((data as { items?: { codigo: string; queda: number; id: number }[] } | null)?.items ?? []) as { codigo: string; queda: number; id: number }[];
            hecho[p.modo].ids.push(...res.map((i) => i.id));
          }
          for (const l of p.ls) {
            const queda = res.find((i) => i.codigo === l.t.codigo)?.queda;
            hecho[p.modo].lineas.push(`${p.modo === "salida" ? `${titulo(p.persona?.nombre)} · ` : ""}${nombreProducto(l.g.producto, l.g.empresa)} · ${etiquetaTalla(l.t.talla)}: ${p.modo === "salida" ? "−" : p.modo === "entrada" ? "+" : ""}${entero(l.n)}${queda !== undefined ? ` (ahora ${entero(queda)})` : ""}`);
            hecho[p.modo].unidades += l.n;
          }
          ok++;
        } catch (e) {
          fallos.push(`• ${p.modo === "entrada" ? "Entrada" : p.modo === "salida" ? "Salida" : "Pedido"}${quien} (${p.ls.map((l) => `${nombreProducto(l.g.producto, l.g.empresa)} ${etiquetaTalla(l.t.talla)}`).join(", ")}): ${e instanceof Error ? e.message : "error"}`);
        }
      }
    } finally {
      setTrabajando(false);
    }
    const u = (n: number) => `${entero(n)} ${n === 1 ? "unidad" : "unidades"}`;
    if (hecho.entrada.lineas.length > 0) bot(`Listo ✅ Agregué ${u(hecho.entrada.unidades)} al stock.\n${hecho.entrada.lineas.join("\n")}`, { hecho: { ids: hecho.entrada.ids, tipo: "entrada", deshecho: false } });
    if (hecho.salida.lineas.length > 0) bot(`Listo ✅ Registré ${u(hecho.salida.unidades)} de salida, con la foto de evidencia.\n${hecho.salida.lineas.join("\n")}`, { hecho: { ids: hecho.salida.ids, tipo: "salida", deshecho: false } });
    if (hecho.pedido.lineas.length > 0) bot(`Pedido registrado ✅ (${u(hecho.pedido.unidades)}).\n${hecho.pedido.lineas.join("\n")}`);
    if (fallos.length > 0) bot(`⚠️ No pude guardar ${fallos.length} ${fallos.length === 1 ? "movimiento" : "movimientos"}:\n${fallos.join("\n")}`);
    if (ok > 0) avisar(ok === 1 ? "Movimiento registrado" : `${ok} movimientos registrados`);
    recordar("asistente", fallos.length === 0 ? "Todo quedó registrado." : `Se registraron ${ok} de ${pasos.length}; hubo ${fallos.length} errores.`);
    docRef.current = null;
    quitarFoto();
  }

  function enviar(ev: FormEvent) {
    ev.preventDefault();
    procesar(texto);
  }

  return (
    <Ventana
      abierta={abierto}
      alCerrar={alCerrar}
      titulo="Asistente de stock"
      subtitulo="Escribe o dicta lo que necesitas."
      pie={
        <div className="space-y-2">
          {fotoVista && (
            <div className="flex items-center gap-3 rounded-xl bg-ground p-2">
              <img src={fotoVista} alt="Foto lista" className="size-11 rounded-lg object-cover" />
              <p className="min-w-0 flex-1 text-[12.5px] text-muted">
                <b className="text-ink">Foto lista.</b> Se manda con tu próxima entrega.
              </p>
              <button type="button" onClick={quitarFoto} aria-label="Quitar la foto" className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-line-2 hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
          )}
        <form onSubmit={enviar} className="flex items-center gap-2">
          <button
            type="button"
            onClick={adjuntarFoto}
            aria-label="Mandar una foto"
            className={cn("grid size-12 shrink-0 place-items-center rounded-xl border transition active:scale-95", fotoVista ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:bg-ground")}
          >
            <Camera className="size-5" />
          </button>
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={escuchando ? "Escuchando… habla ahora" : "Ej: agrega 10 polo manga larga talla M"}
            aria-label="Escribe tu pedido"
            autoComplete="off"
            maxLength={300}
            className={cn("h-12 min-w-0 flex-1 rounded-xl border bg-surface px-3.5 text-sm outline-none transition placeholder:text-faint focus:border-ink", escuchando ? "border-red" : "border-line")}
          />
          <button
            type="button"
            onClick={dictar}
            aria-label={escuchando ? "Dejar de escuchar" : "Dictar por voz"}
            aria-pressed={escuchando}
            className={cn("grid size-12 shrink-0 place-items-center rounded-xl border transition active:scale-95", escuchando ? "animate-pulse border-red bg-red text-white" : "border-line bg-surface text-ink hover:bg-ground")}
          >
            <Mic className="size-5" />
          </button>
          <Boton type="submit" variante="ink" className="h-12 w-12 shrink-0 px-0" disabled={!texto.trim() || trabajando} aria-label="Enviar">
            {trabajando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Boton>
        </form>
        </div>
      }
    >
      <input
        ref={camara}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          fotoElegida(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={galeria}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          fotoElegida(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={archivo}
        type="file"
        accept=".pdf,.xlsx,.xls,.csv,.txt,.docx,.doc,image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void archivoElegido(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="space-y-3 pb-1">
        {mensajes.map((m) => (
          <div key={m.id} className={cn("flex", m.de === "yo" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[92%]", m.de === "yo" && "text-right")}>
              <div className={cn("whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-left text-[13.5px] leading-relaxed", m.de === "yo" ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-ground text-ink")}>
                {m.imagen && <img src={m.imagen} alt="Foto enviada" className="mb-2 max-h-48 w-full rounded-xl object-cover" />}
                {m.texto}
              </div>
              {m.opciones && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.opciones.map((o) => (
                    <button
                      key={o.texto}
                      type="button"
                      onClick={o.accion}
                      className="rounded-xl border border-line bg-surface px-3 py-2 text-left text-[13px] font-semibold transition hover:border-ink active:scale-[0.98]"
                    >
                      {o.texto}
                    </button>
                  ))}
                </div>
              )}
              {m.hecho && (
                <button
                  type="button"
                  disabled={m.hecho.deshecho || trabajando}
                  onClick={() => deshacer(m)}
                  className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] font-semibold text-muted transition hover:border-red hover:text-red disabled:opacity-50"
                >
                  <Undo2 className="size-3.5" /> {m.hecho.deshecho ? "Deshecho" : "Deshacer"}
                </button>
              )}
            </div>
          </div>
        ))}
        {trabajando && (
          <p className="flex items-center gap-2 text-[12.5px] text-muted">
            <Loader2 className="size-3.5 animate-spin" /> Un momento…
          </p>
        )}
        <div ref={fin} />
      </div>
    </Ventana>
  );
}

/** Boton flotante que abre el asistente. */
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
