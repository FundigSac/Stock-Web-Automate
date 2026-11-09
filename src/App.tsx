import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardPlus,
  LayoutDashboard,
  Menu,
  Package,
  RefreshCw,
  UploadCloud,
  Users,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BandaEstado } from "./components/BandaEstado";
import { BotonAsistente } from "./components/BotonAsistente";
import { crearDiferido } from "./components/Diferido";
import { Marca } from "./components/Marca";
import { NecesitaConexion } from "./components/NecesitaConexion";
import type { PreRegistro } from "./components/Registrar";
import { SelectorEmpresa } from "./components/SelectorEmpresa";
import { AuthProvider, useAuth } from "./lib/auth";
import type { GrupoProducto } from "./lib/derive";
import { filtrarPorEmpresa } from "./lib/filtroEmpresa";
import { edadCopia, fechaLarga, hoyISO } from "./lib/format";
import { estadoReporte } from "./lib/reporteSemanal";
import { conProvisional } from "./lib/offline/provisional";
import { usePwa } from "./lib/offline/pwa";
import { useRespaldo } from "./lib/offline/useRespaldo";
import type { Movimiento } from "./lib/types";
import { useQuien } from "./lib/quien";
import { useLiveData } from "./lib/useLiveData";
import { PantallaRegistrar } from "./views/PantallaRegistrar";
import type { FiltroEstado, Vista, VistaProps } from "./views/tipos";

// Solo la pantalla inicial viaja con la app. Lo demás se trae al abrirlo y queda guardado para usarlo sin red.
const VResumen = crearDiferido(() => import("./views/Resumen").then((m) => ({ default: m.Resumen })));
const VStock = crearDiferido(() => import("./views/Stock").then((m) => ({ default: m.Stock })));
const VMovimientos = crearDiferido(() => import("./views/Movimientos").then((m) => ({ default: m.Movimientos })));
const VTrabajadores = crearDiferido(() => import("./views/Trabajadores").then((m) => ({ default: m.Trabajadores })));
const VRespaldo = crearDiferido(() => import("./views/Respaldo").then((m) => ({ default: m.Respaldo })));
const VMas = crearDiferido(() => import("./views/Mas").then((m) => ({ default: m.Mas })));

const DRegistrar = crearDiferido(() => import("./components/Registrar").then((m) => ({ default: m.RegistrarDialog })));
const DAnular = crearDiferido(() => import("./components/Registrar").then((m) => ({ default: m.AnularDialog })));
const DProducto = crearDiferido(() => import("./components/Detalles").then((m) => ({ default: m.VentanaProducto })));
const DTrabajador = crearDiferido(() => import("./components/Detalles").then((m) => ({ default: m.VentanaTrabajador })));
const DNuevoProducto = crearDiferido(() => import("./components/Nuevo").then((m) => ({ default: m.NuevoProductoDialog })));
const DNuevoTrabajador = crearDiferido(() => import("./components/Nuevo").then((m) => ({ default: m.NuevoTrabajadorDialog })));
const DPedidos = crearDiferido(() => import("./components/Pedidos").then((m) => ({ default: m.PedidosDialog })));
const DAsistente = crearDiferido(() => import("./components/Asistente").then((m) => ({ default: m.AsistenteDialog })));
const DReportes = crearDiferido(() => import("./components/Reportes").then((m) => ({ default: m.ReportesDialog })));
const DEntrar = crearDiferido(() => import("./components/Cuenta").then((m) => ({ default: m.EntrarDialog })));
const DPorSubir = crearDiferido(() => import("./views/PorSubirEncima").then((m) => ({ default: m.PorSubirEncima })));

const PRECARGA: Partial<Record<Vista, () => void>> = {
  resumen: VResumen.precargar,
  stock: VStock.precargar,
  movimientos: VMovimientos.precargar,
  trabajadores: VTrabajadores.precargar,
  respaldo: VRespaldo.precargar,
  mas: VMas.precargar,
};

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

