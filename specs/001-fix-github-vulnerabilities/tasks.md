---

description: "Lista de tareas: corrección de las vulnerabilidades detectadas en GitHub"
---

# Tasks: Corrección de las vulnerabilidades detectadas en GitHub

**Input**: Design documents from `specs/001-fix-github-vulnerabilities/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: incluidos. La spec los pide de forma explícita (FR-002, FR-003, FR-008, SC-003, SC-004) y la constitución (principio II) exige casos por tabla.

**Organization**: tareas agrupadas por historia de usuario. Cada tarea empieza su descripción con el PR al que pertenece (FR-017): **PR1** dependencias · **PR2** expresiones regulares · **PR3** prevención.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (ficheros distintos, sin depender de tareas pendientes)
- **[Story]**: historia de usuario (US1…US5) de la spec
- Rutas relativas a la raíz del monorepo

---

## Phase 1: Setup (entorno y línea base)

**Purpose**: dejar el entorno capaz de ejecutar el proyecto y guardar la situación de partida para comparar después.

- [X] T001 Activar Node 22 según `.nvmrc` (`nvm install 22 && nvm use`) y comprobar `node -v` (22.x) y `pnpm -v` (9.15.9); sin esto `pnpm` se niega a ejecutar por `engines` en `package.json`
- [X] T002 Ejecutar `pnpm install --frozen-lockfile && pnpm nomenclator:fetch --si-falta` y confirmar que `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int` pasan en la rama sin cambios (si algo falla aquí, es previo y se anota antes de seguir)
- [X] T003 [P] Guardar la línea base en el directorio temporal de trabajo (no versionar): salida de `pnpm audit --json`, lista de alertas abiertas (`gh api "repos/jcmendez-guerrero/presvetcheck/dependabot/alerts?state=open&per_page=100" --paginate` y `.../code-scanning/alerts?state=open`), resumen de cobertura de `pnpm --filter @mmx/domain test -- --coverage`
- [X] T004 [P] Guardar el número de registros que produce `pnpm worker nomenclator-import --muestra` (línea base para comprobar yauzl en T040)

---

## Phase 2: Foundational (bloqueante para PR1 y PR3)

**Purpose**: crear la ADR donde se registran política y excepciones; US1, US3, US4 y US5 la usan.

**⚠️ CRITICAL**: PR2 (US2) no depende de esta fase y puede empezar tras la Phase 1.

- [X] T005 PR1 · Crear `docs/adr/0016-dependencias-vulnerables-y-excepciones.md` con el formato de las ADR existentes (`# ADR-16 · …`, `- **Estado:** propuesta (fecha)`), secciones Contexto (alertas de partida del 2026-11-01: 90 Dependabot, 7 CodeQL), Decisión (orden de preferencia directa → lockfile → padre → override acotado → descarte; criterio de descarte de FR-012; regla de mantenimiento de FR-013a), tabla de excepciones vacía con las columnas de `specs/001-fix-github-vulnerabilities/contracts/adr-excepciones.md`, y Consecuencias; en español
- [X] T006 PR1 · Añadir la ADR 0016 al índice `docs/adr/README.md`

**Checkpoint**: la ADR existe; las historias pueden empezar.

---

## Phase 3: User Story 1 - Vulnerabilidades críticas y altas en producción (Priority: P1) 🎯 MVP · PR1

**Goal**: ninguna dependencia de ejecución con alertas altas o críticas (nodemailer, drizzle-orm, @fastify/static, @azure/msal-node), sin cambios visibles.

**Independent Test**: `pnpm audit --prod --audit-level high` sin altas/críticas de esas librerías; envío de correo, acceso a datos y servido de la web iguales que antes.

### Tests for User Story 1 (escribir antes de actualizar; deben pasar con las versiones actuales y seguir pasando después)

