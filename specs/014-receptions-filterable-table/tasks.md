---

description: "Lista de tareas de 014-receptions-filterable-table"
---

# Tareas: Tabla filtrable de recepciones de mercancía

**Entrada**: documentos de diseño en `specs/014-receptions-filterable-table/`

**Requisitos previos**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/api-recepciones-lista.md](contracts/api-recepciones-lista.md), [quickstart.md](quickstart.md)

**Tests**: obligatorios por la constitución (principio II) y siempre antes del código que prueban; deben fallar
al escribirlos. Como toda la consulta de la API y el módulo puro de filtros de la web se construyen en la Base,
sus tests también van en la Base; las historias solo llevan los tests de su interfaz.

## Formato: `[ID] [P?] [Historia] Descripción`

- **[P]**: se puede hacer en paralelo (ficheros distintos, sin depender de una tarea sin terminar)
- **[Historia]**: US1, US2 o US3 de spec.md

---

## Fase 1: Preparación

- [X] T001 Confirmar el punto de partida: `pnpm lint && pnpm typecheck && pnpm test` en verde en la rama `claude/receptions-filterable-table-3ad144`; localizar con `grep -n "'/api/recepciones'" apps/api/test/flujos.test.ts apps/web/src/paginas/recepciones.tsx` los dos únicos llamadores del `GET /api/recepciones` (research R2)

---

## Fase 2: Base (bloquea a todas las historias)

**Objetivo**: el endpoint filtrable y paginado y el estado de la dirección existen y están probados, aunque la
página aún muestre la lista antigua.

### Tests de la base (escribirlos primero; deben fallar)

- [X] T002 [P] Crear apps/api/test/recepciones-lista.test.ts (mismo arranque que apps/api/test/recepciones-precios.test.ts: `api`, `entorno`; las recepciones se crean con `POST /api/recepciones` y, cuando haga falta un estado o un `createdAt` concreto, actualizando la fila con `deps.db`). Casos, agrupados con `describe` por historia:
  - **Forma (US1)**: cada fila trae exactamente `id, albaran, proveedor, fechaRecepcion, fechaCompra, registradaAt, estado` (sin `empleado` ni datos del documento); `proveedor` es el nombre; una sin albarán trae `albaran: null`; por defecto, el registro más reciente primero; las descartadas no salen; con 30 recepciones, `porPagina=25` → 25 filas y `total: 30`, `pagina=2` → 5, `pagina=9` → `filas: []` y `total: 30`, `porPagina=101` → 400.
  - **Permisos (FR-015)**: `dev-admin` (fuera de `ROLES.operativa`) → 403; sin usuario → 401.
  - **Filtros (US2)**: `numero=0099` encuentra «F-2025-0099» aunque haya 60 más recientes; sin distinguir mayúsculas (`f-2025`); `numero=%` y `numero=_` no actúan como comodines; `distribuidorId`; `estado=ABIERTA,ERROR_SINCRONIZACION`; `estado=DESCARTADA` muestra la descartada; rangos de recepción y de compra con los dos extremos incluidos y con un solo extremo; varios filtros combinados; `compraDesde=2026-11-10&compraHasta=2026-11-01` → 400; `estado=OTRO` → 400; `proveedores` solo trae distribuidores con alguna recepción.
  - **Fecha de registro en Madrid (FR-013)**, tabla `it.each` de `[registradaDesde = registradaHasta, createdAt, ¿sale?]`: `2026-11-16` con `2026-11-15T23:30:00Z` → sí (00:30 CET) y con `2026-11-16T23:30:00Z` → no; `2026-07-16` con `2026-07-15T22:30:00Z` → sí (00:30 CEST) y con `2026-07-16T22:30:00Z` → no; días de cambio de hora `2026-03-29` con `2026-03-28T23:30:00Z` → sí y `2026-10-25` con `2026-10-24T22:30:00Z` → sí; y solo `registradaDesde` o solo `registradaHasta`.
  - **Orden (US3)**: tabla `it.each` de `orden` × `dir` para las seis columnas (comprobar el orden de los ids); nulos al final en `orden=recibida` con `asc` y con `desc`; paginación estable con fechas de compra iguales (desempate).
  - **Volumen (SC-003)**: insertar 5.000 recepciones de 20 proveedores en un solo `insert` por lotes con `deps.db` y comprobar que la consulta por defecto, `numero=12` y `distribuidorId` + `estado` + rango de compra responden cada una en menos de 1.000 ms (`performance.now()`). `// shortcut: umbral sobre PGlite en memoria; si es inestable en CI, subir el umbral y medir a mano en quickstart.md paso 16`.
