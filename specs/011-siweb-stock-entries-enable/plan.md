# Implementation Plan: Activar la escritura de entradas de stock en Siweb360

**Branch**: `claude/stock-update-api-spec-988373` (feature `011-siweb-stock-entries-enable`) | **Date**: 2026-11-09 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/011-siweb-stock-entries-enable/spec.md`

## Summary

El envío de entradas de stock a Siweb360 ya existe (outbox, `SIWEB_STOCK_WRITE_MODE`) y la API 1.3.0 no cambia la
operación de ajuste. La feature añade lo que la SPEC exigía para encenderlo, apoyándose en el historial de movimientos
(`GET inventory/movements`, que devuelve la nota con nuestra referencia):

1. **Verificación automática de envíos dudosos** en el job `outbox-dispatcher`: 1 coincidencia → enviado; 0 o ≥2 →
   sigue en revisión con evidencia. Nunca reenvía.
2. **Cierre de avisos** por cualquier usuario ("Revisado" / "Resuelto a mano en Siweb360"); reenviar/descartar solo
   admin.
3. **Puerta de la prueba de escritura**: se ejecuta desde administración, se audita y el outbox no envía sin una
   superada en los últimos 30 días.
4. **Conciliación nocturna de movimientos** de medicamentos (entradas, ventas, ajustes): vínculo automático con
   recepciones y dispensaciones; el resto, a una bandeja donde se vincula o se justifica con motivo (append-only).
5. **Registro de bajas**: toda salida justificada aparece como `BAJA` en el registro.
6. Arranque bloqueado en producción sin fecha de corte; copia de la API a 1.3.0; SPEC §5.2.4–5.2.5 actualizada.

Detalle de decisiones en [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript estricto, Node.js 22, pnpm 9

**Primary Dependencies**: Fastify + zod (API), drizzle-orm (PostgreSQL), React (web), MSW (tests). Sin dependencias
nuevas.

**Storage**: PostgreSQL 16; migración `0019_conciliacion_movimientos.sql` (2 tablas append-only, 1 columna)

**Testing**: Vitest (`it.each` en dominio), MSW con `fixtures/siweb/`, Testcontainers (`pnpm test:int`), sin Playwright
nuevo (los flujos nuevos son de administración/bandeja)

**Target Platform**: Azure Container Apps (API + jobs), PWA

**Project Type**: monorepo web (apps/api, apps/web, apps/worker, packages/*)

**Performance Goals**: conciliación nocturna < 2 min para 1 día de movimientos (decenas a cientos de filas); verificación
de dudosos ≤ 1 llamada al historial por fila y pasada

**Constraints**: nunca reenviar automáticamente; nunca escribir salidas salvo la reversión de la prueba sobre `TEST-`;
append-only en justificaciones; sin datos personales en logs; ninguna llamada real a Siweb360 en tests

**Scale/Scope**: 1 almacén («Farmacia»), ~10 usuarios, cientos de movimientos/semana

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principio                                                     | Cumplimiento                                                                                                                                                 | Estado           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| I. Dominio puro                                               | `conciliarMovimientos` en `packages/domain` sin I/O; el reloj se inyecta en el outbox (`now`) y en la puerta de 30 días                                      | ✅               |
| I. zod en `packages/shared`                                   | `CerrarOutboxBody`, `JustificarMovimientoBody`, `PruebaEscrituraBody`; tipos inferidos                                                                       | ✅               |
| I. Errores tipados                                            | `SKU_NO_TEST`, `MOTIVO_INCOMPATIBLE`, `CONFLICTO`, `PRUEBA_ESCRITURA_NO_VIGENTE`                                                                             | ✅               |
| II. Tests sin servicios reales; casos de error                | MSW: 5xx, timeout, capitalización, campos nuevos, 409, `reference_id` cadena/número                                                                          | ✅               |
| II. No inventar estructuras                                   | `reference_type` de tickets del TPV sin muestra real → `it.todo` pidiendo `fixtures/siweb/movements-ticket.json`                                             | ✅               |
| III. Sin datos personales                                     | Los movimientos no traen datos de propietarios; `notes` no se registra en logs                                                                               | ✅               |
| III. Sin UPDATE/DELETE en registros                           | `siweb_movimiento` y `movimiento_justificacion` append-only (trigger + REVOKE); corrección = sustitución                                                     | ✅               |
| III. Reglas legales fuera de UI/prompts                       | Compatibilidad motivo/sentido y reglas de conciliación en `packages/domain`                                                                                  | ✅               |
| III. Roles comprobados en API                                 | `requiereRol` en todas las rutas nuevas; reenviar/descartar solo admin                                                                                       | ✅               |
| III. Arranque en producción                                   | `superRefine`: `entries_only` sin `ENTRY_CUTOVER_DATE` → no arranca                                                                                          | ✅               |
| Regulatorio: outbox + `SIWEB_STOCK_WRITE_MODE`; nunca salidas | El outbox no cambia su guarda `exigirEntrada`. La prueba de escritura (−1 de reversión) es la excepción ya documentada en SPEC §12.3, limitada a SKU `TEST-` | ✅ (justificado) |
| IV. Variables en `.env.example`                               | Sin variables nuevas; se amplían descripciones de `SIWEB_STOCK_WRITE_MODE` y `ENTRY_CUTOVER_DATE`                                                            | ✅               |
| IV. Decisiones abiertas como TODO                             | `TODO(decision DUDA-30)`: justificaciones de entradas en el registro                                                                                         | ✅               |
| IV. Glosario                                                  | Añadir "justificación de movimiento", "baja", "movimiento sin justificar", "prueba de escritura"                                                             | ✅               |
| V. Español en producto                                        | UI, ADR y comentarios de dominio en español                                                                                                                  | ✅               |
| Gates: ADR                                                    | ADR-0018 "Conciliación de movimientos de inventario de Siweb360"                                                                                             | ✅               |

**Re-check post-diseño**: sin violaciones. La única desviación aparente (escritura de un −1) es la prevista en SPEC §12.3.

## Project Structure

### Documentation (this feature)

```text
specs/011-siweb-stock-entries-enable/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api-stock-siweb.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/domain/src/conciliacion-movimientos.ts      # NUEVO: conciliarMovimientos, motivos y compatibilidad
packages/domain/test/conciliacion-movimientos.test.ts
packages/shared/src/config.ts                         # superRefine FR-010
packages/shared/src/                                  # zod: CerrarOutboxBody, JustificarMovimientoBody, PruebaEscrituraBody
packages/shared/src/i18n/                             # textos de códigos nuevos y motivos
packages/db/src/schema/infra.ts                       # siwebMovimiento, movimientoJustificacion, outbox.verificaciones
packages/db/migrations/0019_conciliacion_movimientos.sql
packages/siweb/src/schemas.ts                         # reference_id número|cadena
packages/siweb/src/outbox.ts                          # verificarDudosos, cerrar, puerta pruebaVigente, next_attempt_at
packages/siweb/src/prueba-escritura.ts                # MOVIDO desde apps/worker/src/spikes/spike-siweb.ts (+ notas e historialOk)
packages/siweb/src/conciliacion-movimientos.ts        # NUEVO: conciliarMovimientosDia (lee, guarda, vincula)
packages/siweb/test/
packages/reports/src/datos.ts                         # bajas(), BAJA en psicotropos()
packages/reports/src/entradas.ts                      # tipo 'BAJA' | 'ANULACIÓN BAJA'
apps/api/src/rutas/admin.ts                           # prueba-escritura, estado-stock, outbox ampliado
apps/api/src/rutas/                                   # outbox/cerrar, outbox/revision, movimientos-siweb (operativa)
apps/api/src/crear-deps.ts                            # pruebaVigente para OutboxService
apps/worker/src/contexto.ts                           # ídem
apps/worker/src/jobs/outbox.ts                        # llama a verificarDudosos
apps/worker/src/jobs/conciliacion.ts                  # llama a conciliarMovimientosDia tras conciliarDia
apps/worker/src/spikes/siweb-write-check.ts           # importa de @mmx/siweb
apps/web/src/paginas/admin.tsx                        # estado del stock + prueba de escritura
apps/web/src/paginas/pendientes.tsx                   # bandejas "Envíos a Siweb360 en revisión" y "Movimientos sin justificar"
apps/web/src/paginas/registros.tsx                    # registro "Bajas"
docs/ref/siweb360-openapi.json                        # 1.3.0
docs/adr/0018-conciliacion-movimientos-siweb.md
docs/glosario.md, SPEC.md (§5.2.4, §5.2.5, §12.3), .env.example
```

**Structure Decision**: se respeta la estructura actual del monorepo. La lógica de decisión va a `packages/domain`,
la orquestación con Siweb360 y BD a `packages/siweb` (como `conciliarDia`), y no se crea ningún job nuevo de
infraestructura: la verificación va en `outbox-dispatcher` y la conciliación en `sales-reconciliation`.

## Orden sugerido (para `/speckit-tasks`)

1. Base: copia API 1.3.0, `reference_id`, migración 0019, zod, config FR-010.
2. US4 + puerta: mover prueba de escritura, ruta admin, `pruebaVigente`, estado del stock (sin esto no se debe
   encender nada).
3. US1/US2: `verificarDudosos`, `cerrar`, bandeja de envíos en revisión.
4. US3: dominio `conciliarMovimientos`, `conciliarMovimientosDia`, bandeja y justificación.
5. Registro de bajas + informe semanal.
6. Docs: ADR-0018, SPEC, glosario, DUDA-30.

## Complexity Tracking

Sin violaciones que justificar.
