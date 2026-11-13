---

description: "Lista de tareas de 013-mobile-albaran-qr-scan"
---

# Tareas: Albarán o factura y códigos QR desde el móvil en la recepción de mercancía

**Entrada**: documentos de diseño en `specs/013-mobile-albaran-qr-scan/`

**Requisitos previos**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/api-movil-albaranes.md](contracts/api-movil-albaranes.md), [quickstart.md](quickstart.md)

**Tests**: incluidos. La constitución (Principio II) exige tablas `it.each` en los paquetes puros y tests de la API solo
con fixtures; SC-002 y SC-003 solo se pueden comprobar con tests.

**Organización**: tareas agrupadas por historia de usuario; US1 (albarán) y US2 (QR) son independientes entre sí.

## Formato: `[ID] [P?] [Historia] Descripción`

- **[P]**: se puede hacer en paralelo (ficheros distintos, sin depender de una tarea sin terminar)
- **[Historia]**: US1 = albarán desde el móvil (P1), US2 = QR del envase en la recepción (P2)
- Los textos de la interfaz, en español europeo claro, exactamente como figuran en el contrato; los identificadores, en
  inglés salvo en los módulos que ya usan nombres en español (`leerAlbaran`, `unirLecturas`).

---

## Fase 1: Preparación

Nada que preparar: no hay dependencias, paquetes ni variables de entorno nuevos (plan.md, Technical Context).

---

## Fase 2: Base (bloquea solo a US1)

**Propósito**: cambio de esquema que necesita US1. US2 no lo necesita y puede empezar ya.

- [X] T001 Añadir a `albaranDocumento` en packages/db/src/schema/entradas.ts la columna `paginas: jsonb().$type<{ path: string; mime: string }[] | null>()` (nullable; comentario en español: todas las páginas en orden; nulo en las filas antiguas = una sola página, `documentoPath`)
- [X] T002 Ejecutar `pnpm db:generate -- --name albaran_paginas` para que el fichero y la etiqueta del diario se llamen `0021_albaran_paginas` (no renombrar el SQL a mano: la etiqueta de packages/db/migrations/meta/_journal.json debe coincidir con el nombre del fichero). Comprobar que el SQL solo contiene `ALTER TABLE "albaran_documento" ADD COLUMN "paginas" jsonb;` y que el diario tiene la entrada nueva

**Punto de control**: `pnpm db:migrate` se aplica sin errores en una base local.

---

## Fase 3: Historia 1 - Fotografiar el albarán con el móvil al recibir la mercancía (Prioridad: P1) 🎯 MVP

**Objetivo**: el móvil emparejado envía una o varias fotos, o un PDF, del albarán; el ordenador muestra la misma
propuesta que con una subida desde el ordenador (cabecera, líneas, totales y duplicados) y el móvil solo muestra el
estado del envío.

**Prueba independiente**: con `EXTRACTOR=fake`, emparejar una ventana de móvil, enviar dos imágenes desde «Albarán o
factura» y comprobar que el ordenador abre una recepción nueva con la cabecera y las líneas de
`fixtures/albaranes/sintetico-1.invoice.json` (quickstart.md, pasos 2–5).

### Tests de la historia 1 (escribirlos primero; deben fallar)

