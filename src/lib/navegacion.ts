/**
 * Posición de la píldora de la barra inferior (B16-4 + B5-1). Se mueve solo con transform:
 * cada columna mide lo mismo, así que basta desplazarla un 100 % por cada sección.
 * Una sección desconocida deja la píldora en la primera, nunca fuera de la barra.
 */
export function desplazamientoPildora(ids: readonly string[], activo: string): string {
  return `translateX(${Math.max(0, ids.indexOf(activo)) * 100}%)`;
}
