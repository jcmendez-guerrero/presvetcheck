# Implementation Plan: Formation mode dispense flow

**Branch**: `claude/amazing-cannon-b8yb5y` (spec `016-formation-mode-dispense-flow`) | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-formation-mode-dispense-flow/spec.md`

## Summary

La revisión ya guarda el modo formación y la fecha original, pero la evaluación (`RecetasService.evaluar`) los
ignora y juzga con el stock de hoy, de modo que un producto ya vendido sale como `PEDIR` y no se ofrece
«Dispensar». Se corrige en el servidor: en formación (no alta manual) el stock se sustituye por el chequeo de
movimientos `sale_shipment` del día original, reutilizando la regla de dominio existente
(`evaluarMovimientosRetrospectivos`) y extrayendo la consulta a Siweb360 a un colaborador compartido. La UI casi no
cambia (la pantalla de resultado ya muestra «Dispensar» según la decisión). Ver [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript estricto (Node.js 22, pnpm 9)

**Primary Dependencies**: Fastify + zod (`apps/api`), React + TanStack Router/Query (`apps/web`), Drizzle (`packages/db`), `@mmx/domain`, `@mmx/shared`

**Storage**: PostgreSQL 16 — sin cambios de esquema

**Testing**: Vitest (`it.each` en dominio), MSW + fixtures para Siweb360, Playwright smoke (`EXTRACTOR=fake`)

**Target Platform**: Azure Container Apps (API) + navegador de escritorio/móvil

**Project Type**: web-service + web-app (monorepo pnpm)

**Performance Goals**: una consulta de movimientos por línea de receta; sin impacto perceptible (límite Siweb 1.000 req/h)

**Constraints**: dominio puro con `Clock` inyectado; sin datos personales en logs; no escribir stock saliente en Siweb360; formación sujeta a `RETROSPECTIVE_DISPENSATION_MODE`

**Scale/Scope**: 1 servicio nuevo pequeño, 1 cambio en `evaluar`, ajustes menores de UI/tests; ~1 PR

## Constitution Check

| Principio | Estado |
|---|---|
| I. Dominio puro / decisiones `{decision,motivos,evidencias,reglaVersion}` | OK: la decisión sigue saliendo de `decidirLinea`; la lógica de movimientos ya vive en `packages/domain`. La E/S (Siweb) queda en la capa de servicios |
| II. Tests | OK: casos nuevos en API con MSW (5xx, timeout, sin venta, deshabilitado, regresión en vivo); sin servicios reales |
| III. Seguridad | OK: validación en la API, no solo en UI; `BLOQUEANTE_DURO` no forzable; sin datos personales; sin UPDATE/DELETE de registros finalizados |
| IV. Mantenibilidad | OK: sin variables nuevas ni decisiones D-xx nuevas (reutiliza D-14); Conventional Commits; glosario ya cubre «modo formación» |
| V. Español | OK: textos de UI/errores en español; `code` estables |
| Trazabilidad / outbox | OK: no se escribe stock a Siweb360 |

Sin violaciones; Complexity Tracking no aplica. Re-evaluado tras el diseño: sin cambios.

## Project Structure

### Documentation (this feature)

```text
specs/016-formation-mode-dispense-flow/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/evaluar-formacion.md
└── tasks.md   # /speckit-tasks
```

### Source Code (repository root)

```text
apps/api/src/servicios/
├── retrospectivo.ts        # NUEVO: consulta de movimientos + evaluarMovimientosRetrospectivos (extraído de dispensaciones.ts)
├── recetas.ts              # evaluar(): rama de formación (stock sintético + incidencias de movimientos)
└── dispensaciones.ts       # usa el colaborador extraído (sin cambio de comportamiento)
apps/api/test/
└── evaluar-formacion.test.ts   # NUEVO (MSW + fixtures)
apps/web/src/paginas/
└── resultado.tsx           # aviso «Formación: se comprobó la venta del <fecha>» y no mostrar pedido en formación
apps/web/src/paginas/*.test.tsx # caso de UI sin «Añadir a lista de pedido»
packages/shared/src/ayuda/secciones.ts  # una línea de ayuda (opcional)
```

**Structure Decision**: se mantiene el monorrepo existente; el cambio se concentra en `apps/api` (servicios) con
ajustes mínimos en `apps/web`. No se toca `packages/domain` salvo que el diseño de tareas revele que
`decidirLinea` necesita una bandera explícita de «stock ya validado por movimientos»; en ese caso se añade con tabla
de casos `it.each` (revisión obligatoria según la constitución).

## Complexity Tracking

Sin violaciones que justificar.