- [X] T003 [P] [US1] Añadir en packages/extraction/test/albaran.test.ts una tabla `it.each` de `unirLecturas`: una sola lectura se devuelve igual; la cabecera repartida entre páginas toma el primer valor no nulo; las líneas se concatenan en orden de página; los totales salen de la última página con algún total no nulo; si ninguna tiene totales, todos nulos; `modelo` de la primera lectura
- [X] T004 [P] [US1] Añadir tests de la API en apps/api/test/movil.test.ts (con sus ayudas de emparejamiento y `EXTRACTOR=fake`): `POST /api/movil/m/albaranes` con 2 partes de imagen `pagina` → 201 `{ enviado: true }` sin datos leídos; los eventos de la sesión son `leyendo` y después `{ tipo: 'albaran', documentoId }`; `GET /api/recepciones/albaranes/:documentoId` devuelve `{ documentoId, lectura, distribuidorSugerido, duplicados, mismoFichero }`; la fila de `albaran_documento` tiene 2 `paginas` y `creado_por` = quien emparejó; existe un evento de auditoría `albaran_leer` con ese actor y un `userAgent` que empieza por `movil`; el `lectura` que devuelve esa ruta es igual (`toEqual`) al que devuelve `POST /api/recepciones/albaranes` con las mismas imágenes (SC-002)
- [X] T005 [P] [US1] Añadir tests de error de la API en apps/api/test/movil.test.ts: token caducado o cerrado → 401 `NO_AUTORIZADO`; 0 ficheros → 400 `VALIDACION`; 11 ficheros → rechazado por el límite de la subida (`files: 10` de apps/api/src/app.ts; comprobar solo que es un 4xx, que no se guarda nada y que no se publica ningún evento); tipo de fichero no admitido → 400; sin lector de albaranes (`lectorAlbaranes` nulo) → `EXTRACTOR_NO_CONFIGURADO` y se publica el evento `{ tipo: 'albaran', documentoId: null }`; los mismos ficheros enviados dos veces por la misma persona → una sola fila de `albaran_documento` y el mismo `documentoId`; `GET /api/movil/m/sesion` devuelve `albaranes: true|false`
- [X] T006 [P] [US1] Añadir tests de las rutas del PC en el fichero de tests de recepciones que ya existe en apps/api/test/ (localizarlo con `grep -l "recepciones/albaranes" apps/api/test`): `GET /api/recepciones/albaranes/:id` → 404 si no existe y 400 `VALIDACION` (`campo: 'documentoId'`) cuando ya está unida a una recepción; `GET /api/recepciones/:id/documento?pagina=2` devuelve la segunda página y `?pagina=3` → 404 con una lectura de 2 páginas; las filas antiguas (`paginas` nulo) siguen sirviendo la página 1; `POST /api/recepciones/albaranes` (un fichero) devuelve la misma forma que antes

### Implementación de la historia 1

