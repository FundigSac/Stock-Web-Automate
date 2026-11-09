/** Marca de la app con los tokens de 7.7: barras en el color de acción y la última en rojo, sobre blanco. */
export function Marca({ tam = 36 }: { tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#ffffff" />
      <rect x="7" y="7" width="18" height="5" rx="2" fill="#004257" />
      <rect x="7" y="14" width="12" height="5" rx="2" fill="#004257" />
      <rect x="7" y="21" width="18" height="4" rx="2" fill="#b3261e" />
    </svg>
  );
}
