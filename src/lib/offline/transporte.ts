import { faltaMigracion } from "../errores";
import { ErrorSubida, type CargaRegistro, type ClaseError, type RespuestaRegistro, type SesionSubida, type Transporte } from "./motor";
import { senalConLimite } from "../senal";
import { anotarHoraServidor } from "./reloj";

// Se usa fetch directo y no supabase-js porque este código también corre en el service worker,
// donde no hay localStorage para la sesión.
const LIMITE_MS = 60_000;

type Cuerpo = { code?: string; message?: string; statusCode?: string | number; error?: string; Key?: string; Id?: string };

async function leerCuerpo(r: Response): Promise<Cuerpo> {
  try {
    return (await r.json()) as Cuerpo;
  } catch {
    return {};
  }
}

const AVISO_MIGRACION = "El servidor todavía no está listo para recibir este registro. Sigue guardado aquí.";

/** Traduce la respuesta del servidor. El detalle técnico va a la consola; a la persona, una frase clara. */
export function clasificarRegistro(status: number, c: Cuerpo): ErrorSubida {
  const t = (clase: ClaseError, msg: string) => {
    console.error("[respaldo] registro", status, c.code, c.message);
    return new ErrorSubida(clase, msg);
  };
  if (faltaMigracion(c.code)) return t("sin_migracion", AVISO_MIGRACION);
  if (status === 404) return t("sin_migracion", AVISO_MIGRACION);
  if (status === 401 || c.code === "PGRST301" || c.code === "PGRST303") return t("auth", "Tu sesión venció. Entra de nuevo para subir lo pendiente.");
  if (status === 403 || c.code === "42501") return t("auth", "Esta cuenta no tiene permiso para registrar. Entra con una cuenta autorizada.");
  if (status >= 500 || status === 408 || status === 425 || status === 429) return t("servidor", "El servidor no respondió bien. Se volverá a intentar.");
  // El freno de ritmo no dice nada malo del registro: basta con esperar.
  if (c.code === "P0001" && /demasiados registros/i.test(c.message ?? "")) return t("servidor", "Hay muchos registros subiendo a la vez. Se volverá a intentar en un momento.");
  // P0001 son los avisos que escribe la propia base de datos, ya en español.
  if (c.code === "P0001" && c.message) return t("rechazado", c.message);
  return t("rechazado", "El servidor no aceptó este registro. Revísalo y vuelve a intentarlo.");
}

export function clasificarFoto(status: number, c: Cuerpo): ErrorSubida | null {
  const codigo = Number(c.statusCode ?? status);
  const texto = `${c.error ?? ""} ${c.message ?? ""}`;
  // Ya estaba subida con esa ruta: un intento anterior llegó aunque la respuesta se haya perdido.
  if (codigo === 409 || status === 409 || /already exists|duplicate/i.test(texto)) return null;
  console.error("[respaldo] foto", status, c.statusCode, c.message);
  // Storage responde 400 cuando el token venció: tiene que entrar otra vez, no es que la foto esté mal.
  if (/jwt|exp.*claim/i.test(texto)) return new ErrorSubida("auth", "Tu sesión venció. Entra de nuevo para subir lo pendiente.");
  if (codigo === 401) return new ErrorSubida("auth", "Tu sesión venció. Entra de nuevo para subir lo pendiente.");
  // La ruta siempre cumple la política, así que un rechazo de RLS solo puede venir del freno de subidas (cupo_fotos).
  if (/row-level security/i.test(texto)) return new ErrorSubida("servidor", "Hay muchas fotos subiendo a la vez. Se volverá a intentar en unos minutos.");
  if (codigo === 403) return new ErrorSubida("auth", "Esta cuenta no tiene permiso para subir fotos. Entra con una cuenta autorizada.");
  if (codigo >= 500 || codigo === 408 || codigo === 429) return new ErrorSubida("servidor", "El almacén de fotos no respondió bien. Se volverá a intentar.");
  if (codigo === 413) return new ErrorSubida("rechazado", "La foto pesa demasiado para subirla.");
  return new ErrorSubida("rechazado", "El almacén de fotos no aceptó esta foto.");
}

/** Un 200 de un proxy o un portal cautivo no significa que la foto esté guardada: el almacén siempre responde con su JSON. */
export function fotoConfirmada(tipoContenido: string | null, c: Cuerpo): boolean {
  return /json/i.test(tipoContenido ?? "") && Boolean(c.Key || c.Id);
}

const sinRed = () => new ErrorSubida("red", "No hay conexión. Se subirá cuando vuelva.");

function anotarReloj(r: Response) {
  const fecha = r.headers.get("date");
  if (fecha) void anotarHoraServidor(Date.parse(fecha), Date.now());
}

export function crearTransporte(cfg: { url: string; anonKey: string; sesion: () => Promise<SesionSubida | null> }): Transporte {
  const cabeceras = (token: string | null, extra: Record<string, string> = {}) => ({ apikey: cfg.anonKey, Authorization: `Bearer ${token ?? cfg.anonKey}`, ...extra });

  return {
    sesion: cfg.sesion,

    async subirFoto(ruta: string, foto: Blob, token: string | null) {
      let r: Response;
      try {
        r = await fetch(`${cfg.url}/storage/v1/object/evidencias/${ruta}`, {
          method: "POST",
          headers: cabeceras(token, { "Content-Type": "image/jpeg", "x-upsert": "false" }),
          body: foto,
          signal: senalConLimite(LIMITE_MS),
        });
      } catch {
        throw sinRed();
      }
      anotarReloj(r);
      if (r.ok) {
        if (fotoConfirmada(r.headers.get("content-type"), await leerCuerpo(r))) return;
        console.error("[respaldo] foto", r.status, "respuesta que no viene del almacén");
        throw new ErrorSubida("red", "La red respondió, pero la foto no llegó al almacén. Se volverá a intentar.");
      }
      const e = clasificarFoto(r.status, await leerCuerpo(r));
      if (e) throw e;
    },

    async registrar(carga: CargaRegistro, token: string | null): Promise<RespuestaRegistro> {
      let r: Response;
      try {
        r = await fetch(`${cfg.url}/rest/v1/rpc/registrar_offline`, {
          method: "POST",
          headers: cabeceras(token, { "Content-Type": "application/json" }),
          body: JSON.stringify(carga),
          signal: senalConLimite(LIMITE_MS),
        });
      } catch {
        throw sinRed();
      }
      anotarReloj(r);
      if (!r.ok) throw clasificarRegistro(r.status, await leerCuerpo(r));
      const cuerpo = (await r.json().catch(() => null)) as RespuestaRegistro | null;
      if (!cuerpo || !Array.isArray(cuerpo.items)) throw new ErrorSubida("servidor", "El servidor respondió algo que no se entiende. Se volverá a intentar.");
      return cuerpo;
    },

    async borrarFotoHuerfana(ruta: string, token: string | null) {
      const signal = senalConLimite(LIMITE_MS);
      for (const tabla of ["salidas", "entradas"]) {
        const r = await fetch(`${cfg.url}/rest/v1/${tabla}?select=id&foto_path=eq.${encodeURIComponent(ruta)}&limit=1`, { headers: cabeceras(token), signal });
        if (!r.ok) throw new ErrorSubida("servidor", "No se pudo comprobar la foto.");
        if (((await r.json()) as unknown[]).length > 0) return "en_uso";
      }
      const r = await fetch(`${cfg.url}/storage/v1/object/evidencias/${ruta}`, { method: "DELETE", headers: cabeceras(token), signal });
      return r.ok ? "borrada" : "sin_permiso";
    },
  };
}
