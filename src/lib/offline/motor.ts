import { fechaLima, fotoAntigua, isoLima } from "../tiempo";
import type { ItemRespaldo } from "./almacen";
import { anotarHoraServidor, ultimoContacto } from "./reloj";
import { actualizarItem, aplicarRecibos, esQuota, faltaSubir, fotosHuerfanas, guardarRecibo, liberarEspacio, listarRespaldo, moverFotosViejas, purgarConfirmados, quitarFotoHuerfana } from "./respaldo";

export const LIMITE_DESFASE_SEGUNDOS = 300;
const ESPERA_BASE_MS = 5_000;
export const ESPERA_MAX_MS = 30 * 60_000;
/** La espera más larga posible, con su azar. Algo mayor solo puede venir de un reloj equivocado. */
export const ESPERA_TOPE_MS = ESPERA_MAX_MS * 1.2;
/** Fallos de red seguidos, en registros distintos, para dar por perdida la conexión. */
const REDES_SEGUIDAS_MAX = 2;

export const AVISO_FALTA_SESION = "Hay que abrir la app con tu sesión para subir este registro.";
export const AVISO_OTRA_CUENTA = "Este registro lo guardó otra cuenta. Se subirá cuando esa cuenta entre en este dispositivo.";
const AVISO_LOCAL = "No se pudo preparar este registro para subirlo. Se volverá a intentar.";

/**
 * red y servidor se reintentan solos; local es un problema de este registro y tampoco detiene a los demás;
 * auth y sin_migracion esperan; rechazado necesita a una persona.
 */
export type ClaseError = "red" | "servidor" | "local" | "auth" | "sin_migracion" | "rechazado";

export class ErrorSubida extends Error {
  readonly clase: ClaseError;
  constructor(clase: ClaseError, mensaje: string) {
    super(mensaje);
    this.name = "ErrorSubida";
    this.clase = clase;
  }
}

export type CargaRegistro = {
  p_tipo: "entrada" | "salida";
  p_fecha: string;
  p_quien: string;
  p_items: { client_id: string; codigo: string; cantidad: number }[];
  p_capturado_en: string;
  p_reloj_dispositivo: string;
  p_trabajador: string | null;
  p_nota: string | null;
  p_foto: string | null;
  /** Desfase del reloj conocido al guardar, medido en el último contacto con el servidor. Puede ser de hace días. */
  p_desfase_captura: number | null;
  p_capturado_origen: string | null;
  p_hora_dudosa: boolean;
};

export type RespuestaRegistro = {
  /** Reloj del dispositivo menos reloj del servidor, en segundos. En un reintento, el del primer intento. */
  reloj_desfase_segundos: number;
  servidor_ahora?: string;
  items: {
    client_id: string;
    codigo: string;
    id: number;
    queda: number;
    /** La fila ya estaba: su veredicto es el del primer intento. */
    ya_existia?: boolean;
    revisar_motivo?: string | null;
  }[];
};

export type SesionSubida = { usuario: string; token: string };

export type Transporte = {
  /** La sesión con la que se puede subir ahora. Sin esta función se sube sin sesión. */
  sesion?: () => Promise<SesionSubida | null>;
  subirFoto: (ruta: string, foto: Blob, token: string | null) => Promise<void>;
  registrar: (carga: CargaRegistro, token: string | null) => Promise<RespuestaRegistro>;
  /** Borra una foto que ninguna fila usa. Falla solo si no se pudo preguntar al servidor. */
  borrarFotoHuerfana?: (ruta: string, token: string | null) => Promise<"borrada" | "en_uso" | "sin_permiso">;
};

export type OpcionesSync = {
  /** Ignora la espera entre reintentos (volvió la conexión o la persona pulsó "Subir ahora"). */
  forzar?: boolean;
  reloj?: () => number;
  azar?: () => number;
};

export type ResumenSync = {
  confirmados: number;
  fallidos: number;
  sinRed: boolean;
  /** Registros que no se intentaron porque hace falta la sesión de su dueño. */
  esperanSesion: number;
  sinEspacio: boolean;
  /** El servidor recibió algo pero este dispositivo no pudo anotarlo: hay que repetir la vuelta. */
  reciboFallido: boolean;
};
const NADA: ResumenSync = { confirmados: 0, fallidos: 0, sinRed: false, esperanSesion: 0, sinEspacio: false, reciboFallido: false };

/** Espera antes del intento siguiente: se duplica hasta 30 minutos, con un poco de azar. */
export function esperaReintento(intentos: number, azar: () => number = Math.random): number {
  const base = Math.min(ESPERA_MAX_MS, ESPERA_BASE_MS * 2 ** Math.max(0, intentos - 1));
  return Math.round(base * (0.8 + azar() * 0.4));
}

