# Implementation Plan: Albarán o factura y códigos QR desde el móvil en la recepción de mercancía

**Branch**: `claude/mobile-bill-qr-scanning-7b38cf` (feature `013-mobile-albaran-qr-scan`) | **Date**: 2026-11-12 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/013-mobile-albaran-qr-scan/spec.md`

## Summary

La lectura de albaranes (PC) y el emparejamiento del móvil ya existen. La lectura que hace el móvil también llega ya
al campo de escaneo de la recepción. La feature los une con el mínimo código nuevo:

1. **Albarán desde el móvil (US1)**: una ruta del móvil `POST /api/movil/m/albaranes` que llama al mismo
   `leerAlbaran` (ahora con varias páginas, unidas por la función pura `unirLecturas`) y publica un evento con el id
   de la lectura. El PC la recoge con `GET /api/recepciones/albaranes/:documentoId` y la enseña en la nueva
   recepción, o avisa si está en otra pantalla. Una columna nueva `albaran_documento.paginas` guarda todas las hojas.
2. **QR con enlace GS1 (US2)**: `parseGs1` entiende las direcciones GS1 Digital Link y las convierte a la misma cadena
   GS1 que un DataMatrix. Un QR sin producto da `QR_SIN_PRODUCTO` con un mensaje claro. Cambia el texto de la tarjeta
   del móvil.

Detalle de decisiones en [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript estricto, Node.js 22, pnpm 9

**Primary Dependencies**: Fastify + zod (API), Drizzle (PostgreSQL), React 19 + TanStack Router/Query (web),
`zxing-wasm` (ya instalado). **Ninguna dependencia nueva.**

**Storage**: PostgreSQL 16 (una columna `jsonb` nueva) y Blob, contenedor `albaranes` (ya existe).

**Testing**: Vitest (`it.each` en `packages/gs1` y `packages/extraction`), pruebas de la API con `EXTRACTOR=fake` y
la fixture `fixtures/albaranes/sintetico-1.invoice.json`. Sin servicios reales.

**Target Platform**: PWA en el navegador del móvil (página `/movil`, sin sesión) y del PC/tablet; API en Azure
Container Apps.

**Project Type**: monorepo web (apps/api, apps/web, packages/*).

**Performance Goals**: la lectura sigue el ritmo de Document Intelligence (hasta un minuto). El PC ve el resultado en
el siguiente sondeo de eventos (1,5 s). SC-001: menos de 90 s del papel a la revisión.

**Constraints**: el móvil solo envía y nunca ve datos leídos; de 1 a 10 páginas por envío; un QR leído nunca se abre.

**Scale/Scope**: un establecimiento y pocas recepciones al día. Cambia 1 tabla, hay 2 rutas nuevas y se modifican 3
rutas, 2 paquetes y 3 pantallas.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumple | Cómo |
|---|---|---|
| I. Dominio puro, zod, errores tipados | ✅ | `parseGs1` y `unirLecturas` son funciones puras sin E/S ni reloj. Los cuerpos y respuestas nuevos se validan con zod. Error tipado nuevo `QR_SIN_PRODUCTO`. |
| II. Pruebas | ✅ | Tablas `it.each` para Digital Link (incluido el día `00`) y para la unión de páginas. Pruebas de la API con fixtures y casos de error (token caducado, sin lector, demasiados ficheros, envío repetido). Nada llama a Azure. |
| III. Datos personales y seguridad | ✅ | Los albaranes no llevan datos de propietarios. Aun así, el móvil no recibe nada leído, el evento solo guarda un id y nada del documento va a los logs. El token del móvil se valida como en las recetas. No hay claves nuevas. |
| III. Append-only | ✅ | `albaran_documento` no es un registro finalizado; no se tocan `recepcion_linea` finalizadas, `dispensacion` ni `audit_event`. |
| Reglas fuera de prompts y UI | ✅ | La interpretación GS1 vive en `packages/gs1`; las comprobaciones de la recepción no cambian (API). |
| IV. Mantenibilidad | ✅ | No hay variables de entorno nuevas. Se añade «Enlace GS1 (GS1 Digital Link)» a `docs/glosario.md`. Un PR (bloque de recepción). |
| V. Idioma | ✅ | Textos de la interfaz en español claro; identificadores técnicos en inglés (`unirLecturas` sigue el nombre del módulo, que ya está en español). |
| Trazabilidad | ✅ | Auditoría `albaran_leer` a nombre de quien emparejó; el `userAgent` marca `movil`. |

**Re-check tras el diseño (Phase 1)**: sin cambios; ninguna violación. No hace falta un ADR (no cambia la
arquitectura: se amplían el emparejamiento y la lectura que ya existen).

## Project Structure

### Documentation (this feature)

```text
specs/013-mobile-albaran-qr-scan/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api-movil-albaranes.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/gs1/
├── src/index.ts                     # parseGs1: enlace GS1 → cadena GS1; error QR_SIN_PRODUCTO
└── test/gs1.test.ts                 # tabla de casos Digital Link
packages/extraction/
├── src/albaran.ts                   # unirLecturas(lecturas)
└── test/albaran.test.ts             # tabla de casos de la unión
packages/db/
├── src/schema/entradas.ts           # albaranDocumento.paginas (jsonb, nullable)
└── migrations/                      # migración generada (ADD COLUMN)
apps/api/
├── src/servicios/recepciones.ts     # leerAlbaran(paginas[]), lectura(documentoId), documento(id, pagina)
├── src/servicios/movil.ts           # EventoMovil 'albaran'
├── src/rutas/movil.ts               # POST /api/movil/m/albaranes; /sesion con `albaranes`
├── src/rutas/operativa.ts           # GET /api/recepciones/albaranes/:documentoId; ?pagina en /documento
└── test/movil.test.ts               # flujo móvil → evento → lectura
apps/web/src/
├── paginas/movil.tsx                # tarjeta «Albarán o factura» (captura de páginas reutilizada); texto del QR
├── lib/movil.tsx                    # evento 'albaran', albaranSinDestino, useAlbaranesMovil
├── componentes/movil-pc.tsx         # aviso (junto al de codigoSinDestino) «Ha llegado un albarán desde el móvil»
└── paginas/recepciones.tsx          # cargar lectura por ?albaran= o por evento; confirmar sustitución; QR_SIN_PRODUCTO
docs/glosario.md                     # «Enlace GS1 (GS1 Digital Link)»
```

**Structure Decision**: se usa la estructura del monorepo tal como está; no hay paquetes ni capas nuevas.

## Orden sugerido

1. `packages/gs1` (US2, independiente) y `packages/extraction` `unirLecturas` (puros, primero con sus pruebas).
2. Migración y `leerAlbaran(paginas[])`; la ruta del PC sigue igual hacia fuera.
3. Rutas del móvil y del PC y su prueba de la API.
4. Web: tarjeta del móvil, eventos en el PC y pantalla de recepción.
5. Glosario y `pnpm lint && pnpm typecheck && pnpm test`.

## Complexity Tracking

No hay violaciones de la constitución que justificar.
