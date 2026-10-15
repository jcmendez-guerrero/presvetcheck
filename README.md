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
cp .env.example .env   # los ajustes propios van en .env.local (gana sobre .env y no se pisa)
pnpm i
pnpm dev     # Docker Compose + Nomenclátor (si falta) + migraciones + seed + muestra + API (3000) + web (5173)
```
Los XML de CIMAVet (Nomenclátor y diccionarios) **no están en git**: `pnpm nomenclator:fetch` los descarga de
CIMAVet a `fixtures/nomenclator/` y genera la muestra de los tests (lo hacen solos `pnpm dev`, `pnpm demo` y la CI).
Hace falta antes de `pnpm test` en un clon nuevo.
Sin Docker, con datos en memoria (PGlite) y stock sintético:
```bash
pnpm demo
```
Abre http://localhost:5173. En modo `AUTH_MODE=dev` se elige el usuario/rol arriba a la derecha (y MFA simulado).
Roles: empleado, veterinaria responsable y administración. El farmacéutico garante no usa la app: lo que hace
fuera (autorizar, firmar) lo registra el empleado, y revisa el reporte semanal que recibe por correo.

La banda amarilla dice si la lectura de recetas es **real** (Document Intelligence: pon `EXTRACTOR=azure`,
`DOCINTEL_ENDPOINT` y `DOCINTEL_MODEL_ID=prebuilt-layout` en `.env.local` y haz `az login`) o **simulada**
(`EXTRACTOR=fake`, devuelve recetas de ejemplo).

**Móvil:** el botón «Móvil» de la cabecera enseña un QR. Al leerlo con el móvil (misma red Wi‑Fi; `pnpm demo`
publica la web en la red local) se abre una página para fotografiar recetas y leer códigos de envases: la receta
se abre en el PC para revisarla y los códigos llegan a la pantalla de escaneo abierta. Sin HTTPS (en local) el
móvil lee el código de una foto; con HTTPS (Azure), también con la cámara en vivo.

## Comandos
| Comando | Qué hace |
|---|---|
| `pnpm nomenclator:fetch [--si-falta]` | Descarga el Nomenclátor de CIMAVet y genera la muestra de tests |
| `pnpm lint && pnpm typecheck && pnpm test` | Puerta de calidad |
| `pnpm test:int` | Integración con Testcontainers (PostgreSQL 16) |
| `pnpm test:e2e` | Humo de la UI con Playwright (receta → dispensación, `EXTRACTOR=fake`) |
| `pnpm db:migrate` / `pnpm db:seed` | Migraciones y maestros desde `fixtures/nomenclator/` |
| `pnpm worker <job>` | `cimavet-delta`, `cimavet-full`, `outbox-dispatcher`, `sales-reconciliation`, `weekly-reports`, `nomenclator-import --descargar\|--muestra\|--fichero`, `retention-sweep`, `db-migrate` |
| `pnpm eval:extraction` | Banco de evaluación de la extracción (`fixtures/recetas/`) |
| `pnpm --filter @mmx/api openapi` | Regenera `apps/api/openapi.json` (documentación en `/api/docs`) |
| `pnpm --filter @mmx/worker spike:siweb -- --sku TEST-…` | Spike de escritura en Siweb360 (SPEC §12.3, lo ejecuta una persona) |
| `docker build -t mmx-recetas .` | Imagen única: API + SPA (`node api/main.js`) y jobs (`node worker/worker.js <job>`) |

## Estructura
`apps/api` (Fastify), `apps/web` (React PWA), `apps/worker` (jobs) · `packages/domain` (reglas puras),
`shared`, `db`, `cimavet`, `siweb`, `extraction`, `gs1`, `reports` · `config/rules` (reglas versionadas) ·
`infra/` (Bicep) · `.github/workflows/ci.yml`.