/** Ya toca intentarlo. Una espera más larga que el tope la dejó un reloj equivocado: no se respeta. */
export function tocaIntentar(proximoIntentoEn: number, ahora: number): boolean {
  return proximoIntentoEn <= ahora || proximoIntentoEn - ahora > ESPERA_TOPE_MS;
}

export function construirCarga(it: ItemRespaldo, ahora: number): CargaRegistro {
  return {
    p_tipo: it.tipo,
    p_fecha: it.fecha,
    p_quien: it.quien,
    p_items: it.lineas.map((l) => ({ client_id: l.clientId, codigo: l.codigo, cantidad: l.cantidad })),
    p_capturado_en: it.capturadoEn,
    p_reloj_dispositivo: isoLima(ahora),
    p_trabajador: it.trabajador,
    p_nota: it.nota,
    p_foto: it.fotoRuta,
    p_desfase_captura: it.desfaseAlGuardar,
    p_capturado_origen: it.origenHora,
    p_hora_dudosa: it.horaDudosa,
  };
}

const textoDesfase = (segundos: number) => `${Math.round(Math.abs(segundos) / 60)} min ${segundos > 0 ? "adelantado" : "atrasado"}`;

/** Por qué un registro ya subido necesita que alguien lo mire: saldo negativo, reloj equivocado o fecha que no cuadra. */
export function motivosRevision(it: ItemRespaldo, r: RespuestaRegistro, ahora: number = Date.now()): string | null {
  // Reintento de algo que el servidor ya tenía: vale lo que se decidió la primera vez.
  if (r.items.length > 0 && r.items.every((x) => x.ya_existia)) {
    const previos = Array.from(new Set(r.items.flatMap((x) => (x.revisar_motivo ? [x.revisar_motivo] : []))));
    return previos.length > 0 ? previos.join(" ") : null;
  }
  const motivos: string[] = [];
  if (it.tipo === "salida") {
    for (const l of it.lineas) {
      const fila = r.items.find((x) => x.client_id === l.clientId);
      if (fila && fila.queda < 0) motivos.push(`Al subir, ${l.producto}${l.talla ? ` talla ${l.talla}` : ""} quedó en ${fila.queda}: se entregó más de lo que había.`);
    }
  }
  motivos.push(...motivosDeReloj(it.desfaseAlGuardar, r.reloj_desfase_segundos));
  const servidor = r.servidor_ahora ? Date.parse(r.servidor_ahora) : ahora - r.reloj_desfase_segundos * 1000;
  if (Date.parse(it.capturadoEn) > servidor + LIMITE_DESFASE_SEGUNDOS * 1000) motivos.push("La hora de la foto es posterior a la del servidor: el reloj iba adelantado cuando se tomó.");
  // Sin foto, capturadoEn es el momento de registrar y no hay nada con qué comparar la fecha elegida.
  if (it.fotoRuta && it.origenHora !== "registro") {
    const dias = Math.abs(Date.parse(it.fecha) - Date.parse(fechaLima(it.capturadoEn))) / 86_400_000;
    if (dias > 1) motivos.push(`La fecha del movimiento (${it.fecha}) no coincide con la de la foto (${fechaLima(it.capturadoEn)}).`);
  }
  if (it.fotoRuta && it.guardadoEn && fotoAntigua(it.capturadoEn, it.guardadoEn)) motivos.push(`La foto es del ${fechaLima(it.capturadoEn)} y se registró el ${fechaLima(it.guardadoEn)}: revisa que corresponda a esta entrega.`);
  else if (it.horaDudosa) motivos.push("La fecha guardada en la foto no es confiable: revisa que corresponda a esta entrega.");
  return motivos.length > 0 ? motivos.join(" ") : null;
}

/**
 * El desfase conocido al guardar viene del último contacto, que puede ser de hace semanas; el de subir es el de ahora.
 * Si no coinciden, el reloj cambió en medio y no se puede saber cómo estaba cuando se tomó la foto.
 */
function motivosDeReloj(alGuardar: number | null, alSubir: number): string[] {
  if (alGuardar !== null && Math.abs(alGuardar - alSubir) > LIMITE_DESFASE_SEGUNDOS) {
    return [`El reloj de este dispositivo cambió desde su último contacto con el servidor (${Math.round(Math.abs(alGuardar - alSubir) / 60)} min de diferencia). La hora de la foto no se pudo comprobar y se dejó como estaba.`];
  }
  if (alGuardar !== null && Math.abs(alGuardar) > LIMITE_DESFASE_SEGUNDOS) return [`Al guardar, el reloj de este dispositivo estaba ${textoDesfase(alGuardar)}. La hora de la foto se dejó como estaba.`];
  if (Math.abs(alSubir) > LIMITE_DESFASE_SEGUNDOS) return [`Al subir, el reloj de este dispositivo estaba ${textoDesfase(alSubir)}. La hora de la foto se dejó como estaba.`];
  return [];
}

