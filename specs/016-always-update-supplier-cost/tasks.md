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

- [ ] T001 Crear la rama de trabajo/confirmar que `pnpm i` y `pnpm lint && pnpm typecheck && pnpm test` pasan en verde antes de empezar (línea base) en la raíz del repositorio
- [ ] T002 [P] Añadir las fixtures de Siweb360 derivadas de los ejemplos de `docs/ref/siweb360-openapi.json` v1.3.0: `fixtures/siweb/doc-product-suppliers.json`, `fixtures/siweb/doc-supplier-update.json`, `fixtures/siweb/doc-contact-detail.json` (con `cif`) y documentarlas en `fixtures/siweb/README.md`; sin datos reales

---

## Phase 2: Foundational (bloquea todas las historias)

**⚠️ Ninguna historia puede empezar hasta terminar esta fase.**

- [ ] T003 Añadir `siwebContactId: integer()` (nulo) a `distribuidor` en `packages/db/src/schema/config.ts`
- [ ] T004 Crear la migración `packages/db/migrations/0022_distribuidor_siweb_contacto.sql` (`ALTER TABLE distribuidor ADD COLUMN siweb_contact_id integer`) y registrarla en `packages/db/migrations/meta/_journal.json` (idx 22)
- [ ] T005 [P] Añadir la clave `coste_proveedor_base: precio_coste` (valores `precio_coste` | `precio_neto`) con comentario `TODO(decision D-xx)` en `config/rules/precios.v1.yaml` y a su esquema zod `PreciosRules` en `packages/shared/src/` (tipo inferido)
- [ ] T006 [P] Test de dominio con `it.each` para `costeProveedorCents` (precio_coste vs. neto, sin coste → `null`, decimales, redondeo a céntimos) en `packages/domain/test/precio-proveedor.test.ts`
- [ ] T007 [P] Test de dominio con `it.each` para `normalizarCif` (mayúsculas, espacios, guiones, puntos, prefijo `ES`, vacío) en `packages/domain/test/cif.test.ts`
- [ ] T008 Implementar `costeProveedorCents(linea, rules)` (con `decimal.js`, devuelve céntimos o `null`) y `normalizarCif(cif)` como funciones puras en `packages/domain/src/precio.ts` (y exportarlas desde el índice del paquete)
- [ ] T009 [P] Añadir los esquemas zod `ProveedorProductoSchema`, `ProveedorActualizadoSchema`, `ContactDetailSchema` (con `cif`) y `ActualizarCosteProveedorRequestSchema` (solo `purchase_cost_cents`, ≥ 0, nunca `null`) con `z.looseObject` y tipos inferidos en `packages/siweb/src/schemas.ts`
- [ ] T010 [P] Tests del cliente con MSW (200, 400, 404, 401, 5xx, timeout, campos con otra capitalización, campos nuevos desconocidos) para los métodos nuevos en `packages/siweb/test/proveedores.test.ts`
- [ ] T011 Añadir al cliente `proveedoresDeProducto(productId)`, `actualizarCosteProveedor(productId, contactId, costCents)` (sin reintentos, como `actualizarPrecios`), `contacto(id)` y `buscarProveedoresPorNombre(nombre, limite=10)` en `packages/siweb/src/client.ts`
- [ ] T012 Definir en `packages/siweb/src/outbox.ts` la constante `OPERACION_ACTUALIZAR_COSTE_PROVEEDOR = 'siweb_actualizar_coste_proveedor'`, la función `claveCosteProveedor(recepcionId, numeroLinea)` → `MMX-PRV-{id}-L{n}`, el esquema zod del payload (`variant_id`, `distribuidor_id`, `cost_cents`, `product_id?`, `contact_id?`) y el estado `needs_supplier` (actualizar el comentario de estados en `packages/db/src/schema/infra.ts`)

**Checkpoint**: base lista; las historias pueden empezar.

---

## Phase 3: User Story 1 — El coste del proveedor se actualiza en cada recepción (P1) 🎯 MVP

**Goal**: toda línea con coste y variante de Siweb360 envía el coste del proveedor conocido, con la casilla marcada o no; la casilla solo gobierna el coste de la variante.

