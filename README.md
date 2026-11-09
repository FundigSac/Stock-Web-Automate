# Stock EPP – FUNDIGSAC

Sistema de control de stock de EPP y uniformes. Se usa desde el celular y la computadora, se actualiza en vivo y es el sistema principal (reemplaza al Excel).

## Qué incluye

- **Resumen, Stock, Movimientos y Trabajadores** con datos en vivo (Supabase + tiempo real).
- **Registro de entradas y salidas** (las salidas exigen foto de evidencia con fecha y hora). Los movimientos no se borran, solo se anulan con motivo.
- **Asistente con IA** (Claude Haiku 5.5): entiende frases escritas como humano, fotos de hojas, PDF, Excel y Word, y registra cada movimiento por separado con una sola confirmación.
- **Informes en PDF**: stock, movimientos, entregas por trabajador, resumen y reporte de fotos.
- **Recordatorio semanal**: un aviso de color aparece desde el miércoles con un botón para descargar el reporte del sábado.
- **Pedidos al proveedor**: una lista simple para marcar qué llegó y qué se cancela.
- **Funciona sin conexión**: se instala como app y, tras una primera visita con señal, abre sin red. Cada movimiento y su foto se guardan en el dispositivo y se suben después con la fecha y hora de la foto, nunca con la de la subida.

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

## Sin conexión

Todo registro pasa primero por una cola en IndexedDB (`src/lib/offline`). Se sube la foto, luego la fila, y lo confirmado se conserva 7 días en el dispositivo. La pantalla Respaldo muestra lo pendiente y lo subido.

Los registros hechos con sesión solo suben con esa misma sesión. Si el token venció con la app cerrada, esperan a que se abra la app. Lo que el servidor rechaza no cuenta en el stock y se puede volver a intentar o descartar desde Respaldo. Lo que quedó por revisar no vence a los 7 días.

Si la sesión se pierde sin que nadie la cierre, Respaldo sigue mostrando esos registros como propios y pide entrar otra vez. Lo guardado con otra cuenta se puede rescatar: una cuenta editora descarga la foto o lo sube con su sesión, y la firma original no cambia.

El formulario de Registrar se guarda por cuenta mientras se llena, incluso antes de la foto. Cerrar sesión solo cierra este dispositivo.

La subida usa la función `registrar_offline`, creada por la migración `supabase/migrations/20261109120000_offline_capturado_en.sql`. Si la función faltara en otro entorno, los registros se quedan en cola en cada dispositivo, sin perderse.

Crear productos, crear trabajadores, anular, marcar pedidos, el asistente y los PDF necesitan conexión y lo dicen en pantalla. En iPhone no hay subida en segundo plano: lo pendiente se sube al abrir la app con señal.

## Migraciones

Las cinco de `supabase/migrations` se aplicaron a producción el 9 de noviembre de 2026.

| Archivo | Para qué |
| --- | --- |
| `20261109120000_offline_capturado_en.sql` | Registros sin conexión y hora real de la foto |
| `20261109130000_reporte_sabado.sql` | Saber qué sábado cubrió cada reporte |
| `20261109130100_pedidos_idempotentes.sql` | Pedidos sin duplicados al reintentar |
| `20261109130200_clave_anthropic_permisos.sql` | Que solo la Edge Function lea la clave de IA |
| `20261109140000_cuota_almacen.sql` | Que el almacén no se llene |

## Espacio en Supabase

El plan gratuito da 500 MB de base y 1 GB de archivos. Cada foto se comprime en el dispositivo y el bucket `evidencias` rechaza las que pasen de 1 MB. La función `cupo_fotos` limita las subidas a 40 por minuto y 300 por día: lo que pase de ahí no se pierde, se queda en el dispositivo y se reintenta. La función `uso_almacen` devuelve el espacio usado.

Al descartar un registro rechazado, la app borra su foto del almacén solo si ninguna fila la usa. Eso necesita una política de borrado en el bucket `evidencias`, que hoy no existe, así que la foto se queda donde está.

La Edge Function solo acepta llamadas desde el dominio de producción. Para sumar otro dominio, define el secreto `ORIGENES_PERMITIDOS` con la lista separada por comas.

## Privacidad de las fotos

Las fotos de evidencia están en el bucket `evidencias` y se abren con una dirección pública: quien tenga el enlace puede verlas sin cuenta. Muestran a trabajadores recibiendo prendas, así que les aplica la Ley 29733 de protección de datos personales. Pasarlas a un bucket privado con enlaces firmados obliga a iniciar sesión para verlas, y esa decisión es de la empresa.

## Pruebas

```bash
npm test            # cola, horas y reintentos (Vitest con fake-indexeddb)
npm run test:e2e    # escenario real sin conexión (Playwright, Supabase simulado)
npm run typecheck
```

Las pruebas nunca llaman a Supabase: apuntan a `http://127.0.0.1:54321` y simulan cada respuesta.

## Estructura

- `src/views`: pantallas principales.
- `src/components`: ventanas, asistente, informes y aviso del reporte semanal.
- `src/lib`: datos en vivo, cálculos, PDF, IA y utilidades.
- `src/lib/offline`: cola de registros, copia local de los datos y subida.
- `src/sw.ts`: service worker.
- `supabase/functions/asistente-ia`: función que llama al modelo.
