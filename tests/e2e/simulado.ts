import type { BrowserContext, Route } from "@playwright/test";

/**
 * Datos simulados para las capturas y las pruebas de las ideas de diseño.
 * Nada de esto toca Supabase: todas las llamadas a la dirección local se responden aquí.
 */
export const SUPABASE = "http://127.0.0.1:54321";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

/** Fecha de hace `n` días en Lima, como la usa la app (AAAA-MM-DD). */
export function diaAtras(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(d);
}

const talla = (codigo: string, empresa: string, producto: string, t: string | null, queda: number, entro = 0, salio = 0) => ({
  codigo,
  empresa,
  producto,
  talla: t,
  genero: null,
  tenia_al_inicio: queda - entro + salio,
  entro,
  salio,
  queda,
  aviso: null,
  ultimo_movimiento: diaAtras(1),
});

export const STOCK = [
  talla("POLO-S", "FUNDIGSAC", "POLO AZUL", "S", 12, 12, 0),
  talla("POLO-M", "FUNDIGSAC", "POLO AZUL", "M", 2, 0, 3),
  talla("POLO-L", "FUNDIGSAC", "POLO AZUL", "L", 0, 0, 1),
  talla("PANT-30", "FUNDIGSAC", "PANTALON DRILL", "30", 8),
  talla("PANT-32", "FUNDIGSAC", "PANTALON DRILL", "32", 6),
  talla("PANT-34", "FUNDIGSAC", "PANTALON DRILL", "34", 5),
  talla("BOTA-40", "FUNDIGSAC", "BOTAS DE SEGURIDAD", "40", 1),
  talla("BOTA-41", "FUNDIGSAC", "BOTAS DE SEGURIDAD", "41", 4),
  talla("CASCO-U", "MINERA SUR", "CASCO BLANCO", null, 15),
  talla("GUANTE-U", "MINERA SUR", "GUANTES DE NITRILO", null, 0),
];

const base = { anulado: false, anulado_motivo: null, anulado_por: null, anulado_at: null, creado_por: "ana@fundigsac.pe", etiqueta: null, cambio_ref: null, client_id: null };

export const ENTRADAS = [
  { ...base, id: 1, fecha: diaAtras(1), codigo: "POLO-S", producto: "POLO AZUL  ·  Talla S", cantidad: 12, proveedor_nota: "Textil Lima", foto_path: null, created_at: `${diaAtras(1)}T15:00:00Z` },
  { ...base, id: 2, fecha: diaAtras(3), codigo: "BOTA-41", producto: "BOTAS DE SEGURIDAD  ·  Talla 41", cantidad: 4, proveedor_nota: null, foto_path: null, created_at: `${diaAtras(3)}T14:00:00Z` },
];

export const SALIDAS = [
  { ...base, id: 1, fecha: diaAtras(0), codigo: "POLO-M", producto: "POLO AZUL  ·  Talla M", cantidad: 3, trabajador_cliente: "DIEGO SOTO", area: "ALMACEN", nota: null, foto_path: null, created_at: `${diaAtras(0)}T14:30:00Z` },
  { ...base, id: 2, fecha: diaAtras(2), codigo: "POLO-L", producto: "POLO AZUL  ·  Talla L", cantidad: 1, trabajador_cliente: "ANA RUIZ", area: "PRODUCCION", nota: null, foto_path: null, created_at: `${diaAtras(2)}T16:00:00Z` },
  {
    ...base,
    id: 3,
    fecha: diaAtras(2),
    codigo: "PANT-32",
    producto: "PANTALON DRILL  ·  Talla 32",
    cantidad: 2,
    trabajador_cliente: "DIEGO SOTO",
    area: "ALMACEN",
    nota: null,
    foto_path: null,
    created_at: `${diaAtras(2)}T17:00:00Z`,
    anulado: true,
    anulado_motivo: "Talla equivocada",
    anulado_por: "ana@fundigsac.pe",
    anulado_at: `${diaAtras(2)}T18:00:00Z`,
  },
];

export const TRABAJADORES = [
  { trabajador: "DIEGO SOTO", nombres: "DIEGO", apellidos: "SOTO", area: "ALMACEN", prendas_recibidas: 3, ultima_entrega: diaAtras(0), genero: null },
  { trabajador: "ANA RUIZ", nombres: "ANA", apellidos: "RUIZ", area: "PRODUCCION", prendas_recibidas: 1, ultima_entrega: diaAtras(2), genero: null },
];

export const AJUSTES = { stock_minimo: 2, registro_abierto: true, reporte_inicio: "2026-01-01", reporte_ultimo: diaAtras(3), reporte_por: "Equipo" };

/** Supabase simulado con un catálogo variado. */
export class Simulado {
  /** Tablas que responden con error 500. */
  fallan = new Set<string>();
  /** Mientras no se resuelva, las lecturas de datos quedan esperando (para ver la carga). */
  espera: Promise<void> | null = null;
  lecturas = 0;

  async conectar(context: BrowserContext) {
    await context.route(`${SUPABASE}/**`, (route) => this.responder(route));
  }

  private json(route: Route, cuerpo: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(cuerpo) });
  }

  private async responder(route: Route) {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    const ruta = new URL(req.url()).pathname;
    if (ruta === "/rest/v1/rpc/uso_almacen") return this.json(route, { base_bytes: 42 * 1048576, base_limite: 524288000, fotos_bytes: 120 * 1048576, fotos_limite: 1073741824, fotos: 800 });
    if (ruta === "/rest/v1/rpc/is_editor") return this.json(route, true);
    const tabla = ruta.replace("/rest/v1/", "");
    const datos: Record<string, unknown> = { stock_items: STOCK, entradas: ENTRADAS, salidas: SALIDAS, trabajadores: TRABAJADORES, ajustes: [AJUSTES], pedidos: [] };
    if (tabla in datos) {
      this.lecturas++;
      if (this.espera) await this.espera;
      if (this.fallan.has(tabla)) return this.json(route, { message: "boom" }, 500);
      return this.json(route, datos[tabla]);
    }
    return this.json(route, []);
  }
}
