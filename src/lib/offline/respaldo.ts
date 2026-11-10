import { mesLima } from "../tiempo";
import { nuevoUuid } from "../uuid";
import { abrirAlmacen, borrarMeta, claveBorrador, fotoComoBlob, fotoParaGuardar, guardarMeta, leerMeta, type EstadoItem, type FotoEnAlmacen, type ItemRespaldo, type LineaRespaldo, type OrigenHora, type RegistroRespaldo } from "./almacen";
import { desfaseConocido } from "./reloj";
import { fotoAntigua } from "../tiempo";

export const DIAS_COPIA = 7;
const COPIA_MS = DIAS_COPIA * 24 * 3_600_000;
/** Margen que se exige libre además del tamaño de la foto, para no llenar el dispositivo. */
const MARGEN_BYTES = 5 * 1024 * 1024;
/** Cuántas copias ya subidas se sacrifican de una vez cuando falta espacio. */
const COPIAS_POR_LIBERAR = 5;

const PREFIJO_RECIBO = "recibo:";
const CLAVE_HUERFANAS = "fotos_huerfanas";

export class SinEspacioError extends Error {
  constructor() {
    super("El dispositivo no tiene espacio para guardar este registro.");
    this.name = "SinEspacioError";
  }
}

export type NuevoRegistro = {
  tipo: "entrada" | "salida";
  capturadoEn: string;
  guardadoEn: string;
  fecha: string;
  quien: string;
  trabajador: string | null;
  area: string | null;
  nota: string | null;
  lineas: Omit<LineaRespaldo, "clientId" | "idServidor" | "queda">[];
  foto: { id: string; blob: Blob; origen: "camara" | "galeria"; origenHora?: OrigenHora; dudosa?: boolean } | null;
  dueno?: string | null;
  /** El formulario que se está guardando: su borrador se borra junto con esta escritura. */
  borrador?: { id: string };
};

/** La ruta sale del UUID de la foto y del mes en que se tomó: subir dos veces apunta al mismo archivo. */
export function rutaFoto(tipo: "entrada" | "salida", fotoId: string, capturadoEn: string): string {
  return `${tipo === "entrada" ? "entradas" : "salidas"}/${mesLima(capturadoEn)}/${fotoId}.jpg`;
}

export const esQuota = (e: unknown) => {
  const n = (e as { name?: string } | null)?.name ?? "";
  return n === "QuotaExceededError" || n === "NS_ERROR_DOM_QUOTA_REACHED";
};

// Avisos entre la ventana y el service worker: cualquiera que cambie el respaldo les dice a los demás que relean.
type Aviso = () => void;
const oyentes = new Set<Aviso>();
let canal: BroadcastChannel | null = null;

function canalAvisos(): BroadcastChannel | null {
  if (canal || typeof BroadcastChannel === "undefined") return canal;
  canal = new BroadcastChannel("stock-respaldo");
  (canal as unknown as { unref?: () => void }).unref?.();
  canal.onmessage = () => oyentes.forEach((o) => o());
  return canal;
}

export function suscribirRespaldo(fn: Aviso): () => void {
  canalAvisos();
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
}

function avisar() {
  oyentes.forEach((o) => o());
  canalAvisos()?.postMessage("cambio");
}

function aItem(r: RegistroRespaldo, foto: Blob | null): ItemRespaldo {
  return { ...r, foto: foto ?? r.foto ?? null, dueno: r.dueno ?? null, origenHora: r.origenHora ?? null, horaDudosa: r.horaDudosa ?? false, desfaseAlGuardar: r.desfaseAlGuardar ?? null };
}

type DeFormulario = { clave: string; id: string | null; fotoId: string | null };
type BorradorGuardado = { id?: string; foto?: { id: string } | null };

const esSuBorrador = (b: BorradorGuardado | undefined, f: DeFormulario) => Boolean(b && ((f.id && b.id === f.id) || (f.fotoId && b.foto?.id === f.fotoId)));

/**
 * Escribe el registro y su foto en una sola transacción: o queda todo, o no queda nada.
 * El borrador del formulario sale en la misma transacción. Si la página se cierra después, nunca coexisten el registro y su borrador.
 */