- [X] T003 [P] Crear apps/web/src/lib/recepciones-filtros.test.ts con tablas `it.each` para: `leerFiltros` (los valores válidos se conservan; `estado` desconocido, fecha mal formada, `pagina=0` y `orden=x` se descartan; nunca devuelve `albaran`, que sigue siendo el id del documento del móvil); `aConsulta` (`proveedor` → `distribuidorId`; sin valores vacíos); `rangoInvalido`; `hayFiltros`; `ESTADO_RECEPCION` (los cinco códigos tienen texto; solo `ABIERTA` y `ERROR_SINCRONIZACION` con `atencion`); y `diaMadrid` (`2026-11-15T23:30:00Z` → `2026-11-16`; `2026-07-15T22:30:00Z` → `2026-07-16`; `2026-03-29T00:30:00Z` y `2026-10-25T00:30:00Z`, días de cambio de hora)

### Implementación de la base

- [X] T004 Añadir en apps/api/src/schemas.ts el esquema zod `ListarRecepcionesQuery` con todos los parámetros de contracts/api-recepciones-lista.md: `numero` (trim, 1–60), `distribuidorId` (uuid), `estado` (CSV → array de `ABIERTA|FINALIZADA|SINCRONIZADA|ERROR_SINCRONIZACION|DESCARTADA`, mínimo 1), los seis `…Desde/…Hasta` (`YYYY-MM-DD`), `orden` (`albaran|proveedor|recibida|compra|registrada|estado`, por defecto `registrada`), `dir` (`asc|desc`, por defecto `desc`), `pagina` (`z.coerce` int ≥ 1, por defecto 1), `porPagina` (`z.coerce` int 1–100, por defecto 25), con un `superRefine` que añade un problema por cada par con `desde > hasta` (ruta del campo `…Hasta`); y `ListaRecepcionesDto` = `{ filas: { id, albaran: string|null, proveedor, fechaRecepcion: string|null, fechaCompra, registradaAt, estado }[], total, pagina, porPagina, proveedores: { id, nombre }[] }`; exportar los tipos inferidos
- [X] T005 Reescribir `listar` en apps/api/src/servicios/recepciones.ts como `listar(q: ListarRecepcionesQuery)`: `select` de `recepcion` con `innerJoin(distribuidor)` devolviendo solo los campos de `ListaRecepcionesDto.filas` (`registradaAt` = `recepcion.createdAt`); `where` con `and(...)` de: estados (`inArray`; si no viene `estado`, `ne(estado, 'DESCARTADA')`), `distribuidorId` (`eq`), `numero` (`ilike(recepcion.albaran, '%' + escapado + '%')`, escapando `\`, `%` y `_`), fechas de recepción y de compra (`gte`/`lte` sobre el texto `YYYY-MM-DD`), y fecha de registro con `rangoMadrid` de `@mmx/shared`: inicio = `rangoMadrid(desde, desde)[0]` (`gte`) y fin = `rangoMadrid(hasta, hasta)[1]` (`lt`), cada uno solo si viene su extremo; orden con un mapa cerrado `orden → columna` (`proveedor` → `distribuidor.nombre`), `asc/desc` con `NULLS LAST` (`sql\`${col} ${dir} nulls last\``, con `dir` del mapa cerrado, nunca el texto recibido) y desempate `desc(recepcion.createdAt), asc(recepcion.id)`; `limit(porPagina).offset((pagina-1)*porPagina)`; `total` con `count()` sobre el mismo `where` y el mismo join; `proveedores` = distribuidores con alguna recepción (`selectDistinct` de `distribuidor.id, nombre` con join a `recepcion`), ordenados con `localeCompare(…, 'es')`; devolver `{ filas, total, pagina, porPagina, proveedores }`
- [X] T006 En apps/api/src/rutas/operativa.ts, añadir `querystring: ListarRecepcionesQuery` y `summary: 'Lista filtrable y paginada de recepciones'` al `GET /api/recepciones` (sin `response`: ninguna ruta del fichero lo declara) y pasar `req.query` a `rec.listar`
- [X] T007 Ajustar en apps/api/test/flujos.test.ts (≈L1947) la comprobación de que una recepción descartada no aparece: leer `.json.filas` en lugar del array; T002 y apps/api/test/flujos.test.ts en verde
- [X] T008 [P] Crear apps/web/src/lib/recepciones-filtros.ts con funciones puras sin E/S: tipo `FiltrosRecepciones`; `leerFiltros(s: Record<string, unknown>)` que devuelve solo los valores válidos (mismas listas cerradas y formatos que T004; `pagina` entero ≥ 1; el resto se ignora en silencio); `aConsulta(f)` → `URLSearchParams` para la API (`proveedor` → `distribuidorId`, `numero` tal cual); `rangoInvalido(f)` → lista de campos `…Hasta` con `desde > hasta`; `hayFiltros(f)`; `diaMadrid(iso)` → `YYYY-MM-DD` del instante en Europe/Madrid (`Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' })`); y el mapa `ESTADO_RECEPCION` (código → `{ texto, atencion: boolean }` según research R9); T003 en verde
- [X] T009 En apps/web/src/main.tsx, ampliar `validateSearch` de la ruta `/recepciones`: conservar `albaran` (id del móvil) exactamente como hoy y añadir `...leerFiltros(s)` de T008

