# Tasks: Activar la escritura de entradas de stock en Siweb360

**Input**: Design documents from `specs/011-siweb-stock-entries-enable/` (`plan.md`, `spec.md`, `research.md`,
`data-model.md`, `contracts/api-stock-siweb.md`, `quickstart.md`)

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`

**Tests**: incluidos. La constitución (Principio II) exige tests de dominio con `it.each` y casos de error en outbox y
conciliación; cada historia de la spec define un "Independent Test".

**Organization**: tareas agrupadas por historia de usuario. Orden de historias según el plan: la puerta de puesta en
marcha (US4) va antes que el resto porque sin ella no debe enviarse nada.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede hacerse en paralelo (ficheros distintos, sin dependencias pendientes)
- **[Story]**: historia de la spec (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: referencia de la API y fixtures

- [x] T001 [P] Sustituir `docs/ref/siweb360-openapi.json` por la versión 1.3.0 convertida desde `~/Downloads/siweb360-openapi (1).yaml` (alias YAML resueltos, `yaml` con `maxAliasCount: -1`); comprobar con `git diff --stat` que solo cambian los 20 puntos de research.md R1 y que no entra ningún dato personal ni token real
- [x] T002 [P] Crear fixture `fixtures/siweb/doc-movements.json` copiando el ejemplo de `GET inventory/movements` de `docs/ref/siweb360-openapi.json` (con `reference_id` como cadena) y documentarlo en `fixtures/siweb/README.md`
- [x] T003 [P] Crear fixture `fixtures/siweb/movements-conciliacion.json` derivado de `doc-movements.json` con: entrada con nota `MMX-REC-<uuid>-L1`, venta `sale_shipment` con `reference_id` del ticket de `doc-ticket-7001.json`, rotura `damage` negativa, entrada manual sin nota, movimiento de variante no mapeada y movimiento anterior al corte; anotar en `fixtures/siweb/README.md` que es derivado (no respuesta real)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquemas, BD y configuración que usan todas las historias

**⚠️ CRITICAL**: ninguna historia empieza hasta terminar esta fase

- [x] T004 Cambiar `reference_id` en `StockMovementSchema` de `packages/siweb/src/schemas.ts` a `z.union([z.number(), z.string()]).nullish()` normalizado a `string | null`, y añadir `batch_number`, `expiry_date`, `movement_type` como `nullish` (research.md R5)
- [x] T005 [P] Test en `packages/siweb/test/siweb.test.ts`: `client.movements()` con MSW sobre `fixtures/siweb/doc-movements.json` acepta `reference_id` cadena y número, campos con otra capitalización y campos desconocidos; 5xx y timeout lanzan `HttpError`
- [x] T006 Añadir a `packages/db/src/schema/infra.ts` la columna `outbox.verificaciones` y las tablas `siwebMovimiento` y `movimientoJustificacion` según data-model.md (CHECK por `tipo`, índice único parcial en `sustituye_a`), y exportarlas en `packages/db/src/schema/index.ts`
- [x] T007 Crear `packages/db/migrations/0019_conciliacion_movimientos.sql` y su entrada en `packages/db/migrations/meta/_journal.json`: columna, tablas, triggers `mmx_append_only` en `movimiento_justificacion` y `siweb_movimiento`, y `REVOKE UPDATE, DELETE, TRUNCATE` a `mmx_app` siguiendo el patrón de `0012_revocar_registros.sql`
- [x] T008 [P] Crear `packages/shared/src/schemas/stock-siweb.ts` con `CerrarOutboxBody`, `JustificarMovimientoBody` (discriminada por `tipo`, nota ≥ 5), `PruebaEscrituraBody` (`sku`, `confirmacion: 'SI'`), `MOTIVOS_JUSTIFICACION` y tipos inferidos; exportar en `packages/shared/src/index.ts`
- [x] T009 [P] Añadir códigos `SKU_NO_TEST`, `MOTIVO_INCOMPATIBLE`, `PRUEBA_ESCRITURA_NO_VIGENTE` en `packages/shared/src/codes.ts` y sus textos en español (y los de cada motivo) en `packages/shared/src/i18n/`
- [x] T010 [P] FR-010 en `packages/shared/src/config.ts` (`superRefine`): con `NODE_ENV=production`, `SIWEB_STOCK_WRITE_MODE=entries_only` y sin `ENTRY_CUTOVER_DATE` → error "Falta ENTRY_CUTOVER_DATE para escribir stock en Siweb360"; ampliar descripciones de ambas variables en `.env.example`
- [x] T011 [P] Test en `packages/shared/test/config.test.ts`: producción + `entries_only` sin fecha → falla; con fecha → arranca; `off` sin fecha → arranca
- [x] T012 Test de integración en `packages/db/test/` (Testcontainers, `pnpm test:int`): `UPDATE`/`DELETE` sobre `movimiento_justificacion` y `siweb_movimiento` rechazados; insert duplicado de `siweb_movimiento` con `on conflict do nothing` no duplica

**Checkpoint**: base lista

---

## Phase 3: User Story 4 - Puesta en marcha controlada (Priority: P2, va primero por ser la puerta)

**Goal**: la prueba de escritura se ejecuta desde administración, queda auditada y el outbox no envía sin una superada
en los últimos 30 días; pantalla de estado del stock.

**Independent Test**: con `entries_only` y sin prueba registrada, finalizar una recepción → líneas `ENCOLADA` y 0
envíos; ejecutar la prueba (mock) → `pruebaEscrituraVigente: true` y el outbox envía.

### Tests for User Story 4

- [x] T013 [P] [US4] Mover los casos de `apps/worker/test/spike.test.ts` a `packages/siweb/test/prueba-escritura.test.ts` y añadir: notas `MMX-SPIKE-AAAAMMDD-ENTRADA` y `-REVERSION` en ambos ajustes, `historialOk` verdadero cuando `GET inventory/movements` devuelve los dos movimientos con esa nota y falso si no
- [x] T014 [P] [US4] Test en `packages/siweb/test/siweb.test.ts`: `despachar()` no envía y deja `pending` si `pruebaVigente()` devuelve `null` o una fecha de hace 31 días (reloj inyectado); envía si es de hace 29 días
- [x] T015 [P] [US4] Test en `apps/api/test/stock-siweb.test.ts` (nuevo): `POST /api/admin/siweb/prueba-escritura` → 403 para `empleado`; 400 `SKU_NO_TEST` con SKU sin `TEST-` (y auditado); 200 con mock y auditoría `siweb_prueba_escritura`; `GET /api/admin/estado-stock` devuelve los campos del contrato

### Implementation for User Story 4

- [x] T016 [US4] `git mv apps/worker/src/spikes/spike-siweb.ts packages/siweb/src/prueba-escritura.ts`; mantener las notas `MMX-SPIKE-AAAAMMDD-ENTRADA` / `-REVERSION` y añadir el paso final que lee `client.movements({ variant_id, date_from })` y devuelve `historialOk`; exportar en `packages/siweb/src/index.ts`
- [x] T017 [US4] Actualizar `apps/worker/src/spikes/siweb-write-check.ts` para importar `ejecutarSpike` desde `@mmx/siweb`
- [x] T018 [US4] En `packages/siweb/src/outbox.ts`: añadir `pruebaVigente: () => Promise<Date | null>` a `cfg`; `despachar()` sale sin enviar si es `null` o `now − fecha > 30 días`, registrando en log "Falta la prueba de escritura" (sin datos personales)
- [x] T019 [US4] Función `ultimaPruebaEscritura(db)` en `packages/siweb/src/prueba-escritura.ts`: última `audit_event` `siweb_prueba_escritura` con `ok && coherente && historialOk`; cablearla como `pruebaVigente` en `apps/api/src/crear-deps.ts` y `apps/worker/src/contexto.ts`
- [x] T020 [US4] Rutas en `apps/api/src/rutas/admin.ts`: `POST /api/admin/siweb/prueba-escritura` (rol `admin`, valida `PruebaEscrituraBody`, ejecuta con `preguntar` que devuelve `'SI'`, audita siempre) y `GET /api/admin/estado-stock` (contrato)
- [x] T021 [US4] UI en `apps/web/src/paginas/admin.tsx`: sección "Estado del stock en Siweb360" (modo, fecha de corte, almacén, última prueba, contadores) y formulario "Prueba de escritura" con SKU y confirmación escrita "SI"; textos en español claro

**Checkpoint**: la escritura no puede enviarse sin prueba vigente

---

## Phase 4: User Story 1 - El stock entra solo al finalizar una recepción (Priority: P1) 🎯 MVP

**Goal**: con escritura activa y prueba vigente, cada línea finalizada se envía una vez con lote, caducidad y
referencia; lo ya existente queda cubierto por tests.

**Independent Test**: recepción de 2 líneas con mock → 2 ajustes correctos y "Enviado a Siweb360" en ambas líneas.

### Tests for User Story 1

- [x] T022 [P] [US1] Tests en `packages/siweb/test/siweb.test.ts` (it.each): 2 líneas → 2 ajustes `purchase_receipt` con `batch_number`, `expiry_date`, `notes = MMX-REC-…`; 409 → `failed` con mensaje de stock ilimitado y sin reintento; `exigirEntrada` rechaza cantidad negativa y `sale_shipment` (FR-003); con `off` no se encola y la recepción queda `ESCRITURA_DESACTIVADA` (FR-013); pasar de `entries_only` a `off` deja las filas `pending` intactas y al volver se envían (FR-012)

### Implementation for User Story 1

- [x] T023 [US1] En `apps/web/src/paginas/recepciones.tsx` mostrar por línea "Enviado a Siweb360" (`SINCRONIZADA`), "Pendiente de envío" (`ENCOLADA`) y, para `failed` por 409, "Este producto tiene stock ilimitado en Siweb360"; con `ESCRITURA_DESACTIVADA` mantener el aviso de alta manual actual
- [x] T024 [US1] En `packages/siweb/src/outbox.ts` guardar el error 409 con un código estable (`SIWEB_STOCK_ILIMITADO`) y traducirlo en `packages/shared/src/i18n/` (no mostrar el texto técnico al usuario)

**Checkpoint**: la recepción da de alta stock en Siweb360 (probado con mocks y en np)

---

## Phase 5: User Story 2 - Un envío dudoso se comprueba contra Siweb360 (Priority: P1)

**Goal**: verificación automática contra el historial y cierre de avisos por cualquier usuario.

**Independent Test**: timeout tras enviar; historial con la clave → `sent`; sin ella → sigue en revisión con
"No consta en Siweb360".

### Tests for User Story 2

- [x] T025 [P] [US2] Tests en `packages/siweb/test/siweb.test.ts` (MSW sobre `doc-movements.json`): 1 coincidencia exacta → `sent`, `response.movimiento`, línea `SINCRONIZADA`, auditoría `outbox_verificado_auto`; 0 → sigue `needs_reconciliation`, `last_error` "No consta…", `next_attempt_at` +15 min, `verificaciones` +1, a 96 `next_attempt_at = null`; 2 → "Posible duplicado…" y sin más comprobaciones; historial 5xx/timeout → sin cambios; nota parecida pero no exacta → no cuenta; nunca se llama a `POST stock/adjustments`
- [x] T026 [P] [US2] Tests en `apps/api/test/stock-siweb.test.ts`: `POST /api/outbox/:id/cerrar` con `empleado` → 200 (`revisado` → `sent`, `resuelto_a_mano` → `resolved_manually`, línea `SINCRONIZADA`, auditoría con nota); nota corta → 400; fila `sent` → 409 `CONFLICTO`; `empleado` en `/api/admin/outbox/:id/resolver` → 403

### Implementation for User Story 2

- [x] T027 [US2] En `packages/siweb/src/outbox.ts`: al pasar a `needs_reconciliation` (en `enviar` y en el bloqueo caducado de `despachar`) fijar `nextAttemptAt = now + 10 min`
- [x] T028 [US2] En `packages/siweb/src/outbox.ts`: método `verificarDudosos()` según research.md R2 (solo `stock_adjustment_entry`, `next_attempt_at <= now`, consulta por `variant_id`, `warehouse_id`, `reason`, `date_from`; igualdad exacta de `notes`); no requiere prueba vigente
- [x] T029 [US2] En `packages/siweb/src/outbox.ts`: método `cerrar(id, accion: 'revisado' | 'resuelto_a_mano', actor, nota)` con transacción, `for update`, estados del data-model y auditoría `outbox_cerrar_{accion}`
- [x] T030 [US2] Llamar a `verificarDudosos()` en `apps/worker/src/jobs/outbox.ts` antes de despachar y sumar sus contadores al resultado
- [x] T031 [US2] Rutas en `apps/api/src/rutas/operativa.ts`: `POST /api/outbox/:id/cerrar` y `GET /api/outbox/revision` (roles `operativa` + `admin`, sin payload crudo); ampliar `GET /api/admin/outbox` en `apps/api/src/rutas/admin.ts` con `verificaciones`, `proximaComprobacion`, `evidencia`
- [x] T032 [US2] UI en `apps/web/src/paginas/pendientes.tsx`: bandeja "Envíos a Siweb360 en revisión" con CN, nombre, lote, unidades, evidencia, stock actual y botones "Revisado" / "Resuelto a mano en Siweb360" (nota obligatoria); en `apps/web/src/paginas/admin.tsx` mostrar la evidencia junto a reenviar/descartar

**Checkpoint**: los fallos de red se resuelven solos o quedan con evidencia

---

## Phase 6: User Story 3 - Conciliar todos los movimientos de medicamentos (Priority: P2)

**Goal**: conciliación nocturna de todo movimiento de medicamento; bandeja "Movimientos sin justificar"; registro de
bajas.

**Independent Test**: con `movements-conciliacion.json`, ejecutar la conciliación → entrada y venta vinculadas solas;
rotura y entrada manual en la bandeja; no mapeado y anterior al corte ignorados; justificar rotura → `BAJA` en el
registro.

### Tests for User Story 3

- [x] T033 [P] [US3] Tabla `it.each` en `packages/domain/test/conciliacion-movimientos.test.ts`: reglas 1–4 de research.md R5, límites de fecha de corte en `Europe/Madrid` (medianoche, cambio de hora), nota con espacios o en otra línea, venta de ticket conciliado con CN distinto → sin justificar, compatibilidad motivo/sentido (`MOTIVO_INCOMPATIBLE`), y `it.todo` "falta fixtures/siweb/movements-ticket.json real para confirmar reference_type de tickets del TPV"
- [x] T034 [P] [US3] Tests en `packages/siweb/test/conciliacion-movimientos.test.ts` (MSW + BD de test): guarda movimientos sin duplicar al releer, inserta vínculos `AUTO_*` con actor `sales-reconciliation`, sin fecha de corte devuelve `{ inactivo }`, historial paginado (2 páginas)
- [x] T035 [P] [US3] Tests en `apps/api/test/stock-siweb.test.ts`: `GET /api/movimientos-siweb?estado=sin_justificar` lista solo los pendientes; `POST /api/movimientos-siweb/:id/justificar` con `MOTIVO`/`ROTURA` → 200 y desaparece; segunda justificación → sustituye (`sustituye_a`), no edita; `OTRO` sin nota → 400; `DEVOLUCION_CLIENTE` con unidades negativas → 422
- [x] T036 [P] [US3] Tests en `packages/reports/test/exportaciones.test.ts`: `bajas()` devuelve `BAJA` por justificación vigente de salida, `ANULACIÓN BAJA` + nueva `BAJA` al sustituir; `psicotropos()` incluye las bajas de psicótropos; exportación del registro "Bajas"

### Implementation for User Story 3

- [x] T037 [US3] Crear `packages/domain/src/conciliacion-movimientos.ts` con `conciliarMovimientos()` (puro, reglas R5, devuelve `{ vinculados, sinJustificar, ignorados }` con motivos) y `validarMotivo(motivo, unidades)`; exportar en `packages/domain/src/index.ts`
- [x] T038 [US3] Crear `packages/siweb/src/conciliacion-movimientos.ts` con `conciliarMovimientosDia(db, client, { corte, almacenId, ahora })`: lee `inventory/movements` desde `max(corte, último leído − 1 día)`, inserta en `siweb_movimiento` (`on conflict do nothing`), carga claves de recepción y `conciliacion`, llama al dominio e inserta vínculos `AUTO_*`; exportar en `packages/siweb/src/index.ts`
- [x] T039 [US3] Servicio `justificarMovimiento(db, id, body, actor, ahora)` en `packages/siweb/src/conciliacion-movimientos.ts`: valida con el dominio, comprueba que existan la línea de recepción o la dispensación, inserta en `movimiento_justificacion` (con `sustituye_a` si había vigente) y audita `movimiento_justificar`
- [x] T040 [US3] Llamar a `conciliarMovimientosDia` al final de `apps/worker/src/jobs/conciliacion.ts` (tras `conciliarDia`), con `ENTRY_CUTOVER_DATE` y el almacén del contexto; devolver sus contadores
- [x] T041 [US3] Rutas en `apps/api/src/rutas/operativa.ts`: `GET /api/movimientos-siweb` y `POST /api/movimientos-siweb/:id/justificar` (roles `operativa` + `admin`, zod de `packages/shared`)
- [X] T042 [US3] UI en `apps/web/src/paginas/pendientes.tsx`: bandeja "Movimientos sin justificar" con fecha, código nacional, nombre, lote, caducidad, unidades y motivo de Siweb360; acciones "Vincular a una recepción", "Vincular a una dispensación" (buscador por CN y fecha) y "Justificar" con lista de motivos en español y nota
- [x] T043 [US3] `bajas(desde, hasta)` en `packages/reports/src/datos.ts` y `BAJA` / `ANULACIÓN BAJA` en `psicotropos()`; ampliar el tipo en `packages/reports/src/entradas.ts`; añadir `// TODO(decision DUDA-30): ¿las justificaciones de entradas van al registro?`
- [x] T044 [US3] Registro "Bajas" con exportación en `apps/api/src/rutas/registros.ts` y pestaña en `apps/web/src/paginas/registros.tsx`
- [x] T045 [US3] Informe semanal en `packages/reports/src/semanal.ts`: sección "Movimientos sin justificar" (recuento y lista) y "Conciliación de movimientos sin fecha de corte" si no hay corte