**Independent Test**: finalizar una recepción con una línea con la casilla desmarcada y otra marcada, de un distribuidor con `siweb_contact_id`; ambas producen una operación de proveedor; solo la marcada produce la de variante (`quickstart.md` §2).

### Tests (primero; deben fallar antes de implementar)

- [ ] T013 [P] [US1] Test de integración del encolado (Testcontainers): casilla desmarcada → 1 operación de proveedor y 0 de variante; casilla marcada → ambas; sin coste → ninguna; `actualizarStock` desmarcado → se encola igualmente; `sinPrecios` → ninguna; modo `off` → ninguna; reenviar la finalización no duplica (clave idempotente) en `packages/siweb/test/outbox-coste-proveedor.test.ts`
- [ ] T014 [P] [US1] Test del envío con MSW: contacto recordado → `PUT …/products/{id}/suppliers/{contact_id}` con solo `purchase_cost_cents`; 4xx → `failed`; timeout/5xx/respuesta ambigua → `needs_reconciliation` sin reintento; sin prueba de escritura vigente → no se envía; nunca se envía `null` ni `supplier_reference`/`is_preferred` en `packages/siweb/test/outbox-coste-proveedor.test.ts`
- [ ] T015 [P] [US1] Test: dos variantes del mismo producto en una recepción → dos operaciones y gana la última por orden de línea en `packages/siweb/test/outbox-coste-proveedor.test.ts`

### Implementation

- [ ] T016 [US1] En `encolarRecepcion` de `packages/siweb/src/outbox.ts`, encolar `siweb_actualizar_coste_proveedor` para cada línea de medicamento con coste (`costeProveedorCents` ≠ null) y `siwebVariantId` ≠ null, **sin mirar `actualizarPrecio` ni `actualizarStock`**, respetando `modo === 'off'` y `sinPrecios`; el encolado del coste de variante queda como está (gobernado por la casilla)
- [ ] T017 [US1] En `enviar` de `packages/siweb/src/outbox.ts`, tratar `OPERACION_ACTUALIZAR_COSTE_PROVEEDOR`: obtener `product_id` (mapa `siweb_variant_map.productId`; si es nulo, `GET variante` y guardarlo vía `packages/siweb/src/mapeo.ts`), usar `distribuidor.siweb_contact_id` y llamar a `actualizarCosteProveedor`; clasificar el resultado como las demás operaciones (4xx → `failed`; red/5xx/timeout → `needs_reconciliation`); si no hay contacto recordado, dejar el hueco para US2 (por ahora `needs_supplier` con motivo `SIN_COINCIDENCIA`)
- [ ] T018 [US1] Garantizar que `registrar` y `listar` de `packages/siweb/src/outbox.ts` manejan la operación nueva (auditoría `outbox_*`, sin datos personales en `last_error` ni en logs) y que `resolver` (reenviar/descartar/marcar resuelta) funciona con ella

**Checkpoint**: US1 funciona con un proveedor ya vinculado; MVP entregable.

---

## Phase 4: User Story 2 — El proveedor se encuentra solo y se recuerda (P1)

**Goal**: el contacto de Siweb360 se resuelve automáticamente por CIF la primera vez y se recuerda; si no se puede, la operación queda visible y reanudable.

**Independent Test**: recepción de un distribuidor sin contacto recordado → una búsqueda, actualización enviada y contacto guardado; la segunda recepción no busca; sin CIF/coincidencia/varias → `needs_supplier` visible y, tras vincular, se envía una vez (`quickstart.md` §2).

### Tests

- [ ] T019 [P] [US2] Tests de `resolverProveedor` con MSW: recordado; coincidencia por `supplier_cif` en los proveedores del producto; coincidencia por búsqueda por nombre + detalle con `cif`; 0 coincidencias; varias; distribuidor sin CIF; contacto recordado inexistente (404) → `PROVEEDOR_INEXISTENTE`; máximo 10 candidatos en `packages/siweb/test/resolver-proveedor.test.ts`
- [ ] T020 [P] [US2] Test de integración: `needs_supplier` no es tomado por el dispatcher; al vincular el proveedor pasa a `pending` y se envía una vez con el coste de su recepción; el barrido diario reintenta la resolución sin duplicar en `packages/siweb/test/outbox-coste-proveedor.test.ts`
- [ ] T021 [P] [US2] Test de la API de administración `POST /api/admin/distribuidores/:id/proveedor-siweb`: rol de administración, contacto inexistente → `SIWEB_PROVEEDOR_NO_EXISTE`, CIF distinto sin confirmar → `SIWEB_PROVEEDOR_CIF_DISTINTO`, éxito guarda `siweb_contact_id`, reactiva y audita en `apps/api/test/admin-proveedor-siweb.test.ts`

