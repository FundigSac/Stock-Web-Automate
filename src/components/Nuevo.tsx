import { Loader2, Minus, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { entero, nombreProducto, titulo } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { StockItem, Trabajador } from "../lib/types";
import { cn } from "../lib/utils";
import { CampoAutor, estiloCampo, etiquetaCampo } from "./CampoAutor";
import { Boton, Chip, Ventana } from "./ui";

const mensaje = (e: { message?: string }, otro: string) =>
  e.message && !/fetch|network/i.test(e.message) ? e.message : otro;

const GRUPOS_TALLA: { texto: string; tallas: string[] }[] = [
  { texto: "Ropa", tallas: ["S", "M", "L", "XL", "XXL"] },
  { texto: "Pantalón", tallas: ["28", "30", "32", "34", "36", "38"] },
  { texto: "Calzado", tallas: ["38", "39", "40", "41", "42", "43", "44"] },
  { texto: "Sin talla", tallas: ["ÚNICA"] },
];

type Comun = {
  abierto: boolean;
  alCerrar: () => void;
  avisar: (texto: string, error?: boolean) => void;
  autor: string;
  setAutor: (v: string) => void;
  pedirAutor: boolean;
};

export function NuevoProductoDialog({
  abierto,
  alCerrar,
  avisar,
  autor,
  setAutor,
  pedirAutor,
  stock,
  inicial,
  alCrear,
}: Comun & {
  stock: StockItem[];
  inicial: { nombre?: string; empresa?: string } | null;
  alCrear: (r: { empresa: string; producto: string }) => void;
}) {
  const empresas = useMemo(() => Array.from(new Set(stock.map((s) => s.empresa))).sort((a, b) => a.localeCompare(b, "es")), [stock]);
  const [empresa, setEmpresa] = useState("");
  const [otra, setOtra] = useState(false);
  const [nombre, setNombre] = useState("");
  const [genero, setGenero] = useState("");
  const [tallas, setTallas] = useState<string[]>([]);
  const [cants, setCants] = useState<Record<string, string>>({});
  const [propia, setPropia] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setEmpresa(inicial?.empresa && inicial.empresa !== "TODAS" ? inicial.empresa : "");
    setOtra(false);
    setNombre(inicial?.nombre ?? "");
    setGenero("");
    setTallas([]);
    setCants({});
    setPropia("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const emp = empresa.trim().toUpperCase();
  const nom = nombre.trim();
  const yaExiste = useMemo(
    () => emp && nom && stock.some((s) => s.empresa === emp && nombreProducto(s.producto, s.empresa).toLowerCase() === nombreProducto(nom, emp).toLowerCase()),
    [stock, emp, nom],
  );
  const cantidades = tallas.map((t) => Math.max(0, Number.parseInt(cants[t] ?? "0", 10) || 0));
  const unidades = cantidades.reduce((a, b) => a + b, 0);
  const valido = emp.length >= 2 && nom.length >= 3 && tallas.length > 0 && (!pedirAutor || autor.trim().length >= 2);

  const alternar = (t: string) => setTallas((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]));
  function agregarPropia() {
    const t = propia.trim().toUpperCase();
    if (!t) return;
    setTallas((a) => (a.includes(t) ? a : [...a, t]));
    setPropia("");
  }
  const ponerCant = (t: string, v: string) => setCants((c) => ({ ...c, [t]: v.replace(/[^\d]/g, "").slice(0, 6) }));

  async function crear(ev: FormEvent) {
    ev.preventDefault();
    if (!valido) return;
    setEnviando(true);
    setError(null);
    const { error: e } = await supabase.rpc("crear_producto", {
      p_quien: autor.trim(),
      p_empresa: emp,
      p_nombre: nom,
      p_genero: genero || null,
      p_tallas: tallas,
      p_cantidades: cantidades,
    });
    setEnviando(false);
    if (e) {
      setError(mensaje(e, "No se pudo crear el producto. Revisa tu conexión e inténtalo de nuevo."));
      return;
    }
    avisar(`Producto creado: ${titulo(nom)}${unidades > 0 ? ` · ${entero(unidades)} unidades` : ""}`);
    alCrear({ empresa: emp, producto: nom.toUpperCase() });
    alCerrar();
  }

  return (
    <Ventana
      abierta={abierto}
      alCerrar={alCerrar}
      titulo="Producto nuevo"
      subtitulo="Créalo una vez y ya queda disponible para registrar."
      pie={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="rounded-xl bg-red-soft px-3.5 py-2.5 text-[13px] font-medium text-red">
              {error}
            </p>
          )}
          <Boton type="submit" form="producto-form" variante="ink" className="h-12 w-full" disabled={!valido || enviando}>
            {enviando && <Loader2 className="size-4 animate-spin" />} Crear producto
          </Boton>
        </div>
      }
    >
      <form id="producto-form" onSubmit={crear} className="space-y-6">
        {pedirAutor && <CampoAutor id="np-autor" autor={autor} setAutor={setAutor} />}

        <div>
          <p className={etiquetaCampo}>1. ¿De qué empresa es?</p>
          <div className="flex flex-wrap gap-2">
            {empresas.map((e) => (
              <Chip
                key={e}
                activo={!otra && empresa === e}
                onClick={() => {
                  setOtra(false);
                  setEmpresa(e);
                }}
              >
                {titulo(e)}
              </Chip>
            ))}
            <Chip
              activo={otra}
              onClick={() => {
                setOtra(true);
                setEmpresa("");
              }}
            >
              <Plus className="size-3.5" /> Otra empresa
            </Chip>
          </div>
          {otra && (
            <input
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              maxLength={40}
              placeholder="Nombre de la empresa"
              aria-label="Nombre de la empresa"
              className={cn(estiloCampo, "mt-3")}
            />
          )}
        </div>

        <div>
          <label htmlFor="np-nombre" className={etiquetaCampo}>
            2. ¿Cómo se llama el producto?
          </label>
          <input
            id="np-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={80}
            autoComplete="off"
            placeholder="Ej: Casaca drill azul"
            className={estiloCampo}
          />
          <p className="mt-1.5 text-[12px] text-faint">Escribe el tipo y el color. Sin la empresa: ya la elegiste arriba.</p>
          {yaExiste && (
            <p className="mt-2 rounded-xl bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">
              Ya existe «{nombreProducto(nom, emp)}» en {titulo(emp)}. Aquí solo se agregan tallas que le falten; para sumar unidades usa «Registrar».
            </p>
          )}
        </div>

        <div>
          <p className={etiquetaCampo}>3. ¿Para quién es? (opcional)</p>
          <div className="flex flex-wrap gap-2">
            {[
              ["", "No importa"],
              ["HOMBRE", "Hombre"],
              ["MUJER", "Mujer"],
              ["UNISEX", "Unisex"],
            ].map(([v, t]) => (
              <Chip key={v} activo={genero === v} onClick={() => setGenero(v)}>
                {t}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <p className={etiquetaCampo}>4. ¿En qué tallas viene?</p>
          <div className="space-y-3">
            {GRUPOS_TALLA.map((g) => (
              <div key={g.texto}>
                <p className="mb-1.5 text-[11.5px] font-semibold text-faint">{g.texto}</p>
                <div className="flex flex-wrap gap-2">
                  {g.tallas.map((t) => (
                    <Chip key={`${g.texto}-${t}`} activo={tallas.includes(t)} onClick={() => alternar(t)}>
                      {t === "ÚNICA" ? "Talla única" : t}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                value={propia}
                onChange={(e) => setPropia(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    agregarPropia();
                  }
                }}
                maxLength={24}
                placeholder="¿Otra talla? Escríbela (ej: 3XL, 10)"
                aria-label="Otra talla"
                className={cn(estiloCampo, "h-11")}
              />
              <Boton type="button" className="h-11 shrink-0" onClick={agregarPropia} disabled={!propia.trim()}>
                Agregar
              </Boton>
            </div>
          </div>
        </div>

        {tallas.length > 0 && (
          <div>
            <p className={etiquetaCampo}>5. ¿Cuántas unidades tienes ahora de cada talla? (opcional)</p>
            <ul className="divide-y divide-line-2 overflow-hidden rounded-2xl border border-line">
              {tallas.map((t, i) => (
                <li key={t} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{t === "ÚNICA" ? "Talla única" : `Talla ${t}`}</span>
                  <div className="flex h-10 items-stretch overflow-hidden rounded-xl border border-line focus-within:border-ink">
                    <button
                      type="button"
                      aria-label={`Quitar una unidad de ${t}`}
                      onClick={() => ponerCant(t, String(Math.max(0, cantidades[i] - 1)))}
                      className="grid w-10 place-items-center text-muted transition hover:bg-ground hover:text-ink"
                    >
                      <Minus className="size-4" />
                    </button>
                    <input
                      inputMode="numeric"
                      aria-label={`Unidades de la talla ${t}`}
                      value={cants[t] ?? ""}
                      placeholder="0"
                      onChange={(e) => ponerCant(t, e.target.value)}
                      className="num w-12 bg-transparent text-center text-[15px] font-semibold outline-none"
                    />
                    <button
                      type="button"
                      aria-label={`Agregar una unidad de ${t}`}
                      onClick={() => ponerCant(t, String(cantidades[i] + 1))}
                      className="grid w-10 place-items-center text-muted transition hover:bg-ground hover:text-ink"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={`Quitar la talla ${t}`}
                    onClick={() => alternar(t)}
                    className="grid size-8 place-items-center rounded-lg text-faint transition hover:bg-ground hover:text-ink"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {valido && (
          <p className="rounded-xl bg-ground px-3.5 py-3 text-[13px] leading-relaxed text-muted">
            Se creará <b className="text-ink">{nombreProducto(nom, emp)}</b> en <b className="text-ink">{titulo(emp)}</b> con {tallas.length}{" "}
            {tallas.length === 1 ? "talla" : "tallas"}
            {unidades > 0 ? (
              <>
                {" "}
                y se anotará una entrada de <b className="num text-ink">{entero(unidades)}</b> unidades como stock inicial.
              </>
            ) : (
              <>. Empezará en 0 unidades; luego registras las entradas.</>
            )}
          </p>
        )}

      </form>
    </Ventana>
  );
}

export function NuevoTrabajadorDialog({
  abierto,
  alCerrar,
  avisar,
  autor,
  setAutor,
  pedirAutor,
  trabajadores,
  inicial,
  alCrear,
}: Comun & {
  trabajadores: Trabajador[];
  /** Lo que la persona ya había escrito en el buscador. */
  inicial: string;
  alCrear: (nombreCompleto: string) => void;
}) {
  const areas = useMemo(
    () => Array.from(new Set(trabajadores.map((t) => t.area).filter((a): a is string => Boolean(a)))).sort((a, b) => a.localeCompare(b, "es")),
    [trabajadores],
  );
  const [nombres, setNombres] = useState("");
  const [apellidos, setApellidos] = useState("");
  const [area, setArea] = useState("");
  const [genero, setGenero] = useState("");
  const [otra, setOtra] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setGenero("");
    // Si ya escribió "Juan Perez" en el buscador, se reparte entre nombres y apellidos.
    const partes = inicial.trim().split(/\s+/).filter(Boolean);
    setNombres(partes.length > 1 ? partes.slice(0, Math.ceil(partes.length / 2)).join(" ") : (partes[0] ?? ""));
    setApellidos(partes.length > 1 ? partes.slice(Math.ceil(partes.length / 2)).join(" ") : "");
    setArea("");
    setOtra(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const completo = `${nombres.trim()} ${apellidos.trim()}`.trim().toUpperCase();
  const repetido = trabajadores.some((t) => t.trabajador.toUpperCase() === completo);
  const valido = nombres.trim().length >= 2 && !repetido && (!pedirAutor || autor.trim().length >= 2);

  async function crear(ev: FormEvent) {
    ev.preventDefault();
    if (!valido) return;
    setEnviando(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("crear_trabajador", {
      p_quien: autor.trim(),
      p_nombres: nombres.trim(),
      p_apellidos: apellidos.trim(),
      p_area: area.trim() || null,
      p_genero: genero || null,
    });
    setEnviando(false);
    if (e) {
      setError(mensaje(e, "No se pudo agregar. Revisa tu conexión e inténtalo de nuevo."));
      return;
    }
    const nombre = (data as { trabajador: string } | null)?.trabajador ?? completo;
    avisar(`Trabajador agregado: ${titulo(nombre)}`);
    alCrear(nombre);
    alCerrar();
  }

  return (
    <Ventana
      abierta={abierto}
      alCerrar={alCerrar}
      titulo="Trabajador nuevo"
      subtitulo="Aparecerá en la lista al registrar una salida."
      pie={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="rounded-xl bg-red-soft px-3.5 py-2.5 text-[13px] font-medium text-red">
              {error}
            </p>
          )}
          <Boton type="submit" form="trabajador-form" variante="ink" className="h-12 w-full" disabled={!valido || enviando}>
            {enviando && <Loader2 className="size-4 animate-spin" />} Agregar trabajador
          </Boton>
        </div>
      }
    >
      <form id="trabajador-form" onSubmit={crear} className="space-y-5">
        {pedirAutor && <CampoAutor id="nt-autor" autor={autor} setAutor={setAutor} />}
        <div className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-2">
          <div>
            <label htmlFor="nt-nombres" className={etiquetaCampo}>
              Nombres
            </label>
            <input id="nt-nombres" value={nombres} onChange={(e) => setNombres(e.target.value)} maxLength={60} autoComplete="off" placeholder="Ej: Juan Carlos" className={estiloCampo} />
          </div>
          <div>
            <label htmlFor="nt-apellidos" className={etiquetaCampo}>
              Apellidos
            </label>
            <input id="nt-apellidos" value={apellidos} onChange={(e) => setApellidos(e.target.value)} maxLength={60} autoComplete="off" placeholder="Ej: Pérez Ruiz" className={estiloCampo} />
          </div>
        </div>
        <div>
          <p className={etiquetaCampo}>¿Hombre o mujer? (para filtrar los productos)</p>
          <div className="flex flex-wrap gap-2">
            {[
              ["HOMBRE", "Hombre"],
              ["MUJER", "Mujer"],
            ].map(([v, t]) => (
              <Chip key={v} activo={genero === v} onClick={() => setGenero(v)}>
                {t}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <p className={etiquetaCampo}>Área</p>
          <div className="flex flex-wrap gap-2">
            {areas.map((a) => (
              <Chip
                key={a}
                activo={!otra && area === a}
                onClick={() => {
                  setOtra(false);
                  setArea(a);
                }}
              >
                {titulo(a)}
              </Chip>
            ))}
            <Chip
              activo={otra}
              onClick={() => {
                setOtra(true);
                setArea("");
              }}
            >
              <Plus className="size-3.5" /> Otra área
            </Chip>
          </div>
          {otra && <input value={area} onChange={(e) => setArea(e.target.value)} maxLength={40} placeholder="Nombre del área" aria-label="Nombre del área" className={cn(estiloCampo, "mt-3")} />}
        </div>
        {repetido && <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">{titulo(completo)} ya está en la lista.</p>}
      </form>
    </Ventana>
  );
}