**Checkpoint**: `GET /api/recepciones` devuelve la forma nueva con filtros, orden y páginas; T002, T003 y flujos en verde.

---

## Fase 3: Historia 1 - Ver las recepciones en una tabla con columnas claras (Prioridad: P1) 🎯 MVP

**Objetivo**: tabla de seis columnas, paginada, con textos claros, que abre el detalle.

**Prueba independiente**: con recepciones de varios proveedores y estados, abrir Recepciones: seis columnas con los valores correctos, «Sin albarán»/«—» en vacíos, estado en texto claro, total y paginación; pulsar una fila abre su detalle.

### Tests de la historia 1 (escribirlos primero; deben fallar)

- [X] T010 [P] [US1] Crear apps/web/src/paginas/recepciones-tabla.test.tsx al estilo de apps/web/src/paginas/inicio.test.tsx (`renderToString` y `vi.mock` de `@tanstack/react-router` y de los datos): con dos filas, el HTML tiene las cabeceras «Nº de albarán o factura», «Proveedor», «Fecha de recepción», «Fecha de compra», «Fecha de registro», «Estado» en ese orden (`<th scope="col">`), «Sin albarán», «—», fechas `dd/mm/aaaa`, «Error al enviar» (no `ERROR_SINCRONIZACION`) y el total («2 recepciones»)

### Implementación de la historia 1

