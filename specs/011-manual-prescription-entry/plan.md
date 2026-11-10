# Implementation Plan: Alta manual de recetas sin imagen

**Branch**: `011-manual-prescription-entry` | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/011-manual-prescription-entry/spec.md`

## Summary

La veterinaria responsable podrá dar de alta una receta sin imagen y registrar la dispensación que ya ocurrió fuera de
la app, con su fecha original. En vez de un flujo nuevo, se reutiliza el existente: el alta crea una `receta` sin
páginas con `origen = 'manual'` que pasa por revisión (sin visor, con medicamento, presentación, forma, principio
activo, concentración y especie elegidos de CIMAVet y validados en el servidor), resultado y dispensación en modo
retrospectivo. La validez se calcula en la fecha original pasando esa fecha como primera dispensación al dominio, que
ya lo soporta. No se toca `packages/domain` ni se escribe stock en Siweb360. Detalle de decisiones en
[research.md](research.md).

## Technical Context

**Language/Version**: TypeScript estricto, Node.js 22, pnpm 9

**Primary Dependencies**: Fastify + zod (API), Drizzle (PostgreSQL), React + TanStack Router/Query (web); nada nuevo

**Storage**: PostgreSQL 16 (migración `0019_receta_alta_manual.sql`: 3 columnas en `receta`); Blob solo para adjuntar
imagen después (FR-024)

**Testing**: Vitest (unitarias + `it.each`), Testcontainers (`pnpm test:int`), MSW con `fixtures/` para CIMAVet y
Siweb360, Playwright con `EXTRACTOR=fake`

**Target Platform**: Azure Container Apps (API, worker) + PWA web

**Project Type**: Monorepo web (apps/api, apps/web, apps/worker, packages/*)

**Performance Goals**: Alta de una receta de una línea con su dispensación en < 4 min (SC-001); búsquedas en CIMAVet
como hoy

**Constraints**: Sin escritura de stock de salida; `dispensacion` y `audit_event` append-only; datos del titular
cifrados y fuera de logs; textos de UI en español

**Scale/Scope**: Uso temporal, decenas de recetas en estas semanas; 1 rol

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Calidad — dominio puro, reloj inyectado | No se modifica `packages/domain`; la fecha de referencia se pasa como dato (`primeraDispensacion`). | ✅ |
| II. Pruebas — lint/typecheck/test verdes, sin servicios reales | Unitarias `it.each` para fecha original (futura, anterior a emisión, cambio de hora) y validación del alta; integración con MSW + fixtures; Playwright del flujo. | ✅ |
| III. Seguridad y datos personales | Rol comprobado en la API por receta (no solo en la UI); interruptor apagado por defecto; motivo y custodia sin datos personales; titular cifrado como hoy; nada personal en logs. | ✅ |
| IV. Mantenibilidad | Reutiliza pantallas, servicios y motor; sin dependencias nuevas; variable documentada en `.env.example`. | ✅ |
| V. Español en producto | Spec, UI, mensajes de error (por `code`) y comentarios de dominio en español; términos nuevos (`alta manual`, `custodia`) a `docs/glosario.md`. | ✅ |
| Regulación y trazabilidad | Mismo motor y severidades; `BLOQUEANTE_DURO` nunca forzable; forzado validado en la API; sin stock de salida; dispensación append-only con anulación; evaluación ligada a `reglaVersion`; auditoría del alta. | ✅ |

**Post-design re-check**: ✅. Única desviación de la spec original, ya corregida en la spec: la evaluación usa la
versión de reglas activa al registrar (research R3), coherente con «cada decisión ligada a la versión con la que se
tomó».

## Project Structure

### Documentation (this feature)

```text
specs/011-manual-prescription-entry/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/
├── config.ts                    # MANUAL_PRESCRIPTION_ENTRY
├── codes.ts                     # códigos de error nuevos
├── i18n/errores.es.json         # textos de esos códigos
└── schemas/receta.ts            # PeticionAltaManual; origen en la respuesta
packages/db/
├── src/schema/recetas.ts        # receta.origen, motivoAlta, custodiaPapel
└── migrations/0019_receta_alta_manual.sql
apps/api/src/
├── plugins/auth.ts              # ROLES.altaManual
├── rutas/recetas.ts             # POST /api/recetas/manual, POST /api/recetas/:id/imagenes
├── rutas/sistema.ts             # altaManualHabilitada en /api/config/publica
├── rutas/registros.ts           # filtro origen=manual
├── servicios/recetas.ts         # crearManual, rol por receta, CIMAVet obligatorio, fechaReferencia, duplicado importado
└── servicios/dispensaciones.ts  # retrospectivo obligatorio en manuales, fecha original, primeraDispensacionAt
apps/web/src/
├── paginas/alta-manual.tsx      # formulario corto de alta
├── paginas/revision.tsx         # sin visor; campos CIMAVet de solo lectura
├── paginas/dispensacion.tsx     # retrospectivo bloqueado + fecha obligatoria
├── paginas/registros.tsx        # filtro y etiqueta «Alta manual»
├── paginas/inicio.tsx           # botón según rol y config
└── main.tsx                     # ruta /recetas/manual/nueva
apps/worker/src/jobs/reportes.ts # apartado «Altas manuales» del reporte semanal
.env.example, docs/glosario.md
```

**Structure Decision**: Monorepo existente; el cambio se reparte en las capas que ya tocan recetas y dispensaciones,
sin módulos nuevos salvo la página de alta.

## Complexity Tracking

Sin violaciones de la constitución que justificar.