### Implementation

- [ ] T022 [US2] Implementar `resolverProveedor(distribuidor, productId)` en `packages/siweb/src/proveedor.ts` con el orden de `research.md` D3 (contacto recordado → `supplier_cif` entre los proveedores del producto → búsqueda por nombre + detalle con `cif` → única coincidencia); devuelve `{ contactId } | { motivo: 'SIN_CIF' | 'SIN_COINCIDENCIA' | 'VARIAS_COINCIDENCIAS' | 'PROVEEDOR_INEXISTENTE' }`; usa `normalizarCif`
- [ ] T023 [US2] En `enviar` de `packages/siweb/src/outbox.ts`, usar `resolverProveedor`; si resuelve por búsqueda guardar `distribuidor.siwebContactId` y `contact_id`/`product_id` en el payload; si no, pasar la fila a `needs_supplier` con `last_error` = motivo, `lockedAt` nulo, auditoría y sin enviar nada; un 404 del `PUT` por contacto inexistente también → `needs_supplier` (`PROVEEDOR_INEXISTENTE`)
- [ ] T024 [US2] Añadir `reactivarCosteProveedor(distribuidorId)` (pasa `needs_supplier` → `pending`) y el barrido diario (reintento de las `needs_supplier` con `nextAttemptAt` vencido) en `packages/siweb/src/outbox.ts`, y llamarlo desde el job `outbox-dispatcher` en `apps/worker/src/jobs/`
- [ ] T025 [US2] Esquemas zod de la acción (`{ contactId, confirmarCifDistinto? }` → `{ reactivadas }`) en `packages/shared/src/schemas/` y la ruta `POST /api/admin/distribuidores/:id/proveedor-siweb` en `apps/api/src/rutas/admin.ts` (validar el contacto en Siweb360, comparar CIF, guardar, reactivar, auditar `distribuidor_vincular_siweb`; errores tipados `DomainError`)
- [ ] T026 [P] [US2] Pantalla de administración del outbox: etiqueta en español «Falta vincular el proveedor en Siweb360» con el motivo traducido (`SIN_CIF` → «El distribuidor no tiene CIF», etc.) y acción «Vincular proveedor de Siweb360» (selector con `GET contacts?tipo=Proveedor` ya existente) en `apps/web/src/paginas/` (fichero de la pantalla de outbox/administración) y textos en `apps/web/src/lib/ayudas.ts`; test de componente en `apps/web/src/`
- [ ] T027 [P] [US2] Regenerar `openapi.json` de la API y añadir los términos nuevos («proveedor de Siweb360», «coste de proveedor») a `docs/glosario.md`

**Checkpoint**: US1 + US2 completas para los productos ya dados de alta.

---

## Phase 5: User Story 3 — También cuando el producto se da de alta después (P2)

**Goal**: las líneas en `PENDIENTE_ALTA_SIWEB` encolan el coste del proveedor al vincularse, con la casilla desmarcada o no, una sola vez.

**Independent Test**: línea costeada pendiente de alta con la casilla desmarcada; al completar el alta se encola una operación de proveedor; repetir el alta no duplica.

- [ ] T028 [P] [US3] Test de integración: `reencolarPendientesAlta` encola la operación de proveedor con la casilla desmarcada, no duplica al repetirse y no encola sin coste en `packages/siweb/test/outbox-coste-proveedor.test.ts`
- [ ] T029 [US3] En `reencolarPendientesAlta` de `packages/siweb/src/outbox.ts` encolar `siweb_actualizar_coste_proveedor` para cada línea reencolada con coste, sin condicionarlo a `actualizarPrecio`, reutilizando el helper del encolado de T016