- [X] T011 [US1] Crear apps/web/src/paginas/recepciones-tabla.tsx con el componente `TablaRecepciones`: lee los filtros con `useSearch({ from: '/recepciones' })`, consulta `get<ListaRecepciones>('/api/recepciones?' + aConsulta(f))` con `useQuery({ queryKey: ['recepciones', f], placeholderData: keepPreviousData })`; dentro de `Tarjeta titulo="Recepciones"` pinta una `<table>` (estilo de la tabla de apps/web/src/paginas/admin.tsx, `w-full text-sm`, contenedor `overflow-x-auto`) con `<caption className="sr-only">`, `<th scope="col">` y una fila por recepción: albarán o «Sin albarán», proveedor, `fecha(fechaRecepcion)`, `fecha(fechaCompra)`, `fecha(diaMadrid(registradaAt))`, estado con `ESTADO_RECEPCION` (icono `AlertTriangle` de lucide con `aria-hidden` y `font-semibold` cuando `atencion`); el nº de albarán es un `<Link to="/recepciones/$id">` (accesible por teclado) y toda la fila navega al pulsar; `Cargando` mientras carga; `Mensaje tipo="error"` con botón «Reintentar» (`refetch`) si falla; debajo, «N recepciones», «Página X de Y» y botones «Anterior»/«Siguiente» que cambian `pagina` con `useNavigate({ from: '/recepciones' })` y `search: (s) => ({ ...s, pagina })`; si `filas` llega vacío con `pagina > 1` y `total > 0`, ir a la última página
- [X] T012 [US1] En apps/web/src/paginas/recepciones.tsx, borrar la consulta `lista` (`queryKey: ['recepciones']`, ≈L202–214) y la `Tarjeta titulo="Recepciones recientes"` (≈L509–521) y poner `<TablaRecepciones />` en su lugar. Hoy no se invalida `['recepciones']` en ningún sitio (solo `['recepcion', id]`): la tabla se refresca porque React Query vuelve a pedir al montarse; comprobarlo en el navegador creando y descartando una recepción y volviendo a Recepciones

**Checkpoint**: US1 funciona sola: la tabla sustituye a la lista.

---

## Fase 4: Historia 2 - Filtrar para encontrar una recepción concreta (Prioridad: P1)

**Objetivo**: filtros por albarán, proveedor, estado y tres rangos de fechas, sobre todas las recepciones (la API ya los admite desde la Base).

**Prueba independiente**: con más de 50 recepciones, filtrar por parte del albarán de una antigua y verla; combinar proveedor y estados y ver solo las que cumplen ambos; rango al revés avisa; «Quitar filtros» vuelve al inicio.

### Tests de la historia 2 (escribirlos primero; deben fallar)

- [X] T013 [P] [US2] Añadir a apps/web/src/paginas/recepciones-tabla.test.tsx: con `numero=0099&estado=ABIERTA` en la búsqueda simulada, el HTML muestra los controles con su etiqueta («Nº de albarán o factura», «Proveedor», «Estado», «Fecha de recepción desde/hasta», …), la caja de texto con `0099`, la casilla «Abierta» marcada y el botón «Quitar filtros»; con `total: 0` y filtros, «No hay recepciones con estos filtros»; con `total: 0` sin filtros, «Todavía no hay recepciones»; con `compraDesde` > `compraHasta`, el aviso «La fecha "hasta" no puede ser anterior a "desde"»

### Implementación de la historia 2

- [X] T014 [US2] En apps/web/src/paginas/recepciones-tabla.tsx, añadir sobre la tabla un formulario de filtros con `Campo`/`Etiqueta` de apps/web/src/componentes/ui (cada control con su etiqueta): «Nº de albarán o factura» (texto; actualiza `numero` en la dirección tras `PAUSA_BUSQUEDA_MS` de apps/web/src/lib/busqueda.ts), «Proveedor» (`<select>` con «Todos» + `proveedores` de la respuesta), «Estado» (casillas con los textos de `ESTADO_RECEPCION`; ninguna marcada = todos menos descartadas), y tres pares «desde/hasta» de tipo `date` para recepción, compra y registro; todo cambio de filtro pone `pagina: undefined` (vuelve a la 1); si `rangoInvalido` no está vacío, no se navega y se muestra junto al campo «La fecha "hasta" no puede ser anterior a "desde"»; en pantalla estrecha los filtros se apilan
- [X] T015 [US2] En apps/web/src/paginas/recepciones-tabla.tsx, botón «Quitar filtros» (visible si `hayFiltros`) que navega con `search: (s) => ({ albaran: s.albaran })`; con `total === 0` y filtros, `Info` «No hay recepciones con estos filtros» con el mismo botón; con `total === 0` y sin filtros, «Todavía no hay recepciones»

