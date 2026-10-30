# Stock EPP – FUNDIGSAC

Sistema de control de stock de EPP y uniformes. Se usa desde el celular y la computadora, se actualiza en vivo y es el sistema principal (reemplaza al Excel).

## Qué incluye

- **Resumen, Stock, Movimientos y Trabajadores** con datos en vivo (Supabase + tiempo real).
- **Registro de entradas y salidas** (las salidas exigen foto de evidencia con fecha y hora). Los movimientos no se borran, solo se anulan con motivo.
- **Asistente con IA** (Claude Haiku 5.5): entiende frases escritas como humano, fotos de hojas, PDF, Excel y Word, y registra cada movimiento por separado con una sola confirmación.
- **Informes en PDF**: stock, movimientos, entregas por trabajador, resumen y reporte de fotos.
- **Recordatorio semanal**: una campana con semáforo (verde, amarillo, rojo) y una isla animada avisan cada sábado que toca el reporte.

## Tecnología

Vite, React 18, TypeScript, Tailwind CSS v4, framer-motion, jsPDF. Backend en Supabase (Postgres, RLS, Storage y una Edge Function). Despliegue en Vercel.

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # completar con la URL y la clave pública (anon) de Supabase
npm run dev
```

Variables de entorno:

| Variable | Qué es |
| --- | --- |
| `VITE_SUPABASE_URL` | URL del proyecto de Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave pública (anon / publishable) |

La clave de Anthropic **no** va en el código ni en el navegador: se guarda en Supabase Vault y la usa solo la Edge Function `supabase/functions/asistente-ia`.

## Estructura

- `src/views`: pantallas principales.
- `src/components`: ventanas, asistente, informes y campana del reporte semanal.
- `src/lib`: datos en vivo, cálculos, PDF, IA y utilidades.
- `supabase/functions/asistente-ia`: función que llama al modelo.
