import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { entregasDe, estadoDe, estadoProducto, movimientosDe, textoEstadoProducto, type GrupoProducto } from "../lib/derive";
import { entero, etiquetaTalla, fechaLarga, nombreProducto, nombreTallaEn, partirMovimiento, titulo } from "../lib/format";
import type { Datos } from "../lib/types";
import { cn } from "../lib/utils";
import { MiniFoto, VisorFoto } from "./Evidencia";
import { CantidadMov, EstadoBadge, Kicker, MarcaAnulado, Tabla, Ventana, td, th } from "./ui";

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
    // Las anuladas también se ven, marcadas: explican por qué el saldo no cuadra con lo que se recuerda.
    return movimientosDe(datos, true).filter((m) => m.codigo && codigos.has(m.codigo));
  }, [grupo, datos]);

  if (!grupo) return null;
  // Usa los datos mas recientes de cada talla (el grupo guardado puede haber quedado viejo).
  const tallas = datos.stock.filter((s) => s.empresa === grupo.empresa && s.producto === grupo.producto).sort(
    (a, b) => grupo.tallas.findIndex((t) => t.codigo === a.codigo) - grupo.tallas.findIndex((t) => t.codigo === b.codigo),
  );
  const unidades = tallas.reduce((a, t) => a + Math.max(0, t.queda), 0);
  const ep = estadoProducto(tallas, minimo);

  return (
    <Ventana
      abierta
      alCerrar={alCerrar}
      titulo={nombreProducto(grupo.producto, grupo.empresa)}
      subtitulo={
        <>
          {titulo(grupo.empresa)}
          {grupo.genero ? ` · ${titulo(grupo.genero)}` : ""} · <b className="num text-ink">{entero(unidades)}</b> unidades en total
          <span className="mt-2 block">
            <EstadoBadge estado={ep.estado} texto={textoEstadoProducto(ep)} />
          </span>
        </>
      }
    >
      {editor && (
        <div className="mb-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => alRegistrar("entrada", grupo)}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-ink text-[14px] font-semibold text-white transition active:scale-[0.98]"
          >
            <Plus className="size-4" /> Agregar stock
          </button>
          <button
            type="button"
            onClick={() => alRegistrar("salida", grupo)}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-red text-[14px] font-semibold text-white transition active:scale-[0.98]"
          >
            <Minus className="size-4" /> Dar salida
          </button>
        </div>
      )}
      <Kicker>Por talla</Kicker>
      <div className="mt-2">
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
                <td className={cn(td, "text-[13.5px] font-semibold")}>{nombreTallaEn(t.talla, tallas)}</td>
                <td className={cn(td, "num hidden text-[12px] text-muted sm:table-cell")}>{t.codigo}</td>
                <td className={cn(td, "num hidden text-right text-[13px] sm:table-cell")}>{entero(t.tenia_al_inicio)}</td>
                <td className={cn(td, "num text-right text-[13px]")}>+{entero(t.entro)}</td>
                <td className={cn(td, "num text-right text-[13px]")}>−{entero(t.salio)}</td>
                <td className={cn(td, "num text-right text-[15px] font-semibold")}>{entero(t.queda)}</td>
                <td className={td}>
                  <EstadoBadge estado={estadoDe(t.queda, minimo)} />
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </div>

      <Kicker className="mt-6">Historial de este producto</Kicker>
      {movs.length === 0 ? (
        <p className="mt-2 rounded-2xl bg-ground px-4 py-5 text-center text-[13px] text-muted">
          Todavía no hay entradas ni salidas de este producto.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line-2">
          {movs.slice(0, 40).map((m) => (
            <li key={m.key} className={cn("flex items-center gap-3 py-2.5 text-[13px]", m.anulado && "text-muted")}>
              <span className="w-24 shrink-0 text-muted">{m.fecha ? fechaLarga(m.fecha) : "Sin fecha"}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate", m.anulado && "line-through")}>
                  {m.tipo === "entrada" ? "Entrada" : "Salida"}
                  {m.persona ? ` · ${titulo(m.persona)}` : ""}
                </span>
                <span className="block truncate text-[11.5px] text-faint">
                  {partirMovimiento(m.producto).talla ? etiquetaTalla(partirMovimiento(m.producto).talla) : m.codigo}
                  {m.nota ? ` · ${m.nota}` : ""}
                </span>
                {m.anulado && <MarcaAnulado className="mt-1" />}
              </span>
              {m.foto && <MiniFoto ruta={m.foto} onAbrir={setFoto} className="size-10" />}
              <CantidadMov tipo={m.tipo} cantidad={m.cantidad} anulado={m.anulado} className="min-w-12 justify-end" />
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
  const entregas = useMemo(() => entregasDe(datos.salidas, nombre, true), [datos.salidas, nombre]);
  if (!nombre || !t) return null;

  return (
    <Ventana
      abierta
      alCerrar={alCerrar}
      titulo={titulo(t.trabajador)}
      subtitulo={
        <>
          {titulo(t.area ?? "Sin área")} · <b className="num text-ink">{entero(t.prendas_recibidas)}</b> unidades recibidas · última entrega{" "}
          {fechaLarga(t.ultima_entrega)}
        </>
      }
    >
      <Kicker>Entregas registradas</Kicker>
      {entregas.length === 0 ? (
        <p className="mt-2 rounded-2xl bg-ground px-4 py-5 text-center text-[13px] text-muted">
          Esta persona todavía no tiene entregas registradas.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line-2">
          {entregas.map((s) => (
            <li key={s.id} className={cn("flex items-center gap-3 py-2.5 text-[13px]", s.anulado && "text-muted")}>
              <span className="w-24 shrink-0 text-muted">{fechaLarga(s.fecha)}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate", s.anulado && "line-through")}>{partirMovimiento(s.producto).nombre ? nombreProducto(partirMovimiento(s.producto).nombre) : s.codigo}</span>
                {partirMovimiento(s.producto).talla && <span className="block text-[11.5px] text-faint">{etiquetaTalla(partirMovimiento(s.producto).talla)}</span>}
                {s.anulado && <MarcaAnulado className="mt-1" />}
              </span>
              {s.foto_path && <MiniFoto ruta={s.foto_path} onAbrir={setFoto} className="size-10" />}
              <CantidadMov tipo="salida" cantidad={s.cantidad} anulado={s.anulado} className="min-w-12 justify-end" />
            </li>
          ))}
        </ul>
      )}
      <VisorFoto ruta={foto} titulo="Evidencia de entrega" detalle={t ? titulo(t.trabajador) : undefined} alCerrar={() => setFoto(null)} />
    </Ventana>
  );
}