/** Trae código en cuanto el navegador esté libre. */
function cuandoEsteLibre(fn: () => void): () => void {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(fn, { timeout: 5_000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(fn, 2_500);
  return () => globalThis.clearTimeout(id);
}

const SECCIONES: Record<Vista, { texto: string; sub: string; icono: LucideIcon }> = {
  registrar: { texto: "Registrar", sub: "", icono: ClipboardPlus },
  resumen: { texto: "Resumen", sub: "Qué falta reponer y cómo se movió el almacén", icono: LayoutDashboard },
  stock: { texto: "Stock", sub: "Cuánto queda de cada producto y talla", icono: Package },
  respaldo: { texto: "Por subir", sub: "Lo guardado en este celular", icono: UploadCloud },
  movimientos: { texto: "Movimientos", sub: "Lo que entra y lo que sale", icono: Activity },
  trabajadores: { texto: "Trabajadores", sub: "Quién recibió qué", icono: Users },
  mas: { texto: "Más", sub: "Informes, reporte semanal y ajustes", icono: Menu },
};

const NAV_LATERAL: Vista[] = ["registrar", "resumen", "stock", "respaldo", "movimientos", "trabajadores", "mas"];
const NAV_MOVIL: Vista[] = ["registrar", "stock", "respaldo", "mas"];
/** En el celular estas pantallas se abren desde Más. */
const DENTRO_DE_MAS: Vista[] = ["movimientos", "trabajadores"];
const CON_CIFRAS: Vista[] = ["resumen", "stock", "movimientos", "trabajadores"];
const POR_EMPRESA: Vista[] = ["resumen", "stock", "movimientos"];

const BOTON_AVISO = "inline-flex min-h-14 items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 text-[16px] font-semibold text-ink";

function EsperaVista() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="skeleton h-40" />
      <div className="skeleton h-64" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Tablero />
    </AuthProvider>
  );
}