/** Cambios que deja en el registro una subida confirmada. */
function cambiosConfirmado(it: ItemRespaldo, r: RespuestaRegistro, ahora: number): Partial<Omit<ItemRespaldo, "foto">> {
  return {
    estado: "confirmado",
    confirmadoEn: ahora,
    confirmadoServidorEn: r.servidor_ahora ? Date.parse(r.servidor_ahora) : null,
    ultimoError: null,
    desfaseSegundos: r.reloj_desfase_segundos,
    revision: motivosRevision(it, r, ahora),
    lineas: it.lineas.map((l) => {
      const fila = r.items.find((x) => x.client_id === l.clientId);
      return fila ? { ...l, idServidor: fila.id, queda: fila.queda } : l;
    }),
  };
}

/**
 * Escribe en el dispositivo sin dejar que un fallo detenga la subida.
 * Solo la confirmación libera espacio: por un cambio de estado pasajero no se sacrifican las copias que se prometen por 7 días.
 */
async function escribir(id: string, cambios: Partial<Omit<ItemRespaldo, "foto">>, resumen: ResumenSync, liberar = false): Promise<boolean> {
  try {
    await actualizarItem(id, cambios);
    return true;
  } catch (e) {
    console.error("[respaldo] escritura local", e);
    if (!esQuota(e)) return false;
    resumen.sinEspacio = true;
    if (!liberar) return false;
    try {
      if ((await liberarEspacio()) === 0) return false;
      await actualizarItem(id, cambios);
      return true;
    } catch {
      return false;
    }
  }
}

type Resultado = ClaseError | "ok" | "espera_sesion";

async function procesar(it: ItemRespaldo, t: Transporte, reloj: () => number, azar: () => number, resumen: ResumenSync): Promise<Resultado> {
  let sesion: SesionSubida | null = null;
  try {
    sesion = t.sesion ? await t.sesion() : null;
  } catch (e) {
    console.error("[respaldo] sesión", e);
    return "red";
  }
  // Un registro hecho con sesión solo sube con esa misma sesión. No se manda con otra cuenta ni como anónimo.
  if (it.dueno !== null && sesion?.usuario !== it.dueno) {
    const aviso = sesion ? AVISO_OTRA_CUENTA : AVISO_FALTA_SESION;
    if (it.ultimoError !== aviso || it.estado === "subiendo") await escribir(it.id, { estado: "pendiente", ultimoError: aviso }, resumen);
    return "espera_sesion";
  }
  const token = sesion?.token ?? null;

  await escribir(it.id, { estado: "subiendo" }, resumen);
  try {
    // Primero la foto; la fila solo se crea cuando la foto ya está arriba.
    if (it.fotoRuta && !it.fotoSubida) {
      if (!it.foto) throw new ErrorSubida("rechazado", "La foto de este registro ya no está en el dispositivo.");
      await fotoLegible(it.foto);
      await t.subirFoto(it.fotoRuta, it.foto, token);
      await escribir(it.id, { fotoSubida: true }, resumen);
    }
    const r = await t.registrar(construirCarga(it, reloj()), token);
    if (r.servidor_ahora) await anotarHoraServidor(Date.parse(r.servidor_ahora), reloj());
    const cambios = cambiosConfirmado(it, r, reloj());
    if (!(await escribir(it.id, cambios, resumen, true))) {
      try {
        await guardarRecibo(it.id, cambios);
      } catch (e) {
        console.error("[respaldo] recibo", e);
        resumen.reciboFallido = true;
      }
    }
    return "ok";
  } catch (e) {
    if (!(e instanceof ErrorSubida)) console.error("[respaldo] subida", e);
    const err = e instanceof ErrorSubida ? e : new ErrorSubida("local", AVISO_LOCAL);
    const intentos = it.intentos + 1;
    const cambios =
      err.clase === "rechazado"
        ? { estado: "rechazado" as const, intentos, ultimoError: err.message, revision: err.message }
        : { estado: err.clase === "sin_migracion" ? ("sin_migracion" as const) : ("pendiente" as const), intentos, proximoIntentoEn: reloj() + esperaReintento(intentos, azar), ultimoError: err.message };
    if (!(await escribir(it.id, cambios, resumen))) resumen.reciboFallido = true;
    return err.clase;
  }
}

