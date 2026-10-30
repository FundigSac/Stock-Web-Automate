import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FileDown,
  LayoutDashboard,
  Package,
  Plus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AsistenteDialog, BotonAsistente } from "./components/Asistente";
import { CampanaReporte, EspacioReporte, RESORTE, useReporte } from "./components/CampanaReporte";
import { Cuenta } from "./components/Cuenta";
import { VentanaProducto, VentanaTrabajador } from "./components/Detalles";
import { Marca } from "./components/Marca";
import { NuevoProductoDialog, NuevoTrabajadorDialog } from "./components/Nuevo";
import { AnularDialog, RegistrarDialog, type PreRegistro } from "./components/Registrar";
import { ReportesDialog } from "./components/Reportes";
import { Boton, Skeleton } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { filtrarPorEmpresa, resumir, type GrupoProducto } from "./lib/derive";
import { fechaLarga, hace, titulo } from "./lib/format";
import type { Movimiento } from "./lib/types";
import { useQuien } from "./lib/quien";
import { useLiveData } from "./lib/useLiveData";
import { cn } from "./lib/utils";
import { Movimientos } from "./views/Movimientos";
import { Resumen } from "./views/Resumen";
import { Stock } from "./views/Stock";
import { Trabajadores } from "./views/Trabajadores";
import type { FiltroEstado, Vista, VistaProps } from "./views/tipos";

const NAV: { id: Vista; texto: string; sub: string; icono: LucideIcon }[] = [
  { id: "resumen", texto: "Resumen", sub: "Todo lo importante de un vistazo", icono: LayoutDashboard },
  { id: "stock", texto: "Stock", sub: "Cuánto queda de cada producto y talla", icono: Package },
  { id: "movimientos", texto: "Movimientos", sub: "Lo que entra y lo que sale", icono: Activity },
  { id: "trabajadores", texto: "Trabajadores", sub: "Quién recibió qué", icono: Users },
];

export default function App() {
  return (
    <AuthProvider>
      <Tablero />
    </AuthProvider>
  );
}

