# Implementation Plan: Corrección de las vulnerabilidades detectadas en GitHub

**Branch**: `claude/github-code-vulnerabilities-0fb862` (directorio de spec `001-fix-github-vulnerabilities`) | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-fix-github-vulnerabilities/spec.md`

## Summary

Cerrar las 97 alertas de seguridad abiertas en GitHub (90 de Dependabot y 7 de CodeQL) en 3 PR independientes (FR-017):

1. **PR 1 — Dependencias** (`fix(deps)`): subir las dependencias directas a versiones corregidas dentro de la línea
   más cercana posible (nodemailer 7 → 10, @fastify/static 8 → 10, vitest 3 → 4, drizzle-orm 0.44 → 0.45, eslint 9 → 10,
   vite 6.4.5, uuid 11.1.1+, yauzl 3.2.1+), refrescar el fichero de bloqueo para las transitivas que ya admiten la versión
   corregida (undici, @azure/msal-node, fast-uri, seroval, serialize-javascript), forzar con `pnpm.overrides` acotados las
   que no (esbuild, glob, minimatch, uuid de exceljs), y descartar con justificación las que no tienen salida compatible
   (deepmerge y, si las pruebas lo confirman, las copias antiguas de glob/minimatch que arrastra exceljs). Crea la ADR 0016
   con la política y la tabla de excepciones.
2. **PR 2 — Expresiones regulares** (`fix(seguridad)`): reescribir las 7 expresiones señaladas por CodeQL para que su coste sea lineal, revisar las ~112 expresiones de `domain`, `gs1`, `extraction`, `cimavet` y `siweb`, corregir las vulnerables y añadir una prueba de entrada patológica por función corregida.
3. **PR 3 — Prevención** (`ci`): `.github/dependabot.yml` con actualizaciones agrupadas y un job `dependency-review` en la integración continua con el umbral acordado (altas/críticas de ejecución, críticas de desarrollo), alimentado por la tabla de excepciones de la ADR.

## Technical Context

**Language/Version**: TypeScript 5.8 (estricto) sobre Node.js 22 (`.nvmrc` = 22; `engines.node` `>=22 <23`)

**Primary Dependencies**: Fastify 5 + @fastify/static, Drizzle ORM, nodemailer, exceljs, @azure/identity, React + TanStack Router (web), Vite 6, Vitest, tsup, Testcontainers 11

**Storage**: PostgreSQL 16 (sin cambios de esquema en este trabajo)

**Testing**: Vitest (unitarias con cobertura v8 ≥ 90 % en dominio), Testcontainers (`pnpm test:int`), Playwright (`pnpm test:e2e`, `EXTRACTOR=fake`), MSW y `fixtures/`

**Target Platform**: Azure Container Apps (imagen Docker en GHCR); CI en GitHub Actions `ubuntu-latest`

**Project Type**: Monorepo web (pnpm 9 workspaces + turbo): `apps/api`, `apps/web`, `apps/worker`, `packages/*`

**Performance Goals**: cada función con expresión corregida procesa 100 000 caracteres patológicos en < 1 s (SC-004)

**Constraints**: sin cambios de comportamiento visible (SC-003, SC-005); sin migraciones nuevas (FR-004); sin llamadas reales a CIMAVet/Siweb360/Azure desde pruebas o CI; Node 22 sin cambio de versión; pnpm 9 sin cambio de versión mayor

**Scale/Scope**: 18 librerías afectadas, 6 manifiestos + fichero de bloqueo; 7 expresiones señaladas y ~112 sitios con expresiones regulares a revisar en 5 paquetes

Todas las incógnitas técnicas se resolvieron en [research.md](./research.md); no queda ningún NEEDS CLARIFICATION.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio / regla | Cómo se cumple | Estado |
| --- | --- | --- |
| I. Calidad: dominio puro, TS estricto, sin dependencias pesadas nuevas | Las correcciones de expresiones en `packages/domain` no añaden I/O ni reloj. No se añade ninguna librería nueva: solo se suben versiones; `pnpm.overrides` no es una dependencia. No se sustituye exceljs. | ✅ |
| II. Pruebas: `lint && typecheck && test` en verde; `test:int` si se tocan integraciones; casos por tabla | Las 3 PR exigen las 3 órdenes; PR 1 añade `test:int` y `test:e2e` (sube Testcontainers/undici, Vite, Vitest). PR 2 añade casos `it.each` patológicos y no toca los resultados esperados existentes. | ✅ |
| II. Nunca servicios reales en pruebas/CI | `dependency-review-action` consulta la base de avisos de GitHub, no CIMAVet/Siweb360/Azure. | ✅ |
| III. Datos personales fuera de logs | Las pruebas nuevas usan textos sintéticos (repeticiones de caracteres), sin datos de propietarios. | ✅ |
| III. Identidad gestionada, sin claves estáticas | `@azure/identity` se mantiene en 4.x; solo cambia su dependencia interna msal-node. No se tocan variables de Azure. | ✅ |
| IV. Variables en `.env.example`; Conventional Commits; PR acotados | No se espera ninguna variable nueva; si nodemailer 10 la exigiera, se documenta. 3 PR con `fix(deps)`, `fix(seguridad)`, `ci`. | ✅ |
| V. Español en artefactos de desarrollo | Spec, plan, ADR 0016 y comentarios en español; identificadores genéricos en inglés. | ✅ |
| Flujo: ADR para decisiones duraderas, escrita junto al cambio | ADR 0016 (política de dependencias vulnerables y excepciones) entra en PR 1 y se amplía en PR 3. | ✅ |
| Flujo: PR que toca `packages/domain` exige revisar sus tablas de casos | PR 2 lo indica en la descripción y enumera las tablas afectadas. | ✅ |

Sin violaciones: no hace falta *Complexity Tracking*.

**Re-check tras la fase 1 (diseño)**: sigue sin violaciones. El diseño no añade dependencias (dependency-review-action es una acción de GitHub en CI, no una dependencia del producto), no toca el esquema, mantiene `packages/domain` puro (la medición de tiempo en pruebas usa `performance.now()`, no el reloj de negocio) y deja cada excepción trazable en la ADR 0016.

**Desviación de la spec detectada en la investigación**: SC-001 decía «como máximo 1 descartada (deepmerge)».
La investigación muestra que exceljs 4.4.0 (última versión, sin mantenimiento desde 12/2024) arrastra glob 7 y
minimatch 5 vía archiver 5, cuya API es incompatible con las versiones corregidas (glob ≥ 14.0.2, minimatch ≥ 11.0.1).
Se actualizó SC-001 para permitir descartes justificados según FR-012 cuando no exista versión corregida alcanzable
sin sustituir una librería y el código vulnerable no se alcance con datos externos.

## Project Structure

### Documentation (this feature)

```text
specs/001-fix-github-vulnerabilities/
├── plan.md              # Este fichero
├── research.md          # Fase 0: decisiones de versión y estrategia por librería
├── data-model.md        # Fase 1: alerta, dependencia, excepción (tabla de la ADR)
├── quickstart.md        # Fase 1: cómo validar cada PR
├── contracts/
│   ├── adr-excepciones.md   # Formato de la tabla de excepciones de la ADR 0016
│   └── ci-seguridad.md      # Contrato de la comprobación de CI y de Dependabot
├── checklists/requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks; no lo crea este comando)
```

### Source Code (repository root)

```text
package.json                     # PR 1: vitest, @vitest/coverage-v8, eslint, pnpm.overrides
pnpm-lock.yaml                   # PR 1: regenerado
apps/
├── api/package.json             # PR 1: @fastify/static ^10.1.8, drizzle-orm ^0.45.4
│   └── src/app.ts               # PR 1: revisar registro de fastifyStatic (wildcard: false)
├── web/package.json             # PR 1: vite ^6.4.5 (y TanStack Router si hace falta para seroval)
└── worker/package.json          # PR 1: drizzle-orm
packages/
├── reports/                     # PR 1: nodemailer ^10.3, drizzle-orm; src/mailer.ts
├── cimavet/                     # PR 1: yauzl ^3.2.1, drizzle-orm · PR 2: revisión de expresiones
├── db/                          # PR 1: drizzle-orm, uuid
├── siweb/                       # PR 1: drizzle-orm · PR 2: revisión de expresiones
├── domain/src/{formato,sku,unidades}.ts      # PR 2
├── extraction/src/{borrador.ts,azure/reglas-layout.ts}  # PR 2
└── gs1/src/index.ts             # PR 2
docs/adr/0016-dependencias-vulnerables-y-excepciones.md  # PR 1 (crea), PR 3 (amplía)
.github/
├── dependabot.yml               # PR 3 (nuevo)
└── workflows/ci.yml             # PR 3: job dependency-review
```

**Structure Decision**: se mantiene la estructura actual del monorepo; no se crean paquetes ni carpetas nuevas salvo `.github/dependabot.yml` y la ADR 0016.

## Orden y dependencias entre PR

- PR 1 y PR 2 son independientes y pueden prepararse en paralelo (ficheros disjuntos: manifiestos/lockfile frente a `src/` de 5 paquetes). Si PR 2 se fusiona antes, PR 1 solo necesita rebase del lockfile.
- PR 3 va después de PR 1: la comprobación de CI fallaría con las alertas de partida y necesita la tabla de excepciones de la ADR 0016 para su lista de permitidos.
- Dentro de PR 1, orden de commits recomendado (reversibles por separado): (a) producción sin salto mayor (drizzle, uuid, yauzl, refresco de transitivas), (b) nodemailer 10, (c) @fastify/static 10, (d) herramientas (vitest 4, vite, eslint 10, overrides de esbuild/glob/minimatch), (e) ADR 0016 y descartes.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| nodemailer 10 interpreta direcciones de forma más estricta | Prueba de `mailer.ts` con las direcciones de `.env.example` y con varios destinatarios; revisar CHANGELOG 8/9/10. |
| @fastify/static 10 cambia el manejo de rutas no canónicas | Pruebas de API nuevas: `/../`, `%2e%2e%2f`, `%2f`, `//`; deben devolver 404 o `index.html`, nunca un fichero externo. |
| vitest 4 cambia configuración o cobertura | Las 9 configuraciones son simples (`include`, `coverage.v8`, umbrales); comprobar que los umbrales del dominio siguen ≥ 90 %. |
| Override de glob/minimatch rompe a un consumidor | Overrides acotados por rango de versión (no globales); si una suite falla, se retira el override de ese consumidor y se documenta el descarte. |
| eslint 10 introduce reglas o avisos nuevos (`--max-warnings=0`) | Ajustar configuración o código sin cambiar comportamiento; si el ruido es grande, se separa en commit propio. |
| Node 20 en el equipo local | Usar Node 22 (`.nvmrc`) antes de empezar; sin él `pnpm` se niega a ejecutar. |