- [X] T007 [P] [US1] PR1 · Crear `packages/reports/test/mailer.test.ts`: con `vi.mock('nodemailer')` capturar los argumentos de `createTransport` y `sendMail` de `SmtpMailer` (`packages/reports/src/mailer.ts`) y comprobar host/port/`secure` (465 → true), `auth` solo si hay usuario, y que `from`, `to` (varios destinatarios), `subject`, `text` y `attachments` (`filename`, `content` Buffer, `contentType`) llegan sin cambios; datos sintéticos, sin datos de propietarios (FR-018)
- [X] T008 [P] [US1] PR1 · Crear `apps/api/test/estaticos.test.ts`: con `entorno()` de `apps/api/test/entorno.ts` y `WEB_DIST_DIR` apuntando a una carpeta temporal con `index.html` y `assets/app.js` (y un fichero `secreto.txt` fuera de esa carpeta), comprobar con `app.inject` que `/assets/app.js` se sirve, que `/ruta-spa` devuelve `index.html`, que `/api/no-existe` devuelve 404 `NO_ENCONTRADO`, y que `/../secreto.txt`, `/%2e%2e/secreto.txt`, `/%2e%2e%2fsecreto.txt`, `/assets%2f..%2f..%2fsecreto.txt`, `//secreto.txt` y `/assets/` nunca devuelven el contenido de `secreto.txt` ni un listado de directorio (FR-003)

### Implementation for User Story 1

- [X] T009 [US1] PR1 · Subir `drizzle-orm` a `^0.45.4` en `apps/api/package.json`, `apps/worker/package.json`, `packages/db/package.json`, `packages/cimavet/package.json`, `packages/siweb/package.json` y `packages/reports/package.json`; mantener `drizzle-kit` en `^0.31` (última 0.31.x) en `packages/db/package.json`; `pnpm install`
- [X] T010 [US1] PR1 · Comprobar que no hay cambios de esquema: `pnpm --filter @mmx/db exec drizzle-kit generate` no debe crear ficheros en `packages/db/migrations/` (FR-004); corregir errores de tipos de drizzle 0.45 si `pnpm typecheck` falla
- [X] T011 [US1] PR1 · Refrescar `@azure/identity` a `^4.14.1` en los 4 manifiestos que lo declaran (`pnpm update @azure/identity -r`) para que `@azure/msal-node` quede en ≥ 7.1.0; verificar con `pnpm why @azure/msal-node -r` y que no cambia ninguna variable de entorno de Azure (FR-005)
- [X] T012 [US1] PR1 · Commit `fix(deps): drizzle-orm 0.45 y msal-node 7.1 (alertas altas de ejecución)` tras `pnpm lint && pnpm typecheck && pnpm test`
- [X] T013 [US1] PR1 · Leer el CHANGELOG de nodemailer 8.x, 9.x y 10.x (interpretación de direcciones, `secure`, adjuntos) y subir `nodemailer` a `^10.3.1` (y `@types/nodemailer` si existe) en `packages/reports/package.json`; ajustar `packages/reports/src/mailer.ts` solo si la API cambió
- [X] T014 [US1] PR1 · Verificar que las direcciones de ejemplo de informes en `.env.example` (remitente y destinatarios) siguen siendo válidas con nodemailer 10; si hay que cambiar alguna variable, documentarla en `.env.example` (principio IV); pasar T007 y `pnpm --filter @mmx/reports test`; commit `fix(deps): nodemailer 10`
- [X] T015 [US1] PR1 · Subir `@fastify/static` a `^10.1.8` en `apps/api/package.json`; revisar el registro `{ root: web, wildcard: false }` y `reply.sendFile('index.html')` en `apps/api/src/app.ts` frente al CHANGELOG 9.x/10.x; pasar T008 y `pnpm --filter @mmx/api test`; commit `fix(deps): @fastify/static 10`
- [X] T016 [US1] PR1 · Ejecutar `pnpm audit --prod --audit-level high` y confirmar que no queda ninguna alerta alta o crítica de nodemailer, drizzle-orm, @fastify/static ni @azure/msal-node

