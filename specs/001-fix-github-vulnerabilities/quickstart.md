# Quickstart: validar la corrección de vulnerabilidades

## Requisitos previos

- Node 22 (`nvm use` lee `.nvmrc`); con Node 20, `pnpm` se niega a ejecutar.
- pnpm 9.15.9, Docker en marcha (Testcontainers), `gh` autenticado.
- Muestra del Nomenclátor: `pnpm nomenclator:fetch --si-falta`.

## Puertas comunes a los 3 PR

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## PR 1 — Dependencias

```bash
pnpm test:int && pnpm build && pnpm test:e2e
```

```bash
pnpm audit --prod --audit-level high
```

Esperado: 0 altas/críticas de ejecución; las restantes están en la tabla de la ADR 0016.

Comprobaciones específicas:

| Qué | Cómo | Esperado |
|-----|------|----------|
| Sin migraciones nuevas (FR-004) | `pnpm --filter @mmx/db exec drizzle-kit generate` | «No schema changes» |
| Correo de informes (FR-002) | Prueba de `packages/reports` del mailer | Mismos destinatarios, asunto, cuerpo y adjuntos |
| Rutas de la web (FR-003) | Pruebas de API con `/../package.json`, `/%2e%2e%2fpackage.json`, `/assets%2f..%2f..%2fpackage.json` | 404 o `index.html`, nunca el fichero |
| Nomenclátor con yauzl nuevo | `pnpm worker nomenclator-import --muestra` | Mismo número de registros que antes |
| Cobertura del dominio | `pnpm --filter @mmx/domain test -- --coverage` | ≥ 90 % líneas y ramas |
| Tras fusionar | `gh api "repos/jcmendez-guerrero/presvetcheck/dependabot/alerts?state=open" --jq length` | 0 (descartadas aparte, cada una con `EXC-NN`) |

## PR 2 — Expresiones regulares

```bash
pnpm --filter @mmx/domain --filter @mmx/gs1 --filter @mmx/extraction --filter @mmx/cimavet --filter @mmx/siweb test
```

Esperado: todas las tablas de casos existentes sin cambios en sus valores esperados (SC-003) y cada prueba patológica de 100 000 caracteres < 1 s (SC-004). Tras fusionar, CodeQL en `main`:

```bash
gh api "repos/jcmendez-guerrero/presvetcheck/code-scanning/alerts?state=open" --jq length
```

Esperado: 0.

## PR 3 — Prevención

- En una rama de prueba (no fusionar), añadir una dependencia de ejecución con una vulnerabilidad alta conocida → el job `dependencias` falla.
- Repetir con una vulnerabilidad media → el job pasa con aviso.
- Validar `dependabot.yml` en la pestaña *Insights → Dependency graph → Dependabot* (sin errores de configuración).

Formatos y reglas: [contracts/ci-seguridad.md](./contracts/ci-seguridad.md), [contracts/adr-excepciones.md](./contracts/adr-excepciones.md), [data-model.md](./data-model.md).