**Checkpoint**: US1 + US2 cumplen lo pedido por el usuario.

---

## Fase 5: Historia 3 - Ordenar y conservar los filtros al volver (Prioridad: P2)

**Objetivo**: orden por cualquier columna y estado conservado en la dirección (la API ya ordena desde la Base).

**Prueba independiente**: filtrar y ordenar, abrir una recepción, volver atrás: mismos filtros, orden y página; la dirección copiada da el mismo resultado.

### Tests de la historia 3 (escribirlos primero; deben fallar)

- [X] T016 [P] [US3] Añadir a apps/web/src/paginas/recepciones-tabla.test.tsx: con `orden=compra&dir=asc` en la búsqueda simulada, la cabecera «Fecha de compra» tiene `aria-sort="ascending"` y las demás `aria-sort="none"`; sin `orden`, «Fecha de registro» tiene `aria-sort="descending"`

### Implementación de la historia 3

- [X] T017 [US3] En apps/web/src/paginas/recepciones-tabla.tsx, convertir el contenido de cada `<th>` en un `<button>` que ordena por su columna (primera pulsación `asc`, segunda `desc`; al cambiar de columna empieza en `asc`, salvo «Fecha de registro», que empieza en `desc`), pone `pagina: undefined`, muestra una flecha y expone `aria-sort` en el `<th>`
- [X] T018 [US3] En apps/web/src/paginas/recepciones-tabla.tsx, navegar con `replace: true` al escribir en la caja de albarán (no llenar el historial con cada pausa) y con `replace: false` en el resto de cambios; verificarlo en quickstart.md paso 11: filtrar, ordenar, ir a la página 2, abrir una recepción, pulsar Atrás una vez y ver los mismos filtros, orden y página

**Checkpoint**: las tres historias funcionan juntas.

---

## Fase 6: Cierre y aspectos transversales

- [X] T019 [P] Añadir a quickstart.md un paso 16: con 5.000 recepciones de prueba (`pnpm db:seed` o un script local no versionado), medir en las herramientas del navegador el tiempo de respuesta de `GET /api/recepciones` al cambiar un filtro y anotarlo (SC-003, < 1 s)
- [X] T020 [P] Regenerar apps/api/openapi.json con `pnpm --filter api openapi` y comprobar que el diff solo toca `GET /api/recepciones`
- [X] T021 [P] Revisar los textos de ayuda de recepción en apps/web/src/lib/ayudas.ts (`AYUDA_RECEPCION`) y packages/shared/src/ayuda/: si mencionan la lista de recepciones, explicar en una frase que se puede filtrar y ordenar
- [X] T022 [P] Añadir a SPEC.md §8 (pantallas, `grep -n '^## 8' SPEC.md`) una frase en la pantalla de Recepciones: tabla filtrable (albarán, proveedor, estado, fechas), ordenable y paginada
- [X] T023 `pnpm lint && pnpm typecheck && pnpm test` en verde
- [X] T024 Recorrer quickstart.md en el navegador (`pnpm dev`, `AUTH_MODE=dev`), pasos 1–16, incluidos teclado, lector de pantalla y ventana de 375 px; marcar aquí qué pasos se comprobaron
  - **Recorrido 2026-11-16** (`api-prueba` + `web-prueba`, PGlite en memoria, `EXTRACTOR=fake`, 32 recepciones de prueba de 3 proveedores, 1 descartada). Comprobados: 1 (31 filas, 25 por página, sin la descartada), 2 («Sin albarán»), 3 (textos claros con icono en «Abierta»), 4 («0099» encuentra la más antigua, fuera de la página 1), 5 (proveedor + estado), 6 (rango de compra; 10–15/11 sin resultados, correcto con los datos), 7 (rango al revés: aviso y no se aplica), 8 (mensaje sin resultados y «Quitar filtros»), 9 («Descartada» la muestra), 10 (fecha de compra asc y desc), 11 (abrir y Atrás una vez conserva `?numero=0099`), 12 (la dirección lleva todos los filtros), 14 (375 px: filtros apilados y la tabla se desplaza dentro de la tarjeta, la página no). Etiquetas de los controles comprobadas con `input.labels`.
  - **No comprobado en el navegador**: 13 con un lector de pantalla real (solo `aria-sort`, `scope="col"` y etiquetas), 15 con un móvil emparejado real (`?albaran=` cubierto por T003 y por el código de la ruta), 16 a mano (cubierto por el test de volumen de T002, < 1 s con 5.000 recepciones).
  - **Fallo encontrado y corregido**: con solo «desde» relleno, el formulario lo tomaba por un rango al revés (`''` del campo vacío) y no filtraba. Arreglado en `rangoInvalido` con un caso nuevo en apps/web/src/lib/recepciones-filtros.test.ts.