- [X] T007 [P] [US1] Implementar y exportar la función pura `unirLecturas(lecturas: LecturaAlbaran[]): LecturaAlbaran` en packages/extraction/src/albaran.ts, con las reglas de data-model.md (sin E/S ni reloj); exportarla desde la entrada del paquete si las exportaciones de `albaran.ts` pasan por un índice
- [X] T008 [US1] Cambiar `leerAlbaran(doc, c)` por `leerAlbaran(paginas: { bytes: Uint8Array; mime: string }[], c)` en apps/api/src/servicios/recepciones.ts: validar de 1 a 10 páginas; `sha256` de todas las páginas concatenadas; antes de leer, devolver la respuesta ya existente si hay un `albaran_documento` con el mismo `sha256`, el mismo `creadoPor` y `recepcionId` nulo (research.md R4); leer cada página con `this.d.lectorAlbaranes.leer`, unirlas con `unirLecturas` y después `proponerLineas`; guardar cada página con `guardarFichero` (mismo prefijo `lecturas/...` más `-p{n}`); guardar `documentoPath` y `mime` de la página 1 y `paginas` con todas; mantener la auditoría y la forma de la respuesta (depende de T001, T007)
- [X] T009 [US1] Sacar la construcción de la respuesta del final de `leerAlbaran` a un método `lectura(documentoId: string)` en apps/api/src/servicios/recepciones.ts que carga la fila y devuelve `{ documentoId, lectura, distribuidorSugerido, duplicados, mismoFichero }`; lanzar `DomainError('NO_ENCONTRADO')` si no existe y el error `VALIDACION` que ya existe, con `campo: 'documentoId'` (mismo mensaje que en `crear`), si `recepcionId` está informado; que `leerAlbaran` devuelva `this.lectura(id)`
- [X] T010 [US1] Cambiar `documento(id)` por `documento(id, pagina = 1)` en apps/api/src/servicios/recepciones.ts: la página 1 sigue usando `recepcion.documentoPath`; para la página > 1, cargar el `albaran_documento` con `recepcionId = id` y tomar `paginas[pagina - 1]`; 404 `NO_ENCONTRADO` si no existe. En `detalle`, añadir `paginas: number` (longitud de `paginas`, o 1) al objeto `documento`
- [X] T011 [US1] Actualizar apps/api/src/rutas/operativa.ts: `POST /api/recepciones/albaranes` pasa `[{ bytes, mime }]`; añadir `GET /api/recepciones/albaranes/:documentoId` (`preHandler: pre`, parámetro uuid con zod, resumen en español) → `rec.lectura(...)`; añadir a `GET /api/recepciones/:id/documento` la consulta `pagina: z.coerce.number().int().min(1).default(1)`; mover `MIMES_ALBARAN` (hoy un `const` dentro de la función de rutas, línea ~150) al nivel del módulo y exportarlo, para que T013 pueda importarlo (depende de T009, T010)
- [X] T012 [US1] Añadir `{ tipo: 'albaran'; documentoId: string | null }` a `EventoMovil` en apps/api/src/servicios/movil.ts; en `publicar`, validar que `documentoId` es un uuid o nulo
- [X] T013 [US1] En apps/api/src/rutas/movil.ts: añadir `POST ${PREFIJO_MOVIL}/albaranes` (multipart, resumen en español): autenticar con `delMovil`; leer las partes de fichero `pagina` (de 1 a 10; tipos de `MIMES_ALBARAN`, importado de operativa.ts); publicar `{ tipo: 'leyendo' }`; llamar a `new RecepcionesService(d).leerAlbaran(paginas, m.ctx)`; publicar `{ tipo: 'albaran', documentoId }`; ante cualquier error, publicar `{ tipo: 'albaran', documentoId: null }` y relanzarlo; responder 201 `{ enviado: true }`. Añadir `albaranes: !!d.lectorAlbaranes` a la respuesta de `GET ${PREFIJO_MOVIL}/sesion` (depende de T008, T011, T012)
- [X] T014 [US1] Regenerar apps/api/openapi.json con `pnpm --filter @mmx/api openapi` (script `tsx src/cli/openapi.ts` de apps/api/package.json; si el nombre del paquete no es ese, usar `pnpm -C apps/api openapi`) para que salgan las rutas nuevas (depende de T011, T013)
- [X] T015 [P] [US1] En apps/web/src/paginas/movil.tsx, convertir `EnviarReceta` en un componente genérico `EnviarPaginas` con las propiedades `{ token, titulo, explicacion, ruta, accept, textoEnviando, maxPaginas, onEnviado?, demo? }`, que conserva la lista de páginas, `prepararPagina`, el estado de ocupado y el bloqueo del doble envío, y que no deja añadir más de `maxPaginas` («Un albarán admite hasta 10 páginas»); `EnviarReceta` queda como envoltorio fino con los textos y el comportamiento de hoy (`phash` y `fixture` siguen siendo solo de la receta)
- [X] T016 [US1] Añadir la tarjeta «Albarán o factura» en apps/web/src/paginas/movil.tsx con `EnviarPaginas` (`ruta: '/api/movil/m/albaranes'`, `accept: 'image/*,application/pdf'`, `maxPaginas: 10`, texto de envío «Enviando y leyendo el albarán…», texto final «Enviado al ordenador», sin datos leídos); leer `albaranes` de la respuesta de `/sesion` y, si es falso, mostrar la tarjeta desactivada con «La lectura de albaranes no está configurada: regístralo en el ordenador» (depende de T015)
- [X] T017 [US1] En apps/web/src/lib/movil.tsx: añadir el evento `albaran` al tipo `Evento`; al recibirlo, poner `leyendo` a falso; con `documentoId` no nulo, avisar a los oyentes de albarán suscritos o, si no hay ninguno, guardarlo en un valor nuevo del contexto `albaranSinDestino`; con nulo, poner un valor nuevo `errorAlbaran` con el texto «No se ha podido leer el documento» (el mismo que con una subida desde el ordenador); añadir `suscribirAlbaran` y exportar el hook `useAlbaranesMovil(fn: (documentoId: string) => void)` igual que `useCodigosMovil` (al suscribirse se limpia `albaranSinDestino`)
- [X] T018 [US1] En apps/web/src/componentes/movil-pc.tsx, junto al aviso de `codigoSinDestino`: mostrar «Ha llegado un albarán desde el móvil» con el botón «Abrir la recepción», que navega a `/recepciones` con la búsqueda `{ albaran: <id> }`; mostrar `errorAlbaran` como mensaje de error (depende de T017)
- [X] T019 [US1] En apps/web/src/main.tsx, añadir `validateSearch` a la ruta `/recepciones` para admitir un `albaran` uuid opcional (con el mismo estilo que el `validateSearch` de las otras rutas)
- [X] T020 [US1] En apps/web/src/paginas/recepciones.tsx (formulario de nueva recepción): sacar de `leer` el código que aplica un `AlbaranLeido` (setLeido, setDuplicados, setD con las mismas reglas de cabecera) a `aplicarLectura(r)`; cargar `GET /api/recepciones/albaranes/:id` al abrir la página con `?albaran=` (pasando a `modo = 'albaran'`) y cuando `useAlbaranesMovil` entregue un id; si ya hay una lectura a la vista y la recepción no se ha creado, preguntar «¿Sustituir el albarán leído por el que acaba de llegar del móvil?» con el diálogo de confirmación que ya usa la aplicación antes de reemplazarla; si falla la carga, mostrar el mensaje de error de la API (depende de T011, T017, T019)
- [X] T021 [US1] En `VisorDocumento` de apps/web/src/paginas/recepciones.tsx: cuando `documento.paginas > 1`, mostrar botones de página («Página 1», «Página 2»…) que cambian el origen a `${documento.url}?pagina=n` (con una clave de consulta por página) (depende de T010)

