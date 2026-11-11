# Implementation Plan: Los registros de salidas fallan con «Se ha producido un error»

**Branch**: `012-fix-registros-salidas-error` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/012-fix-registros-salidas-error/spec.md`

## Summary

Todas las consultas de salidas (plantillas A/B/C, todas las salidas, entradas y salidas) y el libro de psicótropos
devuelven `ERROR_INTERNO` en PostgreSQL real. Causa (reproducida en PostgreSQL 16, ver [research.md](research.md)):
`RegistrosService` compara una expresión SQL calculada (`fechaRegistro` / `fechaMovimiento`, añadidas en specs/011)
con objetos `Date` de JS; Drizzle no sabe el tipo de la expresión y pasa el `Date` tal cual a postgres-js, que lo
rechaza (`ERR_INVALID_ARG_TYPE`). PGlite, que usan los tests, sí lo acepta.

Arreglo: pasar los límites del periodo como texto ISO 8601 en esas tres comparaciones; PostgreSQL infiere
`timestamptz` del otro lado. Además: una prueba de integración de `RegistrosService` contra PostgreSQL 16
(Testcontainers) que falla sin el arreglo, y que el registro técnico del error 500 guarde la causa original sin los
parámetros de la consulta (pueden llevar datos personales).

## Technical Context

**Language/Version**: TypeScript estricto, Node.js 22

**Primary Dependencies**: Drizzle ORM 0.45, postgres-js 3.4 (Azure/local), PGlite (tests unitarios), Fastify

**Storage**: PostgreSQL 16 (Azure Flexible Server); sin cambios de esquema ni migraciones

**Testing**: Vitest; `pnpm test` (PGlite) y `pnpm test:int` (Testcontainers, PostgreSQL 16, ya en CI)

**Target Platform**: Azure Container Apps (API)

**Project Type**: monorepo web (API + web + paquetes)

**Performance Goals**: sin cambios (la consulta es la misma; solo cambia cómo se envían dos parámetros)

**Constraints**: hora de Madrid para los límites del periodo; sin datos personales en registros técnicos

**Scale/Scope**: 3 comparaciones en `packages/reports/src/datos.ts`, 1 línea en `apps/api/src/plugins/errores.ts`,
1 prueba de integración nueva

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Estado | Nota |
|-----------|--------|------|
| I. Calidad de código | ✅ | Cambio mínimo en el sitio de la causa; sin nuevas abstracciones |
| II. Disciplina de pruebas | ✅ | Prueba de integración que reproduce el fallo + `pnpm lint && pnpm typecheck && pnpm test` y `pnpm test:int` |
| III. Seguridad y protección de datos | ✅ | El log del 500 deja de incluir los parámetros de la consulta; la causa se registra sin `detail` |
| IV. Mantenibilidad | ✅ | Sin variables nuevas; commit `fix:`; un PR |
| V. Idioma | ✅ | Comentarios y docs en español |
| Regulatorio y trazabilidad | ✅ | No se cambia qué fecha cuenta (specs/011) ni se tocan registros; solo lectura |
| Flujo y puertas de calidad | ✅ | Toca consultas cubiertas por Testcontainers → se añade `pnpm test:int` |

Sin violaciones; no hay tabla de complejidad.

## Project Structure

### Documentation (this feature)

```text
specs/012-fix-registros-salidas-error/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/registros.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/reports/
├── src/datos.ts                    # salidas() y psicotropos(): límites del periodo como ISO
├── test/registros.int.test.ts      # NUEVO: RegistrosService contra PostgreSQL 16
├── vitest.int.config.ts            # NUEVO: igual que packages/db
└── package.json                    # script test:int + devDependency @testcontainers/postgresql (ya en el lockfile)

apps/api/src/plugins/errores.ts     # log del 500: causa original, sin parámetros de la consulta
```

**Structure Decision**: la prueba vive en `packages/reports` porque es quien posee `RegistrosService`;
`packages/db` no puede depender de `reports`. CI ya ejecuta `test:int` en cada paquete que lo define, así que no hay
que tocar workflows.

## Complexity Tracking

No aplica.
