// Una versión nueva recarga todas las pestañas. Si esta tiene una ventana abierta, se espera a que se cierre.
const abiertas = new Set<string>();
let pendiente: (() => void) | null = null;

export function pedirRecarga(recargar: () => void) {
  if (abiertas.size === 0) recargar();
  else pendiente = recargar;
}

export function marcarEdicion(clave: string, abierta: boolean) {
  if (abierta) {
    abiertas.add(clave);
    return;
  }
  abiertas.delete(clave);
  if (abiertas.size === 0 && pendiente) {
    const r = pendiente;
    pendiente = null;
    r();
  }
}