---

## Dependencias y orden de ejecución

### Dependencias entre fases

- **Preparación (F1)** → **Base (F2)** → historias.
- **US1 (F3)** necesita la Base completa. **US2 (F4)** y **US3 (F5)** amplían `recepciones-tabla.tsx` de US1, así que van después de T011; sus tests (T013, T016) se pueden escribir en paralelo con US1.
- **Cierre (F6)** al final.

### Dentro de la base

T002 y T003 primero (en paralelo; deben fallar). API: T004 → T005 → T006 → T007. Web: T008 → T009. Las dos ramas en paralelo.

### Dentro de cada historia

Tests primero (deben fallar) → interfaz.

### Oportunidades de paralelismo

- T002 (API) y T003 (web); después las ramas T004–T007 y T008–T009.
- T010, T013 y T016 tocan el mismo fichero de test: en paralelo con el código, no entre sí.
- T019, T020, T021 y T022 a la vez.

## Ejemplo de paralelismo

```text
# Base: tests y luego API y web a la vez
T002 apps/api/test/recepciones-lista.test.ts   →  T004→T005→T006→T007 (apps/api)
T003 apps/web/src/lib/recepciones-filtros.test.ts  →  T008→T009 (apps/web)
```

## Estrategia de implementación

1. **MVP**: F1 + F2 + US1 (T001–T012). Se ven todas las recepciones paginadas, con proveedor y estado claro.
2. **Lo pedido**: + US2 (T013–T015): la tabla se filtra. Es el mínimo para cerrar la petición del usuario.
3. **Comodidad**: + US3 (T016–T018): orden y estado conservado al volver.
4. **Cierre**: F6 (T019–T024). Un solo PR (bloque de recepción, SPEC §12.1).

## Phase 7: Convergence

- [X] T025 Al dejar un rango de fechas al revés en el formulario, dejar de aplicar también el rango anterior de ese par (quitarlo de la dirección) para que la tabla no siga filtrada por fechas que ya no se ven en los campos, con un caso en `apps/web/src/paginas/recepciones-tabla.test.tsx`, en `apps/web/src/paginas/recepciones-tabla.tsx` per FR-012 (partial) — Hecho sin tocar la dirección: el par al revés no se envía a la API (`consultaAplicable`); vaciarlo en la dirección borraría lo escrito y el aviso.
- [X] T026 Ordenar por la columna Estado según el texto que se ve (Abierta, Descartada, Enviada, Error al enviar, Finalizada) y no por el código interno, con un caso en `apps/api/test/recepciones-lista.test.ts`, en `apps/api/src/servicios/recepciones.ts` per FR-008 (partial)
