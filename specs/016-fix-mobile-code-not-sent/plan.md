# Implementation Plan: El código del envase leído con el móvil llega siempre al ordenador

**Branch**: `016-fix-mobile-code-not-sent` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/016-fix-mobile-code-not-sent/spec.md`

## Summary

El móvil emparejado lee el código del envase (DataMatrix/GS1, QR, EAN-13, Code 128) pero la persona no ve que llegue al
ordenador. Revisando el código no hay una causa única confirmada: hay **cuatro puntos donde la lectura se puede perder
en silencio** (ver [research.md](research.md)): el móvil no distingue ni conserva los envíos fallidos, la plataforma
puede rechazar la petición del móvil antes de llegar a la API y el móvil lo traduce mal, el ordenador solo entrega el
código si hay un campo abierto, y no hay confirmación de entrega.

Enfoque: **primero reproducir y localizar** (T001, antes de cambiar nada), y después cerrar los cuatro puntos con cambios
pequeños en el flujo existente, sin rediseñar el emparejamiento:

1. Móvil: estado de cada lectura (enviando / enviada / por reintentar / sin emparejamiento / rechazada), aviso destacado con vibración
   y sonido de error, «Reintentar» con el mismo código, y el estado sobrevive a bloquear la pantalla.
2. API: el envío del móvil lleva un identificador de lectura generado en el móvil; reenviar el mismo identificador no
   crea un segundo evento (reintento seguro, sin duplicados).
3. PC: un código sin campo de escaneo abierto se guarda como «código pendiente» (cola de hasta 5, 5 minutos cada uno),
   con aviso visible y botón «Usar el código recibido» en el campo de escaneo; nunca se aplica solo. Varias pestañas
   emparejadas con el mismo móvil quedan fuera de alcance.
4. PC: si el emparejamiento termina, el diálogo «Usar el móvil» lo dice.

La interpretación GS1 (`packages/gs1`) no cambia.

## Technical Context

**Language/Version**: TypeScript estricto, Node.js 22, pnpm 9

**Primary Dependencies**: Fastify + zod (API), React + TanStack Router (web), `zxing-wasm` 2.2.x (lectura), Drizzle (sin
migraciones nuevas), Vitest, Playwright

**Storage**: PostgreSQL 16; tabla existente `sesion_movil_evento` (`datos` jsonb). Sin cambios de esquema

**Testing**: Vitest (API con `apps/api/test/movil.test.ts`; web con tests de `lib/` y componentes), Playwright smoke
con `EXTRACTOR=fake`

**Target Platform**: PWA en navegador del móvil (Android/iOS) y del PC; API en Azure Container Apps

**Project Type**: web (apps/web + apps/api)

**Performance Goals**: lectura visible en el PC en < 5 s con buena conexión (SC-002); la consulta del PC sigue cada 1,5 s

**Constraints**: código ≤ 512 caracteres (límite actual); sin datos personales en logs; reintento idempotente; sin
migraciones; textos en español claro

**Scale/Scope**: decenas de lecturas por sesión; 1 móvil por sesión; ~6 archivos de producción y ~4 de pruebas

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Estado | Nota |
|-----------|--------|------|
| I. Calidad de código (dominio puro, zod en `packages/shared`, tipos inferidos) | Cumple | No se toca el dominio. El cuerpo de `POST /api/movil/m/codigos` se define con zod; el esquema compartido vive en `packages/shared` y el móvil y la API infieren el tipo |
| II. Pruebas (`lint`+`typecheck`+`test`, sin servicios reales) | Cumple | Pruebas de API con base de datos de pruebas existente; pruebas de web con `fetch` simulado; sin servicios reales |
| III. Seguridad y datos personales | Cumple | El código del envase no es dato personal, pero no se escribe en logs (la redacción ya cubre `x-movil-token`); sin `UPDATE`/`DELETE` de registros finalizados (los eventos del móvil son efímeros y no están en la lista protegida) |
| IV. Mantenibilidad (variables en `.env.example`, `TODO(decision)`) | Cumple | Sin variables nuevas: la caducidad de 5 min del código pendiente es una constante de la web. Se añade término «código pendiente» a `docs/glosario.md` |
| V. Español | Cumple | Todos los textos nuevos en español claro |
| Trazabilidad regulatoria | Cumple | Cada código queda asociado a quien abrió el emparejamiento (auditoría ya existente) |

Sin violaciones: no hace falta *Complexity Tracking*. Re-evaluada tras el diseño (Phase 1): sigue sin violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/016-fix-mobile-code-not-sent/
├── plan.md              # Este archivo
├── research.md          # Phase 0: causas posibles y decisiones
├── data-model.md        # Phase 1: estados de la lectura y del código pendiente
├── quickstart.md        # Phase 1: cómo reproducir y validar
├── contracts/
│   └── api-movil-codigos.md   # Phase 1: contrato del envío del código
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks, no lo crea este comando)
```

### Source Code (repository root)

```text
apps/api/src/
├── rutas/movil.ts            # POST /api/movil/m/codigos: id de lectura (idempotente)
└── servicios/movil.ts        # publicar(): no duplica un id ya publicado

apps/web/src/
├── paginas/movil.tsx         # estado de envío, «Reintentar», aviso destacado, persistencia del último envío
├── lib/movil.tsx             # cola de códigos pendientes (≤5, 5 min c/u), usarPendiente(), aviso de emparejamiento terminado
├── lib/envio-codigo.ts       # NUEVO: estado y reintento de un envío (puro, probable)
├── componentes/escaner.tsx   # CampoEscaneo: botón «Usar el código recibido»
└── componentes/movil-pc.tsx  # aviso visible del código pendiente; aviso de emparejamiento terminado

packages/shared/src/          # esquema zod del cuerpo del envío del código

apps/api/test/movil.test.ts           # idempotencia, límites, 401
apps/web/src/lib/envio-codigo.test.ts # estados, reintento, no reintentar tras 401
apps/web/src/lib/movil.test.tsx       # casos: cola, caducidad 5 min, uso único, orden, cursor
apps/web/e2e/                         # humo: código del móvil → campo de escaneo (si el entorno lo permite)
docs/glosario.md                      # «código pendiente»
```

**Structure Decision**: se mantiene la estructura actual (web + API); la única pieza nueva es `lib/envio-codigo.ts`, una
máquina de estados pura para que el reintento y los estados se prueben sin navegador.

## Complexity Tracking

Sin violaciones de la constitución que justificar.
