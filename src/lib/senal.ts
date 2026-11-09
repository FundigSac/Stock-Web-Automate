/** Señal que se cancela sola pasado el tiempo. AbortSignal.timeout no existe en Safari antes de la 16 ni en Chrome antes de la 103. */
export function senalConLimite(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const control = new AbortController();
  setTimeout(() => control.abort(new DOMException("La petición tardó demasiado.", "TimeoutError")), ms);
  return control.signal;
}