async function escribirNuevo(registro: RegistroRespaldo, foto: FotoEnAlmacen | null, form: DeFormulario | null): Promise<void> {
  const db = await abrirAlmacen();
  // strict: lo que la app dice que quedó guardado sobrevive a un corte de luz.
  const tx = db.transaction(["respaldo", "fotos", "meta"], "readwrite", { durability: "strict" });
  const meta = tx.objectStore("meta");
  const pasos: Promise<unknown>[] = [tx.objectStore("respaldo").put(registro), tx.done];
  if (foto) pasos.push(tx.objectStore("fotos").put({ id: registro.id, blob: foto }));
  if (form) {
    pasos.push(
      meta.get(form.clave).then((b) => {
        if (esSuBorrador(b as BorradorGuardado | undefined, form)) return meta.delete(form.clave);
      }),
    );
  }
  // Una foto reutilizada deja de ser huérfana: la limpieza no debe borrarla del almacén.
  if (registro.fotoRuta) {
    const ruta = registro.fotoRuta;
    pasos.push(
      meta.get(CLAVE_HUERFANAS).then((h) => {
        const lista = (h as string[] | undefined) ?? [];
        if (lista.includes(ruta)) return meta.put(lista.filter((r) => r !== ruta), CLAVE_HUERFANAS);
      }),
    );
  }
  try {
    await Promise.all(pasos);
  } catch (e) {
    // Si un paso falla, la transacción se aborta aquí mismo: una transacción que queda abierta
    // dejaría esperando para siempre a la siguiente escritura en estos almacenes.
    try {
      tx.abort();
    } catch {
      /* ya había terminado */
    }
    throw e;
  }
}

/** Con el disco lleno, la copia de la foto que guarda el borrador sobra: el registro lleva ese mismo archivo. */
async function soltarBorradorDe(form: DeFormulario | null): Promise<boolean> {
  if (!form) return false;
  const b = await leerMeta<BorradorGuardado>(form.clave);
  if (!esSuBorrador(b, form)) return false;
  await borrarMeta(form.clave);
  return true;
}

export async function encolar(n: NuevoRegistro): Promise<ItemRespaldo> {
  const blob = n.foto?.blob ?? null;
  const registro: RegistroRespaldo = {
    id: nuevoUuid(),
    tipo: n.tipo,
    capturadoEn: n.capturadoEn,
    guardadoEn: n.guardadoEn,
    fecha: n.fecha,
    quien: n.quien,
    trabajador: n.trabajador,
    area: n.area,
    nota: n.nota,
    lineas: n.lineas.map((l) => ({ ...l, clientId: nuevoUuid() })),
    fotoRuta: n.foto ? rutaFoto(n.tipo, n.foto.id, n.capturadoEn) : null,
    fotoOrigen: n.foto?.origen ?? null,
    fotoSubida: false,
    estado: "pendiente",
    intentos: 0,
    proximoIntentoEn: 0,
    ultimoError: null,
    confirmadoEn: null,
    desfaseSegundos: null,
    revision: null,
    dueno: n.dueno ?? null,
    origenHora: n.foto ? (n.foto.origenHora ?? null) : "registro",
    // Una foto vieja cambia el stock hoy con fecha de hace tiempo: alguien tiene que mirarla.
    horaDudosa: (n.foto?.dudosa ?? false) || (n.foto !== null && fotoAntigua(n.capturadoEn, n.guardadoEn)),
    desfaseAlGuardar: await desfaseConocido(Date.now()),
  };
  const form: DeFormulario | null = n.borrador || n.foto ? { clave: claveBorrador(n.dueno ?? null), id: n.borrador?.id ?? null, fotoId: n.foto?.id ?? null } : null;
  // Safari en navegación privada no guarda Blob: ahí la foto va como bytes (se decide antes de abrir la transacción).
  const guardable: FotoEnAlmacen | null = blob ? await fotoParaGuardar(blob) : null;
  try {
    await escribirNuevo(registro, guardable, form);
  } catch (e) {
    if (!esQuota(e)) throw e;
    await reintentarConEspacio(registro, guardable, form);
  }
  avisar();
  return aItem(registro, blob);
}

/** Primero suelta el borrador de este formulario. Las copias de lo ya subido solo se sacrifican si eso no alcanza. */
async function reintentarConEspacio(registro: RegistroRespaldo, blob: FotoEnAlmacen | null, form: DeFormulario | null): Promise<void> {
  if (await soltarBorradorDe(form).catch(() => false)) {
    try {
      await escribirNuevo(registro, blob, form);
      return;
    } catch (e) {
      if (!esQuota(e)) throw e;
    }
  }
  if ((await liberarEspacio().catch(() => 0)) === 0) throw new SinEspacioError();
  try {
    await escribirNuevo(registro, blob, form);
  } catch (e) {
    if (esQuota(e)) throw new SinEspacioError();
    throw e;
  }
}

export async function listarRespaldo(): Promise<ItemRespaldo[]> {
  const db = await abrirAlmacen();
  const tx = db.transaction(["respaldo", "fotos"]);
  const [registros, fotos] = await Promise.all([tx.objectStore("respaldo").getAll(), tx.objectStore("fotos").getAll()]);
  const porId = new Map(fotos.map((f) => [f.id, fotoComoBlob(f.blob)]));
  return registros.map((r) => aItem(r, porId.get(r.id) ?? null)).sort((a, b) => a.capturadoEn.localeCompare(b.capturadoEn));
}