**Checkpoint**: sin resquicios en el camino diferido.

---

## Phase 6: User Story 4 — Se entiende qué hace la casilla (P3)

**Goal**: la ayuda de «Actualizar precio» dice la verdad.

**Independent Test**: abrir el formulario de línea y leer la ayuda (`quickstart.md` §2, última fila).

- [ ] T030 [P] [US4] Reescribir `actualizarPrecio` en `apps/web/src/lib/ayudas.ts` en español claro: «Marcada: este precio pasa a ser el coste de la variante en Siweb360 y el coste de referencia en la app. El coste del proveedor en Siweb360 se actualiza siempre, esté marcada o no.» (elimina la frase obsoleta de que Siweb360 no permite cambiar el precio por API)
- [ ] T031 [P] [US4] Test de componente/ayuda que comprueba el texto en `apps/web/src/` (junto a los tests de `paginas/recepciones.tsx`) y, si la sección de ayuda general lo menciona, actualizar `packages/shared/src/ayuda/secciones.ts`

---

## Phase 7: Polish & cross-cutting

- [ ] T032 [P] Actualizar `SPEC.md` §5 (integración Siweb360: nueva operación de coste de proveedor y estado `needs_supplier`) y §4.10 donde diga que el coste no se actualiza por API; actualizar `AGENTS.md` solo si cambia alguna regla operativa
- [ ] T033 [P] Añadir al informe/pantalla de recepción (si ya muestra `syncEstado`) el aviso de coste de proveedor pendiente, sin cambiar el estado de la recepción, en `apps/web/src/paginas/recepciones.tsx`
- [ ] T034 Ejecutar `pnpm lint && pnpm typecheck && pnpm test` y `pnpm test:int`; corregir lo que falle
- [ ] T035 Recorrer `specs/016-always-update-supplier-cost/quickstart.md` §1–§2 y marcar cada escenario de la spec (FR-001…FR-014, SC-001…SC-007) contra los tests; anotar lo que quede sin cubrir
- [ ] T036 Commits Conventional (`feat(siweb): …`) con las líneas de atribución y un único PR contra la rama principal, con el valor por defecto de `coste_proveedor_base` señalado para revisión de negocio

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2** (bloquea) → historias.
- **US1** (MVP) depende de T003–T012. **US2** depende de US1 (T017 deja el hueco que T023 completa). **US3** depende de T016 (helper de encolado). **US4** es independiente (solo ayuda) y puede ir en paralelo con US2/US3.
- Dentro de cada historia: pruebas primero (deben fallar), luego implementación.
- Fase 7 al final.

### Parallel opportunities

- T002, T005, T006, T007, T009, T010 (Foundational) en paralelo entre sí tras T001; T003→T004 en secuencia; T008 tras T006/T007.
- US1: T013, T014, T015 en paralelo (mismo fichero: coordinar o separar en `describe`).
- US2: T019, T020, T021 en paralelo; T026 y T027 en paralelo con T025.
- US4 (T030, T031) en paralelo con US2/US3.

### Parallel example: US2
```text
T019 resolver-proveedor.test.ts   |  T020 outbox needs_supplier test  |  T021 admin-proveedor-siweb.test.ts
  → T022 proveedor.ts → T023 outbox enviar → T024 reactivar/barrido → T025 ruta admin
                                                         T026 UI admin  ‖  T027 openapi + glosario
```

## Implementation Strategy

1. **MVP**: Fases 1–2 + US1 (proveedor ya vinculado): entrega el cambio pedido para los distribuidores con contacto recordado.
2. Añadir US2 (resolución automática y reanudación) → mínimo para uso real con cualquier distribuidor.
3. US3 (camino diferido) y US4 (ayuda) → completan la spec.
4. Polish y un único PR.

## Notes

- `coste_proveedor_base` (T005) queda con el valor por defecto `precio_coste` hasta que negocio decida (neto o con RE).
- Nunca llamar a Siweb360 real; nunca enviar `purchase_cost_cents: null`; nunca salidas de stock.
- No hacer `UPDATE`/`DELETE` de líneas de recepción finalizadas; solo filas del outbox.
