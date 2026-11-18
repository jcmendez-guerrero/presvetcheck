---

description: "Tareas de la feature 016: coste de proveedor siempre actualizado en Siweb360"
---

# Tasks: Coste de proveedor siempre actualizado en Siweb360 al recibir mercancía

**Input**: `/specs/016-always-update-supplier-cost/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Prerequisites**: plan.md, spec.md. Las pruebas son obligatorias (constitución II; nada llama a Siweb360 real: MSW + fixtures).

**Organization**: por historia de usuario (US1 P1, US2 P1, US3 P2, US4 P3). Un PR (constitución IV).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (ficheros distintos, sin dependencias pendientes)
- **[Story]**: US1–US4 (solo en las fases de historia)
- Cada tarea indica la ruta exacta del fichero

## Phase 1: Setup

- [X] T001 Confirmar que se trabaja en la rama de la sesión y que `pnpm i` y `pnpm lint && pnpm typecheck && pnpm test` pasan en verde antes de empezar (línea base) en la raíz del repositorio
- [X] T002 [P] Añadir las fixtures de Siweb360 derivadas de los ejemplos de `docs/ref/siweb360-openapi.json` v1.3.0: `fixtures/siweb/doc-product-suppliers.json`, `fixtures/siweb/doc-supplier-update.json`, `fixtures/siweb/doc-contact-detail.json` (con `cif`) y documentarlas en `fixtures/siweb/README.md`; sin datos reales

---

## Phase 2: Foundational (bloquea todas las historias)

**⚠️ Ninguna historia puede empezar hasta terminar esta fase.**

- [X] T003 Añadir `siwebContactId: integer()` (nulo) a `distribuidor` en `packages/db/src/schema/config.ts`
- [X] T004 Crear la migración `packages/db/migrations/0022_distribuidor_siweb_contacto.sql` (`ALTER TABLE distribuidor ADD COLUMN siweb_contact_id integer`) y registrarla en `packages/db/migrations/meta/_journal.json` (idx 22)
- [X] T005 Registrar la decisión abierta **D-15** (valor enviado como coste del proveedor: precio de coste con RE o precio neto; defecto `precio_coste`) como fila nueva en `SPEC.md` §13 y en `docs/dudas.md` (con su tarea hija de KAN-1 en Jira si procede) y citarla en `specs/016-always-update-supplier-cost/research.md` D7
- [X] T006 [P] Añadir la clave `coste_proveedor_base: precio_coste` (valores `precio_coste` | `precio_neto`) con comentario `TODO(decision D-15)` en `config/rules/precios.v1.yaml`, a su esquema zod `PreciosRulesSchema` en `packages/shared/src/rules.ts` y a los tests o fixtures que cargan ese YAML (tipo inferido)
- [X] T007 [P] Test de dominio con `it.each` para `costeProveedorCents` (precio_coste vs. neto, sin coste → `null`, decimales, redondeo a céntimos) en `packages/domain/test/precio-proveedor.test.ts`
- [X] T008 [P] Test de dominio con `it.each` para `normalizarCif` (mayúsculas, espacios, guiones, puntos, prefijo `ES`, vacío) en `packages/domain/test/cif.test.ts`
- [X] T009 Implementar `costeProveedorCents(linea, rules)` (con `decimal.js`, devuelve céntimos o `null`) y `normalizarCif(cif)` como funciones puras en `packages/domain/src/precio.ts` (y exportarlas desde el índice del paquete)
- [X] T010 [P] Añadir los esquemas zod `ProveedorProductoSchema`, `ProveedorActualizadoSchema`, `ContactDetailSchema` (con `cif`) y `ActualizarCosteProveedorRequestSchema` (solo `purchase_cost_cents`, ≥ 0, nunca `null`) con `z.looseObject` y tipos inferidos en `packages/siweb/src/schemas.ts`
- [X] T011 [P] Tests del cliente con MSW (200, 400, 404, 401, 5xx, timeout, campos con otra capitalización, campos nuevos desconocidos) para los métodos nuevos en `packages/siweb/test/proveedores.test.ts`
- [X] T012 Añadir al cliente `proveedoresDeProducto(productId)`, `actualizarCosteProveedor(productId, contactId, costCents)` (sin reintentos, como `actualizarPrecios`), `contacto(id)` y `buscarProveedoresPorNombre(nombre, limite=10)` en `packages/siweb/src/client.ts`
- [X] T013 Definir en `packages/siweb/src/outbox.ts` la constante `OPERACION_ACTUALIZAR_COSTE_PROVEEDOR = 'siweb_actualizar_coste_proveedor'`, la función `claveCosteProveedor(recepcionId, numeroLinea)` → `MMX-PRV-{id}-L{n}`, el esquema zod del payload (`variant_id`, `distribuidor_id`, `cost_cents`, `product_id?`, `contact_id?`) y el estado `needs_supplier`: se trata como **estado de fila del outbox** (no como `ResultadoEnvio`); `despachar` no lo toma y no entra en el recuento `{ sent, failed, needs_reconciliation }` que devuelve (se deja así para no romper a quienes lo consumen); actualizar el comentario de estados en `packages/db/src/schema/infra.ts`

**Checkpoint**: base lista; las historias pueden empezar.

---

## Phase 3: User Story 1 — El coste del proveedor se actualiza en cada recepción (P1) 🎯 MVP

**Goal**: toda línea con coste y variante de Siweb360 envía el coste del proveedor conocido, con la casilla marcada o no; la casilla solo gobierna el coste de la variante.

**Independent Test**: finalizar una recepción con una línea con la casilla desmarcada y otra marcada, de un distribuidor con `siweb_contact_id`; ambas producen una operación de proveedor; solo la marcada produce la de variante (`quickstart.md` §2).

### Tests (primero; deben fallar antes de implementar)

- [X] T014 [P] [US1] Test del encolado con la base de datos de pruebas de la API (`createTestDb` + MSW, como `packages/siweb/test/siweb.test.ts`): casilla desmarcada → 1 operación de proveedor y 0 de variante; casilla marcada → ambas; sin coste → ninguna; `actualizarStock` desmarcado → se encola igualmente; `sinPrecios` → ninguna; modo `off` → ninguna; reenviar la finalización no duplica (clave idempotente); una recepción finalizada antes del cambio no se reencola (FR-014); dos variantes del mismo producto → dos operaciones, gana la última por orden de línea en `packages/siweb/test/coste-proveedor.test.ts (más `apps/api/test/recepciones-precios.test.ts` para el encolado por la API)`
- [X] T015 [P] [US1] Test del envío con MSW: contacto recordado → `PUT …/products/{id}/suppliers/{contact_id}` con solo `purchase_cost_cents`; 4xx → `failed`; timeout/5xx/respuesta ambigua → `needs_reconciliation` sin reintento; sin prueba de escritura vigente → no se envía; nunca se envía `null` ni `supplier_reference`/`is_preferred` en `packages/siweb/test/coste-proveedor.test.ts (más `apps/api/test/recepciones-precios.test.ts` para el encolado por la API)`
- [X] T016 [P] [US1] Test de la sustitución del coste de variante: con la casilla desmarcada no se envía `PUT …/variants/{id}/pricing`; con la marcada se envía como hoy (sin regresión) en `packages/siweb/test/coste-proveedor.test.ts (más `apps/api/test/recepciones-precios.test.ts` para el encolado por la API)`

### Implementation

- [X] T017 [US1] En `encolarRecepcion` de `packages/siweb/src/outbox.ts`, encolar `siweb_actualizar_coste_proveedor` para cada línea de medicamento con coste (`costeProveedorCents` ≠ null) y `siwebVariantId` ≠ null, **sin mirar `actualizarPrecio` ni `actualizarStock`**, respetando `modo === 'off'` y `sinPrecios`; el encolado del coste de variante queda como está (gobernado por la casilla)
- [X] T018 [US1] En `enviar` de `packages/siweb/src/outbox.ts`, tratar `OPERACION_ACTUALIZAR_COSTE_PROVEEDOR`: obtener `product_id` (mapa `siweb_variant_map.productId`; si es nulo, `GET variante` y guardarlo vía `packages/siweb/src/mapeo.ts`), usar `distribuidor.siweb_contact_id` y llamar a `actualizarCosteProveedor`; clasificar el resultado como las demás operaciones (4xx → `failed`; red/5xx/timeout → `needs_reconciliation`); si no hay contacto recordado, dejar el hueco para US2 (por ahora `needs_supplier` con motivo `SIN_COINCIDENCIA`)
- [X] T019 [US1] Garantizar que `registrar` y `listar` de `packages/siweb/src/outbox.ts` manejan la operación nueva (auditoría `outbox_*`, sin datos personales en `last_error` ni en logs) y que `resolver` (reenviar/descartar/marcar resuelta) funciona con ella

**Checkpoint**: US1 funciona con un proveedor ya vinculado; MVP entregable.

---

## Phase 4: User Story 2 — El proveedor se encuentra solo y se recuerda (P1)

**Goal**: el contacto de Siweb360 se resuelve automáticamente por CIF la primera vez y se recuerda; si no se puede, la operación queda visible y reanudable.

**Independent Test**: recepción de un distribuidor sin contacto recordado → una búsqueda, actualización enviada y contacto guardado; la segunda recepción no busca; sin CIF/coincidencia/varias → `needs_supplier` visible y, tras vincular, se envía una vez (`quickstart.md` §2).

### Tests

- [X] T020 [P] [US2] Tests de `resolverProveedor` con MSW: recordado; coincidencia por `supplier_cif` en los proveedores del producto; coincidencia por búsqueda por nombre + detalle con `cif`; 0 coincidencias; varias; distribuidor sin CIF; contacto recordado inexistente (404) → `PROVEEDOR_INEXISTENTE`; máximo 10 candidatos en `packages/siweb/test/resolver-proveedor.test.ts`
- [X] T021 [P] [US2] Test: `needs_supplier` no es tomado por el dispatcher; al vincular el proveedor pasa a `pending` y se envía una vez con el coste de su recepción; el barrido diario reintenta la resolución sin duplicar en `packages/siweb/test/coste-proveedor.test.ts (más `apps/api/test/recepciones-precios.test.ts` para el encolado por la API)`
- [X] T022 [P] [US2] Test de la API de administración `POST /api/admin/distribuidores/:id/proveedor-siweb`: rol de administración, contacto inexistente → `SIWEB_PROVEEDOR_NO_EXISTE`, CIF distinto sin confirmar → `SIWEB_PROVEEDOR_CIF_DISTINTO`, éxito guarda `siweb_contact_id`, reactiva y audita en `apps/api/test/admin-proveedor-siweb.test.ts`

### Implementation

- [X] T023 [US2] Implementar `resolverProveedor(distribuidor, productId)` en `packages/siweb/src/proveedor.ts` con el orden de `research.md` D3 (contacto recordado → `supplier_cif` entre los proveedores del producto → búsqueda por nombre + detalle con `cif` → única coincidencia); devuelve `{ contactId } | { motivo: 'SIN_CIF' | 'SIN_COINCIDENCIA' | 'VARIAS_COINCIDENCIAS' | 'PROVEEDOR_INEXISTENTE' }`; usa `normalizarCif`
- [X] T024 [US2] En `enviar` de `packages/siweb/src/outbox.ts`, usar `resolverProveedor`; si resuelve por búsqueda guardar `distribuidor.siwebContactId` y `contact_id`/`product_id` en el payload; si no, pasar la fila a `needs_supplier` con `last_error` = motivo, `lockedAt` nulo, auditoría y sin enviar nada; un 404 del `PUT` por contacto inexistente también → `needs_supplier` (`PROVEEDOR_INEXISTENTE`)
- [X] T025 [US2] Añadir `reactivarCosteProveedor(distribuidorId)` (pasa `needs_supplier` → `pending`, inmediato al vincular) y el barrido diario (reintenta la resolución de las `needs_supplier` con `nextAttemptAt` vencido) en `packages/siweb/src/outbox.ts`, y llamarlo desde el job `outbox-dispatcher` en `apps/worker/src/jobs/outbox.ts`
- [X] T026 [US2] Esquemas zod de la acción (`{ contactId, confirmarCifDistinto? }` → `{ reactivadas }`) en `packages/shared/src/schemas/` y la ruta `POST /api/admin/distribuidores/:id/proveedor-siweb` en `apps/api/src/rutas/admin.ts` (validar el contacto en Siweb360, comparar CIF, rechazar con error tipado si el `contactId` ya está vinculado a otro distribuidor, guardar, reactivar, auditar `distribuidor_vincular_siweb`; errores `DomainError`)
- [X] T027 [P] [US2] Pantalla de administración del outbox: etiqueta en español «Falta vincular el proveedor en Siweb360» con el motivo traducido (`SIN_CIF` → «El distribuidor no tiene CIF», etc.) y acción «Vincular proveedor de Siweb360» (selector con `GET contacts?tipo=Proveedor` ya existente) en `apps/web/src/paginas/` (fichero de la pantalla de outbox/administración) y textos en `apps/web/src/lib/ayudas.ts`; test de componente en `apps/web/src/`
- [X] T028 [P] [US2] Regenerar `openapi.json` de la API y añadir los términos nuevos («proveedor de Siweb360», «coste de proveedor») a `docs/glosario.md`
- [X] T029 [US2] Mostrar en el detalle de la recepción de `apps/web/src/paginas/recepciones.tsx` un aviso en español, para cualquier persona que use la pantalla, cuando haya costes de proveedor pendientes («Coste de proveedor pendiente: falta vincular el proveedor en Siweb360. Pide a administración que lo vincule»), sin cambiar el estado de la recepción; la API de detalle devuelve ese indicador (campo en el esquema de `packages/shared`) y se prueba en `apps/web/src/` y `apps/api/test/`

**Checkpoint**: US1 + US2 completas para los productos ya dados de alta.

---

## Phase 5: User Story 3 — También cuando el producto se da de alta después (P2)

**Goal**: las líneas en `PENDIENTE_ALTA_SIWEB` encolan el coste del proveedor al vincularse, con la casilla desmarcada o no, una sola vez.

**Independent Test**: línea costeada pendiente de alta con la casilla desmarcada; al completar el alta se encola una operación de proveedor; repetir el alta no duplica.

- [X] T030 [P] [US3] Test: `reencolarPendientesAlta` encola la operación de proveedor con la casilla desmarcada, no duplica al repetirse y no encola sin coste en `packages/siweb/test/coste-proveedor.test.ts (más `apps/api/test/recepciones-precios.test.ts` para el encolado por la API)`
- [X] T031 [US3] En `reencolarPendientesAlta` de `packages/siweb/src/outbox.ts` encolar `siweb_actualizar_coste_proveedor` para cada línea reencolada con coste, sin condicionarlo a `actualizarPrecio`, reutilizando el helper del encolado de T017

**Checkpoint**: sin resquicios en el camino diferido.

---

## Phase 6: User Story 4 — Se entiende qué hace la casilla (P3)

**Goal**: la ayuda de «Actualizar precio» dice la verdad.

**Independent Test**: abrir el formulario de línea y leer la ayuda (`quickstart.md` §2, última fila).

- [X] T032 [P] [US4] Reescribir `actualizarPrecio` en `apps/web/src/lib/ayudas.ts` en español claro: «Marcada: este precio pasa a ser el coste de la variante en Siweb360 y el coste de referencia en la app. El coste del proveedor en Siweb360 se actualiza siempre, esté marcada o no.» (elimina la frase obsoleta de que Siweb360 no permite cambiar el precio por API)
- [X] T033 [P] [US4] Test de componente/ayuda que comprueba el texto en `apps/web/src/` (junto a los tests de `paginas/recepciones.tsx`) y, si la sección de ayuda general lo menciona, actualizar `packages/shared/src/ayuda/secciones.ts`

---

## Phase 7: Polish & cross-cutting

- [X] T034 [P] Actualizar `SPEC.md` §5 (integración Siweb360: nueva operación de coste de proveedor y estado `needs_supplier`) y §4.10 donde diga que el coste no se actualiza por API; actualizar `AGENTS.md` solo si cambia alguna regla operativa
- [X] T035 Ejecutar `pnpm lint && pnpm typecheck && pnpm test` y `pnpm test:int`; corregir lo que falle (lint, typecheck y test en verde; `pnpm test:int` no se pudo ejecutar: no hay Docker en el entorno de la sesión)
- [X] T036 Recorrer `specs/016-always-update-supplier-cost/quickstart.md` §1–§2 y marcar cada escenario de la spec (FR-001…FR-014, SC-001…SC-007) contra los tests; anotar lo que quede sin cubrir
- [X] T037 Preparar los commits Conventional (`feat(siweb): …`, `docs: …`) con las líneas de atribución en la rama de la sesión; abrir una pull request solo si se pide expresamente, señalando para revisión de negocio la decisión D-15 (valor por defecto de `coste_proveedor_base`)

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2** (bloquea) → historias.
- **US1** (MVP) depende de T003–T013. **US2** depende de US1 (T018 deja el hueco que T024 completa). **US3** depende de T017 (helper de encolado). **US4** es independiente (solo ayuda) y puede ir en paralelo con US2/US3.
- Dentro de cada historia: pruebas primero (deben fallar), luego implementación.
- Fase 7 al final.

### Parallel opportunities

- T002, T006, T007, T008, T010, T011 (Foundational) en paralelo entre sí tras T001; T003→T004 en secuencia; T009 tras T007/T008.
- US1: T014, T015, T016 en paralelo (T015 y T016 comparten fichero: ejecutarlas una tras otra o separarlas en `describe`).
- US2: T020, T021, T022 en paralelo; T027 y T028 en paralelo con T026.
- US4 (T032, T033) en paralelo con US2/US3.

### Parallel example: US2
```text
T020 resolver-proveedor.test.ts   |  T021 outbox needs_supplier test  |  T022 admin-proveedor-siweb.test.ts
  → T023 proveedor.ts → T024 outbox enviar → T025 reactivar/barrido → T026 ruta admin
                                                         T027 UI admin  ‖  T028 openapi + glosario
