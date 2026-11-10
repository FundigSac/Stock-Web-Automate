import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  DatabaseBackup,
  FileDown,
  LayoutDashboard,
  Package,
  Plus,
  RefreshCw,
  Users,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BotonAsistente } from "./components/BotonAsistente";
import { CampanaReporte, EspacioReporte, RESORTE, useReporte } from "./components/CampanaReporte";
import { Cuenta } from "./components/Cuenta";
import { LimiteError } from "./components/LimiteError";
import { VentanaProducto, VentanaTrabajador } from "./components/Detalles";
import { AvisoDatos } from "./components/AvisoDatos";
import { DatosEnVivo, EstadoRed } from "./components/EstadoRed";
import { Marca } from "./components/Marca";
import { NecesitaConexion } from "./components/NecesitaConexion";
import { NuevoProductoDialog, NuevoTrabajadorDialog } from "./components/Nuevo";
import { PedidosDialog } from "./components/Pedidos";
import { AnularDialog, RegistrarDialog, type PreRegistro } from "./components/Registrar";
import { Boton, BotonReintentar } from "./components/ui";
import { EsqueletoVista } from "./components/Esqueletos";
import { AuthProvider, useAuth } from "./lib/auth";
import { filtrarPorEmpresa, resumir, type GrupoProducto } from "./lib/derive";
import { textoFalloServidor } from "./lib/avisoDatos";
import { fechaLarga, titulo } from "./lib/format";
import { conProvisional } from "./lib/offline/provisional";
import { usePwa } from "./lib/offline/pwa";
import { useRespaldo } from "./lib/offline/useRespaldo";
import type { Movimiento } from "./lib/types";
import { useQuien } from "./lib/quien";
import { useLiveData } from "./lib/useLiveData";
import { desplazamientoPildora } from "./lib/navegacion";
import { cn } from "./lib/utils";
import { Movimientos } from "./views/Movimientos";
import { Respaldo } from "./views/Respaldo";
import { Resumen } from "./views/Resumen";
import { Stock } from "./views/Stock";
import { Trabajadores } from "./views/Trabajadores";
import type { FiltroEstado, Vista, VistaProps } from "./views/tipos";

// El chat y los informes pesan: se cargan la primera vez que se abren. Quedan guardados igual para usarlos después.
const cargarAsistente = () => import("./components/Asistente").then((m) => ({ default: m.AsistenteDialog }));
const cargarReportes = () => import("./components/Reportes").then((m) => ({ default: m.ReportesDialog }));
const CLAVE_LISTA_OFFLINE = "stock_lista_offline_v1";

/** Solo la primera vez en este dispositivo. */
function primeraVezListaOffline(): boolean {
  try {
    if (localStorage.getItem(CLAVE_LISTA_OFFLINE)) return false;
    localStorage.setItem(CLAVE_LISTA_OFFLINE, "1");
  } catch {
    /* sin almacenamiento: puede repetirse el aviso */
  }
  return true;
}

/** `relleno`: el icono activo se rellena (B5-1); Actividad es una línea abierta y solo se engrosa. */
const NAV: { id: Vista; texto: string; sub: string; icono: LucideIcon; relleno?: boolean }[] = [
  { id: "resumen", texto: "Resumen", sub: "Todo lo importante de un vistazo", icono: LayoutDashboard, relleno: true },
  { id: "stock", texto: "Stock", sub: "Cuánto queda de cada producto y talla", icono: Package, relleno: true },
  { id: "movimientos", texto: "Movimientos", sub: "Lo que entra y lo que sale", icono: Activity },
  { id: "trabajadores", texto: "Trabajadores", sub: "Quién recibió qué", icono: Users, relleno: true },
  { id: "respaldo", texto: "Respaldo", sub: "Lo guardado en este dispositivo", icono: DatabaseBackup, relleno: true },
];

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <Tablero />
      </AuthProvider>
    </MotionConfig>
  );
}