**Checkpoint**: US1 lista; las altas de ejecución están corregidas.

---

## Phase 4: User Story 2 - Expresiones regulares vulnerables (Priority: P1) · PR2

**Goal**: las 7 expresiones señaladas por CodeQL (y las que encuentre la revisión) procesan cualquier texto en tiempo lineal, con resultados idénticos.

**Independent Test**: suites de `domain`, `gs1` y `extraction` sin cambios en los valores esperados; cada caso patológico de 100 000 caracteres < 1 s.

**Nota**: trabajar en una rama propia desde `main` (independiente de PR1). Patrón común de prueba: `it.each` con entradas como `' '.repeat(1e5) + 'x'`, `'1'.repeat(1e5)`, `'C N '.repeat(25_000)`, midiendo con `performance.now()` y `expect(ms).toBeLessThan(1000)` (ver research.md).

### Tests for User Story 2 (escribir primero; los patológicos deben fallar o tardar antes de corregir)

- [ ] T017 [P] [US2] PR2 · Añadir casos patológicos para `nombreComercial` (`packages/domain/src/formato.ts`) y `parseCantidadTexto` (`packages/domain/src/unidades.ts`) en `packages/domain/test/unidades-formato.test.ts`
- [ ] T018 [P] [US2] PR2 · Añadir casos patológicos para `extraerCn` con `anclado` `true` y `false` (`packages/domain/src/sku.ts`, `CN_AL_FINAL` y `CN_EN_NOMBRE`) en `packages/domain/test/varios.test.ts`
- [ ] T019 [P] [US2] PR2 · Añadir casos patológicos para `parseGs1` (`packages/gs1/src/index.ts`, recorte de `\r\n` final) en `packages/gs1/test/gs1.test.ts`, p. ej. `'\r\n'.repeat(5e4) + 'x'`
- [ ] T020 [P] [US2] PR2 · Añadir casos patológicos para `plazo` (`packages/extraction/src/borrador.ts`) en `packages/extraction/test/extraction.test.ts`
- [ ] T021 [P] [US2] PR2 · Añadir casos patológicos para el respaldo por texto de `RE_CN` y `RE_COLEGIADO` (`packages/extraction/src/azure/reglas-layout.ts`, líneas ~160–161, usadas en ~201 y ~247) en `packages/extraction/test/reglas-layout.test.ts`

### Implementation for User Story 2

