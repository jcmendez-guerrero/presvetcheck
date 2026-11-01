# ADR-16 · Dependencias vulnerables: política de corrección y tabla de excepciones

- **Estado:** propuesta (01/11/2026)

## Contexto
- El 01/11/2026 GitHub tenía abiertas **90 alertas de Dependabot** (2 críticas, 20 altas, 57 medias, 11 bajas) en 18
  librerías y **7 alertas de CodeQL** (`js/polynomial-redos`, todas altas) en código propio. No había alertas de
  secretos expuestos.
- No existía `.github/dependabot.yml` y las actualizaciones de seguridad automáticas de Dependabot fallaban sin
  abrir ningún PR, así que las alertas se acumularon.
- Algunas copias vulnerables no se pueden corregir solo con una actualización: las arrastran librerías sin
  mantenimiento (exceljs 4.4.0, sin versión nueva desde 12/2024) o con una API incompatible con la versión corregida
  (glob 7 usa *callbacks*; minimatch 3 exporta una función por defecto), o no existe versión corregida (deepmerge).
- Especificación del trabajo: `specs/001-fix-github-vulnerabilities/`.

## Decisión
1. **Orden de preferencia** para corregir una alerta de dependencias:
  1. Subir la dependencia directa a la primera línea con la corrección (la última versión de esa línea mayor).
  2. Refrescar el fichero de bloqueo cuando el padre ya admite la versión corregida.
  3. Subir el padre si una versión mantenida del padre trae la corrección.
  4. Forzar la versión con `pnpm.overrides` **acotado por rango** (nunca un forzado global).
  5. Descartar la alerta en GitHub con justificación.
2. **Criterio de descarte**: solo cuando no hay versión corregida alcanzable sin sustituir una librería **y** el
  código vulnerable no se alcanza con datos externos (escáner, recetas, CIMAVet, Siweb360, peticiones a la API).
  El comentario de descarte en GitHub cita el identificador de la excepción («EXC-NN, ver ADR-16»).
3. **Trazabilidad**: cada forzado de `pnpm.overrides` y cada descarte tiene una fila vigente en la tabla de abajo.
  Toda alta, cambio o retirada de una excepción se hace en el mismo PR que la causa.
4. **Retirada**: cuando se cumple la condición «Revisar cuando», se retira el forzado o se reabre la alerta y la
  fila pasa a «retirada (fecha)»; las filas no se borran.

## Excepciones

| Id | Tipo | Paquete y rango | GHSA | Motivo | Fecha | Responsable | Revisar cuando | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EXC-01 | descarte | deepmerge 4.3.1 | GHSA-gcqx-w48m-w2h4 | No existe versión corregida. Solo se usa al compilar la web (@rollup/plugin-node-resolve 16.0.3, la última) para fusionar opciones propias del plugin; no procesa datos externos. | 01/11/2026 | Juan Camilo Mendez Guerrero | Se publica deepmerge > 4.3.1 o el plugin deja de usarlo. | vigente |
| EXC-02 | forzado | `esbuild@<0.25.0` → `^0.25.12` | GHSA-67mh-4wv8-2f99 | `@esbuild-kit/core-utils` (vía drizzle-kit 0.31) fija esbuild 0.18. Solo desarrollo (generación de migraciones). | 01/11/2026 | Juan Camilo Mendez Guerrero | drizzle-kit deja de depender de `@esbuild-kit`. | vigente |
| EXC-03 | forzado | `esbuild@>=0.27.3 <0.28.1` → `^0.28.2` | GHSA-g7r4-m6w7-qqqr | tsup 8.5.1 (última 8.x) pide esbuild ^0.27; subir a tsup 9 sería un salto mayor solo por esto. Solo compilación. | 01/11/2026 | Juan Camilo Mendez Guerrero | Se sube a tsup 9 o tsup 8.x admite esbuild ≥ 0.28.1. | vigente |
| EXC-04 | forzado | `glob@>=10 <14.0.2` → `^14.0.3` | GHSA-3g3m-2fjr-6pw4 | @fastify/static 10.1.8 (glob ^13), archiver-utils 5 (^10, vía testcontainers) y workbox-build 7.4.1 (^11) no admiten aún glob ≥ 14.0.2; la API de glob 10–14 es compatible. | 01/11/2026 | Juan Camilo Mendez Guerrero | Esos tres paquetes publican versiones con glob ≥ 14.0.2. | vigente |
| EXC-05 | forzado | `minimatch@>=9 <11.0.1` → `^11.0.3` | GHSA-g3hv-75wg-m249 | eslint 10, @eslint/config-array, typescript-eslint y glob piden minimatch ^9/^10; la API de minimatch 9–11 es compatible. | 01/11/2026 | Juan Camilo Mendez Guerrero | Esos paquetes piden minimatch ≥ 11.0.1. | vigente |
| EXC-06 | descarte | minimatch 3.1.5 (vía glob 7, que no está afectado por GHSA-3g3m-2fjr-6pw4) y 5.1.9 (readdir-glob 1 vía archiver 5; filelist vía ejs/workbox-build) | GHSA-g3hv-75wg-m249 | Sin rama corregida para minimatch 3 y 5 (`< 11.0.1`) y sin API compatible. El aviso exige patrones controlados por un atacante: aquí los patrones son fijos en el código (archiver/exceljs) o del propio proyecto al compilar la PWA. | 01/11/2026 | Juan Camilo Mendez Guerrero | exceljs publica una versión con archiver ≥ 7 (o se sustituye exceljs) y workbox-build deja de depender de ejs/jake. | vigente |
| EXC-07 | forzado | `uuid@<11.1.1` → `^11.1.1` | GHSA-w5hq-g745-h8pq | exceljs 4.4.0 pide uuid ^8.3 y dockerode 4 (pruebas) ^10; ambos usan `v4()`, que uuid 11 mantiene igual en CommonJS. | 01/11/2026 | Juan Camilo Mendez Guerrero | exceljs y dockerode piden uuid ≥ 11.1.1. | vigente |

## Consecuencias
- Las alertas abiertas en GitHub reflejan solo problemas nuevos: una alerta antigua no corregida siempre tiene aquí
  su motivo y su condición de revisión.
- Los forzados de versión pueden ocultar incompatibilidades: por eso se acotan por rango y se cubren con la suite
  completa (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build && pnpm test:e2e`).
- Revisar esta tabla al actualizar exceljs, drizzle-kit, eslint o los plugins de Rollup/Vite.