function Tablero() {
  const { editor, sesion, cuentaVencida } = useAuth();
  const [quienEscrito, setAutor] = useQuien();
  // Con sesión firma el correo de la cuenta; sin sesión, el nombre que se escribió en este dispositivo.
  const autor = sesion?.user.email ?? quienEscrito;
  const { datos: delServidor, cargando, error, cambioAt, ultimaCarga, ultimaLectura, tiempoReal, recargar, copiaLista, faltan } = useLiveData(true);
  const respaldo = useRespaldo(recargar, sesion?.user.id ?? null, cuentaVencida?.id ?? null);
  const { enLinea } = respaldo;
  // Lo que se ve incluye lo que todavía no subió. El servidor no sabe de ello: por eso los PDF usan delServidor.
  const { datos: todos, provisionales, sinSubir } = useMemo(() => conProvisional(delServidor, respaldo.items), [delServidor, respaldo.items]);
  const { actualizar: nuevaVersion, offlineListo } = usePwa();
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
  const [reportes, setReportes] = useState(false);
  const [pedidos, setPedidos] = useState(false);
  const [falta, setFalta] = useState<"pdf" | "asistente" | null>(null);
  const [usoChat, setUsoChat] = useState(false);
  const [usoReportes, setUsoReportes] = useState(false);
  // Un import que falló queda recordado por React.lazy: para reintentar hay que crear otro.
  const [intentoChat, setIntentoChat] = useState(0);
  const [intentoReportes, setIntentoReportes] = useState(0);
  const AsistenteDialog = useMemo(() => lazy(cargarAsistente), [intentoChat]);
  const ReportesDialog = useMemo(() => lazy(cargarReportes), [intentoReportes]);
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
  }, []);

  useEffect(() => {
    // Espera su turno: no puede tapar un aviso que importa más.
    if (offlineListo && copiaLista && !aviso && primeraVezListaOffline()) mostrar("Lista para usar sin conexión");
  }, [offlineListo, copiaLista, aviso, mostrar]);

  // Cuando OTRA persona registra algo, aparece un aviso breve (no se repite el de lo que acabas de hacer tu).
  useEffect(() => {
    if (!cambioAt) return;
    if (Date.now() - ultimoAvisoPropio.current < 4000) return;
    setAviso({ texto: "Datos actualizados" });
    window.clearTimeout(temporizadorAviso.current);
    temporizadorAviso.current = window.setTimeout(() => setAviso(null), 2600);
  }, [cambioAt]);

  // El reporte semanal sale de los datos del servidor: lo que todavía no subió no puede ir en él.
  const reporte = useReporte({ todos: delServidor, autor, avisar: mostrar, recargar, errorDatos: error === "servidor", dueno: sesion?.user.id ?? null });
  const minimo = todos.sync?.stock_minimo ?? 2;
  // Registro abierto: cualquiera registra. Si se cierra (ajustes.registro_abierto = false), solo las cuentas autorizadas.
  // Mientras no se sepa, cerrado: no se ofrece registrar a quien quizá no pueda.
  const registroAbierto = todos.sync?.registro_abierto ?? false;
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

  // Si se corta la señal con estas ventanas abiertas, se dice claro en vez de fallar a medias.
  useEffect(() => {
    if (enLinea) return;
    if (asistente) {
      setAsistente(false);
      setFalta("asistente");
    }
    if (reportes) {
      setReportes(false);
      setFalta("pdf");
    }
  }, [enLinea, asistente, reportes]);

  const abrirChat = (pregunta?: string) => {
    if (!enLinea) {
      setFalta("asistente");
      return;
    }
    setPreguntaAsistente(pregunta ?? null);
    setUsoChat(true);
    setAsistente(true);
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
    abrirAsistente: (pregunta) => abrirChat(pregunta),
    abrirPedidos: () => setPedidos(true),
    pedidosPendientes: todos.pedidos.filter((p) => p.estado === "pendiente").length,
    faltanDatos: faltan,
    errorDatos: error === "servidor",
    reintentar: recargar,
  };

  // Desde la ficha de un producto: abre el registro con el producto ya elegido.
  const registrarDe = (tipo: "entrada" | "salida", g: GrupoProducto) => {
    setGrupo(null);
    setPre({ tipo, empresa: g.empresa, producto: g.producto, n: Date.now() });
    setRegistro(true);
  };

  const actual = NAV.find((n) => n.id === vista)!;
  // "Conectado" exige una lectura del servidor en esta sesión: la hora de la copia guardada no prueba que haya red.
  const estadoRed = { r: respaldo, errorDatos: error !== null, tiempoReal, ultimaCarga: ultimaLectura, alAbrir: () => irA("respaldo") };
  // Hay badge en Respaldo solo cuando algo espera o necesita mirarse.
  const avisosRespaldo = respaldo.porSubir + respaldo.porRevisar;
  // Sin el catálogo no hay nada que mostrar: un fallo así ocupa la pantalla entera, nunca como "almacén vacío".
  const sinNada = faltan.includes("stock") || todos.stock.length === 0;
  const cargaFichas = { faltan, errorDatos: error === "servidor", reintentar: recargar };

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
              <span className="flex-1 text-left">{n.texto}</span>
              {n.id === "respaldo" && avisosRespaldo > 0 && <span className="num rounded-full bg-warn px-2 py-0.5 text-[11px] text-white">{avisosRespaldo}</span>}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <DatosEnVivo cargando={cargando} ultimaCarga={ultimaCarga} ultimoMovimiento={ultimoMovimiento ? fechaLarga(ultimoMovimiento) : null} />
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
            {/* Trabajadores y Respaldo no dependen de la empresa: ahí el filtro no haría nada. */}
            {vista !== "trabajadores" && vista !== "respaldo" && (
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
            )}

            <EstadoRed {...estadoRed} />

            {puede && (
              <Boton variante="ink" className="hidden sm:inline-flex" onClick={() => setRegistro(true)}>
                <Plus className="size-4" /> Registrar
              </Boton>
            )}

            {((todos.sync !== null && !registroAbierto) || sesion || cuentaVencida) && <Cuenta avisar={mostrar} puede={puede} porSubir={respaldo.porSubir} />}

            <Boton onClick={() => {
                if (!enLinea) return setFalta("pdf");
                setUsoReportes(true);
                setReportes(true);
              }} disabled={cargando}>
              <FileDown className="size-4" />
              PDF
            </Boton>
          </div>
        </div>
        {/* Entrada "Línea de flujo": index.html marca el html una vez por sesión y el CSS la anima. */}
        <div className="fx-flow-line" aria-hidden="true" />
      </header>

      {/* La isla del reporte semanal sale de la campana; este espacio baja el contenido mientras esta abierta */}
      {!cargando && <EspacioReporte r={reporte} />}

      <main className="mx-auto max-w-[1480px] px-4 pb-28 pt-6 lg:px-8 lg:pb-12">
        {cuentaVencida && !sesion && (
          <div role="alert" className="no-print mb-5 flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-[13px] font-medium text-warn">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p className="flex-1">Tu sesión se cerró{cuentaVencida.email ? ` (${cuentaVencida.email})` : ""}. Entra de nuevo con tu cuenta: lo que tengas guardado aquí sigue a salvo y se sube cuando entres.</p>
          </div>
        )}
        {respaldo.recargaNecesaria && (
          <div role="alert" className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-soft px-4 py-3 text-[13px] font-medium text-red">
            <p className="flex-1">Se abrió una versión nueva de la app en otra pestaña y esta ya no puede guardar en el dispositivo. Recárgala para seguir registrando.</p>
            <Boton className="h-9" onClick={() => window.location.reload()}>
              <RefreshCw className="size-3.5" /> Recargar
            </Boton>
          </div>
        )}
        {respaldo.bloqueado && (
          <div role="alert" className="no-print mb-5 flex items-start gap-3 rounded-2xl bg-red-soft px-4 py-3 text-[13px] font-medium text-red">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p className="flex-1">Hay otra pestaña abierta con una versión anterior de la app. Ciérrala para poder guardar en este dispositivo.</p>
          </div>
        )}
        {nuevaVersion && (
          <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 text-[13px] shadow-card">
            <span>Hay una versión nueva de la app.</span>
            <Boton className="h-9" onClick={nuevaVersion}>
              <RefreshCw className="size-3.5" /> Actualizar
            </Boton>
          </div>
        )}
        {error === "servidor" && !sinNada && (
          <div role="alert" className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-red-soft px-4 py-3 text-[13px] text-red">
            <AlertCircle className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{textoFalloServidor(ultimaCarga, Date.now())}</span>
            <BotonReintentar alReintentar={recargar} />
          </div>
        )}
        {vista !== "respaldo" && !cargando && error !== "sin-copia" && (!enLinea || provisionales > 0) && (
          // Sin señal, una copia de hace semanas se ve igual que una de hace minutos: se dice de cuándo es.
          <AvisoDatos enLinea={enLinea} sinSubir={sinSubir} provisionales={provisionales} guardadoEn={ultimaCarga} />
        )}
        {vista !== "respaldo" && !cargando && faltan.length > 0 && error === null && (
          <div role="alert" className="no-print mb-5 flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-justify text-[13px] font-medium text-warn">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>No todo alcanzó a descargarse antes de perder la señal. Lo que falte aparecerá cuando vuelva la conexión.</span>
          </div>
        )}

        {(error === "sin-copia" || (error === "servidor" && sinNada)) && vista !== "respaldo" ? (
          <div role="alert" data-falla={error === "sin-copia" ? "sin-copia" : "error"} className="mx-auto max-w-md rounded-3xl border border-line-2 bg-surface px-6 py-10 text-center shadow-card">
            {error === "sin-copia" ? <WifiOff className="mx-auto mb-3 size-6 text-warn" /> : <AlertCircle className="mx-auto mb-3 size-6 text-red" />}
            <p className="text-sm font-semibold">{error === "sin-copia" ? "Todavía no hay datos guardados en este dispositivo" : "No se pudieron cargar los datos"}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {error === "sin-copia"
                ? "Ábrela una vez con conexión. Después funciona también sin señal."
                : "El servidor falló: no es que el almacén esté vacío. Se reintentará solo en unos segundos."}
            </p>
            <div className="mt-4 flex justify-center">
              <BotonReintentar alReintentar={recargar} />
            </div>
          </div>
        ) : cargando ? (
          <EsqueletoVista vista={vista} />
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
              {vista === "respaldo" && <Respaldo r={respaldo} autorizado={Boolean(sesion) && editor} />}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* En el celular, la acción principal */}
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
      {puede && !asistente && <BotonAsistente onClick={() => abrirChat()} />}

      {/* Navegacion inferior en celular */}
      <div className="no-print fixed inset-x-2 bottom-3 z-40 lg:hidden">
        {/* B16-4 + B5-1: píldora roja Slab al 12 % detrás del icono activo, etiquetas siempre visibles.
            La píldora es una sola y se desliza solo con transform; con movimiento reducido salta sin animar. */}
        <nav className="relative grid grid-cols-5 rounded-2xl border border-line bg-surface/95 p-1 shadow-pop backdrop-blur" aria-label="Secciones">
          <span
            aria-hidden
            data-pildora
            className="pointer-events-none absolute left-1 top-2 flex h-8 justify-center transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
            style={{ width: "calc((100% - 0.5rem) / 5)", transform: desplazamientoPildora(NAV.map((n) => n.id), vista) }}
          >
            <span className="h-8 w-14 rounded-full bg-red/12" />
          </span>
          {NAV.map((n) => {
            const activo = vista === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => irA(n.id)}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 min-w-0 flex-col items-center gap-1 rounded-xl pb-1.5 pt-1 font-semibold leading-none transition-colors",
                  "text-[11px] min-[380px]:text-[12px] focus-visible:outline-2 focus-visible:outline-ink",
                  activo ? "text-ink" : "text-muted",
                )}
              >
                <span className="grid h-8 w-14 place-items-center">
                  <n.icono className="size-5" strokeWidth={activo ? 2.25 : 2} fill={activo && n.relleno ? "currentColor" : "none"} fillOpacity={activo && n.relleno ? 0.18 : 0} data-relleno={activo && n.relleno ? "" : undefined} />
                </span>
                <span className="max-w-full whitespace-nowrap tracking-[-0.01em]">{n.texto}</span>
                {n.id === "respaldo" && avisosRespaldo > 0 && <span className="num absolute right-1 top-0.5 rounded-full bg-warn px-1.5 text-[10px] leading-4 text-white">{avisosRespaldo}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {puede && usoChat && (
        <LimiteError
          key={`chat-${intentoChat}`}
          alFallar={() => {
            setAsistente(false);
            setUsoChat(false);
            setIntentoChat((n) => n + 1);
            setFalta("asistente");
          }}
        >
        <Suspense fallback={null}>
        <AsistenteDialog
          abierto={asistente}
          alCerrar={() => setAsistente(false)}
          datos={todos}
          minimo={minimo}
          autor={autor}
          setAutor={setAutor}
          pedirAutor={!sesion}
          avisar={mostrar}
          crearProducto={(i) => setNuevoProd({ nombre: i.nombre })}
          crearTrabajador={(n) => setNuevoTrab(n)}
          iniciar={preguntaAsistente}
          consumirIniciar={() => setPreguntaAsistente(null)}
        />
        </Suspense>
        </LimiteError>
      )}
      {usoReportes && (
        <LimiteError
          key={`reportes-${intentoReportes}`}
          alFallar={() => {
            setReportes(false);
            setUsoReportes(false);
            setIntentoReportes((n) => n + 1);
            setFalta("pdf");
          }}
        >
        <Suspense fallback={null}>
          <ReportesDialog
            errorDatos={error === "servidor"}
            abierto={reportes}
            alCerrar={() => setReportes(false)}
            todos={delServidor}
            empresas={empresas}
            empresaInicial={empresa}
            usuario={autor}
            dueno={sesion?.user.id ?? null}
            avisar={mostrar}
          />
        </Suspense>
        </LimiteError>
      )}
      <VentanaProducto grupo={grupo} datos={todos} minimo={minimo} alCerrar={() => setGrupo(null)} editor={puede} alRegistrar={registrarDe} carga={cargaFichas} />
      <VentanaTrabajador nombre={trabajador} datos={todos} alCerrar={() => setTrabajador(null)} carga={cargaFichas} />
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
          abrirAsistente={() => {
            setRegistro(false);
            abrirChat();
          }}
        />
      )}
      {puede && (
        <PedidosDialog abierto={pedidos} alCerrar={() => setPedidos(false)} pedidos={todos.pedidos} stock={todos.stock} autor={autor} setAutor={setAutor} pedirAutor={!sesion} avisar={mostrar} recargar={recargar} falla={faltan.includes("pedidos") ? (error === "servidor" ? "error" : "incompleto") : null} />
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
        <AnularDialog mov={anular} alCerrar={() => setAnular(null)} avisar={mostrar} autor={autor} setAutor={setAutor} pedirAutor={!sesion} stock={todos.stock} pedidos={todos.pedidos} />
      )}

      <NecesitaConexion
        abierto={falta !== null}
        alCerrar={() => setFalta(null)}
        que={falta === "pdf" ? "El PDF" : "El asistente"}
        detalle={
          falta === "pdf"
            ? "Para armar el informe hacen falta las fotos del servidor. Puedes seguir registrando y sacar el PDF cuando vuelva la señal."
            : "El asistente responde desde el servidor. Sin señal usa el botón Registrar: tus movimientos y fotos quedan guardados y se suben después."
        }
      />

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
