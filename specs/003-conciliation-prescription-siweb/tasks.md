---
description: "Task list for feature implementation: Conciliación TPV, Revisión Pantalla Completa y Siweb360 API 1.2.0"
---

# Tasks: Conciliación TPV, Revisión Pantalla Completa y Siweb360 API 1.2.0

**Input**: Design documents from `specs/003-conciliation-prescription-siweb/`  
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

## Format: `[TaskID] [P?] [Story?] Description with file path`

- **[P]**: Ejecutable en paralelo (ficheros distintos, sin dependencias de tareas no completadas).
- **[Story]**: Historia de usuario a la que pertenece ([US1], [US2], [US3]).

---

## Phase 1: Setup (Shared Infrastructure & OpenAPI Spec)

**Propósito**: Preparación de especificaciones de referencia y fixtures para soporte offline/MSW.

- [x] T001 Convertir la especificación OpenAPI 1.2.0 aportada a formato JSON en docs/ref/siweb360-openapi.json
- [x] T002 [P] Crear fixtures para simular el ticket XXX-2026-000458 sin CN y la respuesta de fijación de precios en fixtures/siweb/ticket-xxx-458.json y fixtures/siweb/doc-variant-pricing.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Propósito**: Esquemas de base de datos, tipos y esquemas de validación comunes que bloquean las historias de usuario.

**⚠️ CRÍTICO**: Ninguna tarea de historia de usuario debe comenzar hasta completar esta fase.

- [x] T003 [P] Actualizar el esquema Drizzle y tipos en packages/db/src/schema.ts para admitir 'manual' en conciliacion.origen
- [x] T004 [P] Definir esquemas Zod de búsqueda de tickets y asociación manual en packages/shared/src/api.ts
- [x] T005 [P] Definir esquemas Zod de precios de variantes y movimientos de inventario en packages/siweb/src/schemas.ts

**Punto de control**: Esquemas compartidos listos. Las historias de usuario pueden comenzar de forma independiente.

---

## Phase 3: User Story 1 - Diagnosticar y Resolver Conciliación con Ticket del TPV (Priority: P1) 🎯 MVP

**Objetivo**: Permitir buscar e inspeccionar tickets del TPV por número directo (`XXX-2026-000458`), inferir CNs por catálogo/variante cuando falta la etiqueta `CN`, y asociar manualmente salidas pendientes de conciliar con registro en auditoría.

**Prueba independiente**: Ejecutar el escenario 1 de `quickstart.md`, verificando que una salida de BONQAT CN 590948 se asocia al ticket `XXX-2026-000458` y desaparece de la lista de pendientes.

### Tests para User Story 1

- [x] T006 [P] [US1] Test unitario para extracción de CN con fallback a variantes en packages/siweb/test/ventas.test.ts
- [x] T007 [P] [US1] Tests de integración para endpoints GET /api/conciliacion/tickets y POST /api/conciliacion/asociar en apps/api/test/conciliacion.test.ts

### Implementación para User Story 1

- [x] T008 [US1] Implementar búsqueda de tickets por número y resolución de líneas en packages/siweb/src/client.ts y packages/siweb/src/ventas.ts
- [x] T009 [US1] Implementar servicios buscarTickets y asociarManual con traza de auditoría en apps/api/src/servicios/conciliacion.ts
- [x] T010 [US1] Registrar rutas GET /api/conciliacion/tickets y POST /api/conciliacion/asociar en apps/api/src/rutas/registros.ts
- [x] T011 [US1] Implementar diálogo y buscador de tickets para asociación manual en apps/web/src/paginas/pendientes.tsx

**Punto de control**: User Story 1 (MVP) completamente operativa e independientemente comprobable.

---

## Phase 4: User Story 2 - Espacio de Trabajo de Receta en Pantalla Completa con OCR al lado de la Imagen (Priority: P2)

**Objetivo**: Habilitar modo ancho completo en la revisión de recetas y presentar en panel dividido contiguo la imagen de la receta y el texto reconocido por OCR sin necesidad de scroll vertical.

**Prueba independiente**: Ejecutar el escenario 2 de `quickstart.md`, abriendo `/recetas/:id/revision` y comprobando que ocupa todo el ancho y presenta el OCR al lado de la imagen.

### Tests para User Story 2

- [x] T012 [P] [US2] Test de componente para VisorReceta en panel dividido contiguo en apps/web/src/componentes/visor-receta.test.tsx

### Implementación para User Story 2

