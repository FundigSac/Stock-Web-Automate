import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** Estados de un registro guardado en este dispositivo. */
export type EstadoItem = "pendiente" | "subiendo" | "sin_migracion" | "confirmado" | "rechazado";

/** De dónde salió la hora del registro: solo exif y camara dicen de verdad cuándo se tomó la foto. */
export type OrigenHora = "exif" | "camara" | "archivo" | "ahora" | "registro";

export type LineaRespaldo = {
  /** UUID de la fila en el servidor: un reintento con el mismo valor no crea otra. */
  clientId: string;
  codigo: string;
  cantidad: number;
  producto: string;
  talla: string | null;
  /** Lo que devolvió el servidor al confirmar. */
  idServidor?: number;
  queda?: number;
};

export type ItemRespaldo = {
  id: string;
  tipo: "entrada" | "salida";
  capturadoEn: string;
  /** Cuándo se pulsó Guardar. Solo informa; la hora que vale es capturadoEn. */
  guardadoEn: string;
  fecha: string;
  quien: string;
  trabajador: string | null;
  area: string | null;
  nota: string | null;
  lineas: LineaRespaldo[];
  /** Vive en su propio almacén; aquí llega ya unida al registro. */
  foto: Blob | null;
  fotoRuta: string | null;
  fotoOrigen: "camara" | "galeria" | null;
  fotoSubida: boolean;
  estado: EstadoItem;
  intentos: number;
  proximoIntentoEn: number;
  ultimoError: string | null;
  confirmadoEn: number | null;
  /** Hora del servidor al confirmar. Es la que manda para saber cuándo vence la copia local. */
  confirmadoServidorEn?: number | null;
  desfaseSegundos: number | null;
  /** Por qué alguien debe mirar este registro. Si hay texto, se muestra "Por revisar". */
  revision: string | null;
  /** Cuenta con sesión al guardar. null: se guardó sin sesión, o antes de que existiera este dato. */
  dueno: string | null;
  origenHora: OrigenHora | null;
  horaDudosa: boolean;
  /** Reloj del dispositivo menos reloj del servidor al guardar, en segundos. null si no se sabía. */
  desfaseAlGuardar: number | null;
};

/** Lo que se escribe en el almacén "respaldo". Los registros anteriores a la versión 2 todavía traen su foto dentro. */
export type RegistroRespaldo = Omit<ItemRespaldo, "foto" | "dueno" | "origenHora" | "horaDudosa" | "desfaseAlGuardar"> &
  Partial<Pick<ItemRespaldo, "foto" | "dueno" | "origenHora" | "horaDudosa" | "desfaseAlGuardar">>;

/**
 * Cómo queda guardada una foto. Normalmente como Blob; Safari en navegación privada (y el WebKit de las pruebas)
 * no acepta Blob en IndexedDB, y ahí se guarda como bytes. Al leer, siempre vuelve a ser Blob.
 */
export type FotoEnAlmacen = Blob | { bytes: ArrayBuffer; tipo: string };

export async function fotoComoBytes(b: Blob): Promise<FotoEnAlmacen> {
  return { bytes: await b.arrayBuffer(), tipo: b.type };
}

let sondaBlob: Promise<boolean> | null = null;

/**
 * ¿Este navegador guarda Blob en IndexedDB? Se prueba una vez, en una base aparte: en WebKit privado el put del Blob
 * da error pero la transacción no termina nunca, y en la base real dejaría bloqueados los almacenes.
 */
export function admiteBlob(): Promise<boolean> {
  sondaBlob ??= new Promise<boolean>((ok) => {
    let listo = false;
    const fin = (v: boolean) => {
      if (listo) return;
      listo = true;
      ok(v);
    };
    setTimeout(() => fin(false), 3000);
    try {
      const q = indexedDB.open("stock-sonda-blob", 1);
      q.onupgradeneeded = () => q.result.createObjectStore("s");
      q.onerror = () => fin(false);
      q.onsuccess = () => {
        const db = q.result;
        try {
          const tx = db.transaction("s", "readwrite");
          tx.objectStore("s").put(new Blob(["x"], { type: "text/plain" }), "x");
          tx.oncomplete = () => {
            fin(true);
            db.close();
          };
          tx.onerror = () => fin(false);
          tx.onabort = () => fin(false);
        } catch {
          fin(false);
        }
      };
    } catch {
      fin(false);
    }
  });
  return sondaBlob;
}

/** Solo para pruebas: vuelve a probar en la próxima llamada. */
export function olvidarSondaBlob() {
  sondaBlob = null;
}

