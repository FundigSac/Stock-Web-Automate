// Asistente de stock con IA (Claude Haiku 5.5).
// La clave de Anthropic vive en el Vault de Supabase: el navegador nunca la ve.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODELO = "claude-haiku-5-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const HERRAMIENTA = {
  name: "responder",
  description: "Respuesta al usuario y acciones de stock a realizar (siempre usa esta herramienta).",
  input_schema: {
    type: "object",
    properties: {
      mensaje: { type: "string", description: "Respuesta corta y clara en español para el usuario." },
      acciones: {
        type: "array",
        description: "Acciones a realizar. Vacío si solo respondes o si necesitas aclarar algo.",
        items: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["entrada", "salida", "pedido", "recibir_pedido", "cancelar_pedido", "anular_movimiento", "ver", "crear_producto", "crear_trabajador"] },
            trabajador: { type: "string", description: "Para salidas: nombre completo EXACTO del trabajador de la lista, o el nombre del cliente si no es trabajador." },
            items: {
              type: "array",
              description: "Líneas con CÓDIGO EXACTO del catálogo y cantidad.",
              items: { type: "object", properties: { codigo: { type: "string" }, cantidad: { type: "integer" } }, required: ["codigo", "cantidad"] },
            },
            pedido_ids: { type: "array", items: { type: "integer" } },
            cantidad_recibida: { type: "integer" },
            movimiento: { type: "object", properties: { tipo: { type: "string", enum: ["entrada", "salida"] }, id: { type: "integer" } }, required: ["tipo", "id"] },
            ver: { type: "string", enum: ["por_agotarse", "sin_stock", "pedidos_pendientes", "resumen"] },
            nombre: { type: "string", description: "Nombre del producto o trabajador a crear." },
          },
          required: ["tipo"],
        },
      },
      aclarar: {
        type: "object",
        description: "Úsalo cuando falte un dato imprescindible (talla, cantidad, empresa, tipo de producto, a quién...). No registres nada hasta que lo aclaren.",
        properties: { pregunta: { type: "string" }, opciones: { type: "array", items: { type: "string" }, description: "Máximo 8 opciones cortas que el usuario puede pulsar." } },
        required: ["pregunta"],
      },
    },
    required: ["mensaje", "acciones"],
  },
};

