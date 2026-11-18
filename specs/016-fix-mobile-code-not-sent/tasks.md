---

description: "Tareas para que el código del envase leído con el móvil llegue siempre al ordenador"
---

# Tasks: El código del envase leído con el móvil llega siempre al ordenador

**Input**: Documentos de diseño en `/specs/016-fix-mobile-code-not-sent/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/api-movil-codigos.md](contracts/api-movil-codigos.md)

**Tests**: incluidos (la constitución exige `pnpm lint && pnpm typecheck && pnpm test` en verde y casos de error explícitos).

**Organization**: por historia de usuario. US1 y US2 son P1 y juntas cierran el defecto; US3 es P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: US1, US2, US3

## Path Conventions

Monorepo: `apps/api/`, `apps/web/`, `packages/shared/`, `docs/`. Textos de interfaz en español claro; identificadores
genéricos en inglés técnico.

---

## Phase 1: Setup

**Purpose**: localizar la causa antes de cambiar nada

- [ ] T001 Reproducir el defecto con un móvil real contra el entorno no productivo y registrar el resultado (estado HTTP de `POST /api/movil/m/codigos`, si la respuesta viene de la API o de la plataforma, y si había un campo de escaneo abierto en el PC) en la sección «Resultado del diagnóstico» que se añade al final de `specs/016-fix-mobile-code-not-sent/research.md`. Si la plataforma bloquea la petición (hipótesis H2), anotar la exclusión que falta y abrir tarea en Jira (proyecto KAN); no escribir nombres de recursos internos en este repositorio público.
- [X] T002 [P] Añadir a `docs/glosario.md` el término «código pendiente» (código recibido del móvil en el PC sin campo de escaneo abierto, caduca a los 5 minutos) y «por reintentar» (lectura del móvil cuyo envío falló y se puede repetir), aclarando que no son lo mismo

**Checkpoint**: causa localizada o descartada; las fases siguientes cierran los puntos ciegos en cualquier caso.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contrato del envío y reintento seguro; lo necesitan US1 y US2

**⚠️ CRITICAL**: ninguna historia puede empezar sin esta fase

- [X] T003 Definir en `packages/shared/src/` el esquema zod del cuerpo de `POST /api/movil/m/codigos` (`raw` de 1 a 512 caracteres, `id` UUID opcional), exportarlo desde `packages/shared/src/index.ts` e inferir el tipo; reutilizar la constante del límite de 512 en la API y en el móvil
- [X] T004 [P] Añadir pruebas en `apps/api/test/movil.test.ts`: (a) reenviar el mismo `id` no crea un segundo evento y responde 204 las dos veces; (b) sin `id` se sigue publicando como hasta ahora; (c) `raw` de 513 caracteres responde 400; (d) `id` mal formado responde 400; (e) un código con separador de grupo (U+001D) llega íntegro por `GET /api/movil/sesiones/:id/eventos`; (f) token caducado o sesión cerrada responde 401; (g) dos códigos seguidos salen en el orden de envío; (h) el evento queda asociado al usuario que abrió el emparejamiento (FR-012)
- [X] T005 Usar el esquema de T003 en `apps/api/src/rutas/movil.ts` (ruta `POST ${PREFIJO_MOVIL}/codigos`) y hacer idempotente `publicar()` en `apps/api/src/servicios/movil.ts`: si ya existe un evento `codigo` de la sesión con el mismo `id` (guardado dentro de `datos`), no se inserta otro; el `id` no se devuelve al PC en `eventos()`; el contenido de `raw` no se escribe en ningún log

**Checkpoint**: las pruebas de T004 pasan; la API admite reintentos sin duplicar.

---

## Phase 3: User Story 1 - Leer el DataMatrix con el móvil y verlo en el ordenador (Priority: P1) 🎯 MVP

**Goal**: todo código leído con el móvil (en vivo o por foto) llega íntegro al ordenador y el móvil solo confirma «enviado» cuando el sistema lo ha aceptado.

**Independent Test**: emparejar un móvil, abrir una recepción y leer un DataMatrix GS1 de prueba: la línea se rellena en menos de 5 s; el móvil muestra «Enviando…» y después «Enviado» solo tras el 204.

### Tests for User Story 1

- [X] T006 [P] [US1] Crear `apps/web/src/lib/envio-codigo.test.ts` con `fetch` simulado: la lectura pasa por `enviando → enviada` solo tras un 204; el cuerpo lleva `raw` íntegro y un `id` UUID; la cabecera `x-movil-token` se envía; cada lectura recibe un `id` distinto

### Implementation for User Story 1

- [X] T007 [US1] Crear `apps/web/src/lib/envio-codigo.ts`: función pura/asíncrona que envía una lectura (`id`, `raw`, `leidoAt`) a `/api/movil/m/codigos` y devuelve su estado (`enviada`, `por-reintentar`, `sin-emparejamiento`, `rechazada`) con el motivo en español claro, según la tabla de transiciones de [data-model.md](data-model.md); el estado `enviando` lo gestiona quien la llama
- [X] T008 [US1] Cambiar `enviar()` de `CodigoEnvase` en `apps/web/src/paginas/movil.tsx` para usar `envio-codigo.ts`: mostrar «Enviando…» mientras tanto, y la marca de «Enviado» (y `navigator.vibrate`) solo cuando el estado sea `enviada`; las lecturas en vivo (`EscanerCamara`) y por foto (`deFoto`) usan el mismo camino
- [X] T009 [US1] Ajustar la lista de lecturas de `apps/web/src/paginas/movil.tsx` para que muestre estado y hora de cada lectura (últimas 5) en un tamaño legible, no solo una marca verde pequeña

**Checkpoint**: US1 funciona sola: el camino feliz es correcto y la confirmación es veraz.

---

## Phase 4: User Story 2 - Saber en el momento si el código no ha llegado (Priority: P1)

**Goal**: ante cualquier fallo de envío el móvil lo dice de forma destacada, conserva el código y deja reintentar sin volver a escanear (salvo emparejamiento caducado).

**Independent Test**: con el móvil sin conexión, leer un código: aviso grande «No se ha enviado» con «Reintentar»; restablecer la conexión y pulsar «Reintentar»: el código llega al PC una sola vez.

### Tests for User Story 2

- [X] T010 [P] [US2] Ampliar `apps/web/src/lib/envio-codigo.test.ts`: red caída → `por-reintentar`; 5xx → `por-reintentar`; respuesta que no es JSON de la API (redirección o 403 de plataforma) → `por-reintentar` con el texto «No se ha enviado: comprueba la conexión del móvil»; 401 → `sin-emparejamiento` con «El emparejamiento ha caducado: vuelve a leer el código QR del ordenador»; 400 por exceso de longitud → `rechazada` con «El código es demasiado largo para enviarlo»; 400 por código vacío o `id` mal formado → `rechazada` con «El código no es válido»; el reintento reutiliza el mismo `id` y `raw`

### Implementation for User Story 2

- [X] T011 [US2] Completar `apps/web/src/lib/envio-codigo.ts` con la traducción de cada fallo de T010 (nunca texto técnico ni «error interno») y con guardar/leer la última lectura no enviada en `sessionStorage` para que sobreviva a bloquear la pantalla o cambiar de aplicación
- [X] T012 [US2] En `apps/web/src/paginas/movil.tsx` mostrar un aviso destacado (`role="alert"`, fondo de error, tamaño grande) con el motivo, el botón «Reintentar» solo en estado `por-reintentar`, y para `sin-emparejamiento` la explicación sin reintento; al volver a abrir la página, restaurar y mostrar el estado de la última lectura (FR-006)
- [X] T013 [US2] En el mismo `apps/web/src/paginas/movil.tsx` (después de T012), distinguir el aviso de error del de éxito con vibración en patrón distinto y con `pitido(false)` de `apps/web/src/lib/sonido.ts` (el éxito usa `pitido(true)`), respetando los dispositivos sin vibración
- [X] T014 [P] [US2] Prueba de componente en `apps/web/src/paginas/` (nuevo `movil.test.tsx`): con `fetch` fallido aparece el aviso con «Reintentar»; pulsarlo con `fetch` correcto lo hace desaparecer y muestra «Enviado»; con 401 no aparece «Reintentar»

**Checkpoint**: US1 y US2 juntas cierran el defecto del lado del móvil.

---

## Phase 5: User Story 3 - El ordenador avisa de un código recibido sin campo de escaneo (Priority: P2)

**Goal**: un código recibido sin campo de escaneo abierto se ve, se conserva 5 minutos y se usa solo cuando la persona lo decide; el fin del emparejamiento se explica.

**Independent Test**: con el PC en la pantalla de inicio, leer un código con el móvil: aviso visible; abrir una dispensación antes de 5 min: «Usar el código recibido» lo entrega una vez; después de 5 min: aviso de que caducó.

### Tests for User Story 3

- [X] T015 [P] [US3] Crear `apps/web/src/lib/movil.test.tsx` con tiempo simulado: un código sin oyente queda pendiente; `usarPendiente()` entrega una vez el más antiguo vigente y lo borra; dos códigos sin oyente se conservan y salen en orden de llegada; un sexto descarta el más antiguo y lo avisa; a los 5 minutos cada uno se descarta y queda el aviso de caducado hasta que llegue otro código; con un oyente abierto el código se entrega directamente sin pasar por pendiente; varios códigos de un mismo bloque llegan en orden; en varias consultas seguidas (también tras una pausa en segundo plano) el cursor no se salta ni repite ningún evento; el fin de sesión (`activa: false`, 401, 403 o 404) deja un `motivoFin`

### Implementation for User Story 3

- [X] T016 [US3] En `apps/web/src/lib/movil.tsx` sustituir `codigoSinDestino` por una cola de códigos pendientes `{ raw, recibidoAt }` (máximo 5, caducidad de 5 minutos, ambas constantes con nombre), exponer `codigosPendientes`, `usarPendiente(fn)` (entrega el más antiguo vigente) y el aviso de caducado (`caducadoAt`, hasta que llegue un código nuevo o se cierre) en el contexto, no borrarlos al suscribirse un campo, y guardar `motivoFin` cuando la sesión termina (borrarlo al abrir un emparejamiento nuevo)
- [X] T017 [US3] En `apps/web/src/componentes/escaner.tsx` mostrar en `CampoEscaneo` el botón «Usar el código recibido» cuando haya un código pendiente vigente (indicando cuántos hay), que entrega el más antiguo a `onLectura(raw, 'camara')` una sola vez; si hay aviso de caducado y ninguno vigente, mostrar «El código recibido ha caducado: vuelve a leer el envase»
- [X] T018 [US3] En `apps/web/src/componentes/movil-pc.tsx` reemplazar el aviso de una línea de `AvisosMovil` por un aviso visible con el último código (acortado), la hora, el número de pendientes, la cuenta atrás de caducidad del más antiguo vigente (el que se entregará) y el aviso de descarte (por caducidad o por exceso de 5) si lo hubo, con opción de cerrarlo; y mostrar `motivoFin` en el diálogo «Usar el móvil» (FR-010)
- [X] T019 [P] [US3] Prueba de componente de `CampoEscaneo` en `apps/web/src/componentes/` (nuevo `escaner.test.tsx`): el botón aparece con un código pendiente vigente, no aparece sin él, y el código no se aplica sin pulsarlo

**Checkpoint**: las tres historias funcionan de forma independiente.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T020 [P] Humo en `apps/web/e2e/` (nuevo `movil-codigo.spec.ts`, `AUTH_MODE=dev`, `EXTRACTOR=fake`): emparejar, enviar un código a la API con el token y comprobar que el campo de escaneo lo recibe y que, sin campo abierto, aparece el aviso y el botón; si el entorno de pruebas no permite emparejar sin móvil real, dejar `it.todo` explicando qué falta
- [X] T021 [P] Comprobar que los textos nuevos están en español claro, sin jerga, y que el contenido del código no aparece en logs ni telemetría (revisar `apps/api/src/app.ts` y los `console.*` tocados)
- [X] T022 Ejecutar `pnpm lint && pnpm typecheck && pnpm test` y corregir lo que falle
- [ ] T023 Recorrer los 8 escenarios manuales de [quickstart.md](quickstart.md) con un móvil real, incluidas 20 lecturas seguidas de DataMatrix GS1 (SC-001) cronometrando la llegada al PC (SC-002), y anotar el resultado en `specs/016-fix-mobile-code-not-sent/quickstart.md`. La prueba con personal de farmacia (SC-006) queda como aceptación posterior a la entrega

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 primero (decide si hay trabajo de infraestructura aparte); T002 en paralelo
- **Foundational (Phase 2)**: puede empezar en paralelo con T001 (no depende del diagnóstico; solo la validación manual depende de él); bloquea US1 y US2. T004 (pruebas) antes de T005
- **US1 (Phase 3)** y **US2 (Phase 4)**: tras la Fase 2. US2 amplía `envio-codigo.ts` y `movil.tsx` de US1, así que va después de US1 (mismos archivos)
- **US3 (Phase 5)**: tras la Fase 2; **independiente de US1/US2** (solo toca el lado del PC)
- **Polish (Phase 6)**: tras las historias deseadas

### Within Each User Story

- Pruebas primero y en rojo, después la implementación
- `envio-codigo.ts` antes de `movil.tsx` (página); contexto (`lib/movil.tsx`) antes de `escaner.tsx` y `movil-pc.tsx`

### Parallel Opportunities

- T002 con T001; T004 con T003
- T006 en paralelo con la espera de T005
- T014 en paralelo con T012 y T013 (archivo distinto; T012 y T013 tocan el mismo `movil.tsx`, van en secuencia)
- US3 completa (T015–T019) en paralelo con US1/US2 si hay dos personas: no comparten archivos
- T020 y T021 en paralelo

## Parallel Example: User Story 3

```text
T015 (apps/web/src/lib/movil.test.tsx)   ← en paralelo con →   T019 (apps/web/src/componentes/escaner.test.tsx)
después T016 → T017 y T018 (archivos distintos, ambos dependen de T016)
```

## Implementation Strategy

### MVP First (US1 + US2)

1. T001 (diagnóstico) y Fase 2
2. US1 y US2: el móvil ya no pierde ni oculta ningún envío
3. **Parar y validar** con el escenario 1–4 de [quickstart.md](quickstart.md)

### Incremental Delivery

1. Fase 1 + 2 → API con reintento seguro
2. US1 → camino feliz veraz → validar
3. US2 → fallos visibles y reintento → validar (**cierra el defecto**)
4. US3 → el PC no pierde códigos sin campo abierto → validar
5. Polish

## Notes

- La interpretación GS1 (`packages/gs1`) no cambia; no hay migraciones ni variables de entorno nuevas.
- Varias pestañas del PC emparejadas con el mismo móvil: cada una recibe el código; coordinarlas queda fuera de alcance (spec, Assumptions).
- Si T001 confirma que la plataforma bloquea la petición del móvil, la corrección de infraestructura es un trabajo aparte (Jira KAN, documentación interna en Confluence); US1 y US2 siguen siendo necesarias para que el fallo no sea silencioso.
- Un PR por bloque, Conventional Commits (`fix(web):`, `fix(api):`), referencia a «spec 016».

## Implementation notes (spec 016)

- **T001 and T023 stay open**: they need a real phone against the non-production environment; they cannot be done from this session. The code closes the four silent-loss points regardless of T001's result.
- **T014 (deviation)**: web tests run in plain node (no jsdom, no click-driven component tests). The states, retry and "no retry after 401" are covered by `lib/envio-codigo.test.ts`; the page itself is exercised by the e2e smoke test T020 and by scenarios 2-4 of `quickstart.md` (T023).
- **T015/T016 (deviation)**: the pending-code logic is a pure class, `lib/codigos-pendientes.ts` (injected clock, tested in `lib/codigos-pendientes.test.ts`), following the `BuzonAlbaranes` pattern, instead of a `lib/movil.test.tsx` that would need a DOM. The cursor-without-gaps case is covered in `apps/api/test/movil.test.ts` (server side of the poll).
- **T018**: the notice shows the oldest valid code (the one «Usar el código recibido» delivers) with its countdown, and the count of the rest.
- **T013** was done inside `paginas/movil.tsx` together with T012 (same function).