**Punto de control**: pasan T003–T006 y los pasos 2–5 de quickstart.md funcionan a mano.

---

## Fase 4: Historia 2 - Leer con el móvil el QR de un envase en la recepción (Prioridad: P2)

**Objetivo**: un QR de envase con una dirección GS1 Digital Link rellena código nacional, lote y caducidad igual que el
DataMatrix equivalente; un QR sin producto se rechaza con un mensaje claro y nunca se abre.

**Prueba independiente**: en una recepción abierta, pegar en el campo de escaneo
`https://id.gs1.org/01/08470005700168/10/LOTE1?17=280100` → código nacional 570016, lote `LOTE1`, caducidad
31/01/2028; pegar `https://www.example.com/producto` → mensaje de `QR_SIN_PRODUCTO` y no se rellena nada
(quickstart.md, pasos 6–7).

### Tests de la historia 2 (escribirlos primero; deben fallar)

- [X] T022 [P] [US2] Añadir a packages/gs1/test/gs1.test.ts una tabla `it.each` con el `GTIN14` que ya existe: Digital Link con `01` + `10` + `?17=` da el mismo `Gs1Ok` que la cadena GS1 equivalente salvo `simbologia: 'qr'`; con `21` (serie); `17` con día `00` → último día del mes; dominio propio con prefijo de ruta (`https://example.com/x/01/...`); lote escapado (`LO%2FTE` → `LO/TE`); GTIN-13 en la ruta, completado a 14; claves de consulta desconocidas ignoradas; `712` en la consulta → `cn` por NHRN; dígito de control erróneo → `GTIN_CONTROL`; mes no válido en `17` → `FECHA_INVALIDA`; `https://www.example.com/producto` y `http://` sin `01` → `QR_SIN_PRODUCTO`; el prefijo `]Q3` seguido de una dirección también funciona
- [X] T023 [P] [US2] Añadir un test de la API de `POST /api/scan/parse` con el Digital Link de T022 (mismo CN, lote y caducidad que el DataMatrix) y con una dirección que no es GS1 (`ok: false`, `error: 'QR_SIN_PRODUCTO'`) en el fichero de tests de escaneo que ya existe en apps/api/test/ (localizarlo con `grep -l "scan/parse" apps/api/test`)

