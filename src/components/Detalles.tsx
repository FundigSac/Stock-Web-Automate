import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useMemo, useState } from "react";
import { entregasDe, estadoDe, movimientosDe, type GrupoProducto } from "../lib/derive";
import { entero, etiquetaTalla, fechaLarga, nombreProducto, nombreTallaEn, partirMovimiento, titulo } from "../lib/format";
import type { Datos } from "../lib/types";
import { cn } from "../lib/utils";
import { MiniFoto, VisorFoto } from "./Evidencia";
import { EstadoBadge, Tabla, presion, td, th } from "./ui";
import { Ventana } from "./Ventana";

const encabezado = "mt-6 text-[18px] font-semibold leading-[26px]";
const proposito = "mb-4 text-[16px] leading-6 text-muted";

export function VentanaProducto({
  grupo,
  datos,
  minimo,
  alCerrar,
  editor,
  alRegistrar,
}: {
  grupo: GrupoProducto | null;
  datos: Datos;
  minimo: number;
  alCerrar: () => void;
  editor: boolean;
  alRegistrar: (tipo: "entrada" | "salida", g: GrupoProducto) => void;
}) {
  const [foto, setFoto] = useState<string | null>(null);
  const movs = useMemo(() => {
    if (!grupo) return [];
    const codigos = new Set(grupo.tallas.map((t) => t.codigo));
    return movimientosDe(datos).filter((m) => m.codigo && codigos.has(m.codigo));
  }, [grupo, datos]);

  if (!grupo) return null;
  // Usa los datos mas recientes de cada talla (el grupo guardado puede haber quedado viejo).
  const tallas = datos.stock.filter((s) => s.empresa === grupo.empresa && s.producto === grupo.producto).sort(
    (a, b) => grupo.tallas.findIndex((t) => t.codigo === a.codigo) - grupo.tallas.findIndex((t) => t.codigo === b.codigo),
  );
  const unidades = tallas.reduce((a, t) => a + Math.max(0, t.queda), 0);

  return (
    <Ventana
      abierta
      alCerrar={alCerrar}
      titulo={nombreProducto(grupo.producto, grupo.empresa)}
      subtitulo={
        <>
          {titulo(grupo.empresa)}
          {grupo.genero ? ` · ${titulo(grupo.genero)}` : ""} · <b className="num text-ink">{entero(unidades)}</b> unidades en total
        </>
      }
    >
      <p className={proposito}>Cuánto queda de cada talla y todo lo que entró o salió de este producto.</p>
      {editor && (
        <div className="mb-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          {/* Mismo orden y colores que en Registrar: entregar es la acción principal. */}
          <button
            type="button"
            onClick={() => alRegistrar("salida", grupo)}
            className={cn("flex min-h-16 items-center justify-center gap-3 rounded-lg bg-action px-4 text-[18px] font-semibold text-white hover:bg-ink-2", presion)}
          >
            <ArrowUpFromLine className="size-6" aria-hidden /> Entregar
          </button>
          <button
            type="button"
            onClick={() => alRegistrar("entrada", grupo)}
            className={cn("flex min-h-16 items-center justify-center gap-3 rounded-lg border-2 border-action bg-surface px-4 text-[18px] font-semibold text-action hover:bg-ground", presion)}
          >
            <ArrowDownToLine className="size-6" aria-hidden /> Ingresar
          </button>
        </div>
      )}
      <h3 className="text-[18px] font-semibold leading-[26px]">Por talla</h3>
      {/* En el celular cada talla es una fila: el estado se ve completo sin desplazar de lado. */}
      <ul className="mt-2 divide-y divide-line-2 overflow-hidden rounded-lg border border-line sm:hidden" aria-label="Detalle por talla">
        {tallas.map((t) => (
          <li key={t.codigo} className="flex min-h-16 items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-left text-[18px] font-semibold leading-6">{etiquetaTalla(nombreTallaEn(t.talla, tallas))}</p>
              <p className="num text-left text-[14px] leading-5 text-muted">
                Entró +{entero(t.entro)} · Salió −{entero(t.salio)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <p className="num text-right text-[16px] leading-6 text-muted">
                Queda <b className="text-[20px] text-ink">{entero(t.queda)}</b>
              </p>
              <EstadoBadge estado={estadoDe(t.queda, minimo)} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 hidden sm:block">
        <Tabla etiqueta="Detalle por talla" minAncho={300}>
          <thead className="border-b border-line-2">
            <tr>
              <th className={th} scope="col">Talla</th>
              <th className={cn(th, "hidden sm:table-cell")} scope="col">Código</th>
              <th className={cn(th, "hidden text-right sm:table-cell")} scope="col">Inicio</th>
              <th className={cn(th, "text-right")} scope="col">Entró</th>
              <th className={cn(th, "text-right")} scope="col">Salió</th>
              <th className={cn(th, "text-right")} scope="col">Queda</th>
              <th className={th} scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            {tallas.map((t) => (
              <tr key={t.codigo} className="border-b border-line-2 last:border-0">
                <td className={cn(td, "font-semibold")}>{nombreTallaEn(t.talla, tallas)}</td>
                <td className={cn(td, "num hidden text-[14px] text-muted sm:table-cell")}>{t.codigo}</td>
                <td className={cn(td, "num hidden text-right sm:table-cell")}>{entero(t.tenia_al_inicio)}</td>
                <td className={cn(td, "num text-right")}>+{entero(t.entro)}</td>
                <td className={cn(td, "num text-right")}>−{entero(t.salio)}</td>
                <td className={cn(td, "num text-right text-[18px] font-semibold")}>{entero(t.queda)}</td>
                <td className={td}>
                  <EstadoBadge estado={estadoDe(t.queda, minimo)} />
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </div>

      <h3 className={encabezado}>Historial de este producto</h3>
      {movs.length === 0 ? (
        <p className="mt-2 rounded-lg bg-ground px-4 py-5 text-center text-[16px] text-muted">Todavía no hay entradas ni salidas de este producto.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-2">
          {movs.slice(0, 40).map((m) => (
            <li key={m.key} className="flex min-h-16 items-center gap-3 py-2 text-[16px] leading-6">
              <span className="w-24 shrink-0 text-left text-[14px] leading-5 text-muted">{m.fecha ? fechaLarga(m.fecha) : "Sin fecha"}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 font-semibold [overflow-wrap:anywhere]">
                  {m.tipo === "entrada" ? "Entrada" : "Salida"}
                  {m.persona ? ` · ${titulo(m.persona)}` : ""}
                </span>
                <span className="block truncate text-[14px] leading-5 text-muted">
                  {partirMovimiento(m.producto).talla ? etiquetaTalla(partirMovimiento(m.producto).talla) : m.codigo}
                  {m.nota ? ` · ${m.nota}` : ""}
                </span>
              </span>
              {m.foto && <MiniFoto ruta={m.foto} onAbrir={setFoto} className="size-14" />}
              <b className={cn("num w-12 text-right text-[18px]", m.tipo === "salida" && "text-red")}>
                {m.tipo === "entrada" ? "+" : "−"}
                {entero(m.cantidad)}
              </b>
            </li>
          ))}
        </ul>
      )}
      <VisorFoto ruta={foto} titulo="Evidencia de entrega" alCerrar={() => setFoto(null)} />
    </Ventana>
  );
}

export function VentanaTrabajador({
  nombre,
  datos,
  alCerrar,
}: {
  nombre: string | null;
  datos: Datos;
  alCerrar: () => void;
}) {
  const [foto, setFoto] = useState<string | null>(null);
  const t = datos.trabajadores.find((x) => x.trabajador === nombre) ?? null;
  const entregas = useMemo(() => entregasDe(datos.salidas, nombre), [datos.salidas, nombre]);
  if (!nombre || !t) return null;

  return (
    <Ventana
      abierta
      alCerrar={alCerrar}
      titulo={titulo(t.trabajador)}
      subtitulo={
        <>
          {titulo(t.area ?? "Sin área")} · <b className="num text-ink">{entero(t.prendas_recibidas)}</b> unidades recibidas
          {t.ultima_entrega ? ` · última entrega ${fechaLarga(t.ultima_entrega)}` : ""}
        </>
      }
    >
      <p className={proposito}>Lo que recibió esta persona, con la foto de cada entrega.</p>
      <h3 className="text-[18px] font-semibold leading-[26px]">Entregas registradas</h3>
      {entregas.length === 0 ? (
        <p className="mt-2 rounded-lg bg-ground px-4 py-5 text-center text-[16px] text-muted">Esta persona todavía no tiene entregas registradas.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-2">
          {entregas.map((s) => (
            <li key={s.id} className="flex min-h-16 items-center gap-3 py-2 text-[16px] leading-6">
              <span className="w-24 shrink-0 text-left text-[14px] leading-5 text-muted">{fechaLarga(s.fecha)}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 font-semibold [overflow-wrap:anywhere]">{partirMovimiento(s.producto).nombre ? nombreProducto(partirMovimiento(s.producto).nombre) : s.codigo}</span>
                {partirMovimiento(s.producto).talla && <span className="block text-[14px] leading-5 text-muted">{etiquetaTalla(partirMovimiento(s.producto).talla)}</span>}
              </span>
              {s.foto_path && <MiniFoto ruta={s.foto_path} onAbrir={setFoto} className="size-14" />}
              <b className="num w-12 text-right text-[18px]">{entero(s.cantidad)}</b>
            </li>
          ))}
        </ul>
      )}
      <VisorFoto ruta={foto} titulo="Evidencia de entrega" detalle={t ? titulo(t.trabajador) : undefined} alCerrar={() => setFoto(null)} />
    </Ventana>
  );
}
