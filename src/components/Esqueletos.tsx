import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import type { Vista } from "../views/tipos";
import { Card, Skeleton } from "./ui";

/**
 * Esqueletos con la forma de cada vista (B12-1): mismas tarjetas, radios y alturas que el contenido real,
 * para que al llegar los datos nada salte. Con movimiento reducido no hay brillo (index.css).
 */
export function EsqueletoVista({ vista }: { vista: Vista }) {
  return (
    <div aria-busy="true" data-esqueleto={vista} className="space-y-5">
      <span role="status" className="sr-only">
        Cargando datos…
      </span>
      {vista === "stock" ? <EsqStock /> : vista === "movimientos" ? <EsqMovimientos /> : vista === "trabajadores" ? <EsqTrabajadores /> : vista === "respaldo" ? <EsqRespaldo /> : <EsqResumen />}
    </div>
  );
}

function Barra({ className }: { className?: string }) {
  return <Skeleton className={cn("h-3 rounded-full", className)} />;
}

/** Tarjeta de cifra: etiqueta, número grande y nota. */
function EsqCifra({ className }: { className?: string }) {
  return (
    <Card className={cn("p-5", className)}>
      <Barra className="w-24" />
      <Skeleton className="mt-4 h-9 w-20 rounded-xl" />
      <Barra className="mt-3 w-3/4" />
    </Card>
  );
}

function EsqTitulo() {
  return (
    <>
      <Barra className="w-28" />
      <Skeleton className="mt-2.5 h-5 w-52 rounded-lg" />
    </>
  );
}

function Repetir({ n, children }: { n: number; children: (i: number) => ReactNode }) {
  return <>{Array.from({ length: n }, (_, i) => children(i))}</>;
}

function EsqResumen() {
  return (
    <>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="p-6 xl:col-span-2">
          <EsqTitulo />
          <Skeleton className="mt-6 h-[260px] rounded-2xl" />
        </Card>
        <div className="rounded-3xl bg-ink p-6 shadow-pop">
          <Skeleton className="skeleton-oscuro h-3 w-28 rounded-full" />
          <Skeleton className="skeleton-oscuro mt-6 h-16 w-36 rounded-2xl" />
          <Skeleton className="skeleton-oscuro mt-6 h-2.5 rounded-full" />
          <div className="mt-5 space-y-3">
            <Repetir n={3}>{(i) => <Skeleton key={i} className="skeleton-oscuro h-3.5 rounded-full" />}</Repetir>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
        <Repetir n={4}>{(i) => <EsqCifra key={i} className="rounded-3xl" />}</Repetir>
      </div>
      <Card className="flex gap-4 p-5">
        <Skeleton className="size-10 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2.5">
          <Barra className="w-24" />
          <Barra className="w-full" />
          <Barra className="w-2/3" />
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Repetir n={3}>
          {(i) => (
            <Card key={i} className={cn("p-6", i === 2 && "md:col-span-2 xl:col-span-1")}>
              <EsqTitulo />
              <div className="mt-5 space-y-5">
                <Repetir n={4}>{(j) => <Barra key={j} className="h-4 w-full" />}</Repetir>
              </div>
            </Card>
          )}
        </Repetir>
      </div>
    </>
  );
}

function EsqStock() {
  return (
    <>
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-11 min-w-[220px] flex-1 rounded-xl" />
          <Skeleton className="h-11 w-52 rounded-xl" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Repetir n={4}>{(i) => <Skeleton key={i} className="h-9 w-28 rounded-full" />}</Repetir>
        </div>
        <Barra className="w-2/3" />
      </Card>
      <div className="space-y-3">
        <Repetir n={6}>
          {(i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line-2 bg-surface p-4 shadow-card">
              <div className="min-w-[200px] flex-1 space-y-2">
                <Barra className="h-4 w-44" />
                <Barra className="w-20" />
                <Skeleton className="h-6 w-28 rounded-full" />
              </div>
              <div className="flex gap-1.5">
                <Repetir n={3}>{(j) => <Skeleton key={j} className="h-8 w-14 rounded-lg" />}</Repetir>
              </div>
              <div className="ml-auto space-y-1.5">
                <Skeleton className="ml-auto h-7 w-10 rounded-lg" />
                <Barra className="w-14" />
              </div>
            </div>
          )}
        </Repetir>
      </div>
    </>
  );
}

function EsqFilaMov() {
  return (
    <div className="flex items-start gap-3 p-4">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex justify-between gap-3">
          <Barra className="h-4 w-48" />
          <Skeleton className="h-5 w-12 rounded-lg" />
        </div>
        <Barra className="w-32" />
        <Barra className="w-2/3" />
      </div>
    </div>
  );
}

function EsqMovimientos() {
  return (
    <>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Repetir n={3}>{(i) => <EsqCifra key={i} />}</Repetir>
      </div>
      <Card className="p-6">
        <EsqTitulo />
        <Skeleton className="mt-4 h-[220px] rounded-2xl" />
      </Card>
      <Card className="divide-y divide-line-2 overflow-hidden">
        <Repetir n={5}>{(i) => <EsqFilaMov key={i} />}</Repetir>
      </Card>
    </>
  );
}

function EsqTrabajadores() {
  return (
    <>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Repetir n={3}>{(i) => <EsqCifra key={i} />}</Repetir>
      </div>
      <Card className="overflow-hidden p-2">
        <Repetir n={6}>
          {(i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Barra className="h-4 w-40" />
                <Barra className="w-20" />
              </div>
              <Barra className="w-24" />
            </div>
          )}
        </Repetir>
      </Card>
    </>
  );
}

function EsqRespaldo() {
  return (
    <Card className="divide-y divide-line-2 overflow-hidden">
      <Repetir n={4}>{(i) => <EsqFilaMov key={i} />}</Repetir>
    </Card>
  );
}