```

## Implementation Strategy

1. **MVP**: Fases 1–2 + US1 (proveedor ya vinculado): entrega el cambio pedido para los distribuidores con contacto recordado.
2. Añadir US2 (resolución automática y reanudación) → mínimo para uso real con cualquier distribuidor.
3. US3 (camino diferido) y US4 (ayuda) → completan la spec.
4. Polish y un único PR.

## Notes

- `coste_proveedor_base` (T006, decisión D-15 de T005) queda con el valor por defecto `precio_coste` hasta que negocio decida (neto o con RE).
- Nunca llamar a Siweb360 real; nunca enviar `purchase_cost_cents: null`; nunca salidas de stock.
- No hacer `UPDATE`/`DELETE` de líneas de recepción finalizadas; solo filas del outbox.

## Phase 8: Convergence

- [X] T038 Garantizar el orden por línea al despachar el coste de proveedor: `despachar` ordena solo por `created_at` y todas las filas de una finalización comparten la hora de la transacción, así que «gana la última línea» no está asegurado; añadir un desempate estable (p. ej. por `idempotency_key` con el número de línea ordenado numéricamente) en `packages/siweb/src/outbox.ts` y un test con ≥ 10 líneas del mismo producto que compruebe el orden de envío en `packages/siweb/test/coste-proveedor.test.ts` per US1/AC5 (partial)
- [X] T039 Encolar también el coste de proveedor de las líneas sin variante con «Actualizar stock» desmarcado cuando se enlacen: hoy quedan en `SIN_ACTUALIZAR_STOCK` y `reencolarPendientesAlta` no las ve; ampliar la selección (o el estado) en `packages/siweb/src/outbox.ts` sin dar entrada de stock, con test en `packages/siweb/test/coste-proveedor.test.ts` per FR-008 (partial)
- [X] T040 Despachar el outbox justo después de vincular el proveedor (`void s.outbox.despachar()` como hace la finalización) en `POST /api/admin/distribuidores/:id/proveedor-siweb` de `apps/api/src/rutas/admin.ts`, y afirmarlo en `apps/api/test/admin-proveedor-siweb.test.ts` per FR-007 (partial)
- [X] T041 [P] Añadir tests de componente de la pantalla de administración del outbox (fila `needs_supplier` con distribuidor, motivo en español, selector, botón «Vincular proveedor» y confirmación por CIF distinto) en `apps/web/src/paginas/admin.test.tsx` y del aviso «Coste de proveedor pendiente» en `apps/web/src/paginas/recepciones.test.tsx` per plan: Testing / FR-012 (partial)
- [X] T042 [P] Test de `reencolarPendientesAlta` con la recepción en `ESCRITURA_DESACTIVADA` (enviada a mano sin precios): no debe encolar el coste de proveedor, en `packages/siweb/test/coste-proveedor.test.ts` per FR-010 (partial)
- [X] T043 [P] Hacer que la etiqueta de la casilla (`'Actualizar precio de coste'`, `'Precio'` en modo compacto) en `apps/web/src/paginas/recepciones.tsx` y su `title` no sugieran que desmarcarla evita el coste del proveedor (p. ej. «Actualizar coste de la variante») y ajustar los textos/tests que la citan per FR-013 (partial)
- [ ] T044 [P] Crear la tarea hija de KAN-1 en Jira para la decisión D-15 (etiqueta `dudas`) y, si procede, su fila en `docs/dudas.md` con el enlace, como exige el propio documento per Constitution IV (partial)

## Phase 9: Convergence

- [ ] T045 Actualizar `SPEC.md` §5.2.5 (línea de `status ∈ {…}` de la tabla `outbox`) para incluir `needs_supplier` (y `resolved_manually`, que ya existe en el código), de modo que no contradiga el párrafo del coste de proveedor ni `packages/db/src/schema/infra.ts` per plan: Documentación / Constitution IV (partial)
- [ ] T046 [P] Resolver la diferencia entre el reintento a los 30 minutos cuando Siweb360 no responde al identificar al proveedor (`REINTENTO_PROVEEDOR_RED_MS` en `packages/siweb/src/outbox.ts`) y el «reintento diario» que dicen FR-007 y `research.md` D5: recogerlo en la spec/plan (y en `data-model.md`) o alinear el código, con su test per FR-007 (unrequested)
