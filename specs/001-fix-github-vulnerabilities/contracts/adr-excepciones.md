# Contrato: tabla de excepciones de la ADR 0016

Fichero: `docs/adr/0016-dependencias-vulnerables-y-excepciones.md` (sigue el formato de las ADR existentes en `docs/adr/`).

## Secciones obligatorias de la ADR

1. **Contexto**: alertas de partida (2026-11-01) y motivo de la política.
2. **Decisión — política**:
   - Orden de preferencia: directa → lockfile → padre → override acotado → descarte.
   - Umbral de bloqueo en CI (ver [ci-seguridad.md](./ci-seguridad.md)).
   - Criterio de descarte: sin versión corregida alcanzable sin sustituir una librería **y** código vulnerable no alcanzable con datos externos.
   - Regla de mantenimiento: toda alta, cambio o retirada de una excepción se hace en el mismo PR que la causa (FR-013a).
3. **Tabla de excepciones** (formato abajo).
4. **Consecuencias**.

## Formato de la tabla

```markdown
| Id | Tipo | Paquete y rango | GHSA | Motivo | Fecha | Responsable | Revisar cuando | Estado |
|----|------|-----------------|------|--------|-------|-------------|----------------|--------|
| EXC-01 | descarte | deepmerge 4.3.1 | GHSA-gcqx-w48m-w2h4 | Sin versión corregida; solo en compilación (@rollup/plugin-node-resolve); no procesa datos externos. | 2026-11-xx | … | Se publica deepmerge > 4.3.1 o el plugin deja de usarlo. | vigente |
| EXC-02 | forzado | `esbuild@<0.25.0` → `^0.25.12` | GHSA-67mh-4wv8-2f99 | @esbuild-kit (vía drizzle-kit) fija esbuild 0.18. | … | … | drizzle-kit deja de depender de @esbuild-kit. | vigente |
```

## Reglas de validación

- Cada override de `package.json` → `pnpm.overrides` tiene exactamente una fila `forzado` vigente con la misma clave.
- Cada alerta descartada en GitHub tiene una fila `descarte` vigente con su GHSA, y el texto de descarte en GitHub cita el `Id` (p. ej. «EXC-01, ver ADR 0016»).
- La lista `allow-ghsas` del workflow de CI es exactamente el conjunto de GHSA de filas `descarte` vigentes.
- Textos en español (principio V).