### Implementación de la historia 2

- [X] T024 [US2] En packages/gs1/src/index.ts: añadir `'QR_SIN_PRODUCTO'` a `Gs1Error['error']`; añadir la función pura `digitalLinkAGs1(url: string): string | null` que, con `URL`, lee los segmentos de la ruta por pares `clave/valor` desde la primera clave `01` (`01` → GTIN, completado a 14 dígitos por la izquierda; después `22`, `10`, `21`, `235`) y los parámetros de consulta cuyo nombre sea un AI conocido (`FIJOS`/`VARIABLES`), aplica `decodeURIComponent` a cada valor y construye la cadena GS1 con `GS` tras los AI de longitud variable; en `parseGs1`, después de `quitarPrefijo`, si `s` cumple `/^https?:\/\//i`, convertirla con ella, devolver `{ ok: false, error: 'QR_SIN_PRODUCTO', detalle: 'El código QR no contiene el código del producto' }` si da nulo y, si no, seguir con el análisis de siempre con `simbologia = 'qr'`. No consultar nunca la dirección. Comentario de documentación en español que cite GS1 Digital Link (sintaxis sin comprimir)
- [X] T025 [US2] En apps/web/src/paginas/recepciones.tsx, donde `/api/scan/parse` devuelve `!s.ok` (hoy «No se ha podido leer el código»), mostrar «Este código QR no identifica el medicamento: lee el DataMatrix del envase o escribe los datos» cuando `s.error === 'QR_SIN_PRODUCTO'` y mantener el mensaje actual en los demás casos
- [X] T026 [US2] En `EnviarCodigo` de apps/web/src/paginas/movil.tsx, cambiar el texto a «Lee el código del envase (DataMatrix, código QR o código de barras). Llega a la pantalla de escaneo abierta en el ordenador.» (mismo fichero que T015–T016: no hacerlo a la vez)

**Punto de control**: pasan T022–T023 y los pasos 6–7 de quickstart.md funcionan a mano.

---

## Fase 5: Cierre y aspectos transversales

- [X] T027 [P] Añadir «Enlace GS1 (GS1 Digital Link)» a docs/glosario.md: un QR cuyo contenido es una dirección web con el código del producto, el lote y la caducidad; la aplicación solo lee el texto y nunca la abre
- [X] T028 [P] Actualizar SPEC.md §4.9 (recepción: captura del albarán también desde el móvil emparejado, con varias páginas) y el párrafo de escaneo 2D cerca de SPEC.md L405–410 (se admite el QR con GS1 Digital Link), con una o dos frases en cada sitio
- [X] T029 [P] Actualizar en packages/shared/src/ayuda/secciones.ts los textos de ayuda que describan el móvil o la lectura de albaranes, si hablan solo de receta y DataMatrix
- [X] T030 Comprobar que ninguna línea de log ni error nuevo de apps/api/src/rutas/movil.ts o apps/api/src/servicios/recepciones.ts incluye contenido del documento (constitución III)
- [ ] T031 Ejecutar `pnpm lint && pnpm typecheck && pnpm test` y después `pnpm test:int` (la migración y las rutas de recepciones están cubiertas con Testcontainers); corregir lo que falle. **Estado:** lint, typecheck y test pasan (12 de 12 paquetes); `pnpm test:int` no se pudo ejecutar en esta sesión (Testcontainers no encuentra un entorno de contenedores), pendiente de ejecutar donde haya Docker
- [X] T032 Recorrer quickstart.md de principio a fin con `EXTRACTOR=fake`, incluidas las comprobaciones solo manuales de SC-001 y SC-005 **Hecho (2026-11-12) con `api-prueba` y `web-prueba` (extractor simulado, base en memoria):** pasos 2–7 comprobados en el navegador: el móvil envía 2 páginas y solo ve «Enviado al ordenador»; el aviso del PC y la carga desde el menú; la pregunta al sustituir un albarán leído y lo escrito a mano; las 2 páginas en el visor; el QR con enlace GS1 rellena código nacional, lote y caducidad; una web sin producto da el mensaje de QR_SIN_PRODUCTO