- [x] T013 [US2] Configurar staticData: { anchoCompleto: true } en la ruta /recetas/$id/revision en apps/web/src/main.tsx
- [x] T014 [US2] Rediseñar VisorReceta para disponer imagen y texto OCR lado a lado en panel dividido en apps/web/src/componentes/visor-receta.tsx
- [x] T015 [US2] Adaptar la distribución de 2 columnas de Revision en apps/web/src/paginas/revision.tsx aprovechando el ancho completo

**Punto de control**: User Stories 1 y 2 funcionan de manera independiente y conjunta.

---

## Phase 5: User Story 3 - Integración con Siweb360 API 1.2.0 para Movimientos y Actualización de Precios/Costes (Priority: P3)

**Objetivo**: Integrar endpoints `PUT /inventory/variants/{id}/pricing` y `GET /inventory/movements` en el cliente Siweb, y encolar la sincronización de costes/precios en el outbox tras finalizar recepciones con `actualizarPrecio = true`.

**Prueba independiente**: Ejecutar el escenario 3 de `quickstart.md`, finalizando una recepción con cálculo de costes y verificando la ejecución del outbox hacia Siweb360.

### Tests para User Story 3

- [x] T016 [P] [US3] Tests unitarios con MSW para actualizarPrecios y movements en packages/siweb/test/siweb.test.ts
- [x] T017 [P] [US3] Test de integración para encolado de evento siweb_actualizar_precio al finalizar recepción en apps/api/test/recepciones-precios.test.ts

### Implementación para User Story 3

- [x] T018 [US3] Implementar métodos actualizarPrecios y movements en packages/siweb/src/client.ts
- [x] T019 [US3] Implementar manejador de evento outbox siweb_actualizar_precio en packages/siweb/src/outbox.ts y apps/worker/src/jobs/outbox-dispatcher.ts
- [x] T020 [US3] Encolar evento siweb_actualizar_precio al finalizar recepción con actualizarPrecio en apps/api/src/servicios/recepciones.ts

**Punto de control**: Todas las historias de usuario implementadas y verificables de extremo a extremo.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Propósito**: Documentación, auditoría y aseguramiento de puertas de calidad.

- [x] T021 [P] Actualizar la especificación y esquema OpenAPI generado de la API en apps/api/openapi.json
- [x] T022 [P] Actualizar el glosario de términos del dominio en docs/glosario.md
- [x] T023 Ejecutar los escenarios de validación de specs/003-conciliation-prescription-siweb/quickstart.md
- [x] T024 Verificar calidad global de código con pnpm lint && pnpm typecheck && pnpm test

---

## Dependencies & Execution Order

### Dependencias entre fases

1. **Setup (Phase 1)**: Sin dependencias, inicia de inmediato.
2. **Foundational (Phase 2)**: Depende de Phase 1. Bloquea todas las historias de usuario.
3. **User Stories (Phase 3+)**: Dependen de Foundational (Phase 2).
   - **US1 (P1 - Conciliación TPV)**: Puede ejecutarse primero como MVP.
   - **US2 (P2 - Pantalla Completa y OCR)**: Independiente de US1 y US3; puede desarrollarse en paralelo tras Foundational.
   - **US3 (P3 - Siweb360 API 1.2.0 Precios/Movimientos)**: Independiente de US1 y US2; puede desarrollarse en paralelo tras Foundational.
4. **Polish (Phase 6)**: Depende de completar las historias de usuario.

### Oportunidades de paralelización

- T003, T004, T005 pueden ejecutarse en paralelo dentro de la fase Foundational.
- T006 y T007 (tests de US1) pueden redactarse en paralelo.
- Una vez finalizada la fase Foundational, US1, US2 y US3 pueden ser abordadas en paralelo por distintos desarrolladores o agentes.
- T012 (test de US2) y T016/T017 (tests de US3) pueden correr en paralelo con US1.

---

## Implementation Strategy

### Estrategia MVP First (User Story 1 Primero)

1. Completar Phase 1 (Setup) y Phase 2 (Foundational).
2. Completar Phase 3 (User Story 1): Resolver inmediatamente el caso de bloqueo operativo de BONQAT CN 590948 y ticket `XXX-2026-000458`.
3. Validar de forma independiente: la conciliación manual y automática queda resuelta y utilizable en producción.
4. Continuar secuencialmente con User Story 2 (mejora de ergonomía de pantalla de recetas) y User Story 3 (integración de precios API 1.2.0).
