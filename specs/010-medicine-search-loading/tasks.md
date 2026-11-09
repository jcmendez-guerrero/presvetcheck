---
description: "Tareas de implementación: indicador de carga y búsquedas estables en los buscadores de medicamentos"
---

# Tasks: Indicador de carga y búsquedas estables en los buscadores de medicamentos

**Input**: Design documents from `specs/010-medicine-search-loading/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/buscador-medicamentos.md](./contracts/buscador-medicamentos.md), [quickstart.md](./quickstart.md)

**Tests**: incluidas. La especificación pide resultados medibles (SC-001…SC-005) y la constitución (principio II)
exige pruebas; nunca se llama a CIMAVet: Playwright intercepta `/api/medicamentos/buscar` con `page.route`.

**Organization**: por historia de usuario. Todo el cambio vive en `apps/web/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (ficheros distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario de [spec.md](./spec.md) (US1, US2, US3)

## Referencias rápidas del código actual

| Pantalla | Fichero | Qué hay hoy |
|----------|---------|-------------|
| Revisión | `apps/web/src/paginas/revision.tsx` | `cand = useQuery({ queryKey: ['buscar', busqueda, especie], enabled: buscar && busqueda.trim().length >= 3 })`; `EstadoBusqueda` local (≈ línea 1015); lista `cand.data?.map` con botones `elegir-${cn}` |
| Recepciones | `apps/web/src/paginas/recepciones.tsx` | `cand = useQuery({ queryKey: ['buscar', busqueda], enabled: busqueda.trim().length >= 3 && !sel })`; `sinResultados` (≈ línea 591) con aviso «Otro producto»; lista `cand.data?.map` |
| Sustituto | `apps/web/src/paginas/resultado.tsx` | `buscar(q)` manual con `setBuscando`/`setCandidatos(items.slice(0, 8))`, mínimo 2 |
| Vademécum | `apps/web/src/paginas/vademecum.tsx` | `buscarA`/`buscarB` manuales con `setItemsA/B(res.slice(0, 6))`, mínimo 2 |
| API | `apps/web/src/lib/api.ts` | `api(metodo, url, cuerpo?)` y `get(u)` sin `signal` |
| Icono | `apps/web/src/componentes/ui.tsx` | `Cargando` usa `Loader2` de `lucide-react` con `animate-spin` |

---

## Phase 1: Setup

Sin tareas: no hay dependencias nuevas ni configuración (ver [plan.md](./plan.md), Technical Context).

---

## Phase 2: Foundational (bloquea todas las historias)

**Purpose**: la anulación de peticiones, el hook compartido y la función pura de estado, de los que dependen
US1, US2 y US3.

- [X] T001 Añadir parámetro opcional `signal?: AbortSignal` a `api()` (cuarto argumento) y a `get(u, signal?)` en `apps/web/src/lib/api.ts`, pasándolo a `fetch`; sin `signal` el comportamiento no cambia. Ningún otro llamador se modifica.
- [X] T002 [P] Crear `apps/web/src/lib/busqueda.ts` con las constantes `PAUSA_BUSQUEDA_MS = 300`, `TIEMPO_MAX_BUSQUEDA_MS = 10_000`, `MIN_LETRAS_BUSQUEDA = 3`, el tipo `EstadoBusqueda = 'corto' | 'buscando' | 'error' | 'vacio' | 'resultados'` y la función pura `estadoBusqueda({ letras, pendiente, error, n })` con la prioridad de [data-model.md](./data-model.md) (corto → buscando → error → vacio → resultados).
- [X] T003 Crear `apps/web/src/lib/busqueda.test.ts` con una tabla `it.each` sobre `estadoBusqueda`: los cinco estados, la prioridad (p. ej. `pendiente` gana a `error` y a `n=0`; `letras < 3` gana a todo) y los bordes 2/3 letras.
- [X] T004 Implementar `useBusquedaMedicamentos<T>(texto, { especie?, activo = true })` en `apps/web/src/lib/busqueda.ts` según [contracts/buscador-medicamentos.md](./contracts/buscador-medicamentos.md): `textoEstable` actualizado con `setTimeout(PAUSA_BUSQUEDA_MS)` en `useEffect` (con limpieza); `useQuery` con `queryKey: ['buscar', textoEstable.trim(), especie ?? null]`, `enabled: activo && textoEstable.trim().length >= MIN_LETRAS_BUSQUEDA`, `placeholderData: keepPreviousData`, `retry: false`, y `queryFn: ({ signal }) => get<T[]>(url, AbortSignal.any([signal, AbortSignal.timeout(TIEMPO_MAX_BUSQUEDA_MS)]))` con `encodeURIComponent` y `&especie=` solo si hay especie. Devuelve `{ estado, resultados, desfasada, reintentar }`: `desfasada = texto.trim() !== textoEstable.trim() || isPlaceholderData || isFetching`; `pendiente` para `estadoBusqueda` = `desfasada && letras >= 3`; con `letras < 3` devuelve `resultados: []`; `reintentar = refetch`. Depende de T001 y T002.

**Checkpoint**: `pnpm --filter @mmx/web test -- busqueda` en verde y `pnpm typecheck` sin errores.

---

## Phase 3: User Story 1 - Ver que la búsqueda está en marcha (Priority: P1) 🎯 MVP

**Goal**: en los cuatro buscadores se ve el icono giratorio con "Buscando…" mientras se busca, y después la lista,
"sin resultados" o el error con "Volver a intentar".

**Independent Test**: en `/vademecum`, con la respuesta retrasada 1 s por `page.route`, el `data-testid="estado-busqueda"` muestra "Buscando" durante la espera y desaparece al llegar; con 503 muestra el error y `reintentar-busqueda` vuelve a buscar.

### Tests for User Story 1

- [X] T005 [P] [US1] Crear `apps/web/e2e/busqueda-medicamentos.spec.ts` con las pruebas de la historia 1 en `/vademecum` (campo "Medicamento A"): (a) respuesta retrasada 1 s → "Buscando" visible y luego la lista; (b) `[]` → "No se ha encontrado ningún medicamento"; (c) 503 y después 200 → mensaje de error, clic en `reintentar-busqueda` → lista. Usar `page.route('**/api/medicamentos/buscar**', …)` con candidatos inventados mínimos (`cn`, `nombre`, `nregistro`, `labtitular`), nunca CIMAVet. Deben fallar antes de T006–T010.

### Implementation for User Story 1

- [X] T006 [US1] Crear `apps/web/src/componentes/estado-busqueda.tsx` con `<EstadoBusqueda estado texto onReintentar />` moviendo y ampliando el `EstadoBusqueda` de `revision.tsx`: un único contenedor `role="status"` `aria-live="polite"` `data-testid="estado-busqueda"`; textos exactos de la tabla del contrato; en `buscando`, `Loader2` (`lucide-react`, `aria-hidden`, `animate-spin`) + «Buscando «{texto}»…»; en `error`, botón `Boton variante="texto"` `data-testid="reintentar-busqueda"` «Volver a intentar»; en `resultados`, texto solo para lector de pantalla (`sr-only`) «{n} resultado(s)». Depende de T002.
- [X] T007 [P] [US1] Revisión: en `apps/web/src/paginas/revision.tsx` sustituir `cand = useQuery(...)` por `useBusquedaMedicamentos<Candidato>(busqueda, { especie, activo: buscar })`, pintar `<EstadoBusqueda>` del nuevo componente y borrar la función `EstadoBusqueda` local; la lista usa `resultados`. Mantener `cambiarBusqueda`/`cambiarNombre` y `elegir` como están. Depende de T004, T006.
- [X] T008 [P] [US1] Recepciones: en `apps/web/src/paginas/recepciones.tsx` sustituir `cand = useQuery(...)` por `useBusquedaMedicamentos(busqueda, { activo: !sel })`, añadir `<EstadoBusqueda>` bajo el campo «Nombre del medicamento»; conservar el aviso `sinResultados` («escanea el envase o regístralo como «Otro producto»») y calcularlo con `estado === 'vacio'` en lugar de `cand.data.length === 0`. Depende de T004, T006.
- [X] T009 [P] [US1] Sustituto: en `apps/web/src/paginas/resultado.tsx` borrar `buscar()`, `buscando` y `candidatos`; `onChange` solo hace `setBusqueda`; usar `useBusquedaMedicamentos<ResultadoBusquedaItem>(busqueda)` y `resultados.slice(0, 8)`; pintar `<EstadoBusqueda>` bajo el campo. Depende de T004, T006.
- [X] T010 [P] [US1] Vademécum: en `apps/web/src/paginas/vademecum.tsx` borrar `buscarA`/`buscarB` e `itemsA`/`itemsB`; `onChange` solo hace `setQA`/`setQB`; dos llamadas `useBusquedaMedicamentos<BusquedaItem>(qA)` y `(qB)` con `resultados.slice(0, 6)`; un `<EstadoBusqueda>` bajo cada campo. Depende de T004, T006.

**Checkpoint**: T005 en verde; el indicador se ve en las cuatro pantallas.

---

## Phase 4: User Story 2 - Que la lista siempre corresponda a lo escrito (Priority: P1)

**Goal**: la persona puede seguir escribiendo; la lista anterior se atenúa y no se puede elegir; solo vale la
última búsqueda; pocas peticiones.

**Independent Test**: en `/vademecum`, la respuesta de "amoxi" (lenta) llega después de la de "amoxicilina" (rápida) y la lista final es la de "amoxicilina"; mientras tanto `lista-resultados` tiene `inert` y `aria-busy="true"`; 10 letras seguidas producen ≤ 2 peticiones.

### Tests for User Story 2

- [X] T011 [P] [US2] Añadir a `apps/web/e2e/busqueda-medicamentos.spec.ts`: (a) respuesta desfasada: `page.route` responde a `q=amoxi` tras 1,5 s y a `q=amoxicilina` al momento, con nombres distintos; tras escribir "amoxi", esperar > 300 ms, completar "amoxicilina" y comprobar que al final solo están los nombres de "amoxicilina"; (b) lista no seleccionable: con una lista ya visible, escribir una letra y comprobar `inert` y `aria-busy="true"` en `lista-resultados` hasta la nueva respuesta; (c) contar peticiones a `/api/medicamentos/buscar` al teclear "amoxicilin" con `pressSequentially` (`delay: 50`) → ≤ 2 (SC-003); (d) el campo admite texto mientras hay búsqueda en marcha (nunca `disabled`). Deben fallar antes de T012–T016.

### Implementation for User Story 2

- [X] T012 [US2] Añadir `<ListaResultados desfasada>` en `apps/web/src/componentes/estado-busqueda.tsx`: `<div data-testid="lista-resultados" aria-busy={desfasada} inert={desfasada} className={desfasada ? 'opacity-50 transition-opacity' : 'transition-opacity'}>{children}</div>`. Depende de T006.
- [X] T013 [P] [US2] Envolver la lista de candidatos de `apps/web/src/paginas/revision.tsx` en `<ListaResultados desfasada={desfasada}>`. Depende de T007, T012.
- [X] T014 [P] [US2] Envolver la lista de candidatos de `apps/web/src/paginas/recepciones.tsx` en `<ListaResultados desfasada={desfasada}>`. Depende de T008, T012.
- [X] T015 [P] [US2] Envolver la lista de candidatos de `apps/web/src/paginas/resultado.tsx` en `<ListaResultados desfasada={desfasada}>`; comprobar que `seleccionarCandidato` no se dispara con la lista atenuada. Depende de T009, T012.
- [X] T016 [P] [US2] Envolver las dos listas de `apps/web/src/paginas/vademecum.tsx` en `<ListaResultados>` con su `desfasada` respectiva; comprobar que elegir A no cambia aunque llegue tarde una respuesta de A. Depende de T010, T012.

**Checkpoint**: T011 en verde; ninguna lista desfasada se puede elegir.

---

## Phase 5: User Story 3 - Mismo comportamiento en todos los buscadores (Priority: P2)

**Goal**: los cuatro buscadores pasan la misma batería (SC-005).

**Independent Test**: las pruebas de US1 y US2 se ejecutan sobre cada buscador y dan el mismo resultado.

- [X] T017 [US3] Refactorizar `apps/web/e2e/busqueda-medicamentos.spec.ts` para que la batería (indicador, sin resultados, error/reintento, respuesta desfasada, `inert`) sea una función `bateria(page, campo)` ejecutada por pantalla: vademécum A y B; sustituto (llegar al resultado con el flujo de receta demo de `apps/web/e2e/humo.spec.ts` y pulsar `btn-buscar-sustituto-1`); revisión (receta demo, «Cambiar»/buscar en la línea); recepciones (nueva recepción manual, línea «medicamento»). Usar los `data-testid` y textos existentes; si una pantalla no tiene forma estable de llegar, dejar `test.fixme` explicando qué falta. Depende de T005, T011.
- [X] T018 [US3] Comprobar que ningún texto de búsqueda queda duplicado en las páginas: `grep -rn "Buscando\|al menos 3 letras\|No se ha encontrado ningún medicamento" apps/web/src/paginas` solo debe dar el consejo extra de recepciones; todo lo demás sale de `apps/web/src/componentes/estado-busqueda.tsx`. Depende de T007–T010.

**Checkpoint**: T017 en verde en las cuatro pantallas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T019 [P] Añadir a `apps/web/src/componentes/ui.test.tsx` (estilo `renderToString`) un caso para `EstadoBusqueda`: `role="status"`, el icono es `aria-hidden` y el texto «Buscando» está presente (FR-008).
- [ ] T020 Ejecutar la comprobación manual de [quickstart.md](./quickstart.md) (Slow 3G en `/vademecum`, una sola petición, lista atenuada) y anotar el resultado en la descripción del PR. _(Pendiente: los mismos escenarios ya los cubre Playwright con respuestas retrasadas; falta la prueba a mano con Slow 3G.)_
- [X] T021 Ejecutar `pnpm lint && pnpm typecheck && pnpm test` y `pnpm --filter @mmx/web test:e2e` desde la raíz; todo en verde antes de dar la tarea por terminada.

---

## Dependencies & Execution Order

```text
T001 ─┐
T002 ─┼─▶ T004 ─┐
T003 (tras T002)│
                ├─▶ T006 ─▶ T007 T008 T009 T010 (paralelo) ─▶ T012 ─▶ T013 T014 T015 T016 (paralelo)
T005 (en cualquier momento; falla hasta T010)        T011 (falla hasta T016)
                                                      └──────────────▶ T017, T018 ─▶ T019–T021
```

- **Foundational (T001–T004)** bloquea todo.
- **US1** (T005–T010) es el MVP. **US2** (T011–T016) toca los mismos ficheros de página que US1, así que va
  después; ambas son P1 y salen en el mismo PR.
- **US3** (T017–T018) solo verifica y unifica; depende de US1 y US2.

## Parallel Example: User Story 1

```text
Tras T006, cuatro personas/agentes a la vez (ficheros distintos):
  T007 revision.tsx · T008 recepciones.tsx · T009 resultado.tsx · T010 vademecum.tsx
```

## Parallel Example: User Story 2

```text
Tras T012: T013 revision.tsx · T014 recepciones.tsx · T015 resultado.tsx · T016 vademecum.tsx
```

## Implementation Strategy

1. **MVP**: Foundational + US1 → el indicador se ve en las cuatro pantallas y, gracias al hook, las respuestas
   desfasadas ya no sobrescriben la lista (la clave de la consulta lo garantiza).
2. **US2**: atenuar y bloquear la selección de la lista anterior; pruebas de orden y número de peticiones.
3. **US3**: misma batería en las cuatro pantallas.
4. Un único PR (`feat(web): indicador de carga y búsquedas estables en los buscadores de medicamentos`).

## Phase 7: Convergence

- [X] T022 CRITICAL: En `apps/web/src/lib/busqueda.ts`, usar `AbortSignal.any?.([signal, AbortSignal.timeout(TIEMPO_MAX_BUSQUEDA_MS)]) ?? signal` para que en navegadores sin `AbortSignal.any` (iPadOS < 17.4) la búsqueda siga funcionando (solo se pierde el corte de 10 s), per US1/AC1–AC4, plan D3 (contradicts)
- [X] T023 En `apps/web/e2e/busqueda-medicamentos.spec.ts`, sustituir `await esperar(500)` del paso «amoxi» → «amoxicilina» por esperar la petición real (`page.waitForRequest` cuyo `q` sea exactamente `amoxi`), para que la prueba de respuesta desfasada no pase sin probar nada, per SC-002, US2/AC1 (partial)
- [X] T024 Añadir a `apps/web/e2e/busqueda-medicamentos.spec.ts`, solo en la prueba de vademécum A, un paso con una búsqueda que nunca responde (`q=colgado`, sin `fulfill`) que compruebe «No se ha podido consultar el catálogo» con `timeout: 12_000`, per FR-003, edge case «El catálogo tarda mucho» (partial)
- [X] T025 En `apps/web/src/lib/busqueda.ts`, añadir `&& limpio === estable` a `enabled` para no lanzar la búsqueda del nombre anterior al pulsar «Cambiar» en vademécum, per FR-005 (partial)