function Tablero() {
  const { editor, sesion, cuentaVencida } = useAuth();
  const [quienEscrito, setAutor] = useQuien();
  // Con sesión firma el correo de la cuenta; sin sesión, el nombre que se escribió en este dispositivo.
  const autor = sesion?.user.email ?? quienEscrito;
  const { datos: delServidor, cargando, error, cambioAt, ultimaCarga, recargar, copiaLista, faltan } = useLiveData(true);
  const respaldo = useRespaldo(recargar, sesion?.user.id ?? null, cuentaVencida?.id ?? null);
  const { enLinea } = respaldo;
  // Lo que se ve incluye lo que todavía no subió. El servidor no sabe de ello: por eso los PDF usan delServidor.
  const { datos: todos, provisionales, sinSubir } = useMemo(() => conProvisional(delServidor, respaldo.items), [delServidor, respaldo.items]);
  const { actualizar: nuevaVersion, offlineListo } = usePwa();
  const [vista, setVista] = useState<Vista>("registrar");
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
  const [falta, setFalta] = useState<"pdf" | "asistente" | "parte" | null>(null);
  const [entrando, setEntrando] = useState(false);
  // Por subir abierto desde la banda con un registro a medias: va encima y Atrás vuelve al registro.
  const [porSubirEncima, setPorSubirEncima] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; error?: boolean } | null>(null);
  const ultimoAvisoPropio = useRef(0);
  const temporizadorAviso = useRef<number | undefined>(undefined);
  // La primera pantalla no se anima: tiene que pintarse de inmediato.
  const primeraVista = useRef(true);
  useEffect(() => {
    primeraVista.current = false;
  }, []);

  const mostrar = useCallback((texto: string, esError = false) => {
    ultimoAvisoPropio.current = Date.now();
    setAviso({ texto, error: esError });
    window.clearTimeout(temporizadorAviso.current);
    temporizadorAviso.current = window.setTimeout(() => setAviso(null), esError ? 4000 : 3200);
  }, []);

  useEffect(() => {
    document.title = "Stock EPP";
    // Solo si el service worker ya guardó la app: entonces sale del propio celular y no gasta datos en la primera visita.
    if (navigator.serviceWorker?.controller) return cuandoEsteLibre(DRegistrar.precargar);
  }, []);

  // Con un registro, una ficha o una ventana abierta, los avisos informativos esperan: abajo están sus botones.
  const hayCapa = registro || grupo !== null || trabajador !== null || nuevoProd !== null || nuevoTrab !== null || anular !== null || reportes || pedidos || asistente || entrando || falta !== null;
  const hayCapaRef = useRef(hayCapa);
  hayCapaRef.current = hayCapa;

  useEffect(() => {
    // Espera su turno: no puede tapar un aviso que importa más.
    if (offlineListo && copiaLista && !aviso && !hayCapa && primeraVezListaOffline()) mostrar("Lista para usar sin conexión");
  }, [offlineListo, copiaLista, aviso, hayCapa, mostrar]);

  useEffect(() => {
    if (!registro) setPorSubirEncima(false);
  }, [registro]);

  // Cuando OTRA persona registra algo, aparece un aviso breve (no se repite el de lo que acabas de hacer tu).
  useEffect(() => {
    if (!cambioAt || hayCapaRef.current) return;
    if (Date.now() - ultimoAvisoPropio.current < 4000) return;
    setAviso({ texto: "Datos actualizados" });
    window.clearTimeout(temporizadorAviso.current);
    temporizadorAviso.current = window.setTimeout(() => setAviso(null), 2600);
  }, [cambioAt]);

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
  // Sin campana, el reporte que ya está en rojo (viernes, sábado o atrasado) marca el botón Más.
  const sync = todos.sync;
  const reporteUrgente = useMemo(() => {
    if (!sync?.reporte_inicio) return false;
    const e = estadoReporte(sync.reporte_inicio, sync.reporte_ultimo, hoyISO(), sync.reporte_sabado ?? null);
    return e.semaforo === "rojo" && (e.fase === "pendiente" || e.fase === "hoy" || e.fase === "atrasado");
  }, [sync]);
  // El mismo dato que resumir().ultima, sin traer derive.ts a la carga inicial.
  const ultimoMovimiento = useMemo(() => todos.stock.reduce<string | null>((u, s) => (s.ultimo_movimiento && (!u || s.ultimo_movimiento > u) ? s.ultimo_movimiento : u), null), [todos.stock]);

  // Si la empresa elegida desaparece del catalogo, vuelve a "todas".
  useEffect(() => {
    if (empresa !== "TODAS" && empresas.length > 0 && !empresas.includes(empresa)) setEmpresa("TODAS");
  }, [empresa, empresas]);

  const irA = (v: Vista, estado?: FiltroEstado) => {
    setVista(v);
    if (estado) setFiltroEstado(estado);
    window.scrollTo({ top: 0 });
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
    setAsistente(true);
  };

  const abrirPdf = () => {
    if (!enLinea) return setFalta("pdf");
    setReportes(true);
  };

  /** Punto de entrada al registro. Con tipo, el formulario abre ya en entrada o salida. */
  const abrirRegistro = (tipo?: "entrada" | "salida") => {
    if (tipo) setPre({ tipo, n: Date.now() });
    setRegistro(true);
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
    abrirRegistro: () => abrirRegistro(),
    abrirNuevoProducto: () => setNuevoProd({ empresa }),
    abrirNuevoTrabajador: () => setNuevoTrab(""),
    abrirAsistente: (pregunta) => abrirChat(pregunta),
    abrirPedidos: () => setPedidos(true),
    pedidosPendientes: todos.pedidos.filter((p) => p.estado === "pendiente").length,
    faltanDatos: faltan,
  };

  // Desde la ficha de un producto: abre el registro con el producto ya elegido.
  const registrarDe = (tipo: "entrada" | "salida", g: GrupoProducto) => {
    setGrupo(null);
    setPre({ tipo, empresa: g.empresa, producto: g.producto, n: Date.now() });
    setRegistro(true);
  };

  const actual = SECCIONES[vista];
  const registros = (n: number) => `${n} ${n === 1 ? "registro" : "registros"}`;
  // Sin señal, una copia de hace semanas se ve igual que una de hace minutos: la edad se dice.
  const edad = !enLinea ? edadCopia(ultimaCarga, Date.now()) : null;
  // El distintivo sale solo cuando algo espera o necesita mirarse.
  const avisosRespaldo = respaldo.porSubir + respaldo.porRevisar;
  const sinDatos = error === "sin-copia" || (error === "servidor" && todos.stock.length === 0);
  const conCifras = CON_CIFRAS.includes(vista);
  const activaMovil = DENTRO_DE_MAS.includes(vista) ? "mas" : vista;
  const mostrarCuenta = (todos.sync !== null && !registroAbierto) || Boolean(sesion) || Boolean(cuentaVencida);
  const alFallarParte = (cerrar: () => void) => () => {
    cerrar();
    setFalta("parte");
  };
  // El estado va escrito para el lector de pantalla; a la vista, icono de calendario sobre rojo.
  const marcaReporte = (
    <span role="img" aria-label="Reporte semanal pendiente" title="Reporte semanal pendiente" className="grid size-6 place-items-center rounded-full bg-red text-white">
      <CalendarClock className="size-4" aria-hidden />
    </span>
  );
  // Un registro abierto nunca lleva otra pantalla visible encima de otra: la de arriba oculta a la de abajo.
  const nuevoEnRegistro = registro && (nuevoProd !== null || nuevoTrab !== null);

  const avisoSinDatos = (
    <div className="mx-auto max-w-md rounded-2xl border border-line-2 bg-surface px-6 py-8 text-center">
      <WifiOff className="mx-auto mb-3 size-6 text-warn" aria-hidden />
      <p className="text-[18px] font-semibold">{error === "sin-copia" ? "Todavía no hay datos guardados en este dispositivo" : "No se pudieron cargar los datos"}</p>
      <p className="mt-1 text-[16px] text-muted">{error === "sin-copia" ? "Ábrela una vez con conexión. Después funciona también sin señal." : "Se reintentará solo en unos segundos."}</p>
    </div>
  );

  const contenido = () => {
    if (vista === "registrar") {
      return (
        <PantallaRegistrar
          r={respaldo}
          puede={puede}
          cerrado={todos.sync !== null && !puede}
          conSesion={Boolean(sesion)}
          alElegir={abrirRegistro}
          alPrepararse={DRegistrar.precargar}
          abrirAsistente={() => abrirChat()}
          alEntrar={() => setEntrando(true)}
        >
          {sinDatos ? avisoSinDatos : null}
        </PantallaRegistrar>
      );
    }
    if (vista === "respaldo") return <VRespaldo r={respaldo} autorizado={Boolean(sesion) && editor} espera={<EsperaVista />} />;
    if (vista === "mas") {
      return (
        <VMas
          espera={<EsperaVista />}
          irA={irA}
          abrirPdf={abrirPdf}
          cargando={cargando}
          delServidor={delServidor}
          autor={autor}
          avisar={mostrar}
          recargar={recargar}
          errorDatos={error === "servidor"}
          dueno={sesion?.user.id ?? null}
          mostrarCuenta={mostrarCuenta}
          puede={puede}
          porSubir={respaldo.porSubir}
          empresa={empresa}
          empresas={empresas}
          cambiarEmpresa={setEmpresa}
        />
      );
    }
    if (sinDatos) return avisoSinDatos;
    if (cargando) return <EsperaVista />;
    if (vista === "resumen") return <VResumen {...propsVista} espera={<EsperaVista />} />;
    if (vista === "stock") return <VStock {...propsVista} espera={<EsperaVista />} />;
    if (vista === "movimientos") return <VMovimientos {...propsVista} espera={<EsperaVista />} />;
    return <VTrabajadores {...propsVista} espera={<EsperaVista />} />;
  };

  return (
    <div className="min-h-screen pt-14 lg:pl-64">
      {/* En medio de un registro la vista de fondo no cambia: Por subir se abre encima. */}
      <BandaEstado r={respaldo} ultimaCarga={ultimaCarga} alAbrir={() => (registro && puede ? setPorSubirEncima(true) : irA("respaldo"))} />

      {/* Barra lateral en escritorio */}
      <aside className="no-print fixed bottom-0 left-0 top-14 z-40 hidden w-64 flex-col border-r border-line-2 bg-surface px-4 py-5 lg:flex">
        <div className="flex items-center gap-3 px-2">
          <div className="grid size-9 place-items-center rounded-xl bg-action">
            <Marca tam={22} />
          </div>
          <p className="text-[16px] font-semibold leading-tight">Stock EPP</p>
        </div>

        <nav className="mt-6 space-y-1" aria-label="Secciones">
          {NAV_LATERAL.map((id) => {
            const n = SECCIONES[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => irA(id)}
                onPointerEnter={PRECARGA[id]}
                aria-current={vista === id ? "page" : undefined}
                className={clsx("flex h-14 w-full items-center gap-3 rounded-md px-3 text-[16px] font-semibold", vista === id ? "bg-action text-white" : "text-muted hover:bg-ground hover:text-ink")}
              >
                <n.icono className="size-5" aria-hidden />
                <span className="flex-1 text-left">{n.texto}</span>
                {id === "respaldo" && avisosRespaldo > 0 && <span className="num rounded-full bg-warn px-2 py-0.5 text-[14px] text-white">{avisosRespaldo}</span>}
                {id === "mas" && reporteUrgente && marcaReporte}
              </button>
            );
          })}
        </nav>

        {ultimoMovimiento && <p className="mt-auto px-1 text-[14px] text-muted">Último movimiento: {fechaLarga(ultimoMovimiento)}</p>}
      </aside>

      {/* En escritorio el botón del asistente ocupa 88 px abajo a la derecha: el final de cada pantalla queda por encima. */}
      <main className="mx-auto max-w-[1480px] px-4 pb-[calc(72px+env(safe-area-inset-bottom)+24px)] pt-6 lg:px-8 lg:pb-28">
        {cuentaVencida && !sesion && (
          <div role="alert" className="no-print mb-5 flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-[16px] font-medium text-warn">
            <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p className="flex-1">Tu sesión se cerró{cuentaVencida.email ? ` (${cuentaVencida.email})` : ""}. Entra de nuevo con tu cuenta: lo que tengas guardado aquí sigue a salvo y se sube cuando entres.</p>
          </div>
        )}
        {respaldo.recargaNecesaria && (
          <div role="alert" className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-soft px-4 py-3 text-[16px] font-medium text-red">
            <p className="flex-1">Se abrió una versión nueva de la app en otra pestaña y esta ya no puede guardar en el dispositivo. Recárgala para seguir registrando.</p>
            <button type="button" onClick={() => window.location.reload()} className={BOTON_AVISO}>
              <RefreshCw className="size-4" aria-hidden /> Recargar
            </button>
          </div>
        )}
        {respaldo.bloqueado && (
          <div role="alert" className="no-print mb-5 flex items-start gap-3 rounded-2xl bg-red-soft px-4 py-3 text-[16px] font-medium text-red">
            <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p className="flex-1">Hay otra pestaña abierta con una versión anterior de la app. Ciérrala para poder guardar en este dispositivo.</p>
          </div>
        )}
        {nuevaVersion && (
          <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-[16px]">
            <span>Hay una versión nueva de la app.</span>
            <button type="button" onClick={nuevaVersion} className={BOTON_AVISO}>
              <RefreshCw className="size-4" aria-hidden /> Actualizar
            </button>
          </div>
        )}
        {error === "servidor" && todos.stock.length > 0 && (
          <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl bg-red-soft px-4 py-3 text-[16px] text-red">
            <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>El servidor no entregó los datos. Se reintentará solo.</span>
          </div>
        )}
        {conCifras && !cargando && error !== "sin-copia" && (!enLinea || provisionales > 0) && (
          <div className="no-print mb-5 flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-justify text-[16px] font-medium text-warn" data-testid="aviso-provisional">
            <WifiOff className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              {sinSubir > 0
                ? `Cifras provisionales: falta subir ${registros(sinSubir)}.${edad ? ` Los datos son ${edad}.` : ""}`
                : provisionales > 0
                  ? `Cifras provisionales: ${registros(provisionales)} ya en el servidor, pero todavía no en los datos de este dispositivo.${edad ? ` Los datos son ${edad}.` : ""}`
                  : edad
                    ? `Sin conexión: ves los datos ${edad}.`
                    : "Sin conexión: ves los datos de la última vez que hubo señal."}
            </span>
          </div>
        )}
        {conCifras && !cargando && faltan.length > 0 && error !== "sin-copia" && (
          <div role="alert" className="no-print mb-5 flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-justify text-[16px] font-medium text-warn">
            <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>No todo alcanzó a descargarse antes de perder la señal. Lo que falte aparecerá cuando vuelva la conexión.</span>
          </div>
        )}

        {vista !== "registrar" && (
          <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
            {DENTRO_DE_MAS.includes(vista) && (
              <button type="button" onClick={() => irA("mas")} aria-label="Volver a Más" className="grid size-14 shrink-0 place-items-center rounded-xl border border-line bg-surface lg:hidden">
                <ArrowLeft className="size-6" aria-hidden />
              </button>
            )}
            <div className="mr-auto min-w-0">
              <h1 className="text-[24px] font-semibold leading-8">{actual.texto}</h1>
              <p className="truncate text-left text-[16px] text-muted">{actual.sub}</p>
            </div>
            {/* En todos los anchos: si la lista está filtrada por empresa, se tiene que ver arriba. */}
            {POR_EMPRESA.includes(vista) && <SelectorEmpresa empresa={empresa} empresas={empresas} alCambiar={setEmpresa} className="no-print w-full sm:w-auto sm:min-w-64" />}
          </header>
        )}

        <div key={vista} className={primeraVista.current ? undefined : "paso-entra"}>
          {contenido()}
        </div>
      </main>

      {/* Navegación en el celular */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 flex h-[calc(72px+env(safe-area-inset-bottom))] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Secciones">
        {NAV_MOVIL.map((id) => {
          const n = SECCIONES[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => irA(id)}
              onPointerDown={PRECARGA[id]}
              aria-current={activaMovil === id ? "page" : undefined}
              className={clsx("relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[14px] font-semibold leading-5", activaMovil === id ? "bg-ground text-action" : "text-muted")}
            >
              <n.icono className="size-7" aria-hidden />
              <span className="max-w-full truncate px-0.5">{n.texto}</span>
              {id === "respaldo" && avisosRespaldo > 0 && <span className="num absolute left-1/2 top-1 ml-2 min-w-6 rounded-full bg-red px-1.5 text-center text-[14px] leading-5 text-white">{avisosRespaldo}</span>}
              {id === "mas" && reporteUrgente && <span className="absolute left-1/2 top-1 ml-2">{marcaReporte}</span>}
            </button>
          );
        })}
      </nav>

      {puede && !asistente && <BotonAsistente onClick={() => abrirChat()} />}

      {puede && (
        <DAsistente
          activo={asistente}
          alFallar={() => {
            setAsistente(false);
            setFalta("asistente");
          }}
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
      )}
      <DReportes
        activo={reportes}
        alFallar={() => {
          setReportes(false);
          setFalta("pdf");
        }}
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
      <DProducto activo={grupo !== null} alFallar={alFallarParte(() => setGrupo(null))} grupo={grupo} datos={todos} minimo={minimo} alCerrar={() => setGrupo(null)} editor={puede} alRegistrar={registrarDe} />
      <DTrabajador activo={trabajador !== null} alFallar={alFallarParte(() => setTrabajador(null))} nombre={trabajador} datos={todos} alCerrar={() => setTrabajador(null)} />
      {puede && (
        <DRegistrar
          activo={registro}
          alFallar={alFallarParte(() => setRegistro(false))}
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
          enPausa={nuevoEnRegistro || porSubirEncima}
        />
      )}
      {puede && <DPedidos activo={pedidos} alFallar={alFallarParte(() => setPedidos(false))} abierto={pedidos} alCerrar={() => setPedidos(false)} pedidos={todos.pedidos} stock={todos.stock} autor={autor} setAutor={setAutor} pedirAutor={!sesion} avisar={mostrar} recargar={recargar} />}
      {puede && (
        <DNuevoProducto
          activo={nuevoProd !== null}
          alFallar={alFallarParte(() => setNuevoProd(null))}
          abierto={nuevoProd !== null}
          alCerrar={() => setNuevoProd(null)}
          stock={todos.stock}
          inicial={nuevoProd}
          avisar={mostrar}
          autor={autor}
          setAutor={setAutor}
          pedirAutor={!sesion}
          enFlujo={registro}
          enPausa={porSubirEncima}
          alCrear={(r) => {
            // Si se creo desde el registro, queda elegido para seguir.
            if (registro) setPre({ empresa: r.empresa, producto: r.producto, n: Date.now() });
          }}
        />
      )}
      {puede && (
        <DNuevoTrabajador
          activo={nuevoTrab !== null}
          alFallar={alFallarParte(() => setNuevoTrab(null))}
          abierto={nuevoTrab !== null}
          alCerrar={() => setNuevoTrab(null)}
          trabajadores={todos.trabajadores}
          inicial={nuevoTrab ?? ""}
          avisar={mostrar}
          autor={autor}
          setAutor={setAutor}
          pedirAutor={!sesion}
          enFlujo={registro}
          enPausa={porSubirEncima}
          alCrear={(nombre) => {
            if (registro) setPre({ tipo: "salida", trabajador: nombre, n: Date.now() });
          }}
        />
      )}
      {puede && (
        <DPorSubir
          activo={porSubirEncima}
          alFallar={alFallarParte(() => setPorSubirEncima(false))}
          abierta={porSubirEncima}
          alAtras={() => setPorSubirEncima(false)}
          r={respaldo}
          autorizado={Boolean(sesion) && editor}
        />
      )}
      <DEntrar activo={entrando} alFallar={alFallarParte(() => setEntrando(false))} abierto={entrando} alCerrar={() => setEntrando(false)} />
      {puede && <DAnular activo={anular !== null} alFallar={alFallarParte(() => setAnular(null))} mov={anular} alCerrar={() => setAnular(null)} avisar={mostrar} autor={autor} setAutor={setAutor} pedirAutor={!sesion} stock={todos.stock} pedidos={todos.pedidos} />}

      <NecesitaConexion
        abierto={falta !== null}
        alCerrar={() => setFalta(null)}
        que={falta === "pdf" ? "El PDF" : falta === "asistente" ? "El asistente" : "Esta parte de la app"}
        detalle={
          falta === "pdf"
            ? "Para armar el informe hacen falta las fotos del servidor. Puedes seguir registrando y sacar el PDF cuando vuelva la señal."
            : falta === "asistente"
              ? "El asistente responde desde el servidor. Sin señal usa el botón Registrar: tus movimientos y fotos quedan guardados y se suben después."
              : "Se descarga la primera vez que se abre con señal. Lo que ya guardaste sigue en este celular."
        }
      />

      {/* Un aviso no es un botón: tono suave, borde, ancho de su texto y alineado a la izquierda. */}
      {aviso && (
        <div
          key={aviso.texto}
          role="status"
          className={clsx(
            "paso-entra pointer-events-none fixed inset-x-4 bottom-[calc(72px+env(safe-area-inset-bottom)+12px)] z-[60] mx-auto flex w-fit max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-[16px] font-semibold leading-6 lg:bottom-8 lg:left-64 lg:right-0 lg:max-w-[calc(100vw-20rem)]",
            aviso.error ? "border-red/40 bg-red-soft text-red" : "border-ok/40 bg-ok-soft text-ok",
          )}
        >
          {aviso.error ? <AlertCircle className="size-5 shrink-0" aria-hidden /> : <CheckCircle2 className="size-5 shrink-0" aria-hidden />}
          <span className="text-left">{aviso.texto}</span>
        </div>
      )}
    </div>
  );
}
