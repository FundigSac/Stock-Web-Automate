import { ArrowDownToLine, ArrowUpFromLine, Bot, CheckCircle2, Download, Loader2, RefreshCw, Smartphone, TriangleAlert, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { agruparProductos } from "../lib/derive";
import { mensajeServidor } from "../lib/errores";
import { entero, etiquetaTalla, fechaLarga, hoyISO, norm, nombreProducto, nombreTalla, nombreTallaEn, partirMovimiento, tallaEnFrase, titulo } from "../lib/format";
import { descargarBlob, nombreEvidencia, type FotoCapturada } from "../lib/foto";
import { esVersionVieja, type ItemRespaldo } from "../lib/offline/almacen";
import { borrarBorrador, guardarBorrador, leerBorrador, type Borrador } from "../lib/offline/borrador";
import { duenoActual, registrarMovimiento } from "../lib/offline/cliente";
import { estaEnLinea, useEnLinea } from "../lib/offline/conexion";
import { SinEspacioError } from "../lib/offline/respaldo";
import { supabase } from "../lib/supabase";
import { diasDeFoto, fechaDelRegistro, fechaLima, fotoAntigua, isoLima, selloLima } from "../lib/tiempo";
import type { Movimiento, Pedido, StockItem, Trabajador } from "../lib/types";
import { cn } from "../lib/utils";
import { nuevoUuid } from "../lib/uuid";
import { CampoAutor, estiloCampo as entrada, etiquetaCampo as etiqueta } from "./CampoAutor";
import { ElegirPersona } from "./ElegirPersona";
import { CampoFoto } from "./Evidencia";
import { BOTON_PRINCIPAL, BOTON_SECUNDARIO, CAMPO, ETIQUETA, PantallaFlujo } from "./FlujoRegistro";
import { CANTIDAD_INUSUAL, CantidadPorTalla, conSigno, lineasDe, ListaProductos, ProductoElegido, SEL_VACIA, type Sel } from "./SelectorProducto";
import { Boton, presion } from "./ui";
import { Ventana } from "./Ventana";

const AVISO_ANULAR = "rounded-md bg-warn-soft px-4 py-3 text-[16px] font-medium leading-6 text-warn";

type Tipo = "entrada" | "salida";
type PasoId = "quien" | "producto" | "cantidad" | "foto" | "revisar";

/** Una pregunta por pantalla: la salida tiene 4 pasos y la entrada 3. */
const PASOS: Record<Tipo, PasoId[]> = {
  salida: ["quien", "producto", "foto", "revisar"],
  entrada: ["producto", "cantidad", "revisar"],
};

const limpiarNombre = (s: string) => s.trim().replace(/\s+/g, " ");
const unidadesTexto = (n: number) => `${entero(n)} ${n === 1 ? "unidad" : "unidades"}`;

type Tono = "ok" | "celular" | "aviso" | "error";
type Resultado = { titulo: string; detalle: string | null; tono: Tono; resumen: string; tipo: Tipo; persona: string | null };

const ICONO_RESULTADO: Record<Tono, LucideIcon> = { ok: CheckCircle2, celular: Smartphone, aviso: TriangleAlert, error: TriangleAlert };
const COLOR_RESULTADO: Record<Tono, string> = {
  ok: "bg-ok-soft text-ok",
  celular: "border-2 border-action bg-surface text-action",
  aviso: "bg-warn-soft text-warn",
  error: "bg-red-soft text-red",
};

/** Lo que se dice al terminar, según cómo quedó el registro. */
function resultadoDe(item: Pick<ItemRespaldo, "estado" | "revision">, conRed: boolean): Pick<Resultado, "titulo" | "detalle" | "tono"> {
  if (item.estado === "confirmado") {
    return item.revision ? { titulo: "Guardado y subido.", detalle: "Quedó por revisar. Míralo en Por subir.", tono: "aviso" } : { titulo: "Guardado y subido.", detalle: null, tono: "ok" };
  }
  if (item.estado === "rechazado") return { titulo: "Guardado en este celular.", detalle: "El servidor no lo aceptó y no cuenta en el stock. Míralo en Por subir.", tono: "error" };
  return { titulo: "Guardado en este celular.", detalle: conRed ? "Todavía no se pudo subir. La app lo volverá a intentar sola." : "Se subirá solo cuando haya conexión.", tono: "celular" };
}

/** Miniatura de la foto que todavía está solo en el celular. */
function MiniaturaLocal({ foto }: { foto: FotoCapturada }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(foto.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [foto]);
  return <span className="block size-20 shrink-0 overflow-hidden rounded-md border border-line bg-ground">{url && <img src={url} alt="Foto de la entrega" className="size-full object-cover" />}</span>;
}

/** Una línea del resumen, con su botón para volver a ese paso. */
function Fila({ etiqueta: rotulo, alCambiar, nombreCambiar, children }: { etiqueta: string; alCambiar: () => void; nombreCambiar: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 pl-4 pr-2">
      <div className="min-w-0 flex-1">
        <dt className="text-left text-[16px] text-muted">{rotulo}</dt>
        <dd className="mt-0.5 text-left text-[18px] leading-[26px] text-ink">{children}</dd>
      </div>
      <button
        type="button"
        onClick={alCambiar}
        aria-label={nombreCambiar}
        className="inline-flex min-h-14 shrink-0 items-center rounded-md px-3 text-[16px] font-semibold text-action underline underline-offset-4 hover:bg-ground"
      >
        Cambiar
      </button>
    </div>
  );
}

/** Lo que otra ventana (producto nuevo, trabajador nuevo, ficha de un producto) deja elegido al abrir el registro. */
export type PreRegistro = { tipo?: Tipo; empresa?: string; producto?: string; trabajador?: string; n: number };

/**
 * Registro a pantalla completa, paso a paso. Guarda primero en el celular y después intenta subir.
 * Mientras se llena, lo escrito se guarda como borrador por si la cámara o el sistema cierran la página.
 */
export function RegistrarDialog({
  abierto,
  alCerrar,
  stock,
  trabajadores,
  minimo,
  autor,
  setAutor,
  pedirAutor,
  pre,
  consumirPre,
  nuevoProducto,
  nuevoTrabajador,
  abrirAsistente,
  enPausa = false,
}: {
  abierto: boolean;
  alCerrar: () => void;
  /** Otra pantalla completa está encima (trabajador nuevo, producto nuevo, Por subir). Al volver, todo sigue igual. */
  enPausa?: boolean;
  stock: StockItem[];
  trabajadores: Trabajador[];
  minimo: number;
  /** No se usa: el resultado se muestra en la última pantalla del registro. */
  avisar: (texto: string, error?: boolean) => void;
  /** Nombre de quien registra (se recuerda en este dispositivo). */
  autor: string;
  setAutor: (v: string) => void;
  /** true si no hay sesion: el nombre es obligatorio. */
  pedirAutor: boolean;
  pre: PreRegistro | null;
  consumirPre: () => void;
  nuevoProducto: (inicial: { nombre?: string; empresa?: string }) => void;
  nuevoTrabajador: (inicial: string) => void;
  /** Otra forma de registrar: escribirlo o subir una hoja en el chat. */
  abrirAsistente: () => void;
}) {
  // null: todavía no se eligió entre entrega e ingreso (el registro se abrió sin tipo).
  const [tipo, setTipo] = useState<Tipo | null>(null);
  // 0: elegir el tipo. Desde 1, el número del paso.
  const [paso, setPaso] = useState(0);
  // Si el tipo se eligió dentro del registro, Atrás en el paso 1 vuelve a esa elección.
  const [desdeElegir, setDesdeElegir] = useState(false);
  const [sel, setSel] = useState<Sel>(SEL_VACIA); // entrada: lo que llega · salida: lo que sale
  const [verTodo, setVerTodo] = useState(false);
  // null: la fecha es automática (la de la foto o la de hoy). Con texto, la eligió la persona.
  const [fechaElegida, setFechaElegida] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [quien, setQuien] = useState("");
  const [nota, setNota] = useState("");
  const [foto, setFoto] = useState<FotoCapturada | null>(null);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinEspacio, setSinEspacio] = useState(false);
  const [hayQueRecargar, setHayQueRecargar] = useState(false);
  const [falloBorrador, setFalloBorrador] = useState<string | null>(null);
  const [borradorLeido, setBorradorLeido] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [esCliente, setEsCliente] = useState(false);
  // Se tocó el botón de abajo sin completar el paso: se dice qué falta.
  const [intento, setIntento] = useState(false);
  const [hecho, setHecho] = useState<Resultado | null>(null);
  // Evita que dos toques seguidos guarden dos veces, antes de que el botón alcance a desactivarse.
  const guardando = useRef(false);
  // Este formulario y su borrador se reconocen por este id.
  const idFormulario = useRef(nuevoUuid());
  // Foto del registro que se acaba de guardar, reutilizada con "Otro producto para…".
  const fotoYaGuardada = useRef<string | null>(null);
  const borradorEscrito = useRef(false);
  const temporizadorBorrador = useRef<number | undefined>(undefined);
  // Tras recuperar un borrador se salta al primer paso que falta completar.
  const irAPendiente = useRef(false);
  const encabezado = useRef<HTMLHeadingElement>(null);
  const enLinea = useEnLinea();

  const grupos = useMemo(() => agruparProductos(stock, minimo), [stock, minimo]);

  // Primero quienes recibieron algo hace poco; luego por nombre.
  const personal = useMemo(() => {
    const palabras = norm(quien).split(/\s+/).filter(Boolean);
    return trabajadores
      .filter((t) => palabras.every((p) => norm(`${t.trabajador} ${t.area ?? ""}`).includes(p)))
      .sort((a, b) => (b.ultima_entrega ?? "").localeCompare(a.ultima_entrega ?? "") || a.trabajador.localeCompare(b.trabajador, "es"));
  }, [quien, trabajadores]);
  const persona = limpiarNombre(quien);
  // Sin importar mayúsculas ni tildes: "diego soto" es el trabajador DIEGO SOTO.
  const personaElegida = useMemo(() => (persona ? (trabajadores.find((t) => norm(limpiarNombre(t.trabajador)) === norm(persona)) ?? null) : null), [persona, trabajadores]);
  const dudaPersona = !personaElegida && persona !== "" && personal.length > 0 && !esCliente;
  // El producto se filtra solo segun quien recibe (su genero esta guardado en la lista de trabajadores).
  const generoPersona = tipo === "salida" ? (personaElegida?.genero ?? null) : null;
  const filtroGenero = generoPersona ? { valor: generoPersona, verTodo, alVerTodo: () => setVerTodo(true) } : null;

  const esEntrada = tipo !== "salida";
  // Entrada: suma. Salida: resta.
  const lineas = useMemo(() => lineasDe(grupos, sel, esEntrada), [grupos, sel, esEntrada]);
  const grupo = grupos.find((g) => g.clave === sel.clave) ?? null;
  const unidades = lineas.reduce((a, l) => a + l.n, 0);
  const hayNegativo = !esEntrada && lineas.some((l) => l.quedaria < 0);
  const mayor = lineas.reduce((a, l) => Math.max(a, l.n), 0);
  const hayInusual = mayor >= CANTIDAD_INUSUAL;
  const fotoUsada = esEntrada ? null : foto;
  const fecha = fechaElegida ?? fechaDelRegistro({ capturadoEn: fotoUsada?.capturadoEn });
  const fechaFoto = fotoUsada ? fechaLima(fotoUsada.capturadoEn) : null;
  // Elegir otro día que el de la foto es posible, pero tiene que ser a propósito.
  const fechaDistinta = fechaFoto !== null && !!fechaElegida && fechaElegida !== fechaFoto;
  // Una foto vieja atrasa el movimiento mientras el stock cambia hoy: se confirma y queda para revisar.
  const fotoVieja = fotoUsada !== null && fotoAntigua(fotoUsada.capturadoEn, Date.now());
  const hayAdvertencia = hayNegativo || hayInusual || fechaDistinta || fotoVieja;

  const pasos = tipo ? PASOS[tipo] : [];
  const pasoId: PasoId | null = paso >= 1 ? (pasos[paso - 1] ?? null) : null;

  /** Qué le falta a un paso para poder seguir. Vacío si está completo. */
  function faltaEn(id: PasoId): string {
    if (id === "quien") {
      if (persona === "") return "Escribe o elige a quién se entrega.";
      if (dudaPersona) return "Elige a la persona de la lista o confirma que es un cliente.";
      return "";
    }
    if (id === "producto") {
      if (!grupo) return "Elige el producto.";
      return !esEntrada && lineas.length === 0 ? "Pon al menos 1 unidad en alguna talla." : "";
    }
    if (id === "cantidad") return lineas.length === 0 ? "Pon al menos 1 unidad en alguna talla." : "";
    if (id === "foto") return foto ? "" : "Falta la foto de la entrega.";
    if (fecha === "" || fecha > hoyISO()) return "La fecha no es válida.";
    if (pedirAutor && autor.trim().length < 2) return "Falta tu nombre.";
    return "";
  }
  const falta = tipo ? (pasos.map(faltaEn).find((f) => f !== "") ?? "") : "Elige qué vas a registrar.";
  const valida = falta === "";
  const faltaAqui = pasoId ? faltaEn(pasoId) : "";

  /** Deja el formulario vacío. El aviso de un borrador anterior sin resolver se mantiene. */
  function limpiarFormulario() {
    setSel(SEL_VACIA);
    setVerTodo(false);
    setNota("");
    setQuien("");
    setEsCliente(false);
    setFoto(null);
    setAvisoFoto(null);
    setError(null);
    setSinEspacio(false);
    setHayQueRecargar(false);
    setFalloBorrador(null);
    setConfirmar(false);
    setFechaElegida(null);
    setIntento(false);
    idFormulario.current = nuevoUuid();
    fotoYaGuardada.current = null;
    borradorEscrito.current = false;
  }

  // Cada vez que se abre, empieza limpio.
  useEffect(() => {
    if (!abierto) return;
    limpiarFormulario();
    setTipo(null);
    setPaso(0);
    setDesdeElegir(false);
    setHecho(null);
    setBorrador(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  // Si quedó un registro a medias porque la página se cerró, se ofrece recuperarlo.
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setBorradorLeido(false);
    void leerBorrador(duenoActual()).then((b) => {
      if (!vivo) return;
      if (b) setBorrador(b);
      setBorradorLeido(true);
    });
    return () => {
      vivo = false;
    };
  }, [abierto]);

  const hayDatos = Boolean(foto || quien.trim() || nota.trim() || fechaElegida || Object.values(sel.cants).some((c) => Number(c) > 0));

  async function escribirBorrador() {
    if (!tipo) return;
    borradorEscrito.current = true;
    const r = await guardarBorrador({ id: idFormulario.current, dueno: duenoActual(), guardadoEn: Date.now(), tipo, sel, quien, esCliente, nota, fechaElegida, foto, continuacion: foto !== null && foto.id === fotoYaGuardada.current });
    if (r === "ok") setFalloBorrador(null);
    else setFalloBorrador(r === "sin_espacio" ? "Este celular no tiene espacio para guardar el registro mientras lo llenas. Si la página se cierra, lo tendrás que llenar otra vez." : "No se pudo guardar el registro mientras lo llenas. Si la página se cierra, lo tendrás que llenar otra vez.");
  }

  // Mientras haya un borrador sin resolver no se escribe encima: primero la persona elige qué hacer con él.
  useEffect(() => {
    if (!abierto || !borradorLeido || borrador || hecho || guardando.current) return;
    if (!hayDatos) {
      if (borradorEscrito.current) {
        borradorEscrito.current = false;
        void borrarBorrador(duenoActual());
      }
      return;
    }
    // Tras "Otro producto para…" el formulario todavía no contiene nada nuevo.
    if (foto && foto.id === fotoYaGuardada.current && !sel.clave) return;
    temporizadorBorrador.current = window.setTimeout(() => void escribirBorrador(), 300);
    return () => window.clearTimeout(temporizadorBorrador.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, borradorLeido, borrador, hecho, hayDatos, foto, tipo, sel, quien, esCliente, nota, fechaElegida]);

  /** La cámara del celular puede matar la página: se guarda ya, sin esperar. */
  function guardarAntesDeLaCamara() {
    window.clearTimeout(temporizadorBorrador.current);
    if (hayDatos && !borrador && borradorLeido && !hecho && !guardando.current) void escribirBorrador();
  }

  function recuperarBorrador(b: Borrador) {
    if (b.id) idFormulario.current = b.id;
    fotoYaGuardada.current = b.continuacion && b.foto ? b.foto.id : null;
    setTipo(b.tipo);
    setSel(b.sel);
    setQuien(b.quien);
    setEsCliente(b.esCliente);
    setNota(b.nota);
    setFechaElegida(b.fechaElegida);
    setFoto(b.foto);
    setBorrador(null);
    irAPendiente.current = true;
  }

  // Después de recuperar, se abre el primer paso incompleto, o el resumen si todo está.
  useEffect(() => {
    if (!irAPendiente.current || !tipo) return;
    irAPendiente.current = false;
    const i = PASOS[tipo].findIndex((id) => id !== "revisar" && faltaEn(id) !== "");
    setPaso(i === -1 ? PASOS[tipo].length : i + 1);
  });

  // Si cambia la persona y el producto elegido era del otro género, se quita para no entregar lo que no corresponde.
  useEffect(() => {
    if (!generoPersona || verTodo) return;
    const g = grupos.find((x) => x.clave === sel.clave);
    if (g?.genero && g.genero !== generoPersona && g.genero !== "UNISEX" && !norm(g.empresa).includes("seguridad")) setSel(SEL_VACIA);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generoPersona]);

  // Algo se acaba de crear (o se pidio desde la ficha de un producto): se deja elegido.
  useEffect(() => {
    if (!abierto || !pre) return;
    if (pre.tipo) {
      setTipo(pre.tipo);
      setPaso((p) => (p === 0 ? 1 : p));
    }
    if (pre.trabajador) setQuien(pre.trabajador);
    if (pre.producto) {
      const g = grupos.find((x) => x.producto === pre.producto && (!pre.empresa || x.empresa === pre.empresa));
      if (!g) return; // todavia no llego a la lista: se reintenta cuando lleguen los datos
      setSel({ clave: g.clave, cants: {} });
    }
    consumirPre();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, pre, grupos]);

  // Cualquier cambio en el formulario cancela la advertencia pendiente.
  useEffect(() => setConfirmar(false), [tipo, sel, fechaElegida, paso]);
  useEffect(() => setIntento(false), [paso, tipo]);

  // Cada pantalla nueva lleva el foco a su pregunta: el lector de pantalla la anuncia.
  useEffect(() => {
    if (abierto && !enPausa) encabezado.current?.focus({ preventScroll: true });
  }, [abierto, enPausa, paso, tipo, hecho]);

  function cambiarPersona(texto: string) {
    // La foto reutilizada era de la entrega anterior: con otra persona ya no sirve como evidencia.
    if (fotoYaGuardada.current && foto?.id === fotoYaGuardada.current && norm(limpiarNombre(texto)) !== norm(persona)) {
      setFoto(null);
      fotoYaGuardada.current = null;
    }
    setQuien(texto);
    setVerTodo(false);
    setEsCliente(false);
  }

  function elegirTipo(t: Tipo) {
    setTipo(t);
    setPaso(1);
    setDesdeElegir(true);
  }

  function siguiente() {
    if (!pasoId) return;
    if (faltaEn(pasoId) !== "") {
      setIntento(true);
      return;
    }
    setPaso(paso + 1);
  }

  function atras() {
    if (enviando) return;
    if (paso === 0) return alCerrar();
    if (paso === 1) {
      if (desdeElegir) setPaso(0);
      else alCerrar();
      return;
    }
    setPaso(paso - 1);
  }

  const irAPaso = (id: PasoId) => setPaso(pasos.indexOf(id) + 1);

  async function guardar() {
    if (!tipo || guardando.current) return;
    if (!valida) {
      setIntento(true);
      // Lleva al campo que falta: en un celular puede estar fuera de la vista.
      const campo = pedirAutor && autor.trim().length < 2 ? "reg-autor" : faltaEn("revisar") !== "" ? "reg-fecha" : null;
      if (campo) document.getElementById(campo)?.focus();
      return;
    }
    if (hayAdvertencia && !confirmar) {
      setConfirmar(true);
      return;
    }
    guardando.current = true;
    window.clearTimeout(temporizadorBorrador.current);
    setEnviando(true);
    setError(null);
    setSinEspacio(false);
    setHayQueRecargar(false);
    try {
      const ahora = isoLima(Date.now());
      const item = await registrarMovimiento({
        tipo,
        capturadoEn: !esEntrada && foto ? foto.capturadoEn : ahora,
        guardadoEn: ahora,
        // Se calcula al guardar: el formulario pudo quedar abierto de un día para otro.
        fecha: fechaDelRegistro({ capturadoEn: fotoUsada?.capturadoEn, elegida: fechaElegida }),
        quien: autor.trim(),
        // Un trabajador va con su nombre tal como está en la lista; un cliente, siempre en mayúsculas para no partirlo en varios.
        trabajador: esEntrada ? null : (personaElegida?.trabajador ?? persona.toUpperCase()),
        area: esEntrada ? null : (personaElegida?.area ?? null),
        nota: nota.trim() || null,
        lineas: lineas.map((l) => ({ codigo: l.t.codigo, cantidad: l.n, producto: l.t.producto, talla: nombreTalla(l.t.talla) })),
        foto: fotoUsada ? { id: fotoUsada.id, blob: fotoUsada.blob, origen: fotoUsada.origen, origenHora: fotoUsada.origenHora, dudosa: fotoUsada.dudosa } : null,
        borrador: { id: idFormulario.current },
      });
      borradorEscrito.current = false;
      const receptor = esEntrada ? null : (personaElegida?.trabajador ?? persona.toUpperCase());
      setHecho({
        ...resultadoDe(item, estaEnLinea()),
        resumen: `${esEntrada ? "Entrada" : "Salida"} de ${unidadesTexto(unidades)}: ${nombreProducto(grupo?.producto, grupo?.empresa)}${receptor ? `, para ${titulo(receptor)}` : ""}.`,
        tipo,
        persona: receptor,
      });
    } catch (e) {
      if (e instanceof SinEspacioError) {
        setSinEspacio(true);
        setError("Este celular se quedó sin espacio y el registro no se guardó. Lo que llenaste sigue aquí. Descarga la foto para no perderla, libera espacio y vuelve a pulsar Guardar.");
      } else if (esVersionVieja(e)) {
        setHayQueRecargar(true);
        setError("Esta pestaña quedó en una versión anterior de la app y ya no puede guardar. Descarga la foto para no perderla y recarga la página.");
      } else {
        console.error(e);
        setError("No se pudo guardar en este celular. Inténtalo de nuevo.");
      }
    } finally {
      guardando.current = false;
      setEnviando(false);
    }
  }

  /** Nuevo registro del mismo tipo, desde cero. */
  function registrarOtro() {
    const t = hecho?.tipo ?? tipo;
    limpiarFormulario();
    setHecho(null);
    setTipo(t);
    setPaso(1);
  }

  /** La misma persona y la misma foto sirven para el siguiente producto de esa entrega. */
  function otroProductoMismaEntrega() {
    fotoYaGuardada.current = foto?.id ?? null;
    idFormulario.current = nuevoUuid();
    setSel(SEL_VACIA);
    setNota("");
    setConfirmar(false);
    setHecho(null);
    setPaso(PASOS.salida.indexOf("producto") + 1);
  }

  function enviar(ev: FormEvent) {
    ev.preventDefault();
    void guardar();
  }

  const pregunta = (texto: string, sub?: ReactNode) => (
    <>
      <h1 ref={encabezado} tabIndex={-1} className="text-[24px] font-semibold leading-8 outline-none">
        {texto}
      </h1>
      {sub ? <p className="mt-1 text-[16px] text-muted">{sub}</p> : null}
    </>
  );

  const nombreReceptor = personaElegida ? titulo(personaElegida.trabajador) : persona.toUpperCase();
  const paraQuien = !esEntrada && persona ? `Para ${nombreReceptor}` : null;

  const botonAsistente = (
    <button type="button" disabled={!enLinea} onClick={abrirAsistente} className={cn(BOTON_SECUNDARIO, "mt-8 text-action")}>
      <Bot className="size-5 shrink-0" aria-hidden />
      {enLinea ? "Escribirlo o subir una hoja con el asistente" : "Asistente · Necesita conexión"}
    </button>
  );

  const avisoBorrador =
    borrador && !hecho ? (
      <div role="status" className="mb-6 rounded-lg bg-warn-soft p-4 text-warn">
        <p className="text-[16px] font-semibold">
          Quedó un registro sin guardar
          {borrador.foto ? `, con la foto del ${selloLima(borrador.foto.capturadoEn).fecha} a las ${selloLima(borrador.foto.capturadoEn).hora}` : ""}
          {borrador.quien ? `, para ${titulo(borrador.quien)}` : ""}.
        </p>
        {hayDatos && <p className="mt-1 text-[16px]">Elige qué hacer con él. Mientras tanto, lo que llenes ahora no se guarda solo, así el anterior no se pierde.</p>}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => recuperarBorrador(borrador)} className={BOTON_SECUNDARIO}>
            Recuperar
          </button>
          <button
            type="button"
            onClick={() => {
              setBorrador(null);
              void borrarBorrador(duenoActual());
            }}
            className={BOTON_SECUNDARIO}
          >
            Descartar
          </button>
        </div>
      </div>
    ) : null;

  const listaLineas = (
    <ul className="mt-1 space-y-1">
      {lineas.map((l) => (
        <li key={l.t.codigo} className="num text-left">
          {etiquetaTalla(nombreTallaEn(l.t.talla, grupo?.tallas ?? []))}: {esEntrada ? "+" : "−"}
          {entero(l.n)}, quedarán <span className={cn("font-semibold", l.quedaria < 0 && "text-red")}>{conSigno(l.quedaria)}</span>
        </li>
      ))}
    </ul>
  );

  let contenido: ReactNode;
  if (hecho) {
    const Icono = ICONO_RESULTADO[hecho.tono];
    contenido = (
      <>
        <div className="flex flex-col items-center pt-4 text-center">
          <span
            className={cn(
              "grid size-20 place-items-center rounded-full transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] starting:opacity-0 starting:[transform:scale(0.8)]",
              COLOR_RESULTADO[hecho.tono],
            )}
          >
            <Icono className="size-10" aria-hidden />
          </span>
          <h1 ref={encabezado} tabIndex={-1} className="mt-5 text-[24px] font-semibold leading-8 outline-none">
            {hecho.titulo}
          </h1>
          {hecho.detalle && <p className="mt-2 max-w-md text-[18px] leading-[26px] text-muted">{hecho.detalle}</p>}
          <p className="num mt-4 max-w-md text-[16px] text-ink">{hecho.resumen}</p>
        </div>
        {hecho.tipo === "salida" && hecho.persona && (
          <div className="mt-8">
            <button type="button" onClick={otroProductoMismaEntrega} className={BOTON_SECUNDARIO}>
              Otro producto para {titulo(hecho.persona)}
            </button>
            <p className="mt-2 text-left text-[16px] text-muted">Usa la misma foto de esta entrega.</p>
          </div>
        )}
      </>
    );
  } else if (!tipo || !pasoId) {
    contenido = (
      <>
        {pregunta("¿Qué vas a registrar?")}
        <div className="mt-5 grid grid-cols-1 gap-3">
          <button type="button" onClick={() => elegirTipo("salida")} className="registrar-opcion registrar-salida">
            <ArrowUpFromLine className="size-10 shrink-0" aria-hidden />
            Entregar a un trabajador
          </button>
          <button type="button" onClick={() => elegirTipo("entrada")} className="registrar-opcion registrar-entrada">
            <ArrowDownToLine className="size-10 shrink-0" aria-hidden />
            Ingresar a almacén
          </button>
        </div>
        {botonAsistente}
      </>
    );
  } else if (pasoId === "quien") {
    contenido = (
      <>
        {pregunta("¿Quién recibe?")}
        <div className="mt-5">
          <ElegirPersona
            quien={quien}
            personal={personal}
            personaElegida={personaElegida}
            persona={persona}
            dudaPersona={dudaPersona}
            esCliente={esCliente}
            alEscribir={cambiarPersona}
            alElegir={(t) => cambiarPersona(t.trabajador)}
            alMarcarCliente={() => setEsCliente(true)}
            alAgregar={() => nuevoTrabajador(persona)}
          />
        </div>
        {botonAsistente}
      </>
    );
  } else if (pasoId === "producto") {
    contenido = (
      <>
        {pregunta(esEntrada ? "¿Qué ingresa?" : "¿Qué le entregas?", paraQuien)}
        <div className="mt-5">
          {grupo ? (
            <>
              <ProductoElegido grupo={grupo} alCambiar={() => setSel(SEL_VACIA)} />
              {!esEntrada && (
                <div className="mt-6">
                  <CantidadPorTalla key={grupo.clave} grupo={grupo} valor={sel} onChange={setSel} suma={false} />
                </div>
              )}
            </>
          ) : (
            <ListaProductos idCampo="reg-producto" grupos={grupos} genero={filtroGenero} alElegir={(g) => setSel({ clave: g.clave, cants: {} })} nuevoProducto={nuevoProducto} />
          )}
        </div>
        {esEntrada && botonAsistente}
      </>
    );
  } else if (pasoId === "cantidad") {
    contenido = (
      <>
        {pregunta("¿Cuántas unidades ingresan?", grupo ? nombreProducto(grupo.producto, grupo.empresa) : null)}
        <div className="mt-5">
          {grupo ? <CantidadPorTalla key={grupo.clave} grupo={grupo} valor={sel} onChange={setSel} suma /> : <p className="text-left text-[16px] text-muted">Primero elige el producto.</p>}
        </div>
      </>
    );
  } else if (pasoId === "foto") {
    contenido = (
      <>
        {pregunta("Toma la foto", "La foto de la entrega es obligatoria.")}
        <div className="mt-5">
          <CampoFoto
            foto={foto}
            alCambiar={setFoto}
            alFallar={setAvisoFoto}
            antesDeElegir={() => {
              setAvisoFoto(null);
              guardarAntesDeLaCamara();
            }}
          />
        </div>
        {avisoFoto && (
          <p role="alert" className="mt-4 rounded-lg bg-warn-soft px-4 py-3 text-[16px] font-semibold text-warn">
            {avisoFoto}
          </p>
        )}
        {fotoVieja && fotoUsada && (
          <p className="mt-4 flex items-start gap-3 rounded-lg bg-warn-soft px-4 py-3 text-[16px] font-semibold text-warn">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>La foto tiene {diasDeFoto(fotoUsada.capturadoEn, Date.now())} días. Puedes usarla, pero el registro pasará a Por revisar.</span>
          </p>
        )}
      </>
    );
  } else {
    contenido = (
      <form id="registrar-form" onSubmit={enviar} noValidate>
        {pregunta("Revisa y guarda")}
        <p className="num mt-4 text-left text-[18px] font-semibold">
          {esEntrada ? `Vas a sumar ${unidadesTexto(unidades)} al stock.` : `Vas a restar ${unidadesTexto(unidades)} del stock.`}
        </p>
        <dl className="mt-4 divide-y divide-line-2 overflow-hidden rounded-lg border border-line bg-surface">
          {!esEntrada && (
            <Fila etiqueta="Recibe" alCambiar={() => irAPaso("quien")} nombreCambiar="Cambiar quién recibe">
              {personaElegida ? `${titulo(personaElegida.trabajador)}${personaElegida.area ? ` · ${titulo(personaElegida.area)}` : ""}` : `${persona.toUpperCase()} · cliente`}
            </Fila>
          )}
          <Fila etiqueta={esEntrada ? "Ingresa" : "Entregas"} alCambiar={() => irAPaso("producto")} nombreCambiar="Cambiar el producto">
            <span className="font-semibold">{nombreProducto(grupo?.producto, grupo?.empresa)}</span>
            {!esEntrada && listaLineas}
          </Fila>
          {esEntrada && (
            <Fila etiqueta="Cantidad" alCambiar={() => irAPaso("cantidad")} nombreCambiar="Cambiar la cantidad">
              {listaLineas}
            </Fila>
          )}
          {!esEntrada && foto && (
            <Fila etiqueta="Foto" alCambiar={() => irAPaso("foto")} nombreCambiar="Cambiar la foto">
              <span className="mt-1 flex items-center gap-3">
                <MiniaturaLocal foto={foto} />
                <span className="num text-[16px] text-muted">
                  {selloLima(foto.capturadoEn).fecha} a las {selloLima(foto.capturadoEn).hora}
                </span>
              </span>
            </Fila>
          )}
        </dl>

        <div className="mt-6 grid grid-cols-1 gap-4 min-[460px]:grid-cols-2">
          <div>
            <label htmlFor="reg-fecha" className={ETIQUETA}>
              Fecha
            </label>
            <input id="reg-fecha" type="date" value={fecha} max={hoyISO()} onChange={(e) => setFechaElegida(e.target.value)} className={CAMPO} />
            {fechaFoto && fechaElegida === null && <p className="mt-1 text-left text-[16px] text-muted">Es la fecha de la foto.</p>}
          </div>
          <div>
            <label htmlFor="reg-nota" className={ETIQUETA}>
              {esEntrada ? "Proveedor o nota (opcional)" : "Nota (opcional)"}
            </label>
            <input id="reg-nota" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={120} className={CAMPO} />
          </div>
        </div>
        {pedirAutor && (
          <div className="mt-6">
            <CampoAutor id="reg-autor" autor={autor} setAutor={setAutor} />
          </div>
        )}
      </form>
    );
  }

  const avisoFalloBorrador = falloBorrador ? <p className="rounded-lg bg-warn-soft px-4 py-3 text-[16px] font-semibold text-warn">{falloBorrador}</p> : null;
  const queFalta = (texto: string) =>
    intento && texto ? (
      <p role="alert" className="text-[16px] font-semibold text-red">
        {texto}
      </p>
    ) : null;

  let pie: ReactNode = null;
  if (hecho) {
    pie = (
      <>
        <button type="button" onClick={registrarOtro} className={BOTON_PRINCIPAL}>
          Registrar otro
        </button>
        <button type="button" onClick={alCerrar} className="inline-flex min-h-14 w-full items-center justify-center rounded-md text-[18px] font-semibold text-action underline underline-offset-4 hover:bg-ground">
          Ir al inicio
        </button>
      </>
    );
  } else if (pasoId === "revisar") {
    pie = (
      <>
        {error && (
          <div role="alert" className="rounded-lg bg-red-soft p-4 text-red">
            <p className="text-[16px] font-semibold">{error}</p>
            {(sinEspacio || hayQueRecargar) && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {foto && (
                  <button type="button" onClick={() => descargarBlob(foto.blob, nombreEvidencia(foto.capturadoEn))} className={cn(BOTON_SECUNDARIO, "text-red")}>
                    <Download className="size-5 shrink-0" aria-hidden /> Descargar la foto
                  </button>
                )}
                {hayQueRecargar && (
                  <button type="button" onClick={() => window.location.reload()} className={cn(BOTON_SECUNDARIO, "text-red")}>
                    <RefreshCw className="size-5 shrink-0" aria-hidden /> Recargar la página
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {avisoFalloBorrador}
        {confirmar && hayAdvertencia && (
          <div role="alert" className="rounded-lg bg-warn-soft p-4 text-warn">
            <p className="flex items-start gap-3 text-[16px] font-semibold">
              <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>
                {hayNegativo && "Estás sacando más de lo que hay en stock: el saldo de alguna talla quedará en negativo. "}
                {hayInusual && `Pusiste ${entero(mayor)} unidades en una sola talla. Revisa que el número esté bien. `}
                {fechaDistinta && fechaFoto && `La foto es del ${fechaLarga(fechaFoto)} y el movimiento quedaría con fecha ${fechaLarga(fecha)}. `}
                {fotoVieja && fotoUsada && `La foto tiene ${diasDeFoto(fotoUsada.capturadoEn, Date.now())} días. ${fechaElegida ? "" : `El movimiento queda con fecha ${fechaLarga(fecha)} aunque el stock cambie hoy. `}El registro pasará a Por revisar.`}
              </span>
            </p>
            <button type="button" onClick={() => setConfirmar(false)} className={cn(BOTON_SECUNDARIO, "mt-3")}>
              Corregir
            </button>
          </div>
        )}
        {queFalta(falta)}
        <button type="submit" form="registrar-form" disabled={enviando} aria-disabled={!valida} className={BOTON_PRINCIPAL}>
          {enviando && <Loader2 className="size-6 animate-spin" aria-hidden />}
          {confirmar && hayAdvertencia ? "Registrar igual" : "Guardar"}
        </button>
      </>
    );
  } else if (pasoId) {
    pie = (
      <>
        {avisoFalloBorrador}
        {queFalta(faltaAqui)}
        <button type="button" onClick={siguiente} aria-disabled={faltaAqui !== ""} className={BOTON_PRINCIPAL}>
          Siguiente
        </button>
      </>
    );
  }

  return (
    <PantallaFlujo
      abierta={abierto}
      oculta={enPausa}
      etiqueta={tipo === "salida" ? "Entrega a un trabajador" : tipo === "entrada" ? "Ingreso a almacén" : "Registrar"}
      pasoTexto={!hecho && tipo && paso >= 1 ? `Paso ${paso} de ${pasos.length}` : null}
      alAtras={hecho ? undefined : atras}
      atrasDesactivado={enviando}
      claveContenido={hecho ? "hecho" : `${tipo ?? "tipo"}-${paso}`}
      pie={pie}
    >
      {avisoBorrador}
      {contenido}
    </PantallaFlujo>
  );
}

export function AnularDialog({
  mov,
  alCerrar,
  avisar,
  autor,
  setAutor,
  pedirAutor,
  stock,
  pedidos,
}: {
  stock: StockItem[];
  pedidos: Pedido[];
  mov: Movimiento | null;
  alCerrar: () => void;
  avisar: (texto: string) => void;
  autor: string;
  setAutor: (v: string) => void;
  pedirAutor: boolean;
}) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enLinea = useEnLinea();

  useEffect(() => {
    setMotivo("");
    setError(null);
  }, [mov?.key]);

  async function anular(ev: FormEvent) {
    ev.preventDefault();
    if (!mov) return;
    setEnviando(true);
    setError(null);
    const { error: e } = await supabase.rpc("anular_movimiento", { p_quien: autor.trim(), p_tipo: mov.tipo, p_id: mov.id, p_motivo: motivo.trim() });
    setEnviando(false);
    if (e) {
      setError(mensajeServidor(e, "No se pudo anular. Revisa tu conexión e inténtalo de nuevo."));
      return;
    }
    avisar("Movimiento anulado");
    alCerrar();
  }

  const partes = mov ? partirMovimiento(mov.producto) : null;
  // Quitar una entrada resta del stock: si deja la talla en negativo, hay que saberlo antes.
  const saldo = mov?.tipo === "entrada" ? stock.find((s) => s.codigo === mov.codigo)?.queda : undefined;
  const quedaria = saldo !== undefined && mov ? saldo - mov.cantidad : null;
  // El pedido se cierra en el mismo instante en que nace su entrada: así se reconoce, porque la fila no guarda de qué pedido vino.
  const desdePedido =
    mov?.tipo === "entrada" &&
    pedidos.some((p) => p.estado === "recibido" && p.codigo === mov.codigo && (p.cantidad_recibida ?? p.cantidad) === mov.cantidad && !!p.cerrado_at && Math.abs(Date.parse(p.cerrado_at) - Date.parse(mov.creado)) < 120_000);

  return (
    <Ventana
      abierta={mov !== null}
      alCerrar={alCerrar}
      titulo="Anular movimiento"
      subtitulo={
        mov && partes
          ? `${mov.tipo === "entrada" ? "Entrada" : "Salida"} de ${entero(mov.cantidad)} · ${nombreProducto(partes.nombre)}${partes.talla ? ` · ${tallaEnFrase(partes.talla)}` : ""}`
          : undefined
      }
    >
      <form onSubmit={anular} className="space-y-4">
        <p className="rounded-md bg-ground px-4 py-3 text-[16px] leading-6 text-muted">
          El movimiento no se borra: queda marcado como anulado, con tu nombre y el motivo, y deja de contar en el stock.
        </p>
        {!enLinea && <p className={AVISO_ANULAR}>Anular necesita conexión. Hazlo cuando vuelva la señal.</p>}
        {quedaria !== null && quedaria < 0 && <p className={AVISO_ANULAR}>Si anulas esta entrada, el saldo de esta talla quedará en {entero(quedaria)}.</p>}
        {desdePedido && <p className={AVISO_ANULAR}>Esta entrada vino de un pedido recibido. Al anularla el pedido sigue cerrado: si todavía hace falta, pídelo de nuevo.</p>}
        {mov?.etiqueta && <p className={AVISO_ANULAR}>Es una mitad de un cambio de prenda. La otra mitad no se anula sola: búscala en Movimientos y anúlala también.</p>}
        {pedirAutor && <CampoAutor id="anular-autor" autor={autor} setAutor={setAutor} />}
        <div>
          <label htmlFor="anular-motivo" className={etiqueta}>
            Motivo (obligatorio)
          </label>
          <input
            id="anular-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={200}
            placeholder="Por ejemplo: se anotó el producto equivocado"
            className={entrada}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-red-soft px-4 py-3 text-[16px] font-medium leading-6 text-red">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <button
            type="submit"
            disabled={!enLinea || motivo.trim().length < 3 || enviando || (pedirAutor && autor.trim().length < 2)}
            className={cn(
              "inline-flex min-h-16 shrink-0 items-center justify-center gap-2 rounded-md bg-red px-4 text-[18px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red sm:flex-1",
              presion,
            )}
          >
            {enviando && <Loader2 className="size-5 animate-spin" aria-hidden />} Anular movimiento
          </button>
          <Boton type="button" className="min-h-14 shrink-0 text-[18px] sm:flex-1" onClick={alCerrar}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Ventana>
  );
}
