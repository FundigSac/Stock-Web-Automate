import { Loader2, Search, TriangleAlert, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { agruparProductos } from "../lib/derive";
import { mensajeServidor } from "../lib/errores";
import { entero, etiquetaTalla, fechaLarga, hoyISO, norm, nombreProducto, nombreTalla, partirMovimiento, titulo } from "../lib/format";
import { descargarBlob, nombreEvidencia, type FotoCapturada } from "../lib/foto";
import { esVersionVieja } from "../lib/offline/almacen";
import { borrarBorrador, guardarBorrador, leerBorrador, type Borrador } from "../lib/offline/borrador";
import { duenoActual, registrarMovimiento } from "../lib/offline/cliente";
import { useEnLinea } from "../lib/offline/conexion";
import { SinEspacioError, textoGuardado } from "../lib/offline/respaldo";
import { supabase } from "../lib/supabase";
import { diasDeFoto, fechaDelRegistro, fechaLima, fotoAntigua, isoLima, selloLima } from "../lib/tiempo";
import type { Movimiento, Pedido, StockItem, Trabajador } from "../lib/types";
import { cn } from "../lib/utils";
import { nuevoUuid } from "../lib/uuid";
import { CampoAutor, estiloCampo as entrada, etiquetaCampo as etiqueta } from "./CampoAutor";
import { CampoFoto } from "./Evidencia";
import { CANTIDAD_INUSUAL, lineasDe, SEL_VACIA, SelectorProducto, type Sel } from "./SelectorProducto";
import { Boton, Ventana } from "./ui";

type Tipo = "entrada" | "salida";

const limpiarNombre = (s: string) => s.trim().replace(/\s+/g, " ");

const TIPOS: { id: Tipo; texto: string; ayuda: string }[] = [
  { id: "entrada", texto: "Entrada (+)", ayuda: "Llega mercadería" },
  { id: "salida", texto: "Salida (−)", ayuda: "Se entrega o se vende" },
];

/** Lo que otra ventana (producto nuevo, trabajador nuevo, ficha de un producto) deja elegido al abrir el registro. */
export type PreRegistro = { tipo?: Tipo; empresa?: string; producto?: string; trabajador?: string; n: number };

export function RegistrarDialog({
  abierto,
  alCerrar,
  stock,
  trabajadores,
  minimo,
  avisar,
  autor,
  setAutor,
  pedirAutor,
  pre,
  consumirPre,
  nuevoProducto,
  nuevoTrabajador,
  abrirAsistente,
}: {
  abierto: boolean;
  alCerrar: () => void;
  stock: StockItem[];
  trabajadores: Trabajador[];
  minimo: number;
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
  const [tipo, setTipo] = useState<Tipo>("entrada");
  const [sel, setSel] = useState<Sel>(SEL_VACIA); // entrada: lo que llega · salida: lo que sale
  const [verTodo, setVerTodo] = useState(false);
  // null: la fecha es automática (la de la foto o la de hoy). Con texto, la eligió la persona.
  const [fechaElegida, setFechaElegida] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [quien, setQuien] = useState("");
  const [listaPersonal, setListaPersonal] = useState(false);
  const [nota, setNota] = useState("");
  const [foto, setFoto] = useState<FotoCapturada | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinEspacio, setSinEspacio] = useState(false);
  const [hayQueRecargar, setHayQueRecargar] = useState(false);
  const [falloBorrador, setFalloBorrador] = useState<string | null>(null);
  const [borradorLeido, setBorradorLeido] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [esCliente, setEsCliente] = useState(false);
  // Evita que dos toques seguidos guarden dos veces, antes de que el botón alcance a desactivarse.
  const guardando = useRef(false);
  // Qué botón se pulsó cuando apareció la advertencia.
  const otroPedido = useRef(false);
  // Este formulario y su borrador se reconocen por este id.
  const idFormulario = useRef(nuevoUuid());
  // Foto del registro que se acaba de guardar con "Guardar y registrar otro".
  const fotoYaGuardada = useRef<string | null>(null);
  const borradorEscrito = useRef(false);
  const temporizadorBorrador = useRef<number | undefined>(undefined);
  const enLinea = useEnLinea();

  const grupos = useMemo(() => agruparProductos(stock, minimo), [stock, minimo]);

  const personal = useMemo(() => {
    const palabras = norm(quien).split(/\s+/).filter(Boolean);
    return trabajadores
      .filter((t) => palabras.every((p) => norm(`${t.trabajador} ${t.area ?? ""}`).includes(p)))
      .sort((a, b) => a.trabajador.localeCompare(b.trabajador, "es"));
  }, [quien, trabajadores]);
  const persona = limpiarNombre(quien);
  // Sin importar mayúsculas ni tildes: "diego soto" es el trabajador DIEGO SOTO.
  const personaElegida = useMemo(() => (persona ? (trabajadores.find((t) => norm(limpiarNombre(t.trabajador)) === norm(persona)) ?? null) : null), [persona, trabajadores]);
  const dudaPersona = !personaElegida && persona !== "" && personal.length > 0 && !esCliente;
  // El producto se filtra solo segun quien recibe (su genero esta guardado en la lista de trabajadores).
  const generoPersona = tipo === "salida" ? (personaElegida?.genero ?? null) : null;
  const filtroGenero = generoPersona ? { valor: generoPersona, verTodo, alVerTodo: () => setVerTodo(true) } : null;

  const esEntrada = tipo === "entrada";
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

  const falta = (() => {
    if (!esEntrada && persona === "") return "Falta indicar a quién se entrega.";
    if (!esEntrada && dudaPersona) return "Elige a la persona de la lista o confirma que es un cliente.";
    if (lineas.length === 0) return "Pon al menos 1 unidad en alguna talla.";
    if (!esEntrada && !foto) return "Falta la foto de la entrega.";
    if (fecha === "" || fecha > hoyISO()) return "La fecha no es válida.";
    if (pedirAutor && autor.trim().length < 2) return "Falta tu nombre.";
    return "";
  })();
  const valida = falta === "";

  // Cada vez que se abre, empieza limpio.
  useEffect(() => {
    if (!abierto) return;
    setTipo("entrada");
    setSel(SEL_VACIA);
    setVerTodo(false);
    setNota("");
    setQuien("");
    setListaPersonal(false);
    setEsCliente(false);
    setFoto(null);
    setError(null);
    setSinEspacio(false);
    setHayQueRecargar(false);
    setFalloBorrador(null);
    setConfirmar(false);
    setFechaElegida(null);
    setBorrador(null);
    idFormulario.current = nuevoUuid();
    fotoYaGuardada.current = null;
    borradorEscrito.current = false;
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
    borradorEscrito.current = true;
    const r = await guardarBorrador({ id: idFormulario.current, dueno: duenoActual(), guardadoEn: Date.now(), tipo, sel, quien, esCliente, nota, fechaElegida, foto, continuacion: foto !== null && foto.id === fotoYaGuardada.current });
    if (r === "ok") setFalloBorrador(null);
    else setFalloBorrador(r === "sin_espacio" ? "Este dispositivo no tiene espacio para guardar el formulario mientras lo llenas. Si la página se cierra, lo tendrás que llenar otra vez." : "No se pudo guardar el formulario mientras lo llenas. Si la página se cierra, lo tendrás que llenar otra vez.");
  }

  // Mientras haya un borrador sin resolver no se escribe encima: primero la persona elige qué hacer con él.
  useEffect(() => {
    if (!abierto || !borradorLeido || borrador || guardando.current) return;
    if (!hayDatos) {
      if (borradorEscrito.current) {
        borradorEscrito.current = false;
        void borrarBorrador(duenoActual());
      }
      return;
    }
    // Tras "Guardar y registrar otro" el formulario todavía no contiene nada nuevo.
    if (foto && foto.id === fotoYaGuardada.current && !sel.clave) return;
    temporizadorBorrador.current = window.setTimeout(() => void escribirBorrador(), 300);
    return () => window.clearTimeout(temporizadorBorrador.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, borradorLeido, borrador, hayDatos, foto, tipo, sel, quien, esCliente, nota, fechaElegida]);

  /** La cámara del celular puede matar la página: se guarda ya, sin esperar. */
  function guardarAntesDeLaCamara() {
    window.clearTimeout(temporizadorBorrador.current);
    if (hayDatos && !borrador && borradorLeido && !guardando.current) void escribirBorrador();
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
    setListaPersonal(false);
    setBorrador(null);
  }

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
    if (pre.tipo) setTipo(pre.tipo);
    if (pre.trabajador) {
      setQuien(pre.trabajador);
      setListaPersonal(false);
    }
    if (pre.producto) {
      const g = grupos.find((x) => x.producto === pre.producto && (!pre.empresa || x.empresa === pre.empresa));
      if (!g) return; // todavia no llego a la lista: se reintenta cuando lleguen los datos
      setSel({ clave: g.clave, cants: {} });
    }
    consumirPre();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, pre, grupos]);

  // Cualquier cambio en el formulario cancela la advertencia pendiente.
  useEffect(() => setConfirmar(false), [tipo, sel, fechaElegida]);

  async function guardar(otro: boolean) {
    if (!valida || guardando.current) return;
    if (hayAdvertencia && !confirmar) {
      otroPedido.current = otro;
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
      avisar(textoGuardado(item, `${esEntrada ? "Entrada" : "Salida"} de ${entero(unidades)} ${unidades === 1 ? "unidad" : "unidades"}: ${nombreProducto(grupo?.producto, grupo?.empresa)}`));
      if (otro) {
        // La misma persona y la misma foto sirven para el siguiente producto de esa entrega.
        fotoYaGuardada.current = foto?.id ?? null;
        idFormulario.current = nuevoUuid();
        setSel(SEL_VACIA);
        setNota("");
        setConfirmar(false);
      } else {
        alCerrar();
      }
    } catch (e) {
      if (e instanceof SinEspacioError) {
        setSinEspacio(true);
        setError("Este dispositivo se quedó sin espacio y el registro no se guardó. Descarga la foto para no perderla, libera espacio y vuelve a pulsar Guardar.");
      } else if (esVersionVieja(e)) {
        setHayQueRecargar(true);
        setError("Esta pestaña quedó en una versión anterior de la app y ya no puede guardar. Descarga la foto para no perderla y recarga la página.");
      } else {
        console.error(e);
        setError("No se pudo guardar en este dispositivo. Inténtalo de nuevo.");
      }
    } finally {
      guardando.current = false;
      setEnviando(false);
    }
  }

  function enviar(ev: FormEvent) {
    ev.preventDefault();
    guardar(false);
  }

  const nProd = esEntrada ? 2 : 3;

  const bloqueQuien = (
    <div>
      <label htmlFor="reg-quien" className={etiqueta}>
        2. ¿A quién se entrega?
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          id="reg-quien"
          value={quien}
          onChange={(e) => {
            setQuien(e.target.value);
            setListaPersonal(true);
            setVerTodo(false);
            setEsCliente(false);
          }}
          onFocus={() => setListaPersonal(true)}
          placeholder="Busca por nombre o área, o escribe un cliente"
          autoComplete="off"
          className={cn(entrada, "pl-10", quien && "pr-10")}
        />
        {quien && (
          <button
            type="button"
            onClick={() => {
              setQuien("");
              setListaPersonal(true);
              setVerTodo(false);
              setEsCliente(false);
            }}
            aria-label="Borrar"
            className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-faint transition hover:bg-ground hover:text-ink"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {personaElegida ? (
        <p className="mt-2 rounded-xl bg-ground px-3.5 py-2.5 text-[13px] text-muted">
          <b className="text-ink">{titulo(personaElegida.trabajador)}</b>
          {personaElegida.area ? ` · ${titulo(personaElegida.area)}` : ""}
        </p>
      ) : listaPersonal ? (
        <div className="mt-2">
          {personal.length > 0 ? (
            <ul className="max-h-52 divide-y divide-line-2 overflow-y-auto overscroll-contain rounded-2xl border border-line">
              {personal.map((t) => (
                <li key={t.trabajador}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuien(t.trabajador);
                      setListaPersonal(false);
                      setVerTodo(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-ground active:bg-ground"
                  >
                    <span className="min-w-0 truncate text-[13.5px] font-semibold">{titulo(t.trabajador)}</span>
                    <span className="shrink-0 rounded-full bg-ground px-2.5 py-0.5 text-[11px] font-semibold text-muted">{t.area ? titulo(t.area) : "Sin área"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            persona !== "" && (
              <p className="rounded-xl bg-ground px-3.5 py-2.5 text-[13px] text-muted">
                No está en la lista: se registrará como cliente «<b className="text-ink">{persona}</b>».
              </p>
            )
          )}
        </div>
      ) : (
        persona !== "" && !dudaPersona && <p className="mt-2 text-[12px] text-muted">Se registrará como cliente: {persona.toUpperCase()}.</p>
      )}
      {dudaPersona && (
        <button
          type="button"
          onClick={() => {
            setEsCliente(true);
            setListaPersonal(false);
          }}
          className="mt-2.5 inline-flex h-11 w-full items-center justify-center rounded-xl border border-line text-[13px] font-semibold text-ink transition hover:bg-ground"
        >
          No está en la lista: es un cliente
        </button>
      )}
      {!personaElegida && (
        <button
          type="button"
          onClick={() => nuevoTrabajador(persona)}
          className="mt-2.5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-faint/70 text-[13px] font-semibold text-ink transition hover:bg-ground"
        >
          <UserPlus className="size-4" /> {persona ? `Agregar «${persona}» como trabajador nuevo` : "¿No está? Agregar trabajador nuevo"}
        </button>
      )}
    </div>
  );

  const lineaTexto = (g: typeof grupo, l: (typeof lineas)[number]) =>
    `${nombreProducto(g?.producto, g?.empresa)} · ${etiquetaTalla(l.t.talla).toLowerCase()}`;

  return (
    <Ventana
      abierta={abierto}
      alCerrar={alCerrar}
      titulo="Registrar movimiento"
      subtitulo={enLinea ? "Se guarda al instante y lo ve todo el equipo." : "Sin conexión: se guarda en este dispositivo y se sube cuando vuelva la señal."}
      pie={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="rounded-xl bg-red-soft px-3.5 py-2.5 text-[13px] font-medium text-red">
              {error}
              {(sinEspacio || hayQueRecargar) && foto && (
                <button type="button" onClick={() => descargarBlob(foto.blob, nombreEvidencia(foto.capturadoEn))} className="mt-2 block font-semibold underline underline-offset-2">
                  Descargar la foto
                </button>
              )}
              {hayQueRecargar && (
                <button type="button" onClick={() => window.location.reload()} className="mt-2 block font-semibold underline underline-offset-2">
                  Recargar la página
                </button>
              )}
            </p>
          )}
          {falloBorrador && <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-justify text-[12.5px] font-medium text-warn">{falloBorrador}</p>}
          {confirmar && hayAdvertencia && (
            <div role="alert" className="rounded-2xl bg-warn-soft p-3.5 text-warn">
              <p className="flex items-start gap-2.5 text-[13px] font-semibold">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  {hayNegativo && "Estás sacando más de lo que hay en stock: el saldo de alguna talla quedará en negativo. "}
                  {hayInusual && `Pusiste ${entero(mayor)} unidades en una sola talla. Revisa que el número esté bien. `}
                  {fechaDistinta && fechaFoto && `La foto es del ${fechaLarga(fechaFoto)} y el movimiento quedaría con fecha ${fechaLarga(fecha)}. `}
                  {fotoVieja && fotoUsada && `La foto tiene ${diasDeFoto(fotoUsada.capturadoEn, Date.now())} días. ${fechaElegida ? "" : `El movimiento queda con fecha ${fechaLarga(fecha)} aunque el stock cambie hoy. `}El registro pasará a Por revisar.`}
                </span>
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Boton type="button" variante="ink" onClick={() => guardar(otroPedido.current)} disabled={enviando}>
                  Registrar igual
                </Boton>
                <Boton type="button" onClick={() => setConfirmar(false)}>
                  Corregir
                </Boton>
              </div>
            </div>
          )}
          {!valida && (sel.clave || persona !== "") && <p className="text-[12.5px] text-muted">{falta}</p>}
          <div className="flex gap-2">
            <Boton type="button" className="h-12 flex-1" disabled={!valida || enviando || confirmar} onClick={() => guardar(true)}>
              <span className="sm:hidden">Guardar y otro</span>
              <span className="hidden sm:inline">Guardar y registrar otro</span>
            </Boton>
            <Boton type="submit" form="registrar-form" variante="ink" className="h-12 flex-[1.3]" disabled={!valida || enviando || confirmar}>
              {enviando && <Loader2 className="size-4 animate-spin" />} Guardar
            </Boton>
          </div>
        </div>
      }
    >
      <form id="registrar-form" onSubmit={enviar} className="space-y-6">
        <button type="button" onClick={abrirAsistente} className="text-[13px] font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
          ¿Prefieres escribirlo o subir una hoja? Abre el asistente
        </button>
        {pedirAutor && <CampoAutor id="reg-autor" autor={autor} setAutor={setAutor} />}

        {borrador && (
          <div role="status" className="rounded-2xl bg-warn-soft p-3.5 text-warn">
            <p className="text-[13px] font-semibold">
              Quedó un registro sin guardar
              {borrador.foto ? `, con la foto del ${selloLima(borrador.foto.capturadoEn).fecha} a las ${selloLima(borrador.foto.capturadoEn).hora}` : ""}
              {borrador.quien ? `, para ${titulo(borrador.quien)}` : ""}.
            </p>
            {hayDatos && <p className="mt-1 text-[12.5px]">Hasta que elijas, lo que llenes ahora no se guarda como borrador para no borrar ese.</p>}
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Boton type="button" variante="ink" onClick={() => recuperarBorrador(borrador)}>
                Recuperar
              </Boton>
              <Boton
                type="button"
                onClick={() => {
                  setBorrador(null);
                  void borrarBorrador(duenoActual());
                }}
              >
                Descartar
              </Boton>
            </div>
          </div>
        )}

        {/* 1. Que se hace */}
        <div>
          <p className={etiqueta}>1. ¿Qué vas a registrar?</p>
          <div role="tablist" aria-label="Tipo de movimiento" className="grid grid-cols-2 gap-1.5 rounded-2xl bg-ground p-1">
            {TIPOS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tipo === t.id}
                onClick={() => setTipo(t.id)}
                className={cn(
                  "rounded-xl px-2.5 py-2.5 text-left transition",
                  tipo === t.id ? (t.id === "entrada" ? "bg-ink text-white shadow-card" : "bg-red text-white shadow-card") : "text-muted hover:text-ink",
                )}
              >
                <span className="block text-[13.5px] font-semibold">{t.texto}</span>
                <span className={cn("block text-[11px] leading-snug", tipo === t.id ? "text-white/85" : "text-faint")}>{t.ayuda}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Salida: primero la persona, para filtrar los productos */}
        {!esEntrada && bloqueQuien}

        {/* Entrada / salida: el producto */}
        <SelectorProducto
          idCampo="reg-producto"
          titulo={`${nProd}. ¿Qué producto?`}
          ayuda={esEntrada ? "¿Cuántas unidades llegaron? Ponlas en cada talla" : "¿Cuántas unidades salen? Ponlas en cada talla"}
          suma={esEntrada}
          grupos={grupos}
          genero={filtroGenero}
          valor={sel}
          onChange={setSel}
          nuevoProducto={nuevoProducto}
        />

        {/* Foto de evidencia (solo salidas) */}
        {!esEntrada && <CampoFoto
            foto={foto}
            alCambiar={setFoto}
            alFallar={(m) => avisar(m, true)}
            antesDeElegir={guardarAntesDeLaCamara}
          />}

        {/* Fecha y nota */}
        <div className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-2">
          <div>
            <label htmlFor="reg-fecha" className={etiqueta}>
              Fecha
            </label>
            <input id="reg-fecha" type="date" value={fecha} max={hoyISO()} onChange={(e) => setFechaElegida(e.target.value)} className={entrada} />
            {fechaFoto && fechaElegida === null && <p className="mt-1 text-[12px] text-muted">Es la fecha de la foto.</p>}
          </div>
          <div>
            <label htmlFor="reg-nota" className={etiqueta}>
              {esEntrada ? "Proveedor o nota (opcional)" : "Nota (opcional)"}
            </label>
            <input id="reg-nota" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={120} className={entrada} />
          </div>
        </div>

        {/* Resumen antes de guardar */}
        {lineas.length > 0 && (
          <div className={cn("rounded-2xl p-4 text-[13px] leading-relaxed", esEntrada ? "bg-ground" : "bg-red-soft")}>
            <p className={cn("font-semibold", esEntrada ? "text-ink" : "text-red")}>
              {esEntrada ? "Vas a SUMAR" : "Vas a RESTAR"} {entero(unidades)} {unidades === 1 ? "unidad" : "unidades"}
              {!esEntrada && persona ? ` · para ${titulo(persona)}` : ""}
            </p>
            <ul className="mt-1.5 space-y-0.5 text-muted">
              {lineas.map((l) => (
                <li key={l.t.codigo}>
                  {lineaTexto(grupo, l)}:{" "}
                  <b className="num text-ink">
                    {esEntrada ? "+" : "−"}
                    {entero(l.n)}
                  </b>{" "}
                  → quedará <b className={cn("num", l.quedaria < 0 ? "text-red" : "text-ink")}>{entero(l.quedaria)}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

      </form>
    </Ventana>
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
          ? `${mov.tipo === "entrada" ? "Entrada" : "Salida"} de ${entero(mov.cantidad)} · ${nombreProducto(partes.nombre)}${partes.talla ? ` · ${etiquetaTalla(partes.talla).toLowerCase()}` : ""}`
          : undefined
      }
    >
      <form onSubmit={anular} className="space-y-4">
        <p className="rounded-xl bg-ground px-3.5 py-3 text-[13px] leading-relaxed text-muted">
          El movimiento no se borra: queda marcado como anulado, con tu nombre y el motivo, y deja de contar en el stock.
        </p>
        {!enLinea && <p className="rounded-xl bg-warn-soft px-3.5 py-3 text-[13px] font-medium text-warn">Anular necesita conexión. Hazlo cuando vuelva la señal.</p>}
        {quedaria !== null && quedaria < 0 && <p className="rounded-xl bg-warn-soft px-3.5 py-3 text-[13px] font-medium text-warn">Si anulas esta entrada, el saldo de esta talla quedará en {entero(quedaria)}.</p>}
        {desdePedido && <p className="rounded-xl bg-warn-soft px-3.5 py-3 text-justify text-[13px] font-medium text-warn">Esta entrada vino de un pedido recibido. Al anularla el pedido sigue cerrado: si todavía hace falta, pídelo de nuevo.</p>}
        {mov?.etiqueta && <p className="rounded-xl bg-warn-soft px-3.5 py-3 text-justify text-[13px] font-medium text-warn">Es una mitad de un cambio de prenda. La otra mitad no se anula sola: búscala en Movimientos y anúlala también.</p>}
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
          <p role="alert" className="rounded-xl bg-red-soft px-3.5 py-3 text-[13px] font-medium text-red">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="submit"
            disabled={!enLinea || motivo.trim().length < 3 || enviando || (pedirAutor && autor.trim().length < 2)}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-red sm:flex-1 px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando && <Loader2 className="size-4 animate-spin" />} Anular movimiento
          </button>
          <Boton type="button" className="h-12 shrink-0 sm:flex-1" onClick={alCerrar}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Ventana>
  );
}