const SISTEMA = `Eres el asistente de un sistema de control de stock de EPP y uniformes de la empresa FUNDIGSAC (empresas: FUNDIGSAC, COSEGEN, M&L, POLO IMPORTADO y SEGURIDAD ALMACÉN).
Hablas español claro y breve. Las personas escriben rápido y con faltas de ortografía: entiende lo que quisieron decir.

QUÉ PUEDES HACER (siempre respondes llamando a la herramienta "responder"):
- entrada: llegó mercadería al almacén (suma stock).
- salida: se entregó o vendió algo a un trabajador o cliente (resta stock). Necesita "trabajador".
- pedido: se pide mercadería al proveedor (no cambia el stock hasta que llegue).
- recibir_pedido / cancelar_pedido: usa los ids de la lista de PEDIDOS PENDIENTES.
- anular_movimiento: solo con un id de la lista de ÚLTIMOS MOVIMIENTOS (por ejemplo "anula lo último" = el movimiento más reciente).
- ver: por_agotarse, sin_stock, pedidos_pendientes o resumen (la app mostrará la lista completa).
- crear_producto / crear_trabajador: cuando piden algo que no existe, con el nombre.

REGLAS IMPORTANTES:
1. Usa SOLO códigos del CATÁLOGO. Nunca inventes códigos ni cantidades.
2. Si un dato imprescindible falta o hay varias opciones posibles (tipo de producto, talla, empresa, cantidad, a quién), NO registres: usa "aclarar" con opciones cortas. Ejemplo: dicen "polo" y hay varios tipos o empresas -> pregunta cuál.
3. GÉNERO: si el trabajador tiene género (HOMBRE o MUJER) solo ofrece productos de ese género o UNISEX. Nunca ofrezcas ropa del otro género. Si no existe ese producto para ese género, dilo y ofrece lo que sí hay para ese género.
4. Una frase puede traer varios productos: devuelve varias líneas o varias acciones.
5. "C/F" significa "con Fundigsac" y "S/F" "sin Fundigsac" (variantes de pantalón jean). Las tallas pueden ser S, M, L, XL, números (28, 30, 32...) o ÚNICA.
6. Cuando te pasen una FOTO, PDF, Excel, Word o texto de un documento, cuaderno o lista (si trae "CONTENIDO DEL ARCHIVO", ya es la tabla leída): lee TODAS las filas y conviértelas en acciones (cada fila un movimiento individual). Lo que no puedas leer o no encuentres en el catálogo, avísalo en "mensaje" y no lo inventes.
7. Si solo saludan o preguntan algo general, responde en "mensaje" sin acciones.
8. Cantidades: enteros positivos. "un/una" = 1. Números escritos con letras ("cinco") también cuentan.
9. No hables de códigos internos en "mensaje": usa nombres de producto, talla y empresa.
10. TODA pregunta al usuario va en "aclarar" con "opciones" pulsables (nombres reales de producto/empresa/trabajador/talla del catálogo, máximo 8). "mensaje" nunca lleva la pregunta, solo un resumen corto de lo entendido.
11. DOCUMENTO CON FOTO: si es una lista de entregas o cambios a trabajadores, cada fila es una "salida" (agrupa las filas del mismo trabajador en una sola acción con varios items). Si es una guía de ingreso o compra, son "entrada". Si no se puede saber cuál es, pregunta con "aclarar" y opciones ["Son entregas (salidas)", "Es mercadería que llegó (entradas)"]. Si en una fila no se lee la talla o hay varios productos posibles, no la adivines: déjala fuera y menciónala en "mensaje" (qué fila y por qué).
12. Para un nombre de trabajador, busca el más parecido de la lista aunque esté mal escrito (apellido o nombre); si hay dudas entre dos personas, pregunta con "aclarar".
14. FALTAS Y JERGA: entiende por significado, no por letras. Ejemplos: "poloo", "polp", "kamisero" = polo/camisero; "ml" = manga larga, "mc" = manga corta; "gantes", "guantez" = guantes; "xl", "equis ele", "extra grande" = XL; "mediana" = M, "grande" = L, "chica/pequeña" = S; "una docena" = 12; "media docena" = 6; "un par" = 2. Nombres de personas: aunque falten letras o esté solo el nombre o el apellido ("dieg", "karlita", "sr maza"), elige al más parecido de la lista.
15. ELEGIR SIN PREGUNTAR DE MÁS: si tras aplicar género, talla y tipo queda UNA sola opción en el catálogo, úsala sin preguntar. Pregunta solo cuando de verdad hay 2 o más opciones distintas (tipo de producto, empresa, color). Si hay opciones con stock y otras sin stock, ofrece primero las que tienen stock.
16. STOCK: para una salida revisa la columna "stock actual". Si piden más de lo que hay, igual arma la acción pero avisa en "mensaje" cuánto hay. Si el producto está en 0, dilo.
17. COLOR/TIPO: si dicen "camisero" sin color ni género y hay varios, pregunta el color (opciones reales del catálogo). Si el trabajador tiene género, nunca preguntes por el otro género.
18. EJEMPLOS DE aclarar: pregunta "¿Qué polo le entregaste a Diego?" con opciones ["Polo Manga Larga · Fundigsac · L (17)", "Polo Manga Larga · Cosegen · L (3)"]; pregunta "¿Cuántos?" con opciones ["1","2","3","5","10"].
19. REGLA DE ORO DE PREGUNTAS: si tu respuesta necesita que el usuario elija o escriba algo, SIEMPRE llena "aclarar" (con "opciones" cuando se pueda elegir). Si "acciones" está vacío y no es un saludo, una consulta de stock o una negativa, entonces falta un "aclarar": agrégalo. Nunca dejes una pregunta suelta en "mensaje".
20. PREGUNTAR EN PASOS: primero el producto (opciones SIN repetir por talla, con el stock total, ej. "Camisero Blanco Hombre · Fundigsac (22)"), después la talla (opciones = tallas que tienen stock, ej. "M (3)"). No mezcles producto y talla en la misma lista.
21. SIN PRODUCTO PARA ESE GÉNERO: si el producto pedido no existe para el género del trabajador, usa "aclarar" con opciones: los productos parecidos de ese género que sí existen (sin repetir tallas) y como última opción «Crear «nombre» para mujer/hombre».
22. CREAR: si piden agregar un trabajador o producto nuevo, devuelve la acción crear_trabajador o crear_producto con el nombre; la app abre el formulario donde se completan área, género, empresa y tallas. No preguntes esos datos tú.
13. Cuando devuelvas acciones de entrada/salida/pedido, NO las repitas en "mensaje" (la app ya muestra el resumen). Usa "mensaje" solo para avisar de lo que dejaste fuera o no se pudo leer (fila, motivo); si no hay nada que avisar, escribe solo "Revisa y confirma.".`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Mensaje no válido" }, 400);
  }
  const texto = String(body.texto ?? "").slice(0, 800).trim();
  const imagen = typeof body.imagen === "string" && body.imagen.length > 0 ? body.imagen : null;
  const tipoImg = body.media_type === "image/png" ? "image/png" : body.media_type === "application/pdf" ? "application/pdf" : "image/jpeg";
  const docTexto = typeof body.documento === "string" ? body.documento.slice(0, 60_000).trim() : "";
  const historial = Array.isArray(body.historial) ? (body.historial as { rol?: string; texto?: string }[]).slice(-8) : [];
  if (!texto && !imagen && !docTexto) return json({ error: "Escribe algo o manda una foto." }, 400);
  if (imagen && imagen.length > 7_000_000) return json({ error: "El archivo pesa demasiado." }, 413);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Limites para que nadie gaste la cuenta de IA
  const hace1m = new Date(Date.now() - 60_000).toISOString();
  const hace24h = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: porMin }, { count: porDia }] = await Promise.all([
    admin.from("ia_uso").select("id", { count: "exact", head: true }).gte("created_at", hace1m),
    admin.from("ia_uso").select("id", { count: "exact", head: true }).gte("created_at", hace24h),
  ]);
  if ((porMin ?? 0) >= 30) return json({ error: "Demasiadas consultas seguidas. Espera un momento." }, 429);
  if ((porDia ?? 0) >= 1500) return json({ error: "Se alcanzó el límite diario del asistente." }, 429);
  await admin.from("ia_uso").insert({ con_imagen: Boolean(imagen) });

  const { data: clave } = await admin.rpc("clave_anthropic");
  if (!clave) return json({ error: "El asistente no tiene la clave de IA configurada." }, 500);

  // Contexto real del negocio, leido aqui (el navegador no puede alterarlo)
  const [stock, personal, pedidos, entradas, salidas, ajustes] = await Promise.all([
    admin.from("stock_items").select("codigo,empresa,producto,talla,genero,queda").order("empresa").order("producto").limit(1000),
    admin.from("trabajadores").select("trabajador,area,genero").order("trabajador").limit(200),
    admin.from("pedidos").select("id,codigo,producto,cantidad,fecha,creado_por").eq("estado", "pendiente").order("id", { ascending: false }).limit(60),
    admin.from("entradas").select("id,fecha,codigo,producto,cantidad,creado_por,created_at").eq("anulado", false).order("id", { ascending: false }).limit(12),
    admin.from("salidas").select("id,fecha,codigo,producto,cantidad,trabajador_cliente,creado_por,created_at").eq("anulado", false).order("id", { ascending: false }).limit(12),
    admin.from("ajustes").select("stock_minimo,ia_reglas").eq("id", 1).maybeSingle(),
  ]);
  const catalogo = (stock.data ?? []) as { codigo: string; empresa: string; producto: string; talla: string | null; genero: string | null; queda: number }[];
  const codigos = new Set(catalogo.map((c) => c.codigo));
  const pedidosPend = (pedidos.data ?? []) as { id: number }[];
  const idsPedidos = new Set(pedidosPend.map((p) => p.id));
  const movs = [
    ...((entradas.data ?? []) as { id: number; created_at: string }[]).map((m) => ({ ...m, tipo: "entrada" })),
    ...((salidas.data ?? []) as { id: number; created_at: string }[]).map((m) => ({ ...m, tipo: "salida" })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15);
  const clavesMov = new Set(movs.map((m) => `${m.tipo}:${m.id}`));

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  const contexto = `\n\nCATÁLOGO (codigo|empresa|producto|talla|genero|stock actual):\n${catalogo
    .map((c) => `${c.codigo}|${c.empresa}|${c.producto}|${c.talla ?? "-"}|${c.genero ?? "-"}|${c.queda}`)
    .join("\n")}\n\nTRABAJADORES (nombre|area|genero):\n${((personal.data ?? []) as { trabajador: string; area: string | null; genero: string | null }[])
    .map((t) => `${t.trabajador}|${t.area ?? "-"}|${t.genero ?? "sin dato"}`)
    .join("\n")}`;
  const contextoVariable = `\n\nHOY: ${hoy}. STOCK MÍNIMO (por agotarse): ${ajustes.data?.stock_minimo ?? 2} unidades o menos.\n\nPEDIDOS PENDIENTES (id|codigo|producto|cantidad|fecha):\n${((pedidos.data ?? []) as { id: number; codigo: string; producto: string; cantidad: number; fecha: string }[])
    .map((p) => `${p.id}|${p.codigo}|${p.producto}|${p.cantidad}|${p.fecha}`)
    .join("\n") || "(ninguno)"}\n\nÚLTIMOS MOVIMIENTOS, del más reciente al más antiguo (tipo|id|codigo|producto|cantidad|trabajador|registró):\n${movs
    .map((m) => {
      const x = m as unknown as { tipo: string; id: number; codigo: string; producto: string; cantidad: number; trabajador_cliente?: string; creado_por?: string };
      return `${x.tipo}|${x.id}|${x.codigo}|${x.producto}|${x.cantidad}|${x.trabajador_cliente ?? "-"}|${x.creado_por ?? "-"}`;
    })
    .join("\n") || "(ninguno)"}`;

  // Conversacion reciente (alternando roles, empezando por el usuario)
  type Msg = { role: "user" | "assistant"; content: unknown };
  const mensajes: Msg[] = [];
  for (const h of historial) {
    const role = h.rol === "asistente" ? "assistant" : "user";
    const t = String(h.texto ?? "").slice(0, 500).trim();
    if (!t) continue;
    const ult = mensajes[mensajes.length - 1];
    if (ult && ult.role === role) ult.content = `${ult.content}\n${t}`;
    else mensajes.push({ role, content: t });
  }
  while (mensajes.length > 0 && mensajes[0].role !== "user") mensajes.shift();
  const actual: unknown[] = [];
  if (imagen) actual.push(tipoImg === "application/pdf" ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: imagen } } : { type: "image", source: { type: "base64", media_type: tipoImg, data: imagen } });
  if (docTexto) actual.push({ type: "text", text: `CONTENIDO DEL ARCHIVO (cada fila de una tabla va en una línea, columnas separadas por " | "):\n${docTexto}` });
  actual.push({ type: "text", text: texto || "Lee este documento y dime qué movimientos de stock contiene." });
  const previo = mensajes[mensajes.length - 1];
  if (previo && previo.role === "user") {
    // dos mensajes de usuario seguidos: se juntan en uno
    mensajes.pop();
    actual.unshift({ type: "text", text: String(previo.content) });
  }
  mensajes.push({ role: "user", content: actual });

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": String(clave), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 8000,
        system: [
          { type: "text", text: SISTEMA + (ajustes.data?.ia_reglas ? `\n${ajustes.data.ia_reglas}` : "") + contexto, cache_control: { type: "ephemeral" } },
          { type: "text", text: contextoVariable },
        ],
        tools: [HERRAMIENTA],
        tool_choice: { type: "tool", name: "responder" },
        messages: mensajes,
      }),
    });
  } catch (e) {
    console.error("anthropic fetch", e);
    return json({ error: "No pude conectar con la IA." }, 502);
  }
  if (!resp.ok) {
    const detalle = (await resp.text()).slice(0, 400);
    console.error("anthropic", resp.status, detalle);
    return json({ error: `La IA respondió con error (${resp.status}).`, detalle }, 502);
  }
  const data = await resp.json();
  const uso = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use") as { input?: Record<string, unknown> } | undefined;
  const salida = uso?.input;
  if (!salida) return json({ error: "La IA no devolvió una respuesta válida." }, 502);

  // Se validan los datos que devolvio la IA: solo codigos, pedidos y movimientos que existen
  type Accion = Record<string, unknown>;
  const acciones: Accion[] = [];
  for (const a of ((salida.acciones as Accion[]) ?? []).slice(0, 80)) {
    const tipo = String(a.tipo ?? "");
    if (["entrada", "salida", "pedido"].includes(tipo)) {
      const items = ((a.items as { codigo?: string; cantidad?: number }[]) ?? [])
        .filter((i) => i && codigos.has(String(i.codigo)) && Number.isInteger(i.cantidad) && (i.cantidad as number) > 0 && (i.cantidad as number) <= 100000)
        .slice(0, 40)
        .map((i) => ({ codigo: String(i.codigo), cantidad: i.cantidad as number }));
      if (items.length === 0) continue;
      if (tipo === "salida" && !String(a.trabajador ?? "").trim()) continue;
      acciones.push({ tipo, trabajador: a.trabajador ? String(a.trabajador).slice(0, 80) : undefined, items });
    } else if (tipo === "recibir_pedido" || tipo === "cancelar_pedido") {
      const ids = ((a.pedido_ids as number[]) ?? []).filter((i) => idsPedidos.has(i)).slice(0, 40);
      if (ids.length === 0) continue;
      acciones.push({ tipo, pedido_ids: ids, cantidad_recibida: Number.isInteger(a.cantidad_recibida) ? a.cantidad_recibida : undefined });
    } else if (tipo === "anular_movimiento") {
      const m = a.movimiento as { tipo?: string; id?: number } | undefined;
      if (m && clavesMov.has(`${m.tipo}:${m.id}`)) acciones.push({ tipo, movimiento: { tipo: m.tipo, id: m.id } });
    } else if (tipo === "ver") {
      if (["por_agotarse", "sin_stock", "pedidos_pendientes", "resumen"].includes(String(a.ver))) acciones.push({ tipo, ver: a.ver });
    } else if (tipo === "crear_producto" || tipo === "crear_trabajador") {
      acciones.push({ tipo, nombre: String(a.nombre ?? "").slice(0, 80) });
    }
  }
  const aclarar = salida.aclarar as { pregunta?: string; opciones?: string[] } | undefined;
  return json({
    mensaje: String(salida.mensaje ?? "").slice(0, 1500),
    acciones,
    aclarar: aclarar?.pregunta ? { pregunta: String(aclarar.pregunta).slice(0, 300), opciones: (aclarar.opciones ?? []).map((o) => String(o).slice(0, 90)).slice(0, 8) } : undefined,
  });
});