export async function obtenerItem(id: string): Promise<ItemRespaldo | undefined> {
  const db = await abrirAlmacen();
  const tx = db.transaction(["respaldo", "fotos"]);
  const [r, f] = await Promise.all([tx.objectStore("respaldo").get(id), tx.objectStore("fotos").get(id)]);
  return r ? aItem(r, fotoComoBlob(f?.blob)) : undefined;
}

/** Cambia solo los datos del registro. La foto no se reescribe: un cambio de estado pesa unos bytes. */
export async function actualizarItem(id: string, cambios: Partial<Omit<ItemRespaldo, "foto">>): Promise<void> {
  const db = await abrirAlmacen();
  const tx = db.transaction("respaldo", "readwrite");
  const actual = await tx.store.get(id);
  if (!actual) {
    await tx.done;
    return;
  }
  await Promise.all([tx.store.put({ ...actual, ...cambios }), tx.done]);
  avisar();
}

/** Saca del registro las fotos guardadas antes de la versión 2. Lo que no se pueda mudar sigue donde estaba. */
export async function moverFotosViejas(): Promise<number> {
  const db = await abrirAlmacen();
  let movidas = 0;
  for (const r of await db.getAll("respaldo")) {
    if (!r.foto) continue;
    const { foto, ...resto } = r;
    try {
      const tx = db.transaction(["respaldo", "fotos"], "readwrite");
      await Promise.all([tx.objectStore("fotos").put({ id: r.id, blob: foto }), tx.objectStore("respaldo").put(resto), tx.done]);
      movidas++;
    } catch (e) {
      console.error("[respaldo] mudar foto", e);
    }
  }
  return movidas;
}

/** Vuelve a poner en cola un registro que el servidor rechazó, para intentarlo otra vez. */
export async function reintentarItem(id: string): Promise<void> {
  await actualizarItem(id, { estado: "pendiente", proximoIntentoEn: 0, ultimoError: null, revision: null });
}

/** Otra cuenta guardó este registro y no va a volver: una cuenta autorizada lo toma para subirlo. La firma original no cambia. */
export async function adoptarItem(id: string, dueno: string): Promise<void> {
  const item = await obtenerItem(id);
  if (!item || !faltaSubir(item)) return;
  await actualizarItem(id, { dueno, estado: "pendiente", proximoIntentoEn: 0, ultimoError: null });
}