- [ ] T022 [P] [US2] PR2 · Reescribir la división de `nombreComercial` en `packages/domain/src/formato.ts:18` (`/(?:^|\s+)\d|,/`) para que sea lineal (p. ej. recorrido que busca el primer dígito precedido de espacio o inicio, o la primera coma), con el mismo resultado en todos los casos de `unidades-formato.test.ts`
- [ ] T023 [P] [US2] PR2 · Reescribir `CN_AL_FINAL` y `CN_EN_NOMBRE` en `packages/domain/src/sku.ts` sin `\s*`/`[\s.:#-]*` solapados con los tokens vecinos (p. ej. una sola clase separadora acotada `{0,5}` o comprobación manual tras `lastIndexOf`), manteniendo `extraerCn` y `varianteCoincideCn`
- [ ] T024 [P] [US2] PR2 · Reescribir la expresión de `parseCantidadTexto` en `packages/domain/src/unidades.ts:58` (`/^\s*(\d+(?:[.,]\d+)?)\s*([^\d\s].*?)\s*$/`) haciendo `trim()` primero y separando número y unidad sin `.*?\s*$`
- [ ] T025 [P] [US2] PR2 · Sustituir `raw.replace(/[\r\n]+$/g, '')` en `packages/gs1/src/index.ts:116` por un recorte desde el final con bucle sobre los códigos de `\r` y `\n`
- [ ] T026 [P] [US2] PR2 · Reescribir la expresión de `plazo` en `packages/extraction/src/borrador.ts:43` (`/(\d+)\s*(d[ií]as?|mes(?:es)?)/i`) para que no reintente desde cada dígito de una serie larga (p. ej. limitar `\s{0,3}` y `\d{1,4}`, o buscar primero la palabra y leer el número anterior)
- [ ] T027 [P] [US2] PR2 · Reescribir `RE_CN` y `RE_COLEGIADO` en `packages/extraction/src/azure/reglas-layout.ts` acotando los separadores (`\s{0,3}`, `\.?` único) para que el coste sea lineal sobre el contenido completo del documento
- [ ] T028 [US2] PR2 · Ejecutar `pnpm --filter @mmx/domain --filter @mmx/gs1 --filter @mmx/extraction test` y la cobertura del dominio (≥ 90 % líneas y ramas, FR-009); ningún valor esperado preexistente puede cambiar (FR-007); commit `fix(seguridad): expresiones regulares de coste lineal (CodeQL js/polynomial-redos)`
- [ ] T029 [US2] PR2 · Revisión ampliada (FR-006a): listar todas las expresiones de `packages/domain/src`, `packages/gs1/src`, `packages/extraction/src`, `packages/cimavet/src` y `packages/siweb/src` (`grep -rnE "new RegExp|/[^/]+/[gimsuy]*\.(exec|test)|\.match\(|\.replace\(/|\.split\(/"`, ~112 sitios) y clasificar cada una: recibe texto externo (sí/no) y tiene cuantificadores que pueden casar los mismos caracteres (sí/no); guardar la tabla en el directorio temporal para la descripción del PR
- [ ] T030 [US2] PR2 · Corregir cada expresión clasificada como vulnerable en T029 en su fichero de `src/`, con su caso patológico en el `test/` del mismo paquete (mismos criterios que T017–T027); commit `fix(seguridad): expresiones regulares adicionales de la revisión`
- [ ] T031 [US2] PR2 · Abrir PR2 con la tabla de T029 en la descripción, la lista de tablas de casos del dominio afectadas (revisión explícita exigida por la constitución) y `Co-Authored-By`/atribución según las instrucciones del repo

**Checkpoint**: US2 lista; al fusionar, CodeQL debe cerrar las 7 alertas.

---

## Phase 5: User Story 3 - Herramientas de desarrollo y compilación (Priority: P2) · PR1

**Goal**: sin alertas en herramientas de prueba, compilación y desarrollo (incluidas las 2 críticas de tinypool).