/** La foto en el formato que este navegador sí guarda. */
export async function fotoParaGuardar(b: Blob): Promise<FotoEnAlmacen> {
  return (await admiteBlob()) ? b : fotoComoBytes(b);
}

export function fotoComoBlob(f: FotoEnAlmacen | null | undefined): Blob | null {
  if (!f) return null;
  if (typeof (f as { bytes?: unknown }).bytes === "object") {
    const g = f as { bytes: ArrayBuffer; tipo: string };
    return new Blob([g.bytes], { type: g.tipo });
  }
  return f as Blob;
}

export type CampoEspejo = "stock" | "entradas" | "salidas" | "trabajadores" | "pedidos" | "sync";

interface Esquema extends DBSchema {
  respaldo: { key: string; value: RegistroRespaldo; indexes: { estado: EstadoItem } };
  fotos: { key: string; value: { id: string; blob: FotoEnAlmacen } };
  espejo: { key: CampoEspejo; value: { campo: CampoEspejo; filas: unknown; guardadoEn: number } };
  meta: { key: string; value: unknown };
}

const VERSION = 2;
let conexion: Promise<IDBPDatabase<Esquema>> | null = null;

// Una pestaña vieja puede impedir que la base suba de versión: la persona tiene que saber qué hacer.
let bloqueada = false;
const oyentesBloqueo = new Set<(b: boolean) => void>();

function marcarBloqueo(b: boolean) {
  if (bloqueada === b) return;
  bloqueada = b;
  oyentesBloqueo.forEach((o) => o(b));
}

export function suscribirBloqueo(fn: (bloqueada: boolean) => void): () => void {
  oyentesBloqueo.add(fn);
  fn(bloqueada);
  return () => {
    oyentesBloqueo.delete(fn);
  };
}

// Otra pestaña abrió la base con una versión mayor: esta ya no puede volver a abrirla hasta recargarse.
let recargaNecesaria = false;
const oyentesRecarga = new Set<(r: boolean) => void>();

function marcarRecargaNecesaria() {
  if (recargaNecesaria) return;
  recargaNecesaria = true;
  oyentesRecarga.forEach((o) => o(true));
}

export function suscribirRecargaNecesaria(fn: (necesaria: boolean) => void): () => void {
  oyentesRecarga.add(fn);
  fn(recargaNecesaria);
  return () => {
    oyentesRecarga.delete(fn);
  };
}

export const esVersionVieja = (e: unknown) => (e as { name?: string } | null)?.name === "VersionError";

/** Una ranura por cuenta: un borrador de una cuenta no pisa el de otra en un equipo compartido. */
export const claveBorrador = (dueno: string | null) => `borrador_registrar:${dueno ?? "sin_sesion"}`;

export function abrirAlmacen(): Promise<IDBPDatabase<Esquema>> {
  conexion ??= openDB<Esquema>("stock-offline", VERSION, {
    upgrade(db, viejo) {
      if (viejo < 1) {
        const respaldo = db.createObjectStore("respaldo", { keyPath: "id" });
        respaldo.createIndex("estado", "estado");
        db.createObjectStore("espejo", { keyPath: "campo" });
        db.createObjectStore("meta");
      }
      // Las fotos viejas se mudan después, una por una (moverFotosViejas): con el disco lleno, mudarlas aquí impediría abrir la base.
      if (viejo < 2) db.createObjectStore("fotos", { keyPath: "id" });
    },
    blocked() {
      marcarBloqueo(true);
    },
    blocking(_actual, _nueva, evento) {
      // Otra pestaña necesita una versión nueva: esta suelta la base para no bloquearla y tendrá que recargarse.
      (evento.target as IDBDatabase).close();
      conexion = null;
      marcarRecargaNecesaria();
    },
    terminated() {
      conexion = null;
    },
  })
    .then((db) => {
      marcarBloqueo(false);
      return db;
    })
    .catch((e) => {
      conexion = null;
      if (esVersionVieja(e)) marcarRecargaNecesaria();
      throw e;
    });
  return conexion;
}

/** Solo para las pruebas: suelta la conexión antes de borrar la base. */
export async function cerrarAlmacen(): Promise<void> {
  const c = conexion;
  conexion = null;
  if (c) (await c).close();
}

export async function leerMeta<T>(clave: string): Promise<T | undefined> {
  return (await (await abrirAlmacen()).get("meta", clave)) as T | undefined;
}

export async function guardarMeta(clave: string, valor: unknown): Promise<void> {
  await (await abrirAlmacen()).put("meta", valor, clave);
}

export async function borrarMeta(clave: string): Promise<void> {
  await (await abrirAlmacen()).delete("meta", clave);
}
