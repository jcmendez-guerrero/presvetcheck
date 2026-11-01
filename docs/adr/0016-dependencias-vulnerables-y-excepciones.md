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
|----|------|-----------------|------|--------|-------|-------------|----------------|--------|

## Consecuencias
- Las alertas abiertas en GitHub reflejan solo problemas nuevos: una alerta antigua no corregida siempre tiene aquí
  su motivo y su condición de revisión.
- Los forzados de versión pueden ocultar incompatibilidades: por eso se acotan por rango y se cubren con la suite
  completa (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build && pnpm test:e2e`).
- Revisar esta tabla al actualizar exceljs, drizzle-kit, eslint o los plugins de Rollup/Vite.