function Tablero() {
  const { editor, sesion } = useAuth();
  const [autor, setAutor] = useQuien();
  const { datos: todos, cargando, error, cambioAt, ultimaCarga, tiempoReal, recargar } = useLiveData(true);
  const [vista, setVista] = useState<Vista>("resumen");
  const [empresa, setEmpresa] = useState("TODAS");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos");
  const [grupo, setGrupo] = useState<GrupoProducto | null>(null);
  const [trabajador, setTrabajador] = useState<string | null>(null);
  const [registro, setRegistro] = useState(false);
  const [asistente, setAsistente] = useState(false);
  const [preguntaAsistente, setPreguntaAsistente] = useState<string | null>(null);
  const [pre, setPre] = useState<PreRegistro | null>(null);
  const [nuevoProd, setNuevoProd] = useState<{ nombre?: string; empresa?: string } | null>(null);
  const [nuevoTrab, setNuevoTrab] = useState<string | null>(null);
  const [anular, setAnular] = useState<Movimiento | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [reportes, setReportes] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; error?: boolean } | null>(null);
  const ultimoAvisoPropio = useRef(0);
  const temporizadorAviso = useRef<number | undefined>(undefined);

  const mostrar = useCallback((texto: string, esError = false) => {
    ultimoAvisoPropio.current = Date.now();
    setAviso({ texto, error: esError });
    window.clearTimeout(temporizadorAviso.current);
    temporizadorAviso.current = window.setTimeout(() => setAviso(null), esError ? 4000 : 3200);
  }, []);

  useEffect(() => {
    document.title = "Stock EPP";
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Cuando OTRA persona registra algo, aparece un aviso breve (no se repite el de lo que acabas de hacer tu).
  useEffect(() => {
    if (!cambioAt) return;
    if (Date.now() - ultimoAvisoPropio.current < 4000) return;
    setAviso({ texto: "Datos actualizados" });
    window.clearTimeout(temporizadorAviso.current);
    temporizadorAviso.current = window.setTimeout(() => setAviso(null), 2600);
  }, [cambioAt]);

  const reporte = useReporte({ todos, autor, avisar: mostrar, recargar });
  const minimo = todos.sync?.stock_minimo ?? 2;
  // Registro abierto: cualquiera registra. Si se cierra (ajustes.registro_abierto = false), solo las cuentas autorizadas.
  const registroAbierto = todos.sync?.registro_abierto ?? true;
  const puede = registroAbierto || editor;
  const empresas = useMemo(
    () => Array.from(new Set(todos.stock.map((s) => s.empresa))).sort((a, b) => a.localeCompare(b, "es")),
    [todos.stock],
  );
  const datos = useMemo(() => filtrarPorEmpresa(todos, empresa), [todos, empresa]);
  const ultimoMovimiento = useMemo(() => resumir(todos.stock, minimo).ultima, [todos.stock, minimo]);

  // Si la empresa elegida desaparece del catalogo, vuelve a "todas".
  useEffect(() => {
    if (empresa !== "TODAS" && empresas.length > 0 && !empresas.includes(empresa)) setEmpresa("TODAS");
  }, [empresa, empresas]);

  const irA = (v: Vista, estado?: FiltroEstado) => {
    setVista(v);
    if (estado) setFiltroEstado(estado);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const propsVista: VistaProps = {
    todos,
    datos,
    minimo,
    empresa,
    cambiarEmpresa: setEmpresa,
    abrirProducto: setGrupo,
    abrirTrabajador: setTrabajador,
    irA,
    filtroEstado,
    setFiltroEstado,
    editor: puede,
    pedirAnular: setAnular,
    abrirRegistro: () => setRegistro(true),
    abrirNuevoProducto: () => setNuevoProd({ empresa }),
    abrirNuevoTrabajador: () => setNuevoTrab(""),
    abrirAsistente: (pregunta) => {
      setPreguntaAsistente(pregunta ?? null);
      setAsistente(true);
    },
    pedidosPendientes: todos.pedidos.filter((p) => p.estado === "pendiente").length,
  };

  // Desde la ficha de un producto: abre el registro con el producto ya elegido.
  const registrarDe = (tipo: "entrada" | "salida", g: GrupoProducto) => {
    setGrupo(null);
    setPre({ tipo, empresa: g.empresa, producto: g.producto, n: Date.now() });
    setRegistro(true);
  };

  // Estado de la conexion: se lee de nuevo cada 20 s y ademas llegan avisos en tiempo real.
  const edad = ultimaCarga ? (ahora - ultimaCarga) / 1000 : Infinity;
  const pill = error
    ? { tono: "bg-red-soft text-red", texto: "Revisar conexión", vivo: false }
    : edad > 60
      ? { tono: "bg-warn-soft text-warn", texto: `Sin actualizar ${hace(ultimaCarga ? new Date(ultimaCarga).toISOString() : null, ahora)}`, vivo: false }
      : { tono: "bg-ok-soft text-ok", texto: tiempoReal ? "En vivo" : "Conectado", vivo: tiempoReal };

  const actual = NAV.find((n) => n.id === vista)!;

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Barra lateral */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line-2 bg-surface px-4 py-5 lg:flex">
        <div className="flex items-center gap-3 px-2">
          <div className="grid size-9 place-items-center rounded-xl bg-ink">
            <Marca tam={22} />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Stock EPP</p>
            <p className="text-[11px] text-muted">Control en vivo</p>
          </div>
        </div>

        <nav className="mt-8 space-y-1" aria-label="Secciones">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => irA(n.id)}
              aria-current={vista === n.id ? "page" : undefined}
              className={cn(
                "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold transition",
                vista === n.id ? "bg-ink text-white" : "text-muted hover:bg-ground hover:text-ink",
              )}
            >
              <n.icono className="size-[18px]" />
              {n.texto}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <div className="rounded-2xl bg-ground p-3.5 text-[12px] leading-relaxed text-muted">
            <p className="font-semibold text-ink">Datos en vivo</p>
            <p>{cargando ? "Conectando…" : `Actualizado ${hace(ultimaCarga ? new Date(ultimaCarga).toISOString() : null, ahora)}`}</p>
            {ultimoMovimiento && <p>Último movimiento: {fechaLarga(ultimoMovimiento)}</p>}
          </div>
        </div>
      </aside>

      {/* Cabecera */}
      <header className={cn("z-30 border-b border-line-2/70 bg-ground/85 backdrop-blur-md", reporte.unido ? "relative" : "sticky top-0")}>
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 lg:px-8">
          {/* Celular: titulo y campana en una fila (la isla baja justo debajo y empuja lo demas). Pantalla grande: sin caja propia. */}
          <motion.div
            data-fila-titulo
            className="flex w-full items-center gap-3 sm:contents"
            initial={false}
            animate={{ marginBottom: reporte.modo === "cerrada" ? 0 : reporte.empujeMovil }}
            transition={RESORTE}
          >
            <div className="mr-auto min-w-0">
              <h1 className="display text-2xl font-semibold leading-tight lg:text-[28px]">{actual.texto}</h1>
              <p className="truncate text-[13px] text-muted">{actual.sub}</p>
            </div>
            {!cargando && (
              <div className="no-print shrink-0 sm:order-3">
                <CampanaReporte r={reporte} />
              </div>
            )}
          </motion.div>

          <div className="no-print flex flex-wrap items-center gap-2.5 sm:order-2">
            <div className="relative">
              <select
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
                aria-label="Empresa"
                className="h-10 appearance-none rounded-xl border border-line bg-surface py-0 pl-3.5 pr-9 text-sm font-semibold outline-none transition hover:bg-ground focus-visible:border-ink"
              >
                <option value="TODAS">Todas las empresas</option>
                {empresas.map((e) => (
                  <option key={e} value={e}>
                    {titulo(e)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            </div>

            <span className={cn("inline-flex h-10 items-center gap-2.5 rounded-xl px-3.5 text-[13px] font-semibold", pill.tono)} role="status">
              <span className={cn("relative size-2 rounded-full bg-current", pill.vivo && "live-dot")} />
              {pill.texto}
            </span>

            {puede && (
              <Boton variante="ink" className="hidden sm:inline-flex" onClick={() => setRegistro(true)}>
                <Plus className="size-4" /> Registrar
              </Boton>
            )}

            {(!registroAbierto || sesion) && <Cuenta avisar={mostrar} />}

            <Boton onClick={() => setReportes(true)} disabled={cargando}>
              <FileDown className="size-4" />
              PDF
            </Boton>
          </div>
        </div>
      </header>

      {/* La isla del reporte semanal sale de la campana; este espacio baja el contenido mientras esta abierta */}
      {!cargando && <EspacioReporte r={reporte} />}

      <main className="mx-auto max-w-[1480px] px-4 pb-28 pt-6 lg:px-8 lg:pb-12">
        {error && (
          <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl bg-red-soft px-4 py-3 text-[13px] text-red">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>No se pudieron cargar los datos. Se reintentará solo. ({error})</span>
          </div>
        )}

        {cargando ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <Skeleton className="h-[360px] xl:col-span-2" />
              <Skeleton className="h-[360px]" />
            </div>
            <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={vista}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {vista === "resumen" && <Resumen {...propsVista} />}
              {vista === "stock" && <Stock {...propsVista} />}
              {vista === "movimientos" && <Movimientos {...propsVista} />}
              {vista === "trabajadores" && <Trabajadores {...propsVista} />}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* Boton flotante para registrar desde el celular */}
      {puede && (
        <button
          type="button"
          onClick={() => setRegistro(true)}
          className="no-print fixed bottom-24 right-4 z-40 inline-flex h-14 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-white shadow-pop transition active:scale-95 sm:hidden"
        >
          <Plus className="size-5" /> Registrar
        </button>
      )}

      {/* Asistente: solo para agregar stock o crear */}
      {puede && !asistente && <BotonAsistente onClick={() => setAsistente(true)} />}

      {/* Navegacion inferior en celular */}
      <nav
        className="no-print fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-line bg-surface/95 p-1.5 shadow-pop backdrop-blur lg:hidden"
        aria-label="Secciones"
      >
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => irA(n.id)}
            aria-current={vista === n.id ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[10.5px] font-semibold transition",
              vista === n.id ? "bg-ink text-white" : "text-muted",
            )}
          >
            <n.icono className="size-[18px]" />
            {n.texto}
          </button>
        ))}
      </nav>

      {puede && (
        <AsistenteDialog
          abierto={asistente}
          alCerrar={() => setAsistente(false)}
          datos={todos}
          minimo={minimo}
          autor={autor}
          avisar={mostrar}
          crearProducto={(i) => setNuevoProd({ nombre: i.nombre })}
          crearTrabajador={(n) => setNuevoTrab(n)}
          iniciar={preguntaAsistente}
          consumirIniciar={() => setPreguntaAsistente(null)}
        />
      )}
      <ReportesDialog
        abierto={reportes}
        alCerrar={() => setReportes(false)}
        todos={todos}
        empresas={empresas}
        empresaInicial={empresa}
        usuario={autor}
        avisar={mostrar}
      />
      <VentanaProducto grupo={grupo} datos={todos} minimo={minimo} alCerrar={() => setGrupo(null)} editor={puede} alRegistrar={registrarDe} />
      <VentanaTrabajador nombre={trabajador} datos={todos} alCerrar={() => setTrabajador(null)} />
      {puede && (
        <RegistrarDialog
          abierto={registro}
          alCerrar={() => setRegistro(false)}
          stock={todos.stock}
          trabajadores={todos.trabajadores}
          minimo={minimo}
          avisar={mostrar}
          autor={autor}
          setAutor={setAutor}
          pedirAutor={!sesion}
          pre={pre}
          consumirPre={() => setPre(null)}
          nuevoProducto={(i) => setNuevoProd(i)}
          nuevoTrabajador={(n) => setNuevoTrab(n)}
        />
      )}
      {puede && (
        <NuevoProductoDialog
          abierto={nuevoProd !== null}
          alCerrar={() => setNuevoProd(null)}
          stock={todos.stock}
          inicial={nuevoProd}
          avisar={mostrar}
          autor={autor}
          setAutor={setAutor}
          pedirAutor={!sesion}
          alCrear={(r) => {
            // Si se creo desde el registro, queda elegido para seguir.
            if (registro) setPre({ empresa: r.empresa, producto: r.producto, n: Date.now() });
          }}
        />
      )}
      {puede && (
        <NuevoTrabajadorDialog
          abierto={nuevoTrab !== null}
          alCerrar={() => setNuevoTrab(null)}
          trabajadores={todos.trabajadores}
          inicial={nuevoTrab ?? ""}
          avisar={mostrar}
          autor={autor}
          setAutor={setAutor}
          pedirAutor={!sesion}
          alCrear={(nombre) => {
            if (registro) setPre({ tipo: "salida", trabajador: nombre, n: Date.now() });
          }}
        />
      )}
      {puede && (
        <AnularDialog mov={anular} alCerrar={() => setAnular(null)} avisar={mostrar} autor={autor} setAutor={setAutor} pedirAutor={!sesion} />
      )}

      <AnimatePresence>
        {aviso && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            className={cn(
              "fixed bottom-24 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white shadow-pop lg:bottom-8",
              aviso.error ? "bg-red" : "bg-ink",
            )}
          >
            {aviso.error ? <AlertCircle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
            <span className="truncate">{aviso.texto}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
