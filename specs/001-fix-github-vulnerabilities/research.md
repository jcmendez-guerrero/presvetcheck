# Research: Corrección de las vulnerabilidades detectadas en GitHub

**Fecha**: 2026-11-01 · Fuentes: API de GitHub (alertas Dependabot y CodeQL, avisos GHSA), registro de npm (`npm view`), `pnpm-lock.yaml`, `pnpm audit --prod` y el código del repositorio.

## Estrategia general (orden de preferencia por alerta)

1. **Subir la dependencia directa** a la primera línea que incluya la corrección (preferir la última versión de esa línea mayor, no la última mayor).
2. **Refrescar el fichero de bloqueo** (`pnpm update <pkg> -r` o `--depth`) cuando el padre ya admite la versión corregida dentro de su rango.
3. **Subir el padre** si una versión mantenida del padre trae la corrección.
4. **Forzar con `pnpm.overrides` acotado por rango** (`"glob@>=10 <14.0.2": "^14.0.3"`), nunca global; registrar el forzado en la ADR 0016 (FR-013).
5. **Descartar en GitHub con justificación** (FR-012) solo si no hay versión corregida compatible y el código vulnerable no se alcanza con datos externos.

- **Rationale**: minimiza saltos de versión mayor y deja cada excepción trazable.
- **Alternatives considered**: forzar todo con overrides globales (rompe consumidores con API antigua: glob 7 usa *callbacks*, minimatch 3 exporta una función por defecto); sustituir exceljs (contradice el principio I sin necesidad, porque las rutas vulnerables no se usan).

## Decisiones por librería

| Librería | Actual | Decisión | Mecanismo | Notas |
|----------|--------|----------|-----------|-------|
| nodemailer | ^7.0.3 | **^10.3.1** | 1 (directa, `packages/reports`) | Uso mínimo: `createTransport({host,port,secure,auth})` + `sendMail({from,to,subject,text,attachments})` en `src/mailer.ts`. `engines` `>=20`. Revisar CHANGELOG 8–10 por la interpretación más estricta de direcciones. |
| drizzle-orm | ^0.44.2 | **^0.45.4** | 1 (6 manifiestos) | No se usa `sql.identifier` ni `sql.raw` en el código, pero la alerta aplica igual. drizzle-kit se queda en ^0.31 (última 0.31.11 compatible con 0.45). Verificar que `drizzle-kit generate` no produce migraciones. |
| @fastify/static | ^8.2.0 | **^10.1.8** | 1 (`apps/api`) | Registro con `{ root, wildcard: false }` y `reply.sendFile('index.html')` en `NotFoundHandler`; compatible con Fastify 5. Trae glob ^13 → ver glob. |
| @azure/msal-node | 6.0.1 | **≥ 7.1.0** | 2/3 (`@azure/identity` ^4.14.1 pide `^7.1.0`) | `pnpm update @azure/identity -r`. Sin cambios de código. |
| undici | 7.30.0 | **≥ 7.30.1** | 2 (testcontainers 11.14 pide `^7.24.5`) | Solo pruebas de integración. testcontainers 12 (undici 8) descartado: salto mayor innecesario. |
| tinypool | 1.1.1 | **desaparece** | 1 (vitest ^4.1.12 ya no depende de tinypool) | Cierra las 2 críticas. |
| vitest, @vitest/mocker, @vitest/coverage-v8 | ^3.2.0 | **^4.1.12** (última 4.x) | 1 (raíz) | vitest 5 descartado: exige más cambios y no aporta correcciones adicionales. Configuraciones simples (`include`, `coverage.provider: 'v8'`, umbrales): verificar umbrales del dominio. |
| vite | ^6.3.0 (6.4.4) | **^6.4.5** | 1 (`apps/web`) | Sin salto mayor. vite 7/8 fuera de alcance. |
| esbuild | 0.18.20 / 0.27.7 | **≥ 0.25.0** y **≥ 0.28.1** | 4: `"esbuild@<0.25.0": "^0.25.12"` (@esbuild-kit vía drizzle-kit) y `"esbuild@>=0.27.3 <0.28.1": "^0.28.2"` (tsup 8 / bundle-require) | tsup 9 descartado: salto mayor solo por esto. Solo compilación/desarrollo. |
| fast-uri | 3.1.8 / 4.2.2 | **≥ 3.1.9 / ≥ 4.2.3** | 2 (ajv, @fastify/ajv-compiler, fast-json-stringify admiten el rango) | Ejecución (validación de esquemas de la API). |
| seroval | 1.6.9 | **≥ 1.6.11** | 2 (`@tanstack/router-core` pide `^1.6.7`; última 1.7.6) | Si el refresco no basta, subir `@tanstack/react-router` dentro de 1.x. |
| serialize-javascript | 7.1.2 | **≥ 7.1.3** | 2 (@rollup/plugin-terser) | Solo compilación (PWA). |
| uuid | 11.x directa; 8.3.2 (exceljs); 10.0.0 (dockerode) | **≥ 11.1.1** | 1 (directa `packages/db`) + 4: `"uuid@<11.1.1": "^11.1.1"` | exceljs usa `require('uuid').v4`, que uuid 11 mantiene en CJS. Si las pruebas de exportación fallan, se retira el override para exceljs y se descarta (la vulnerabilidad solo afecta a v3/v5/v6 con `buf`, que exceljs no usa). |
| yauzl | 3.2.0 (fijada) | **3.2.1** (o ^3.4.0) | 1 (`packages/cimavet`) | Mantener fijada si había motivo; comprobar en `descarga.ts` y con el fichero de muestra del Nomenclátor. |
| minimatch | 3.1.5, 5.1.9, 9.0.9, 10.2.6 | **≥ 11.0.1** donde sea compatible | 3: eslint 10 elimina minimatch 3 de eslint y config-array · 4: `"minimatch@>=9 <11.0.1": "^11.0.3"` · 5: minimatch 5 (readdir-glob 1 vía archiver 5 de exceljs; filelist vía workbox) | Aviso: `< 11.0.1` sin ramas corregidas para 3/5/9/10. La vulnerabilidad exige patrones controlados por un atacante; los patrones de archiver/filelist son internos. Si queda alguna copia, una única alerta (por fichero de bloqueo) se descarta con justificación. |
| glob | 7.2.3, 10.5.0, 11.1.0, 13.0.6 | **≥ 14.0.2** donde sea compatible | 4: `"glob@>=10 <14.0.2": "^14.0.3"` (@fastify/static, test-exclude, archiver-utils 5, workbox-build) · 5: glob 7 (archiver-utils 2/3 y rimraf 2 vía exceljs) | glob 7 usa API de *callbacks* incompatible con 14. La vulnerabilidad requiere usar `AbortSignal`; exceljs no lo hace. |
| deepmerge | 4.3.1 | **descartar** | 5 | Sin versión corregida. Solo compilación (@rollup/plugin-node-resolve 16.0.3, última). No procesa datos externos. |
| eslint | ^9.28.0 | **^10** | 3 | Necesario para retirar minimatch 3. typescript-eslint admite `^10.0.0`. `--max-warnings=0`: corregir avisos nuevos en commit propio. |

