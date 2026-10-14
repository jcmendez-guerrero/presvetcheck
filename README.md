# Mundo Mascotix · Verificación de recetas veterinarias

Sistema de verificación de recetas, dispensación y registro de entradas/salidas
(ver `SPEC.md` para la especificación y `AGENTS.md` para las convenciones).

## Requisitos
- Node.js 22 (`.nvmrc`) y pnpm 9
- Docker con el plugin Compose (PostgreSQL 16 + Azurite)

## Arranque en local
```bash
cp .env.example .env
pnpm i
pnpm dev          # docker compose + migraciones + seed + API (3000) + web (5173)
```

## Comandos
| Comando | Qué hace |
|---|---|
| `pnpm lint && pnpm typecheck && pnpm test` | Puerta de calidad antes de terminar cualquier tarea |
| `pnpm test:int` | Integración con Testcontainers (requiere Docker) |
| `pnpm db:migrate` / `pnpm db:seed` | Migraciones y datos maestros desde `fixtures/` |
| `pnpm worker <job>` | Ejecuta un job en local |
| `pnpm eval:extraction` | Banco de evaluación de la extracción |