---

## Dependencias y orden de ejecución

### Dependencias entre fases

- **Fase 2 (T001–T002)**: bloquea solo a US1.
- **US1 (Fase 3)**: después de la Fase 2.
- **US2 (Fase 4)**: sin dependencias; puede empezar ya y en paralelo con la Fase 2 y con US1.
- **Cierre (Fase 5)**: después de las historias que documenta; T031–T032 al final.

### Dentro de US1

- Primero los tests T003–T006.
- T007 → T008 → T009 → T010 → T011 (mismo fichero de servicio, en orden).
- T012 → T013 (también necesita T008 y T011) → T014.
- T015 → T016.
- T017 → T018.
- T019 es independiente.
- T020 necesita T011, T017 y T019; T021 necesita T010.

### Dentro de US2

- Tests T022–T023 → T024 → T025. T026 es independiente en el código, pero comparte fichero con T015–T016.

### Oportunidades de paralelismo

- Tests de US1: T003 y T006 a la vez; T004 y T005 comparten fichero (una sola persona).
- T007 (extraction), T012 (servicio del móvil), T015 (página del móvil) y T019 (router) tocan ficheros distintos y pueden empezar a la vez.
- Toda US2 en paralelo con US1. T022 y T023 a la vez.
- Cierre T027–T029 a la vez.

## Ejemplo de paralelismo

```text
# US2 junto a US1:
Tarea: "T022 [US2] Tabla de casos de Digital Link en packages/gs1/test/gs1.test.ts"
Tarea: "T003 [US1] Tabla de casos de unirLecturas en packages/extraction/test/albaran.test.ts"
Tarea: "T023 [US2] Test de la API de scan/parse con Digital Link"
Tarea: "T019 [US1] validateSearch de albaran en apps/web/src/main.tsx"
```

## Estrategia de implementación

### MVP (US1)

1. T001–T002 y después T003–T021.
2. Parar y validar con los pasos 2–5 de quickstart.md. Entregable: el albarán se puede fotografiar con el móvil.

### Entrega incremental

1. US2 (T022–T026) es pequeña e independiente; puede ir antes o con US1.
2. Cierre (T027–T032) antes de abrir la PR. Una sola PR para el bloque de recepción (constitución IV).

---

## Fase 6: Convergence (convergencia con la revisión de código)

**Origen**: revisión `ponytail-review` del 2026-11-12 sobre lo implementado; cada hallazgo se comprobó en el código antes de añadirlo. Hacer primero T033 y T034 (fallos de comportamiento) y después T036, que prueba ambos.