**Checkpoint**: todas las historias funcionan por separado

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T046 [P] ADR `docs/adr/0018-conciliacion-movimientos-siweb.md` (en español): historial como fuente, verificación de dudosos, justificaciones append-only, prueba de escritura en la app; enlazar en `docs/adr/README.md`
- [X] T047 [P] Actualizar `SPEC.md` §5.2.4 (control de entradas → conciliación de movimientos, D-02b parcialmente desbloqueada), §5.2.5 (ya se pueden consultar movimientos; verificación automática) y §12.3 (prueba desde administración, `historialOk`)
- [X] T048 [P] `docs/glosario.md`: "justificación de movimiento", "movimiento sin justificar", "baja", "prueba de escritura"
- [X] T049 [P] Añadir DUDA-30 a `docs/dudas.md` (justificaciones de entradas en el registro) y crear la incidencia en Jira KAN si hay acceso; si no, dejar la fila como "Pendiente de crear en Jira"
- [X] T050 Comprobar FR-015: `grep` de logs nuevos en `packages/siweb/src` y `apps/worker/src/jobs` sin `notes`, nombres de propietario ni payload crudo
- [X] T051 Ejecutar `pnpm lint && pnpm typecheck && pnpm test` y `pnpm test:int`; validar los pasos locales de `specs/011-siweb-stock-entries-enable/quickstart.md`
- [ ] T052 [US3] Buscador en `apps/web/src/paginas/pendientes.tsx` para «Vincular a una recepción» / «Vincular a una dispensación» (candidatos por CN y fecha; la API `POST /api/movimientos-siweb/:id/justificar` ya admite `VINCULO_RECEPCION` y `VINCULO_DISPENSACION`). Hoy la bandeja solo justifica con motivo.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → **US4 (3)** → **US1 (4)** → **US2 (5)**; **US3 (6)** depende solo de la fase 2.
- **Polish (7)** al final.