**Independent Test**: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build && pnpm test:e2e` en verde, cobertura del dominio ≥ 90 %.

### Implementation for User Story 3

- [X] T032 [US3] PR1 · Subir `vitest` y `@vitest/coverage-v8` a `^4.1.12` (última 4.x) en `package.json` raíz; revisar las 9 configuraciones `apps/{api,worker}/vitest.config.ts` y `packages/{gs1,siweb,cimavet,db,extraction,domain,reports}/vitest.config.ts` frente a la guía de migración de Vitest 4 (opciones de `coverage`, `pool`); confirmar con `pnpm why tinypool -r` que tinypool desaparece
- [X] T033 [US3] PR1 · Ejecutar `pnpm test` y la cobertura del dominio; si los umbrales `thresholds` de `packages/domain/vitest.config.ts` dejan de cumplirse por cambios de medición de v8, investigar antes de tocar umbrales (no se bajan)
- [X] T034 [P] [US3] PR1 · Subir `vite` a `^6.4.5` en `apps/web/package.json`; `pnpm --filter @mmx/web build`
- [X] T035 [US3] PR1 · Refrescar `testcontainers` y `@testcontainers/postgresql` dentro de 11.x (`pnpm update testcontainers @testcontainers/postgresql -r`) para que `undici` quede en ≥ 7.30.1; si el rango no lo permite, añadir override `"undici@>=7.0.0 <7.30.1": "^7.30.1"` en `package.json` → `pnpm.overrides`; ejecutar `pnpm test:int`
- [X] T036 [US3] PR1 · Subir `eslint` a `^10` en `package.json` raíz (y `@eslint/js` a su línea compatible); ajustar `eslint.config.js` si cambia la API; `pnpm lint` con `--max-warnings=0` (corregir avisos nuevos sin cambiar comportamiento, en commit separado si son muchos)
- [X] T037 [US3] PR1 · Añadir en `package.json` → `pnpm.overrides` los forzados acotados de research.md: `"esbuild@<0.25.0": "^0.25.12"`, `"esbuild@>=0.27.3 <0.28.1": "^0.28.2"`, `"glob@>=10 <14.0.2": "^14.0.3"`, `"minimatch@>=9 <11.0.1": "^11.0.3"`; `pnpm install`; `pnpm update serialize-javascript -r` para ≥ 7.1.3
- [X] T038 [US3] PR1 · Ejecutar `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build && pnpm test:e2e`; si un override rompe a un consumidor, retirarlo solo para ese rango y anotar el caso para T043; registrar cada override que quede en la tabla de la ADR 0016 como fila `forzado` (FR-013); commit `chore(deps): vitest 4, vite 6.4.5, eslint 10 y forzados de esbuild/glob/minimatch`

**Checkpoint**: US3 lista; sin alertas críticas en ningún ámbito.

---

## Phase 6: User Story 4 - Medias y bajas restantes y excepciones documentadas (Priority: P2) · PR1

**Goal**: 0 alertas abiertas sin decisión; cada descarte con fila en la ADR 0016.

**Independent Test**: panel de Dependabot en 0 abiertas tras fusionar PR1; cada descartada cita su `EXC-NN`.

### Implementation for User Story 4

- [X] T039 [P] [US4] PR1 · Refrescar `fast-uri` (`pnpm update fast-uri -r` → ≥ 3.1.9 y ≥ 4.2.3) y `seroval` (`pnpm update seroval seroval-plugins -r` → ≥ 1.6.11; si no basta, subir `@tanstack/react-router` dentro de 1.x en `apps/web/package.json`); `pnpm --filter @mmx/api test && pnpm --filter @mmx/web build`
- [X] T040 [P] [US4] PR1 · Subir `yauzl` a `3.2.1` (o `^3.4.0` si no había motivo para fijarla; revisar historial con `git log -S'"yauzl"' -- packages/cimavet/package.json`) en `packages/cimavet/package.json`; ejecutar `pnpm --filter @mmx/cimavet test` y `pnpm worker nomenclator-import --muestra` y comparar con la línea base de T004
- [X] T041 [US4] PR1 · Subir `uuid` a `^11.1.1` en `packages/db/package.json` y añadir override `"uuid@<11.1.1": "^11.1.1"` en `package.json` → `pnpm.overrides` (cubre exceljs y dockerode); ejecutar `pnpm --filter @mmx/reports test` (exportaciones con exceljs); si falla, retirar el override para exceljs y anotar el descarte para T043
- [X] T042 [US4] PR1 · Comprobar con `pnpm why glob -r` y `pnpm why minimatch -r` qué copias vulnerables quedan (previsto: glob 7 y minimatch 3/5 vía exceljs → archiver 5, y @eslint/eslintrc si persiste) y confirmar en el código de esas librerías que no se usan con patrones o `AbortSignal` procedentes de datos externos
- [X] T043 [US4] PR1 · Completar la tabla de excepciones de `docs/adr/0016-dependencias-vulnerables-y-excepciones.md` con: EXC-01 deepmerge 4.3.1 (GHSA-gcqx-w48m-w2h4), una fila `descarte` por cada copia restante de T038/T041/T042 con su GHSA y motivo, y las filas `forzado` de T035/T037/T041; fecha, responsable y condición «Revisar cuando»
- [X] T044 [US4] PR1 · Commit `fix(deps): fast-uri, seroval, yauzl, uuid y ADR 0016` y verificación final de PR1 según `specs/001-fix-github-vulnerabilities/quickstart.md` (sección PR 1)
- [ ] T045 [US4] PR1 · Abrir PR1 con la lista de alertas que cierra, la tabla de excepciones y la justificación de los saltos mayores (constitución: complejidad justificada en la descripción); atribución según las instrucciones del repo
- [ ] T046 [US4] PR1 · Tras fusionar PR1: descartar en GitHub cada alerta que siga abierta y tenga fila `descarte` vigente (`gh api -X PATCH repos/jcmendez-guerrero/presvetcheck/dependabot/alerts/<n> -f state=dismissed -f dismissed_reason=tolerable_risk -f dismissed_comment="EXC-NN, ver ADR 0016"`), confirmando antes con el responsable; comprobar 0 alertas abiertas

**Checkpoint**: panel de Dependabot limpio.

---

## Phase 7: User Story 5 - Prevención (Priority: P3) · PR3

**Goal**: propuestas automáticas de actualización y una comprobación de CI que bloquea según el umbral acordado.

**Independent Test**: en una rama de prueba, una dependencia de ejecución con vulnerabilidad alta hace fallar el job; una media solo avisa.

**Nota**: empezar desde `main` después de fusionar PR1 (necesita la tabla de excepciones).

### Implementation for User Story 5

- [ ] T047 [P] [US5] PR3 · Crear `.github/dependabot.yml` según `specs/001-fix-github-vulnerabilities/contracts/ci-seguridad.md`: `npm` en `/` semanal con grupos `produccion` (`dependency-type: production`) y `desarrollo` (`development`), `commit-message.prefix` `fix(deps)` / `chore(deps)`; `github-actions` en `/` semanal con prefijo `ci`
- [ ] T048 [US5] PR3 · Añadir a `.github/workflows/ci.yml` el job `dependencias` (solo `pull_request`, permisos `contents: read` y `pull-requests: write`) con dos pasos `actions/dependency-review-action@v4`: (1) `fail-on-severity: high`, `fail-on-scopes: runtime`; (2) `fail-on-severity: critical`, `fail-on-scopes: development`; ambos con `allow-ghsas` igual a los GHSA de las filas `descarte` vigentes de la ADR 0016 y `comment-summary-in-pr: on-failure`
- [ ] T049 [US5] PR3 · Ampliar `docs/adr/0016-dependencias-vulnerables-y-excepciones.md` con la política de CI (tabla de casos de `contracts/ci-seguridad.md`) y la regla de que `allow-ghsas` debe coincidir con la tabla de excepciones (FR-013a)
- [ ] T050 [US5] PR3 · Verificar en una rama de prueba (sin fusionar, borrar al terminar): añadir una versión de ejecución con vulnerabilidad alta conocida (p. ej. `nodemailer@9.0.0` en `packages/reports/package.json`) → el job falla; cambiarla por una con vulnerabilidad media → el job pasa con aviso
- [ ] T051 [US5] PR3 · Commit `ci: Dependabot agrupado y revisión de dependencias en PR`, abrir PR3 e indicar en la descripción el ajuste manual pendiente: marcar `dependencias` como comprobación obligatoria en la protección de `main`

**Checkpoint**: prevención activa.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T052 [P] Actualizar `AGENTS.md` con una referencia breve a la ADR 0016 (cómo añadir o retirar un forzado o un descarte) para mantenerlo coherente con la constitución
- [ ] T053 Cambiar el estado de la ADR 0016 a «aceptada (fecha)» cuando los 3 PR estén fusionados
- [ ] T054 Validación final según `specs/001-fix-github-vulnerabilities/quickstart.md`: 0 alertas Dependabot abiertas (descartadas solo con `EXC-NN`), 0 alertas CodeQL abiertas en `main`, `pnpm audit --prod --audit-level high` limpio (SC-001, SC-002)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: tras Setup; bloquea US1, US3, US4 y US5. **No** bloquea US2.
- **US1 (Phase 3)** → **US3 (Phase 5)** → **US4 (Phase 6)**: mismo PR1 y mismo lockfile, en este orden (ver commits del plan).
- **US2 (Phase 4)**: tras Setup; independiente del resto (PR2, ficheros `src/` y `test/` disjuntos con PR1).
- **US5 (Phase 7)**: tras fusionar PR1 (necesita la tabla de excepciones para `allow-ghsas`).
- **Polish (Phase 8)**: tras los 3 PR.

### User Story Dependencies

- **US1 (P1)**: solo Foundational.
- **US2 (P1)**: ninguna.
- **US3 (P2)**: tras US1 (comparte `pnpm-lock.yaml`; los overrides de T037 se prueban sobre las versiones nuevas).
- **US4 (P2)**: tras US3 (T042/T043 necesitan saber qué overrides funcionaron).
- **US5 (P3)**: tras PR1 fusionado.

### Within Each User Story

- Pruebas primero (T007–T008, T017–T021); deben pasar con versiones actuales (US1) o mostrar el problema (US2).
- Un commit por grupo de cambio reversible (Conventional Commits).
- `pnpm lint && pnpm typecheck && pnpm test` en verde antes de cada commit.

### Parallel Opportunities

- T003 y T004.
- T007 y T008.
- T017–T021 entre sí; T022–T027 entre sí (ficheros distintos).
- Toda la Phase 4 (PR2) en paralelo con las Phases 2, 3, 5 y 6 (PR1).
- T034 junto a T032/T033; T039 y T040 entre sí.
- T047 junto a T048–T049.

---

## Parallel Example: User Story 2

```bash
# Pruebas patológicas, a la vez:
Task: "T017 casos patológicos de nombreComercial y parseCantidadTexto en packages/domain/test/unidades-formato.test.ts"
Task: "T018 casos patológicos de extraerCn en packages/domain/test/varios.test.ts"
Task: "T019 casos patológicos de parseGs1 en packages/gs1/test/gs1.test.ts"
Task: "T020 casos patológicos de plazo en packages/extraction/test/extraction.test.ts"
Task: "T021 casos patológicos de RE_CN/RE_COLEGIADO en packages/extraction/test/reglas-layout.test.ts"

