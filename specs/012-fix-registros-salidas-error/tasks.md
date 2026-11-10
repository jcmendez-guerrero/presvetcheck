---

description: "Tareas para arreglar los registros de salidas y psicótropos (ERROR_INTERNO en PostgreSQL real)"
---

# Tasks: Los registros de salidas fallan con «Se ha producido un error»

**Input**: Design documents from `/specs/012-fix-registros-salidas-error/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/registros.md](contracts/registros.md)

**Tests**: Pedidos por la spec (US3, FR-005): la prueba de integración contra PostgreSQL 16 se escribe **antes** del
arreglo y debe fallar sin él.

**Organization**: por historia de usuario. US1 y US2 comparten el mismo fichero (`datos.ts`) y la misma prueba, así
que se hacen en secuencia.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3 de [spec.md](spec.md)

## Contexto para quien implemente

- Causa (probada en PostgreSQL 16, ver [research.md](research.md)): en `packages/reports/src/datos.ts`,
  `gte(fechaRegistro, ini)` / `lt(fechaRegistro, fin)` (líneas ~94–95, método `salidas`) y
  `gte(fechaMovimiento, ini)` / `lt(fechaMovimiento, fin)` (línea ~403, método `psicotropos`) pasan objetos `Date`
  a una expresión `sql` sin tipo; postgres-js los rechaza con `ERR_INVALID_ARG_TYPE`. PGlite los acepta, por eso
  los tests actuales pasan. Arreglo: `ini.toISOString()` / `fin.toISOString()` en esas comparaciones. No cambiar
  `rangoMadrid` (lo usan otros sitios que funcionan).
- Columnas obligatorias para insertar en `dispensacion`: `canal`, `con_receta`, `cn`, `nombre_farmaco`, `lote`,
  `unidades`, `metodo_captura`, `empleado`, `fecha_venta` (el `id` se puede generar con `gen_random_uuid()`).
  Opcionales usadas aquí: `nregistro`, `fecha_original` (`date`), `anula_dispensacion_id`.
- Columnas obligatorias de `cimavet_medicamento`: `nregistro` (PK), `nombre`, `nombre_norm`, `source`,
  `fetched_at`; para el libro de psicótropos, `psicotropo = true`.
- `RegistrosService` necesita `{ db, cipher }`; `cipher = new ColumnCipher(randomBytes(32).toString('base64'))`
  (`@mmx/db`). Base de datos: `createDb(uri, { max: 2 })` + `runMigrations(h)` (`@mmx/db`), como en
  `packages/db/test/postgres.int.test.ts`.
- Docker local con Colima: exportar `DOCKER_HOST` (socket de Colima, `docker context inspect`) y
  `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` antes de `test:int`. No escribir rutas locales en
  ficheros versionados.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: que `packages/reports` pueda ejecutar pruebas de integración con Testcontainers, igual que `packages/db`.

- [x] T001 Add `"test:int": "vitest run --config vitest.int.config.ts"` to scripts and `@testcontainers/postgresql` (same version as `packages/db/package.json`) to devDependencies in `packages/reports/package.json`; run `pnpm i` (no new package in the lockfile)
- [x] T002 [P] Create `packages/reports/vitest.int.config.ts` copying `packages/db/vitest.int.config.ts` (include `test/**/*.int.test.ts`, timeouts 180 000 ms)
- [x] T003 [P] Exclude `test/**/*.int.test.ts` from the unit run in `packages/reports/vitest.config.ts` (same as `packages/db/vitest.config.ts`), so `pnpm test` does not need Docker

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: base común de la prueba de integración que usan US1, US2 y US3.

- [x] T004 Create `packages/reports/test/registros.int.test.ts` with the shared harness: `beforeAll` starts `postgres:16-alpine` (`PostgreSqlContainer`), `createDb` + `runMigrations`, builds `RegistrosService({ db, cipher })`; `afterAll` closes and stops; a small helper inserting a `dispensacion` row via `sql` (required columns from the context above; params as ISO strings, not `Date`); comments in Spanish

**Checkpoint**: `pnpm --filter @mmx/reports test:int` arranca el contenedor y aplica migraciones (sin casos todavía).

---

## Phase 3: User Story 1 — Consultar y descargar las salidas de un periodo (Priority: P1) 🎯 MVP

**Goal**: todas las vistas y descargas de salidas responden sin error y cada salida cae en su fecha de registro.

**Independent Test**: `pnpm --filter @mmx/reports test:int` — los casos de salidas pasan contra PostgreSQL 16.

### Tests for User Story 1 (escribir primero; deben FALLAR antes de T008)

- [x] T005 [US1] In `packages/reports/test/registros.int.test.ts`, add `it.each` cases for `reg.salidas(desde, hasta, { incluirPropietario: false, dniCompleto: false })`: (a) normal sale on 2026-11-05 → included in 2026-11-01…2026-11-10; (b) manual-entry sale with `fecha_original = 2026-10-20` and `fecha_venta` inside the period → excluded, and included when querying 2026-10-20…2026-10-20; (c) `fecha_original` equal to `desde` and to `hasta` → included; (d) sale at 2026-11-10T22:30:00Z (23:30 Madrid) → included, at 2026-11-10T23:30:00Z (00:30 Madrid next day) → excluded; (e) empty period → `[]`
- [x] T006 [US1] In the same file, add a DST case: period 2026-10-25…2026-10-25 (change to winter time) with sales at 2026-10-24T21:30:00Z (23:30 CEST on the 24th → excluded), 2026-10-24T22:30:00Z (00:30 CEST on the 25th → included) and 2026-10-25T23:30:00Z (00:30 CET on the 26th → excluded); assert by ids, not by count only
- [x] T007 [US1] Run `pnpm --filter @mmx/reports test:int` and confirm T005/T006 fail with `ERR_INVALID_ARG_TYPE ... Received an instance of Date` (proves the test catches the bug)

### Implementation for User Story 1

- [x] T008 [US1] In `packages/reports/src/datos.ts` method `salidas`, change `gte(fechaRegistro, ini)` / `lt(fechaRegistro, fin)` to `gte(fechaRegistro, ini.toISOString())` / `lt(fechaRegistro, fin.toISOString())`, with a one-line Spanish comment: the expression has no type, so postgres-js cannot serialize a `Date`
- [x] T009 [US1] Run `pnpm --filter @mmx/reports test:int` (T005/T006 pass) and `pnpm --filter @mmx/reports test` + `pnpm --filter @mmx/api test` (PGlite suites still green; `/api/registros/salidas`, `/todas-salidas`, `/movimientos` go through `salidas`)

**Checkpoint**: US1 lista; ya se puede desplegar el MVP en NP.

---

## Phase 4: User Story 2 — Libro de psicótropos (Priority: P2)

**Goal**: el registro de psicótropos responde sin error; una anulación cuenta el día en que se anula.

**Independent Test**: los casos de psicótropos de `registros.int.test.ts` pasan contra PostgreSQL 16.

### Tests for User Story 2 (deben FALLAR antes de T012)

- [x] T010 [US2] In `packages/reports/test/registros.int.test.ts`, insert a `cimavet_medicamento` row with `psicotropo = true` (required columns from the context above) and add cases for `reg.psicotropos(desde, hasta)`: (a) psychotropic sale on 2026-11-03 → appears in 2026-11-01…2026-11-10; (b) its cancellation (`anula_dispensacion_id` = original id, `fecha_venta` 2026-11-12) → appears in 2026-11-12…2026-11-12 and not in 2026-11-01…2026-11-10; (c) manual-entry psychotropic sale with `fecha_original = 2026-10-20` → appears on 2026-10-20
- [x] T011 [US2] Run `pnpm --filter @mmx/reports test:int` and confirm T010 fails with `ERR_INVALID_ARG_TYPE`

### Implementation for User Story 2

- [x] T012 [US2] In `packages/reports/src/datos.ts` method `psicotropos`, change `gte(fechaMovimiento, ini)` / `lt(fechaMovimiento, fin)` to use `ini.toISOString()` / `fin.toISOString()`
- [x] T013 [US2] Run `pnpm --filter @mmx/reports test:int` (all cases pass)

**Checkpoint**: US1 y US2 funcionan contra PostgreSQL real.

---

## Phase 5: User Story 3 — Que no vuelva a llegar a producción sin detectarse (Priority: P3)

**Goal**: el fallo se detecta en CI y, si otro error 500 ocurre, el registro técnico guarda la causa sin datos
personales.

**Independent Test**: CI ejecuta `test:int` de `@mmx/reports`; un error de base de datos forzado deja en el log
`cause.code` / `cause.message` y no los parámetros de la consulta.

- [x] T014 [US3] Confirm CI picks up the new script: `.github/workflows/ci.yml` step «Integración (Testcontainers, PostgreSQL 16)» runs `pnpm … test:int` over all packages, so `@mmx/reports` is included without changes; run `pnpm test:int` from the root to confirm turbo runs both `@mmx/db` and `@mmx/reports`
- [x] T015 [P] [US3] In `apps/api/src/plugins/errores.ts` (log line before the generic 500), log `message` cut before `'\nparams:'` and, when `err.cause` exists, `cause: { name, code, message }` only (never `detail`, `params` or the whole object); keep the 500 response body unchanged (FR-007)
- [x] T016 [US3] Add a test in `apps/api/test/errores.test.ts` (new): `buildApp` disables the logger when `NODE_ENV=test`, so do not use `entorno()`; create a bare `Fastify({ logger: { level: 'error', stream } })` where `stream` collects lines in an array, call `registrarErrores(app)` from `apps/api/src/plugins/errores.ts`, register a route that throws an `Error('Failed query: select 1\nparams: Ana,600000000', { cause: Object.assign(new Error('boom'), { code: 'XX000', detail: 'Ana' }) })`, capture log output, assert the response is the generic `ERROR_INTERNO` body and the log contains `XX000` and `boom` but not `Ana` nor `600000000`

**Checkpoint**: las tres historias están completas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T017 Run `pnpm lint && pnpm typecheck && pnpm test` and `pnpm test:int` from the repo root; all green
- [x] T018 Check `git diff` contains no internal Azure names, local paths or personal data (public repository)
- [ ] T019 Commit as `fix(registros): …` (Conventional Commits, Spanish), open one PR
- [ ] T020 After deploying to NP, validate per [quickstart.md](quickstart.md) §3 (period 01/11/2026–10/11/2026: «Ver entradas y salidas», «Ver salidas» A/B/C, «Todas las salidas», «Registro de psicótropos» and their XLSX/CSV)

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004)** → US1 → US2 → US3 → Polish.
- T002 and T003 are independent of each other (different files) once T001 is done.
- US1 and US2 touch the same files (`datos.ts`, `registros.int.test.ts`): run them in sequence, not in parallel.
- T015 (errores.ts) is independent of US1/US2 and can be done at any time after Setup; T016 depends on T015.
- T020 depends on the deploy after T019.

## Parallel Example

```text
After T001:          T002 ‖ T003
Any time:            T015 (apps/api) ‖ the US1/US2 work (packages/reports)
```

## Implementation Strategy

1. **MVP**: Setup + Foundational + US1 (T001–T009). That alone fixes «Ver entradas y salidas» and every outbound
   report the user reported; it can be deployed to NP.
2. Add US2 (T010–T013): psicótropos book.
3. Add US3 (T014–T016): CI guard and better error logging.
4. Polish (T017–T020) and deploy.