### User Story Dependencies

- **US4**: tras la fase 2. Es la puerta: sin ella no se enciende la escritura en ningún entorno real.
- **US1**: usa `pruebaVigente` de US4 en sus tests (T022 inyecta una prueba vigente).
- **US2**: usa `outbox.ts` como US1/US4 → mismo fichero, en serie.
- **US3**: independiente del outbox; puede hacerse en paralelo con US4/US1/US2 tras la fase 2 (comparte `pendientes.tsx` y `operativa.ts` con US2: coordinar o hacer en serie esos ficheros).

### Within Each User Story

- Tests primero (deben fallar), después dominio → servicio → ruta → UI.

### Parallel Opportunities

- Fase 1: T001, T002, T003.
- Fase 2: T005, T008, T009, T010, T011 en paralelo tras T004/T006.
- Tests de cada historia marcados [P].
- US3 entera en paralelo con US4→US1→US2 (salvo `pendientes.tsx` y `operativa.ts`).
- Polish: T046–T049.

---

## Parallel Example: User Story 3

```bash
Task: "T033 tabla it.each en packages/domain/test/conciliacion-movimientos.test.ts"
Task: "T034 tests en packages/siweb/test/conciliacion-movimientos.test.ts"
Task: "T035 tests de rutas en apps/api/test/stock-siweb.test.ts"
Task: "T036 tests de bajas en packages/reports/test/exportaciones.test.ts"
```

---

## Implementation Strategy

### MVP (probar en np, no encender en producción)

1. Fases 1–2.
2. US4 (puerta) + US1 → se puede activar `entries_only` en np con la prueba de escritura y comprobar las entradas.
3. **Parar y validar** con quickstart.md.

### Entrega incremental

1. MVP (US4 + US1) en np.
2. US2: los envíos dudosos se resuelven solos → menos trabajo manual.
3. US3: conciliación completa y registro de bajas.
4. **Solo entonces** encender en producción: la SPEC exige el control de entradas manuales (US3) antes de la fecha de
   corte, y la app no arranca en producción con `entries_only` sin fecha de corte (FR-010).
