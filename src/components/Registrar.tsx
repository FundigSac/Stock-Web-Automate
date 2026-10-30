import { Loader2, Search, TriangleAlert, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { agruparProductos } from "../lib/derive";
import { entero, etiquetaTalla, hoyISO, nombreProducto, partirMovimiento, titulo } from "../lib/format";
import { subirFoto } from "../lib/foto";
import { supabase } from "../lib/supabase";
import type { Movimiento, StockItem, Trabajador } from "../lib/types";
import { cn } from "../lib/utils";
import { CampoAutor, estiloCampo as entrada, etiquetaCampo as etiqueta } from "./CampoAutor";
import { CampoFoto } from "./Evidencia";
import { lineasDe, norm, SEL_VACIA, SelectorProducto, type Sel } from "./SelectorProducto";
import { Boton, Ventana } from "./ui";

type Tipo = "entrada" | "salida";

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
}) {
  const [tipo, setTipo] = useState<Tipo>("entrada");
  const [sel, setSel] = useState<Sel>(SEL_VACIA); // entrada: lo que llega · salida: lo que sale · cambio: lo que recibe
  const [verTodo, setVerTodo] = useState(false);
  const [fecha, setFecha] = useState(hoyISO());
  const [quien, setQuien] = useState("");
  const [listaPersonal, setListaPersonal] = useState(false);
  const [nota, setNota] = useState("");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  // Si el guardado falla despues de subir la foto, se reutiliza al reintentar.
  const subida = useRef<{ foto: Blob; ruta: string } | null>(null);

  const grupos = useMemo(() => agruparProductos(stock, minimo), [stock, minimo]);

  const personal = useMemo(() => {
    const palabras = norm(quien).split(/\s+/).filter(Boolean);
    return trabajadores
      .filter((t) => palabras.every((p) => norm(`${t.trabajador} ${t.area ?? ""}`).includes(p)))
      .sort((a, b) => a.trabajador.localeCompare(b.trabajador, "es"));
  }, [quien, trabajadores]);
  const personaElegida = trabajadores.find((t) => t.trabajador === quien) ?? null;
  // El producto se filtra solo segun quien recibe (su genero esta guardado en la lista de trabajadores).
  const generoPersona = tipo !== "entrada" ? (personaElegida?.genero ?? null) : null;
  const filtroGenero = generoPersona ? { valor: generoPersona, verTodo, alVerTodo: () => setVerTodo(true) } : null;

  const esEntrada = tipo === "entrada";
  // Entrada: suma. Salida: resta. Cambio: lo que devuelve suma y lo que recibe resta.
  const lineas = useMemo(() => lineasDe(grupos, sel, esEntrada), [grupos, sel, esEntrada]);
  const grupo = grupos.find((g) => g.clave === sel.clave) ?? null;
  const unidades = lineas.reduce((a, l) => a + l.n, 0);
  const hayNegativo = !esEntrada && lineas.some((l) => l.quedaria < 0);
  const persona = quien.trim();

  const falta = (() => {
    if (!esEntrada && persona === "") return "Falta indicar a quién se entrega.";
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
    setSel(SEL_VACIA);
    setVerTodo(false);
    setNota("");
    setQuien("");
    setListaPersonal(false);
    setFoto(null);
    subida.current = null;
    setError(null);
    setConfirmar(false);
    setFecha(hoyISO());
  }, [abierto]);

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
  useEffect(() => setConfirmar(false), [tipo, sel]);

  async function guardar(otro: boolean) {
    if (!valida) return;
    if (hayNegativo && !confirmar) {
      setConfirmar(true);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      let ruta: string | null = null;
      if (!esEntrada && foto) {
        if (subida.current?.foto === foto) ruta = subida.current.ruta;
        else {
          ruta = await subirFoto(foto);
          subida.current = { foto, ruta };
        }
      }
      const items = lineas.map((l) => ({ codigo: l.t.codigo, cantidad: l.n }));
      const { error: e } = await supabase.rpc("registrar_lote", {
        p_quien: autor.trim(),
        p_tipo: tipo,
        p_fecha: fecha,
        p_items: items,
        p_trabajador: esEntrada ? null : persona,
        p_nota: nota.trim() || null,
        p_foto: ruta,
      });
      if (e) throw new Error(e.message && !/fetch|network/i.test(e.message) ? e.message : "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
      avisar(
        `${esEntrada ? "Entrada" : "Salida"} registrada: ${entero(unidades)} ${unidades === 1 ? "unidad" : "unidades"} de ${nombreProducto(grupo?.producto, grupo?.empresa)}`,
      );
      if (otro) {
        setSel(SEL_VACIA);
        setNota("");
        setFoto(null);
        subida.current = null;
        setConfirmar(false);
      } else {
        alCerrar();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar. Inténtalo de nuevo.");
    } finally {
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
        persona !== "" && <p className="mt-2 text-[12px] text-muted">Se registrará como cliente: {persona}.</p>
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
      subtitulo="Se guarda al instante y lo ve todo el equipo."
      pie={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="rounded-xl bg-red-soft px-3.5 py-2.5 text-[13px] font-medium text-red">
              {error}
            </p>
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
        {pedirAutor && <CampoAutor id="reg-autor" autor={autor} setAutor={setAutor} />}

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
        {!esEntrada && <CampoFoto foto={foto} alCambiar={setFoto} alFallar={(m) => avisar(m, true)} />}

        {/* Fecha y nota */}
        <div className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-2">
          <div>
            <label htmlFor="reg-fecha" className={etiqueta}>
              Fecha
            </label>
            <input id="reg-fecha" type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} className={entrada} />
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

        {confirmar && hayNegativo && (
          <div role="alert" className="rounded-2xl bg-warn-soft p-4 text-warn">
            <p className="flex items-start gap-2.5 text-[13.5px] font-semibold">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>Estás sacando más de lo que hay en stock: el saldo de alguna talla quedará en negativo.</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Boton type="button" variante="ink" onClick={() => guardar(false)} disabled={enviando}>
                Registrar igual
              </Boton>
              <Boton type="button" onClick={() => setConfirmar(false)}>
                Corregir la cantidad
              </Boton>
            </div>
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
}: {
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
      setError(e.message && !/fetch|network/i.test(e.message) ? e.message : "No se pudo anular. Inténtalo de nuevo.");
      return;
    }
    avisar("Movimiento anulado");
    alCerrar();
  }

  const partes = mov ? partirMovimiento(mov.producto) : null;

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
            disabled={motivo.trim().length < 3 || enviando || (pedirAutor && autor.trim().length < 2)}
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
