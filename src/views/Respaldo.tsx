import { CheckCircle2, Clock3, ImageOff, Loader2, ShieldAlert, TriangleAlert, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Boton, Card, Kicker, Vacio } from "../components/ui";
import { EspacioUsado } from "../components/UsoAlmacen";
import { entero, nombreProducto } from "../lib/format";
import { descargarBlob, nombreEvidencia } from "../lib/foto";
import type { ItemRespaldo } from "../lib/offline/almacen";
import { soportaBackgroundSync } from "../lib/offline/cliente";
import { DIAS_COPIA, faltaSubir, porRevisar, textoEstado } from "../lib/offline/respaldo";
import type { Respaldo as DatosRespaldo } from "../lib/offline/useRespaldo";
import { selloLima } from "../lib/tiempo";
import { cn } from "../lib/utils";

function Miniatura({ foto }: { foto: Blob | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!foto) return;
    const u = URL.createObjectURL(foto);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [foto]);
  return url ? (
    <img src={url} alt="Foto guardada" className="size-16 shrink-0 rounded-xl border border-line object-cover" />
  ) : (
    <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-ground text-faint" title="Sin foto">
      <ImageOff className="size-5" />
    </span>
  );
}

function estadoDe(i: ItemRespaldo, subiendoAhora: boolean): { texto: string; clase: string; icono: ReactNode } {
  const texto = textoEstado(i, subiendoAhora);
  if (texto === "Por revisar") return { texto, clase: "bg-red-soft text-red", icono: <TriangleAlert className="size-3.5" /> };
  if (texto === "Subido") return { texto, clase: "bg-ok-soft text-ok", icono: <CheckCircle2 className="size-3.5" /> };
  if (texto === "Subiendo") return { texto, clase: "bg-warn-soft text-warn", icono: <Loader2 className="size-3.5 animate-spin" /> };
  return { texto, clase: "bg-warn-soft text-warn", icono: <Clock3 className="size-3.5" /> };
}