- [X] T033 HIGH: en `suscribirAlbaran` de apps/web/src/lib/movil.tsx, cuando una pantalla se suscribe y hay un id en `albaranSinDestino`, entregárselo (`fn(id)`) y después limpiarlo, en lugar de limpiarlo sin más; guardar el id pendiente también en un `useRef` para leerlo dentro del `useCallback`. Hoy, si el aviso «Ha llegado un albarán desde el móvil» está a la vista y la persona abre Recepciones por el menú (no con el botón del aviso), el aviso desaparece y la lectura se pierde de la pantalla per US1/AC4 y FR-005 (partial)
- [X] T034 HIGH: en `cargarDelMovil` de apps/web/src/paginas/recepciones.tsx, preguntar «¿Sustituir…?» también cuando `modo === 'manual'` y `d.distribuidor` o `d.albaran` no están vacíos, no solo cuando `leido` está informado; hoy un albarán del móvil pisa en silencio la cabecera que la persona está escribiendo a mano per Edge Cases «segundo albarán desde el móvil… no lo sobrescribe sin avisar» y FR-004 (partial)
- [X] T035 MEDIUM: limitar el tamaño total de un albarán en `leerAlbaran` de apps/api/src/servicios/recepciones.ts (por ejemplo 25 MB entre todas las páginas, rechazado con `VALIDACION` y mensaje en español) y calcular el `sha256` página a página (sin `Buffer.concat` de todas las páginas); hoy 10 ficheros de 20 MB ocupan unos 200 MB en memoria y hasta el triple con las copias de `new Uint8Array(...)`, y pueden reiniciar el contenedor per plan: Constraints (partial)
- [X] T036 MEDIUM: añadir un test web (vitest, junto a los de apps/web/src/lib o componentes) que monte `ProveedorMovil`, reciba un evento `albaran` sin ningún suscriptor, monte después un suscriptor con `useAlbaranesMovil` y compruebe que recibe el id y que el aviso se limpia (falla antes de T033); añadir otro para T034 que compruebe que en modo manual con la cabecera escrita se pide confirmación antes de reemplazarla per Constitution II (missing)
- [X] T037 LOW: apps/api/openapi.json trae unas 780 líneas que no son de esta feature (no se regeneró en specs anteriores); dejar en esta PR solo las rutas de la spec 013 (regenerar en un commit aparte o restaurar el fichero y regenerarlo por separado) per Constitution IV, un cambio por PR (unrequested) **Hecho a mano (2026-11-12):** apps/api/openapi.json vuelve a estar como en el último commit (el hook de seguridad bloqueó hacerlo desde la sesión). Las rutas nuevas de la spec 013 no están en ese fichero: regenerarlo en un commit aparte con `pnpm --filter @mmx/api openapi`
- [X] T038 LOW: definir una sola constante del máximo de páginas del albarán en packages/shared y usarla en `files` de `multipart` (apps/api/src/app.ts), en `MAX_PAGINAS_ALBARAN` de apps/api/src/servicios/recepciones.ts y en apps/web/src/paginas/movil.tsx; hoy son tres copias del número 10 per plan: Constraints (partial)
- [X] T039 LOW: cerrar la carrera de dos envíos idénticos a la vez en `leerAlbaran` (dos lecturas de pago y dos filas sin recepción) con un índice único parcial sobre `(sha256, creado_por)` donde `recepcion_id` sea nulo en una migración 0022 escrita a mano como la 0021, y devolver la fila existente si el insert falla por duplicado; si no se quiere la migración, dejar anotada la decisión aquí per research.md R4 (partial) **Decisión (2026-11-12): no se hace.** El índice único no se puede crear si ya hay filas sin recepción repetidas (las subidas anteriores a esta feature las permitían), así que la migración podría fallar al desplegar; el riesgo que cubre (dos envíos idénticos en el mismo instante) solo cuesta una lectura de más y una fila suelta sin recepción. Si se quisiera, hacerlo en una spec aparte con una limpieza previa de duplicados

---

## Fase 7: Convergence (segunda pasada, tras el recorrido en el navegador)

- [X] T040 MEDIUM: regenerar apps/api/openapi.json con `pnpm --filter @mmx/api openapi` en un commit aparte, para que el fichero versionado incluya `POST /api/movil/m/albaranes` y `GET /api/recepciones/albaranes/{documentoId}` (hoy no están, porque T037 lo dejó como en el último commit); comprobar con `grep` que aparecen las dos rutas per T014 y SPEC §7 (partial)
- [X] T041 LOW: poner al día specs/013-mobile-albaran-qr-scan/contracts/api-movil-albaranes.md y data-model.md con lo construido en la Fase 6: tope de 25 MB entre todas las páginas (400 `VALIDACION`), albarán pendiente que se entrega a la primera pantalla de recepción que se abre (también por el menú), pregunta «¿Sustituir lo que has escrito…?» cuando la cabecera se está escribiendo a mano, y el máximo de páginas como constante compartida `MAX_PAGINAS_DOCUMENTO` per T033, T034, T035 y T038 (partial)