async function fotoLegible(foto: Blob) {
  try {
    await foto.slice(0, 1).arrayBuffer();
  } catch {
    throw new ErrorSubida("local", "La foto guardada no se pudo leer. Se volverá a intentar.");
  }
}

/** Tareas de mantenimiento antes de subir. Ninguna puede impedir la subida. */
async function preparar(t: Transporte, resumen: ResumenSync): Promise<Set<string>> {
  const sinAplicar = await aplicarRecibos().catch((e) => {
    console.error("[respaldo] recibos", e);
    return new Set<string>();
  });
  await moverFotosViejas().catch((e) => console.error("[respaldo] fotos viejas", e));
  try {
    // Lo que vale es la hora que dio el servidor: un reloj adelantado no borra copias antes de tiempo.
    const contacto = await ultimoContacto();
    if (contacto) await purgarConfirmados(contacto.servidorMs);
  } catch (e) {
    console.error("[respaldo] limpieza", e);
    if (esQuota(e)) resumen.sinEspacio = true;
  }
  if (t.borrarFotoHuerfana) {
    try {
      // Borrar necesita una cuenta: sin sesión quedan anotadas para otra vuelta.
      const sesion = t.sesion ? await t.sesion() : null;
      const huerfanas = sesion ? await fotosHuerfanas() : [];
      // Un registro local puede estar usando esa foto y su fila todavía no existe: el servidor no la vería en uso.
      const enCola = new Set(huerfanas.length > 0 ? (await listarRespaldo()).flatMap((i) => (i.fotoRuta ? [i.fotoRuta] : [])) : []);
      for (const ruta of huerfanas) {
        if (!enCola.has(ruta)) await t.borrarFotoHuerfana(ruta, sesion?.token ?? null);
        await quitarFotoHuerfana(ruta);
      }
    } catch (e) {
      // Sin red: quedan anotadas para la próxima vuelta.
      console.error("[respaldo] fotos huérfanas", e);
    }
  }
  return sinAplicar;
}

const sinRedDeclarada = () => (globalThis.navigator as { onLine?: boolean } | undefined)?.onLine === false;

async function correr(t: Transporte, op: OpcionesSync): Promise<ResumenSync> {
  const reloj = op.reloj ?? Date.now;
  const azar = op.azar ?? Math.random;
  const resumen = { ...NADA };
  const vistos = await preparar(t, resumen);
  let redesSeguidas = 0;
  // Se vuelve a leer al terminar cada uno: lo que se guarde mientras tanto entra en esta misma vuelta.
  for (;;) {
    const lista = await listarRespaldo();
    const siguiente = lista.find((i) => !vistos.has(i.id) && faltaSubir(i) && (op.forzar || tocaIntentar(i.proximoIntentoEn, reloj())));
    if (!siguiente) return resumen;
    vistos.add(siguiente.id);
    const r = await procesar(siguiente, t, reloj, azar, resumen);
    if (r === "espera_sesion") {
      resumen.esperanSesion++;
      continue;
    }
    if (r === "ok") resumen.confirmados++;
    else resumen.fallidos++;
    if (r === "red") {
      resumen.sinRed = true;
      redesSeguidas++;
      // Un solo fallo puede ser de ese registro: se sigue con el siguiente hasta confirmar que no hay red.
      if (sinRedDeclarada() || redesSeguidas >= REDES_SEGUIDAS_MAX) return resumen;
      continue;
    }
    redesSeguidas = 0;
    resumen.sinRed = false;
    // Sin sesión válida o sin migración, los demás fallarían igual. Sin dueño, el fallo es solo de ese registro.
    if ((r === "auth" && siguiente.dueno !== null) || r === "sin_migracion") return resumen;
  }
}

type Cerrojos = { request: <T>(n: string, o: { ifAvailable: boolean }, f: (l: unknown) => Promise<T>) => Promise<T> };

/** Una sola subida a la vez, incluso entre pestañas y el service worker. */
function conCerrojo(fn: () => Promise<ResumenSync>): Promise<ResumenSync> {
  const locks = (globalThis.navigator as unknown as { locks?: Cerrojos } | undefined)?.locks;
  if (!locks) return fn();
  return locks.request("stock-respaldo", { ifAvailable: true }, (l) => (l ? fn() : Promise.resolve(NADA)));
}

let enCurso: Promise<ResumenSync> | null = null;

export function sincronizar(t: Transporte, op: OpcionesSync = {}): Promise<ResumenSync> {
  if (enCurso) return op.forzar ? enCurso.then(() => sincronizar(t, op)) : enCurso;
  const actual: Promise<ResumenSync> = conCerrojo(() => correr(t, op)).finally(() => {
    if (enCurso === actual) enCurso = null;
  });
  enCurso = actual;
  return actual;
}