## Expresiones regulares (PR 2)

- **Decision**: reescribir sin cuantificadores anidados ni alternativas solapadas junto a `\s*`/`\s+`/`.*?`; donde la expresión recorre texto libre largo, sustituirla por recorrido manual o dividir en pasos (p. ej. `trim()` + expresión anclada sin `\s*` final, o `indexOf` del separador). Para `parseGs1`, sustituir `/[\r\n]+$/` por un bucle que recorta desde el final.
- **Rationale**: CodeQL `js/polynomial-redos` señala patrones `\s*X\s*$`, `(?:^|\s+)\d`, `\d+\s*(...)` sobre texto externo. El coste lineal se garantiza mejor con lógica explícita que con trucos de *lookahead*.
- **Revisión ampliada (FR-006a)**: ~112 sitios en `domain`, `gs1`, `extraction`, `cimavet`, `siweb`. Criterio de revisión: la expresión recibe texto externo **y** tiene un cuantificador seguido de otro que puede casar los mismos caracteres. Se documenta la lista revisada en la descripción del PR.
- **Prueba de tiempo acotado**: caso `it.each` con entrada de 100 000 caracteres (p. ej. `' '.repeat(1e5) + 'x'`, `'1'.repeat(1e5)`) y `expect(duración).toBeLessThan(1000)`; medir con `performance.now()` dentro de la prueba (no es el reloj de negocio, así que no viola la inyección de `Clock`).
- **Alternatives considered**: librería `re2` (dependencia nativa pesada, contradice principio I); regla de lint `eslint-plugin-regexp` (opción C de la aclaración, descartada por el usuario).

## Prevención (PR 3)

- **Decision**: `actions/dependency-review-action@v4` en `pull_request` con dos pasos: `fail-on-severity: high` + `fail-on-scopes: runtime`, y `fail-on-severity: critical` + `fail-on-scopes: development`; `allow-ghsas` con los GHSA descartados en la ADR 0016; `comment-summary-in-pr: on-failure` y `warn-only` no se usa. Las medias/bajas aparecen en el resumen sin bloquear.
- **Rationale**: compara solo lo que el PR introduce (FR-016 «cuando un cambio introduzca»); usa la misma base de avisos que Dependabot; gratuita en repositorios públicos (el repo es público); no llama a servicios del dominio.
- **Alternatives considered**: `pnpm audit` en CI (evalúa todo el árbol, no el cambio; falla por alertas preexistentes y no distingue umbral por ámbito sin dos ejecuciones); Snyk/Socket (servicios de terceros, fuera de las suposiciones de la spec).
- **Dependabot**: hoy las *security updates* están activadas pero nunca se ha abierto un PR (no hay `dependabot.yml`). Se crea `.github/dependabot.yml` con `package-ecosystem: npm` en `/` (pnpm se detecta por el lockfile), `groups` para `production` y `development`, y `github-actions` en `/`; frecuencia semanal (SC-006: propuesta en < 1 semana).
- **CodeQL**: ya configurado en modo *default setup* (javascript-typescript, actions); no hay que añadir workflow.

## Entorno

- **Decision**: implementar con Node 22 (el equipo local tiene Node 20.19.5; `pnpm` rechaza ejecutar por `engines`). pnpm se mantiene en 9.15.9.
- `pnpm audit --prod` hoy: 45 vulnerabilidades (8 altas, 32 moderadas, 5 bajas); sirve como comprobación rápida local antes de abrir PR 1.