# Correcciones, a la vez:
Task: "T022 formato.ts" · "T023 sku.ts" · "T024 unidades.ts" · "T025 gs1/index.ts" · "T026 borrador.ts" · "T027 reglas-layout.ts"
```

## Parallel Example: PR1 y PR2 a la vez

```bash
# Persona/sesión A (PR1): T005 → T006 → US1 (T007–T016) → US3 (T032–T038) → US4 (T039–T046)
# Persona/sesión B (PR2): US2 (T017–T031), en su propia rama desde main
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup) y Phase 2 (ADR).
2. Phase 3 (US1): altas de ejecución corregidas.
3. **Parar y validar**: `pnpm audit --prod --audit-level high`, T007 y T008 en verde.

### Incremental Delivery

1. PR2 (US2) puede fusionarse en cuanto esté listo: cierra las 7 alertas de CodeQL.
2. PR1 (US1 + US3 + US4): cierra las 90 de Dependabot (o deja las descartadas con `EXC-NN`).
3. PR3 (US5): evita que vuelvan a acumularse.

---

## Notes

- [P] = ficheros distintos, sin dependencias pendientes.
- Nunca llamar a CIMAVet, Siweb360 ni Azure reales desde pruebas o CI.
- No bajar umbrales de cobertura ni cambiar valores esperados de pruebas existentes para «hacer pasar» una actualización: eso es una regresión.
- No usar `git stash` sin etiqueta en este worktree (pila compartida); preferir commits WIP.