/** Solo se borra lo que el servidor confirmó hace más de 7 días y nadie tiene que revisar. `ahora` debe ser una hora que el servidor haya dado. */
export async function purgarConfirmados(ahora: number): Promise<number> {
  const db = await abrirAlmacen();
  const tx = db.transaction(["respaldo", "fotos"], "readwrite");
  const fotos = tx.objectStore("fotos");
  let borrados = 0;
  let cursor = await tx.objectStore("respaldo").index("estado").openCursor("confirmado");
  while (cursor) {
    const { confirmadoEn, confirmadoServidorEn, desfaseSegundos, id, revision } = cursor.value;
    // La hora del servidor es la buena. En un reintento, desfaseSegundos es el del primer intento y no sirve para corregir este reloj.
    const confirmado = confirmadoServidorEn ?? (confirmadoEn === null ? null : confirmadoEn - (desfaseSegundos ?? 0) * 1000);
    if (revision === null && confirmado !== null && ahora - confirmado > COPIA_MS) {
      await fotos.delete(id);
      await cursor.delete();
      borrados++;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  if (borrados > 0) avisar();
  return borrados;
}

/** Con el almacenamiento lleno: borra las copias más antiguas de lo ya subido. Nunca lo pendiente ni lo que hay que revisar. */
export async function liberarEspacio(max = COPIAS_POR_LIBERAR): Promise<number> {
  const db = await abrirAlmacen();
  const tx = db.transaction(["respaldo", "fotos"], "readwrite");
  const respaldo = tx.objectStore("respaldo");
  const fotos = tx.objectStore("fotos");
  const candidatos = (await respaldo.index("estado").getAll("confirmado"))
    .filter((r) => r.revision === null)
    .sort((a, b) => (a.confirmadoEn ?? 0) - (b.confirmadoEn ?? 0))
    .slice(0, max);
  for (const r of candidatos) {
    await fotos.delete(r.id);
    await respaldo.delete(r.id);
  }
  await tx.done;
  if (candidatos.length > 0) avisar();
  return candidatos.length;
}

/** Quita del dispositivo un registro rechazado. Si su foto ya estaba arriba y nadie más la usa, queda anotada para borrarla. */
export async function descartarItem(id: string): Promise<void> {
  const item = await obtenerItem(id);
  if (!item) return;
  if (item.estado !== "rechazado") throw new Error("Solo se puede descartar un registro rechazado por el servidor.");
  const db = await abrirAlmacen();
  const tx = db.transaction(["respaldo", "fotos"], "readwrite");
  await Promise.all([tx.objectStore("fotos").delete(id), tx.objectStore("respaldo").delete(id), tx.done]);
  if (item.fotoSubida && item.fotoRuta) {
    const ruta = item.fotoRuta;
    // "Guardar y registrar otro" reutiliza la foto: si otro registro la tiene, se queda.
    const compartida = (await listarRespaldo()).some((i) => i.fotoRuta === ruta);
    if (!compartida) await guardarMeta(CLAVE_HUERFANAS, [...(await fotosHuerfanas()), ruta]).catch((e) => console.error("[respaldo] foto huérfana", e));
  }
  avisar();
}

export async function fotosHuerfanas(): Promise<string[]> {
  return (await leerMeta<string[]>(CLAVE_HUERFANAS)) ?? [];
}

export async function quitarFotoHuerfana(ruta: string): Promise<void> {
  await guardarMeta(CLAVE_HUERFANAS, (await fotosHuerfanas()).filter((r) => r !== ruta));
}

/** Comprobante mínimo de que el servidor ya recibió un registro, para cuando el registro completo no se pudo actualizar. */
export async function guardarRecibo(id: string, cambios: Partial<Omit<ItemRespaldo, "foto">>): Promise<void> {
  await guardarMeta(PREFIJO_RECIBO + id, cambios);
}

/** Aplica los comprobantes guardados. Devuelve los ids que siguen sin aplicar, para no volver a subirlos en esta vuelta. */
export async function aplicarRecibos(): Promise<Set<string>> {
  const db = await abrirAlmacen();
  const claves = (await db.getAllKeys("meta")).filter((k) => String(k).startsWith(PREFIJO_RECIBO));
  const sinAplicar = new Set<string>();
  for (const k of claves) {
    const id = String(k).slice(PREFIJO_RECIBO.length);
    try {
      const cambios = await leerMeta<Partial<Omit<ItemRespaldo, "foto">>>(String(k));
      if (cambios) await actualizarItem(id, cambios);
      await borrarMeta(String(k));
    } catch (e) {
      console.error("[respaldo] recibo", e);
      sinAplicar.add(id);
    }
  }
  return sinAplicar;
}

export const PENDIENTES: readonly EstadoItem[] = ["pendiente", "subiendo", "sin_migracion"];
export const faltaSubir = (i: ItemRespaldo) => PENDIENTES.includes(i.estado);
export const porRevisar = (i: ItemRespaldo) => i.estado === "rechazado" || (i.estado === "confirmado" && i.revision !== null);

/** Lo que cada cuenta ve de este dispositivo: lo suyo y lo que se guardó sin sesión. */
export const esDeCuenta = (i: Pick<ItemRespaldo, "dueno">, usuario: string | null) => i.dueno === null || i.dueno === usuario;

/** "subiendo" también queda escrito si la app se cerró a mitad: solo se muestra así mientras de verdad se está subiendo. */
export function textoEstado(i: ItemRespaldo, subiendoAhora: boolean): string {
  if (porRevisar(i)) return "Por revisar";
  if (i.estado === "confirmado") return "Subido";
  if (i.estado === "sin_migracion") return "Esperando al servidor";
  return i.estado === "subiendo" && subiendoAhora ? "Subiendo" : "Por subir";
}

/** Lo que se le dice a la persona según cómo quedó el registro. */
export function textoGuardado(it: Pick<ItemRespaldo, "estado" | "revision">, base: string): string {
  if (it.estado === "rechazado") return `${base}. El servidor no lo aceptó y no cuenta en el stock: míralo en Respaldo.`;
  if (it.estado === "confirmado") return it.revision ? `${base}. Quedó por revisar: míralo en Respaldo.` : base;
  return `${base}. Guardado en este dispositivo: se subirá con su fecha y hora originales.`;
}

/** ¿Cabe este tamaño en el almacenamiento del navegador? Si no se puede saber, se asume que sí. */
export async function hayEspacioPara(bytes: number): Promise<boolean> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e?.quota || e.usage === undefined) return true;
    return e.quota - e.usage > bytes + MARGEN_BYTES;
  } catch {
    return true;
  }
}

/** Pide al navegador que no borre estos datos cuando se quede sin espacio. */
export async function pedirPersistencia(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
