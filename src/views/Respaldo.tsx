import { CheckCircle2, ShieldAlert, UploadCloud } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { FilaOtraCuenta, FilaPorSubir, useRecienSubidos } from "../components/FilaPorSubir";
import { Boton } from "../components/ui";
import { entero } from "../lib/format";
import type { ItemRespaldo } from "../lib/offline/almacen";
import { soportaBackgroundSync } from "../lib/offline/cliente";
import { DIAS_COPIA, faltaSubir, porRevisar } from "../lib/offline/respaldo";
import type { Respaldo as DatosRespaldo } from "../lib/offline/useRespaldo";

function Grupo({ titulo, nota, cantidad, children }: { titulo: string; nota?: string; cantidad: number; children: ReactNode }) {
  if (cantidad === 0) return null;
  return (
    <section aria-label={titulo}>
      <h2 className="flex items-baseline gap-2 text-[18px] font-semibold leading-6">
        {titulo} <span className="num text-[16px] font-normal text-muted">{entero(cantidad)}</span>
      </h2>
      {nota && <p className="mt-1 text-[16px] leading-6 text-muted">{nota}</p>}
      <ul className="mt-3 divide-y divide-line-2 overflow-hidden rounded-2xl border border-line bg-surface">{children}</ul>
    </section>
  );
}

/** Lo más reciente arriba. */
const recientes = (items: ItemRespaldo[]) => [...items].reverse();

const AVISO = "mt-3 text-[16px] font-medium leading-6";

/** Pantalla Por subir: lo que este celular guardó y en qué quedó cada registro. */
export function Respaldo({ r, autorizado }: { r: DatosRespaldo; /** Cuenta editora con sesión: puede rescatar lo que otra cuenta dejó aquí. */ autorizado: boolean }) {
  const pendientes = useMemo(() => r.items.filter(faltaSubir), [r.items]);
  const revisar = useMemo(() => r.items.filter(porRevisar), [r.items]);
  const subidos = useMemo(() => r.items.filter((i) => i.estado === "confirmado" && !porRevisar(i)), [r.items]);
  const recienSubidos = useRecienSubidos(r.items);
  const enSegundoPlano = soportaBackgroundSync();
  const faltaServidor = r.sinMigracion > 0;
  const nada = pendientes.length === 0 && revisar.length === 0 && r.deOtraCuenta === 0;
  const titular = pendientes.length > 0 ? `${entero(pendientes.length)} por subir` : revisar.length > 0 ? `${entero(revisar.length)} por revisar` : "Lo tuyo ya está subido";

  return (
    <div className="space-y-6">
      <section aria-label="Estado de este celular" className="rounded-2xl border border-line-2 bg-surface p-4 sm:p-5">
        {nada ? (
          <div>
            <h2 className="flex items-center gap-2.5 text-[20px] font-semibold leading-7">
              <CheckCircle2 className="size-7 shrink-0 text-ok" aria-hidden />
              Todo subido.
            </h2>
            <p className="mt-1 text-[16px] leading-6 text-muted">No hay nada pendiente en este celular.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="num text-[20px] font-semibold leading-7">{titular}</h2>
              {!r.enLinea && pendientes.length > 0 && <p className="text-[16px] font-medium leading-6 text-warn">Sin conexión. Se suben solos cuando vuelva la señal.</p>}
            </div>
            {pendientes.length > 0 && (
              <Boton variante="ink" className="w-full duration-100 sm:w-auto lg:min-h-14" onClick={r.subirAhora} disabled={!navigator.onLine || r.subiendo}>
                <UploadCloud className="size-5" aria-hidden /> Subir ahora
              </Boton>
            )}
          </div>
        )}
        {r.sinEspacio && (
          <p role="alert" className={`${AVISO} text-red`}>
            Este celular se quedó sin espacio. Lo pendiente sigue guardado y se sigue subiendo, pero hay que liberar espacio para registrar más.
          </p>
        )}
        {faltaServidor && <p className={`${AVISO} text-warn`}>El servidor todavía no tiene la actualización que recibe estos registros. Siguen guardados aquí y se subirán solos cuando esté lista.</p>}
        {r.esperanEntrar > 0 && (
          <p role="alert" className={`${AVISO} text-warn`}>
            Tu sesión se cerró. {r.esperanEntrar === 1 ? "Tu registro sigue guardado aquí" : `Tus ${r.esperanEntrar} registros siguen guardados aquí`} y se {r.esperanEntrar === 1 ? "subirá" : "subirán"} cuando entres otra vez con tu cuenta.
          </p>
        )}
        {r.deOtraCuenta > 0 && (
          <p className={`${AVISO} text-warn`}>
            Hay {r.deOtraCuenta} {r.deOtraCuenta === 1 ? "registro guardado" : "registros guardados"} con otra cuenta en este celular. Se subirán cuando esa cuenta entre{autorizado ? ", o puedes rescatarlos abajo." : "."}
          </p>
        )}
        {r.persistente === false && (
          <div className="mt-3 rounded-2xl bg-warn-soft p-4 text-warn">
            <p className="text-[16px] font-medium leading-6">
              <ShieldAlert className="mr-1.5 inline size-5 align-[-4px]" aria-hidden />
              Este navegador puede borrar lo guardado aquí si el celular se queda sin espacio. Instalar la app en la pantalla de inicio suele protegerlo.
            </p>
            <Boton className="mt-3 w-full duration-100 sm:w-auto lg:min-h-14" onClick={() => void r.protegerDatos()}>
              Pedir protección
            </Boton>
          </div>
        )}
      </section>

      <Grupo titulo="Por revisar" nota="No se perdió nada. Cada registro dice su motivo. Lo que no se pudo subir no cuenta en el stock hasta que lo reintentes." cantidad={revisar.length}>
        {recientes(revisar).map((i) => (
          <FilaPorSubir key={i.id} i={i} r={r} recienSubido={recienSubidos.has(i.id)} />
        ))}
      </Grupo>
      <Grupo titulo="Por subir" cantidad={pendientes.length}>
        {recientes(pendientes).map((i) => (
          <FilaPorSubir key={i.id} i={i} r={r} />
        ))}
      </Grupo>
      <Grupo titulo="Subidos" cantidad={subidos.length}>
        {recientes(subidos).map((i) => (
          <FilaPorSubir key={i.id} i={i} r={r} recienSubido={recienSubidos.has(i.id)} />
        ))}
      </Grupo>
      {autorizado && (
        <Grupo titulo="De otra cuenta" cantidad={r.deOtrasCuentas.length}>
          {r.deOtrasCuentas.map((i) => (
            <FilaOtraCuenta key={i.id} i={i} r={r} puedeSubir={autorizado} />
          ))}
        </Grupo>
      )}

      <section aria-label="Cómo se guarda" className="space-y-2 px-1 text-[16px] leading-6 text-muted">
        <h2 className="text-[18px] font-semibold text-ink">Cómo se guarda</h2>
        <p>Sin señal puedes seguir registrando. Cada registro queda en este celular con su foto y con la fecha y hora de la foto, y esa hora no cambia al subirlo.</p>
        <p>
          {enSegundoPlano
            ? "Cuando vuelve la conexión, este celular puede subirlos con la app cerrada mientras tu sesión siga vigente. Si la sesión venció, esperan a que abras la app."
            : "Este celular no sube con la app cerrada, como pasa en iPhone y iPad. Se suben cuando abres la app con conexión."}{" "}
          Lo ya subido se guarda aquí {DIAS_COPIA} días como copia.
        </p>
      </section>
    </div>
  );
}