function Fila({ i, r }: { i: ItemRespaldo; r: DatosRespaldo }) {
  const [descartando, setDescartando] = useState(false);
  const estado = estadoDe(i, r.subiendo);
  const { fecha, hora } = selloLima(i.capturadoEn);
  const unidades = i.lineas.reduce((a, l) => a + l.cantidad, 0);
  const nombres = Array.from(new Set(i.lineas.map((l) => nombreProducto(l.producto)))).join(", ");
  return (
    <li className="flex items-start gap-3 p-4">
      <Miniatura foto={i.foto} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-[14px] font-semibold leading-snug">
            {i.tipo === "entrada" ? "Entrada" : "Salida"} de {entero(unidades)} {unidades === 1 ? "unidad" : "unidades"}
          </p>
          <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold", estado.clase)}>
            {estado.icono}
            {estado.texto}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-muted">{nombres}</p>
        {i.trabajador && <p className="text-[13px] text-muted">Para {nombreProducto(i.trabajador)}</p>}
        <p className="mt-1 text-[12.5px]">
          {i.origenHora === "archivo" ? "Archivo del" : i.origenHora === "ahora" ? "Elegida el" : i.foto ? "Foto del" : "Registrado el"} <b className="num">{fecha}</b> a las <b className="num">{hora}</b>
          {i.fotoOrigen === "galeria" && <span className="text-muted"> (de la galería)</span>}
        </p>
        {i.revision && <p className="mt-1.5 text-justify text-[12.5px] font-medium text-red">{i.revision}</p>}
        {!i.revision && i.ultimoError && faltaSubir(i) && <p className="mt-1.5 text-justify text-[12.5px] text-muted">{i.ultimoError}</p>}
        {i.estado === "rechazado" && !descartando && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Boton className="h-9" onClick={() => r.reintentar(i.id)}>
              Volver a intentar
            </Boton>
            <Boton className="h-9" onClick={() => setDescartando(true)}>
              Descartar
            </Boton>
          </div>
        )}
        {descartando && (
          <div role="alert" className="mt-2.5 rounded-xl bg-red-soft p-3 text-red">
            <p className="text-justify text-[12.5px] font-medium">Se borra de este dispositivo y no llegará al servidor. Si la foto te sirve, descárgala antes.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {i.foto && (
                <Boton className="h-9" onClick={() => i.foto && descargarBlob(i.foto, nombreEvidencia(i.capturadoEn))}>
                  Descargar foto
                </Boton>
              )}
              <Boton variante="ink" className="h-9" onClick={() => void r.descartar(i.id)}>
                Sí, descartar
              </Boton>
              <Boton className="h-9" onClick={() => setDescartando(false)}>
                No
              </Boton>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function Grupo({ titulo, nota, items, r }: { titulo: string; nota?: string; items: ItemRespaldo[]; r: DatosRespaldo }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={titulo}>
      <div className="mb-2.5 px-1">
        <h2 className="display text-[17px] font-semibold">
          {titulo} <span className="num text-muted">({items.length})</span>
        </h2>
        {nota && <p className="text-justify text-[12.5px] text-muted">{nota}</p>}
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line-2">
          {[...items].reverse().map((i) => (
            <Fila key={i.id} i={i} r={r} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** Un registro de otra cuenta: se puede rescatar la foto o, con confirmación, subirlo con la cuenta que está dentro. */
function FilaOtraCuenta({ i, r, puedeSubir }: { i: ItemRespaldo; r: DatosRespaldo; puedeSubir: boolean }) {
  const [confirmando, setConfirmando] = useState(false);
  const { fecha, hora } = selloLima(i.capturadoEn);
  const unidades = i.lineas.reduce((a, l) => a + l.cantidad, 0);
  return (
    <li className="flex items-start gap-3 p-4">
      <Miniatura foto={i.foto} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug">
          {i.tipo === "entrada" ? "Entrada" : "Salida"} de {entero(unidades)} {unidades === 1 ? "unidad" : "unidades"}
        </p>
        <p className="mt-0.5 text-[13px] text-muted">{Array.from(new Set(i.lineas.map((l) => nombreProducto(l.producto)))).join(", ")}</p>
        <p className="text-[12.5px] text-muted">
          Guardado el {fecha} a las {hora} por {i.quien}
        </p>
        {!confirmando && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {i.foto && (
              <Boton className="h-9" onClick={() => i.foto && descargarBlob(i.foto, nombreEvidencia(i.capturadoEn))}>
                Descargar foto
              </Boton>
            )}
            {puedeSubir && (
              <Boton className="h-9" onClick={() => setConfirmando(true)}>
                Subir con mi cuenta
              </Boton>
            )}
          </div>
        )}
        {confirmando && (
          <div role="alert" className="mt-2.5 rounded-xl bg-warn-soft p-3 text-warn">
            <p className="text-justify text-[12.5px] font-medium">Se sube con tu cuenta y conserva la firma de {i.quien}. Hazlo solo si esa persona ya no va a entrar en este dispositivo.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Boton variante="ink" className="h-9" onClick={() => void r.adoptar(i.id)}>
                Sí, subir
              </Boton>
              <Boton className="h-9" onClick={() => setConfirmando(false)}>
                No
              </Boton>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

export function Respaldo({ r, autorizado }: { r: DatosRespaldo; /** Cuenta editora con sesión: puede rescatar lo que otra cuenta dejó aquí. */ autorizado: boolean }) {
  const pendientes = useMemo(() => r.items.filter(faltaSubir), [r.items]);
  const revisar = useMemo(() => r.items.filter(porRevisar), [r.items]);
  const subidos = useMemo(() => r.items.filter((i) => i.estado === "confirmado" && !porRevisar(i)), [r.items]);
  const enSegundoPlano = soportaBackgroundSync();
  const faltaServidor = r.sinMigracion > 0;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Kicker>Este dispositivo</Kicker>
            <p className="display mt-1 text-lg font-semibold">
              {pendientes.length === 0 ? "No hay nada por subir" : `${pendientes.length} por subir`}
            </p>
          </div>
          <Boton variante="ink" onClick={r.subirAhora} disabled={!navigator.onLine || r.subiendo || pendientes.length === 0}>
            {r.subiendo ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />} Subir ahora
          </Boton>
        </div>
        {!r.enLinea && pendientes.length > 0 && <p className="mt-3 text-[13px] font-medium text-warn">Sin conexión. Se suben cuando vuelva la señal.</p>}
        {r.sinEspacio && (
          <p role="alert" className="mt-3 text-justify text-[13px] font-medium text-red">
            Este dispositivo se quedó sin espacio. Lo pendiente sigue guardado y se sigue subiendo, pero libera espacio para poder registrar más.
          </p>
        )}
        {faltaServidor && (
          <p className="mt-3 text-justify text-[13px] font-medium text-warn">
            El servidor todavía no tiene la actualización que recibe estos registros. Siguen guardados aquí y se subirán solos cuando esté lista.
          </p>
        )}
        {r.esperanEntrar > 0 && (
          <p role="alert" className="mt-3 text-justify text-[13px] font-medium text-warn">
            Tu sesión se cerró. {r.esperanEntrar === 1 ? "Tu registro sigue guardado aquí" : `Tus ${r.esperanEntrar} registros siguen guardados aquí`} y se {r.esperanEntrar === 1 ? "subirá" : "subirán"} cuando entres otra vez con tu cuenta.
          </p>
        )}
        {r.deOtraCuenta > 0 && (
          <p className="mt-3 text-justify text-[13px] font-medium text-warn">
            Hay {r.deOtraCuenta} {r.deOtraCuenta === 1 ? "registro guardado" : "registros guardados"} con otra cuenta en este dispositivo. Se subirán cuando esa cuenta entre{autorizado ? ", o puedes rescatarlos abajo." : "."}
          </p>
        )}
        {r.persistente === false && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warn-soft px-3.5 py-3 text-warn">
            <p className="flex-1 text-justify text-[13px] font-medium">
              <ShieldAlert className="mr-1.5 inline size-4 align-text-bottom" />
              Este navegador puede borrar lo guardado aquí si el dispositivo se queda sin espacio. Instalar la app en la pantalla de inicio suele protegerlo.
            </p>
            <Boton className="h-9" onClick={() => void r.protegerDatos()}>
              Pedir protección
            </Boton>
          </div>
        )}
        <div className="mt-3 space-y-1.5 text-justify text-[13px] leading-relaxed text-muted">
          <p>Sin señal puedes seguir registrando. Cada movimiento y su foto se guardan en este dispositivo con la fecha y hora en que se tomó la foto, y esa hora no cambia al subirlos.</p>
          <p>
            {enSegundoPlano
              ? "Cuando vuelve la conexión, este dispositivo puede subirlos con la app cerrada mientras tu sesión siga vigente. Si la sesión venció, esperan a que abras la app."
              : "Este dispositivo no sube con la app cerrada, como pasa en iPhone y iPad: se suben cuando abres la app con conexión."}{" "}
            Lo ya subido se conserva aquí {DIAS_COPIA} días como copia.
          </p>
        </div>
      </Card>

      <EspacioUsado />

      {r.items.length === 0 && (
        <Card>
          <Vacio icono={<UploadCloud className="size-5" />} titulo="Todavía no hay registros guardados aquí" texto="Lo que registres desde este dispositivo aparecerá en esta lista." />
        </Card>
      )}

      <Grupo titulo="Por revisar" nota="No se perdió nada. Aquí está el motivo de cada uno. Lo que el servidor rechazó no cuenta en el stock hasta que se vuelva a intentar." items={revisar} r={r} />
      <Grupo titulo="Por subir" items={pendientes} r={r} />
      <Grupo titulo="Subidos" items={subidos} r={r} />
      {autorizado && r.deOtrasCuentas.length > 0 && (
        <section aria-label="De otra cuenta">
          <div className="mb-2.5 px-1">
            <h2 className="display text-[17px] font-semibold">
              De otra cuenta <span className="num text-muted">({r.deOtrasCuentas.length})</span>
            </h2>
          </div>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line-2">
              {r.deOtrasCuentas.map((i) => (
                <FilaOtraCuenta key={i.id} i={i} r={r} puedeSubir={autorizado} />
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
