# Mundo Mascotix · Verificación de recetas veterinarias

Verificación de recetas, dispensación guiada y registro de entradas/salidas para el establecimiento
"Medicamentos Veterinarios". Especificación en `SPEC.md`, convenciones en `AGENTS.md`, decisiones conservadoras
en `docs/dudas.md`, arquitectura en `docs/adr/`, lector de códigos en `docs/scanner.md` y glosario en
`docs/glosario.md`.

## Requisitos
- Node.js 22 (`.nvmrc`) y pnpm 9
- Docker con Compose (PostgreSQL 16 + Azurite) para `pnpm dev` y `pnpm test:int`

Con **colima** (macOS), Testcontainers necesita el socket:
`export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`.

## Arranque
```bash
cp .env.example .env
pnpm i
pnpm dev     # Docker Compose + migraciones + seed + muestra del Nomenclátor + API (3000) + web (5173)
```
Sin Docker, con datos en memoria (PGlite) y stock sintético:
```bash
pnpm demo
```
Abre http://localhost:5173. En modo `AUTH_MODE=dev` se elige el usuario/rol arriba a la derecha (y MFA simulado).

## Comandos
| Comando | Qué hace |
|---|---|
| `pnpm lint && pnpm typecheck && pnpm test` | Puerta de calidad |
| `pnpm test:int` | Integración con Testcontainers (PostgreSQL 16) |
| `pnpm test:e2e` | Humo de la UI con Playwright (receta → dispensación, `EXTRACTOR=fake`) |
| `pnpm db:migrate` / `pnpm db:seed` | Migraciones y maestros desde `fixtures/nomenclator/` |
| `pnpm worker <job>` | `cimavet-delta`, `cimavet-full`, `outbox-dispatcher`, `sales-reconciliation`, `weekly-reports`, `nomenclator-import --muestra\|--fichero`, `retention-sweep`, `db-migrate` |
| `pnpm eval:extraction` | Banco de evaluación de la extracción (`fixtures/recetas/`) |
| `pnpm --filter @mmx/api openapi` | Regenera `apps/api/openapi.json` (documentación en `/api/docs`) |
| `pnpm --filter @mmx/worker spike:siweb -- --sku TEST-…` | Spike de escritura en Siweb360 (SPEC §12.3, lo ejecuta una persona) |
| `docker build -t mmx-recetas .` | Imagen única: API + SPA (`node api/main.js`) y jobs (`node worker/worker.js <job>`) |

## Estructura
`apps/api` (Fastify), `apps/web` (React PWA), `apps/worker` (jobs) · `packages/domain` (reglas puras),
`shared`, `db`, `cimavet`, `siweb`, `extraction`, `gs1`, `reports` · `config/rules` (reglas versionadas) ·
`infra/` (Bicep) · `.github/workflows/ci.yml`.
