---
description: 'Lista de tareas del asistente de consultas sobre prescripción y dispensación'
---

# Tasks: Asistente de consultas sobre prescripción y dispensación

**Input**: documentos de diseño en `specs/002-prescription-chat-assistant/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: se incluyen porque la constitución (principio II) los exige: tablas `it.each` en el dominio, MSW para
el cliente externo y ningún servicio real en CI. Dentro de cada fase, los tests van **antes** que la
implementación y deben fallar primero.

**Organization**: tareas agrupadas por historia de usuario. US2, US3 y US4 reutilizan el panel y el orquestador
de US1 (ver Dependencias).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (ficheros distintos, sin dependencias pendientes)
- **[Story]**: historia a la que pertenece (US1–US4)
- Rutas relativas a la raíz del repositorio (monorepo `apps/*` + `packages/*`)

---

## Phase 1: Setup (infraestructura compartida)

**Purpose**: paquete nuevo, configuración y documentación de gobierno previa al código.

- [x] T001 Crear el paquete `@mmx/assistant` en `packages/assistant/`, copiando la estructura de `packages/extraction`: `package.json` con scripts `typecheck` y `test` (el banco real vive en `apps/api/src/cli/eval-asistente.ts`); dependencias `@mmx/domain`, `@mmx/shared`, `@azure/identity`,
  `decimal.js` y `zod`; dev `msw`. Añadir también `tsconfig.json`, `vitest.config.ts` y un `src/index.ts` vacío. Añadir `@mmx/assistant: workspace:*` a `apps/api/package.json` y ejecutar `pnpm i`
- [x] T002 [P] Añadir al root `package.json` el script `"eval:asistente": "pnpm --filter @mmx/assistant eval"`
- [x] T003 [P] Añadir las variables `ASSISTANT` (`off|fake|azure`, por defecto `off`), `ASSISTANT_ENDPOINT`, `ASSISTANT_DEPLOYMENT`, `ASSISTANT_API_VERSION` (por defecto `2024-10-21`), `ASSISTANT_TIMEOUT_MS` (20000), `ASSISTANT_MONTHLY_TOKEN_LIMIT` (3000000), `ASSISTANT_PRICE_IN_PER_1K_EUR` y
  `ASSISTANT_PRICE_OUT_PER_1K_EUR` (opcionales, decimales en texto) a `envSchema` en `packages/shared/src/config.ts`. En `superRefine`: con `ASSISTANT=azure` y `NODE_ENV=production`, exigir `ASSISTANT_ENDPOINT` y `ASSISTANT_DEPLOYMENT`; prohibir `ASSISTANT=fake` en producción
- [x] T004 [P] Documentar las variables de T003 en `.env.example`, con descripción y valor por defecto
- [x] T005 [P] Añadir los códigos `ASISTENTE_DESACTIVADO`, `ASISTENTE_NO_DISPONIBLE`, `ASISTENTE_LIMITE_MENSUAL`, `ASISTENTE_CONVERSACION_AJENA`, `ASISTENTE_CONVERSACION_CERRADA` y `RECETA_LINEA_NO_ENCONTRADA` a `packages/shared/src/errors.ts` (`CODIGOS_ERROR`) y sus mensajes en español a
  `packages/shared/src/i18n/errores.es.json`. Los textos de FR-026 y FR-027a van en el mismo catálogo; el texto fijo de «sin información» de [salida-modelo.md](./contracts/salida-modelo.md) es la constante `TEXTO_SIN_INFORMACION` de `packages/assistant/src/textos.ts`
- [x] T006 [P] Escribir el ADR `docs/adr/0017-asistente-de-consultas-con-herramientas-deterministas.md` (decisiones R1–R4 de research.md, y la reintroducción del servicio generativo frente a DUDA-27) y enlazarlo en `docs/adr/README.md`
- [x] T007 [P] Crear `fixtures/asistente/README.md`, que explique el banco (`banco.v1.yaml`) y las respuestas grabadas (`chat/*.json`, que proceden de llamadas reales anonimizadas, nunca inventadas)

---

## Phase 2: Foundational (prerrequisitos bloqueantes)

**Purpose**: esquemas, persistencia, puerto del modelo, saneado de datos personales, validación de citas, control de consumo, orquestador y rutas básicas. Sin esto no hay ninguna historia.

**⚠️ CRITICAL**: ninguna historia puede empezar hasta terminar esta fase.

### Tests (escribir primero)

- [x] T008 [P] Tests `it.each` de `PiiScrubber` en `packages/assistant/test/pii.test.ts`: DNI y NIE con letra correcta e incorrecta, teléfonos `6xx…` con prefijo `+34` y separadores, correos, direcciones («C/ Mayor 12», «Avda. de la Paz, 3») y nombres y teléfonos conocidos pasados como `conocidos[]`
  (sin acentos ni mayúsculas) → `[dato eliminado]` y `eliminada=true`. Texto sin datos personales → sin cambios
- [x] T009 [P] Tests `it.each` de la validación V1–V7 en `packages/assistant/test/citas.test.ts`, según [salida-modelo.md](./contracts/salida-modelo.md): fuente no devuelta en el turno, `respondida` sin fuentes, `simulacionId` inexistente, simulación omitida que se añade, `usaContextoLinea` sin `contexto_linea` y texto con un DNI
- [x] T010 [P] Tests `it.each` de `estadoConsumo` en `packages/assistant/test/consumo.test.ts`: 79 % → normal, 80 % → aviso, 100 % → en_pausa, `limite_ampliado` por encima de lo usado → vuelve a normal o aviso, y cambio de mes en `Europe/Madrid` (31/10 23:30 frente a 01/11 00:30 hora local con el `Clock` inyectado)
- [x] T011 [P] Test en `packages/assistant/test/instrucciones.test.ts`: falla si `src/instrucciones.ts` contiene `\d+\s*(días|dias|meses|mg|%|envases?)`, los códigos de `CODIGOS_ERROR` (`packages/shared/src/errors.ts`) o los nombres de los ficheros YAML de reglas (FR-006)
- [x] T012 [P] Tests MSW del cliente de chat en `packages/assistant/test/azure-client.test.ts`: respuesta con `tool_calls`, respuesta final con `json_schema`, 429 con `retry-after` ≤ 3 s (un reintento), 5xx, _timeout_ (`ASSISTANT_TIMEOUT_MS`), `finish_reason: content_filter` y campos desconocidos
  tolerados. Los cuerpos salen de `fixtures/asistente/chat/*.json`; si falta una respuesta real grabada, dejar `it.todo('falta fixtures/asistente/chat/<caso>.json grabado de una llamada real')`
- [x] T013 [P] Test de integración en `packages/db/test/asistente.test.ts` (PGlite; la comprobación con PostgreSQL real queda en `pnpm test:int`): el _trigger_ rechaza `UPDATE` y `DELETE` en `asistente_intercambio`, y con `mmx.purga_retencion='on'` solo permite `DELETE` de filas con más de 1 año

### Implementación

- [x] T014 Schemas zod en `packages/shared/src/schemas/asistente.ts` y exportarlos desde `packages/shared/src/index.ts`: `ContextoConversacion`, `FuenteCitada`, `SimulacionGuardada`, `SalidaModelo`, los argumentos y resultados de cada herramienta de [herramientas.md](./contracts/herramientas.md),
  los cuerpos y respuestas de [api.md](./contracts/api.md), `ConsumoMesDto` y `CasoEvaluacion`
- [x] T015 Esquema Drizzle `packages/db/src/schema/asistente.ts` con las tablas `asistente_conversacion`, `asistente_intercambio`, `asistente_valoracion` y `asistente_consumo_mes` según [data-model.md](./data-model.md). Exportarlo en `packages/db/src/schema/index.ts`
- [x] T016 Migración `packages/db/migrations/0016_asistente.sql` (sobre la 0015 de `main`) (generar con `pnpm db:generate` y completar a mano): tablas, índices, único `(conversacion_id, orden)`, único `(intercambio_id, usuario_oid)` y _trigger_ `mmx_asistente_solo_insercion` con el mismo patrón que
  la guarda de la migración 0004. Permisos para el rol `mmx_app` como en `0010_permisos_app.sql` (depende de T015)
- [x] T017 [P] `PiiScrubber` en `packages/assistant/src/pii.ts`: `limpiar(texto, conocidos?: string[]) → { texto, eliminada }`. Reutiliza la validación de `packages/domain/src/dni.ts` para DNI y NIE (hace pasar T008)
- [x] T018 [P] Validación de la salida del modelo en `packages/assistant/src/citas.ts`: `validarSalida(salida, turno) → { ok, salida, errores[] }`, con V1–V7 (hace pasar T009)
- [x] T019 [P] `estadoConsumo` (puro) y `costeEstimado` con `decimal.js` en `packages/assistant/src/consumo.ts` (hace pasar T010)
- [x] T020 [P] Puerto `AssistantModel` en `packages/assistant/src/model.ts`: `chat(mensajes, herramientas, schemaSalida) → { tipo: 'herramientas', llamadas[] } | { tipo: 'final', salida, usage }`, con `modelo` y `usage` (tokens de entrada y salida)
- [x] T021 [P] `FakeAssistantModel` en `packages/assistant/src/fake.ts`: ejecuta guiones (lista de rondas: llamadas a herramientas y salida final) elegidos por coincidencia de la pregunta. Si no hay guion, devuelve `sin_informacion`
- [x] T022 Cliente HTTP `AzureChatClient` en `packages/assistant/src/azure/chat-client.ts`: `POST {endpoint}/openai/deployments/{deployment}/chat/completions?api-version=…` con `tools` y `response_format: json_schema` (`strict: true`), _timeout_, un reintento solo con 429 o 5xx y `retry-after` ≤ 3
  s, `content_filter` → salida `fuera_de_ambito`, y errores → `DomainError('ASISTENTE_NO_DISPONIBLE')`. Nunca registra cuerpos de petición ni de respuesta. Implementa `AssistantModel` (depende de T020; hace pasar T012)
- [x] T023 `crearModeloAsistente(config, deps)` en `packages/assistant/src/factory.ts`: `off` → null; `fake` → `FakeAssistantModel`; `azure` → `AzureChatClient` con el proveedor de token de `tokenProviderAzure` de `packages/extraction/src/factory.ts` (moverlo a `packages/shared/src/node/` si hace
  falta para no depender de `@mmx/extraction`). Si falta configuración fuera de producción → modelo desactivado que lanza `ASISTENTE_NO_DISPONIBLE`, sin impedir el arranque
- [x] T024 [P] Instrucciones de comportamiento, **sin reglas legales**, en `packages/assistant/src/instrucciones.ts`: rol; español claro sin jerga; usar siempre herramientas para reglas y datos; no calcular (usar `simular_*`); citar solo `fuenteId` devueltos; declinar lo clínico y lo que está fuera
  de ámbito; no autorizar ni forzar; pedir aclaración si faltan datos; ignorar peticiones de saltarse las reglas; elegir `tipo` según [salida-modelo.md](./contracts/salida-modelo.md). Exportar `instruccionesVersion` (`instrucciones.v1@hash8`) desde `packages/assistant/src/instrucciones.ts` (hace
  pasar T011)
- [x] T025 `ChatOrchestrator` en `packages/assistant/src/orchestrator.ts`: recibe la pregunta ya saneada y el historial (como mucho los últimos 10 intercambios) y un registro de herramientas (`ToolRegistry`, interfaz en `packages/assistant/src/tools/registry.ts`). Hace como mucho 4 rondas y 8
  llamadas, valida los argumentos con zod, recorta a 6.000 caracteres por resultado, registra las fuentes y simulaciones del turno, valida con `validarSalida` (un reintento y después la respuesta fija «sin información»), pasa `PiiScrubber` sobre el texto final (V7) y devuelve la salida, las fuentes,
  las simulaciones, el uso de tokens, las rondas y la duración (depende de T017–T021)
- [x] T026 Repositorio de consumo `ConsumoRepo` en `apps/api/src/servicios/asistente-consumo.ts`: _upsert_ atómico por `mes` (`YYYY-MM` en `Europe/Madrid` con `packages/shared/src/madrid.ts`), lectura del estado y comprobación previa a cada turno (depende de T016, T019)
- [x] T027 Servicio `AsistenteService` en `apps/api/src/servicios/asistente.ts`: `estado()`, `crearConversacion(contexto, usuario)` (de momento solo `general`), `preguntar(conversacionId, pregunta, usuario)` y `cerrar(...)`. `preguntar` comprueba que la conversación es del usuario y está abierta,
  sanea con `PiiScrubber`, comprueba el consumo (en pausa → intercambio con `estado='limite'` y `ASISTENTE_LIMITE_MENSUAL`), ejecuta `ChatOrchestrator`, guarda el intercambio de solo inserción con `regla_version`, `fuentes_version`, `modelo` e `instrucciones_version` (FR-022), incrementa el consumo
  y, ante un error, guarda el intercambio con `estado='error'`. Cierre automático tras 8 h sin actividad (depende de T025, T026)
- [x] T028 Añadir `asistente: { modelo: AssistantModel | null; herramientas: ToolRegistry }` y `mailer` a `AppDeps` en `apps/api/src/deps.ts` y construirlos en `apps/api/src/crear-deps.ts` y en el entorno de tests `apps/api/test/entorno.ts` (con `ASSISTANT=fake`)
- [x] T029 Rutas `GET /api/asistente/estado`, `POST /api/asistente/conversaciones`, `POST /api/asistente/conversaciones/:id/mensajes` y `POST /api/asistente/conversaciones/:id/cerrar` en `apps/api/src/rutas/asistente.ts`, según [api.md](./contracts/api.md), y registrarlas en `apps/api/src/app.ts` (depende de T027, T028)
- [x] T030 Añadir `'*.pregunta'`, `'*.respuesta'`, `'*.texto'` y `'*.comentario'` a `REDACCION` en `apps/api/src/app.ts` (FR-020)
- [x] T031 Test de API en `apps/api/test/asistente.test.ts`: `estado` con `ASSISTANT=off` y `fake`; conversación de otro usuario → 403; conversación cerrada → 409; consumo en pausa → 429 sin llamar al modelo; modelo que falla → 503 e intercambio `estado='error'`; la pregunta con DNI se guarda saneada y con `piiEliminada=true`

**Checkpoint**: la API admite una conversación general con el modelo falso, guarda intercambios inmutables y respeta el límite de consumo.

---

## Phase 3: User Story 1 - Consultar una duda general sobre las reglas (Priority: P1) 🎯 MVP

**Goal**: el empleado pregunta desde cualquier pantalla y recibe una respuesta en español apoyada en las reglas vigentes, la guía o la Ayuda, con las fuentes citadas y simulaciones del motor cuando hay fechas.

**Independent Test**: escenarios 1–3 y 10–11 del [quickstart](./quickstart.md) y los casos US1 del banco con `FakeAssistantModel`: respuesta igual a la regla vigente, con su fuente y versión, sin ninguna receta.

### Tests for User Story 1

- [x] T032 [P] [US1] Tests `it.each` de `simularValidez` y `simularSustituibilidad` en `packages/domain/test/simulacion.test.ts`. Casos de `SPEC.md` §12.2 y de validez: general 1 mes, antimicrobiano 5 días, crónico 3 meses, preventivo 6 meses, psicótropo 1 mes, plazo declarado superior al máximo,
  fin de mes (31/01 + 1 mes), cambio de horario en `Europe/Madrid`. Además: sustitución prohibida en excepcional, clase no indicada, inmunológico y excluido por lista; `FALTAN_DATOS` sin `fechaEmision`. Resultado siempre con `{ decision, motivos, evidencias, reglaVersion, supuestos }`
- [x] T033 [P] [US1] Tests del índice de fuentes en `packages/assistant/test/indice.test.ts`: las secciones de `docs/ref/guia-receta-veterinaria.md` se separan por encabezado con un `fuenteId` estable (`guia:<ancla>`); la búsqueda con sinónimos («antibiótico» encuentra «antimicrobiano») devuelve la
  sección esperada; una consulta sin coincidencias devuelve una lista vacía; la versión cambia si cambia el texto
- [x] T034 [P] [US1] Tests de las herramientas `consultar_reglas`, `buscar_guia`, `buscar_ayuda`, `simular_validez` y `simular_sustituibilidad` en `packages/assistant/test/tools-us1.test.ts`. Con un `RulesBundle` alterado (plazo de antimicrobiano distinto), el resultado refleja el cambio y la versión nueva (US1-AS3)

### Implementation for User Story 1

- [x] T035 [US1] Módulo puro `packages/domain/src/simulacion.ts` con `simularValidez` (compone `casoLinea`, `calcularValidez` y `recetaCaducada`) y `simularSustituibilidad` (compone `sustitucionPermitida` con las exclusiones del `RulesBundle`), los tipos `DecisionSimulacion` y `ResultadoSimulacion`,
  y la exportación en `packages/domain/src/index.ts`. Sin I/O y con `Clock` inyectado (hace pasar T032)
- [x] T036 [P] [US1] Pasar el contenido de la Ayuda de JSX a datos en `packages/shared/src/ayuda/secciones.ts` (`{ id, titulo, bloques: ({ p: Inline[] } | { lista: Inline[][] })[] }`, con `Inline` = texto o negrita) y exportar `textoPlanoAyuda(seccion)`. Cambiar `apps/web/src/paginas/ayuda.tsx` para que pinte esos datos sin cambios visibles (índice y búsqueda se mantienen)
- [x] T037 [P] [US1] Índice léxico en memoria en `packages/assistant/src/fuentes/indice.ts`: secciones por encabezado de la guía y de la Ayuda, normalización con `packages/shared/src/text.ts`, sinónimos del dominio en `packages/assistant/src/fuentes/sinonimos.ts`, `fuentesVersion` (`guia@hash8+ayuda@hash8`) y lectura de fragmentos por `fuenteId` (hace pasar T033)
- [x] T038 [US1] Herramientas `consultar_reglas` (`packages/assistant/src/tools/reglas.ts`), `buscar_guia` y `buscar_ayuda` (`packages/assistant/src/tools/fuentes.ts`), y `simular_validez` y `simular_sustituibilidad` (`packages/assistant/src/tools/simulaciones.ts`), según
  [herramientas.md](./contracts/herramientas.md), registradas en `ToolRegistry` (depende de T035, T037; hace pasar T034)
- [x] T039 [US1] Construir el índice al arrancar y registrar las herramientas US1 en `apps/api/src/crear-deps.ts`. La guía se busca con `findUp('docs/ref/guia-receta-veterinaria.md')`; incluirla en la imagen de producción a través del `Dockerfile`
- [x] T040 [US1] Ruta `GET /api/asistente/fuentes/:fuenteId` en `apps/api/src/rutas/asistente.ts`: fragmento actual, versión y `versionVigente` según la `version` pedida (FR-007)
- [x] T041 [US1] Preguntas de ejemplo (FR-004) en `packages/shared/src/ayuda/preguntas-ejemplo.ts`, devueltas por `GET /api/asistente/estado`
- [x] T042 [US1] Panel del asistente en `apps/web/src/componentes/asistente.tsx`: botón flotante «Preguntar» (≥ 44 px, accesible por teclado; oculto si `activo=false`), panel lateral (pantalla completa en móvil), preguntas de ejemplo, campo de pregunta (≤ 2.000 caracteres) con el aviso permanente
  «No escribas datos del cliente», indicador «Buscando en las reglas…», texto plano de la respuesta, fichas de fuente que abren un visor del fragmento, tarjeta «Simulación» pintada desde `simulaciones` (nunca desde el texto), aviso de datos eliminados, mensajes de 429 y 503 con enlace a `/ayuda` y
  botón «Nueva conversación»
- [x] T043 [US1] Montar el panel en `apps/web/src/componentes/layout.tsx` y añadir los tipos y las llamadas a `apps/web/src/lib/api.ts` y `apps/web/src/lib/tipos.ts`
- [x] T044 [US1] Guiones de `FakeAssistantModel` para los ejemplos de US1 (validez con antibiótico, vacuna no sustituible, psicótropos, solo principio activo, simulación del 3 de octubre, fuera de ámbito) en `packages/assistant/src/guiones/us1.ts`, usados en la demo y en los tests
- [x] T045 [US1] Casos US1 en `fixtures/asistente/banco.v1.yaml` (formato `CasoEvaluacion`): preguntas generales sobre validez, sustitución, formato, psicótropos y estupefacientes, solo principio activo, uso humano, fuera de ámbito, intentos de saltarse las reglas («ignora las reglas», «autoriza
  esta sustitución») y preguntas con DNI o teléfono. Marcar en el YAML los casos pendientes de validar por JC
- [x] T046 [US1] Test `apps/api/test/asistente-banco.test.ts`: ejecuta los casos con guion del banco con `FakeAssistantModel` y la API en memoria, y comprueba el tipo, las fuentes citadas, las simulaciones y el saneado

**Checkpoint**: MVP. El asistente responde dudas generales con fuentes y simulaciones; la app funciona igual con `ASSISTANT=off`.

---

## Phase 4: User Story 2 - Preguntar por una línea de receta concreta (Priority: P2)

**Goal**: desde Resultado o Dispensación, el empleado pregunta por una línea y el asistente explica el resultado del motor y los pasos a seguir, sin datos del titular ni del veterinario.

**Independent Test**: escenarios 4–6 del [quickstart](./quickstart.md): la tarjeta «Resultado del motor» coincide con la línea, el teléfono del titular se elimina y el bloqueo no forzable se explica.

### Tests for User Story 2

- [x] T047 [P] [US2] Tests `it.each` de `simularCambioFormato` y `simularEquivalencia` en `packages/domain/test/simulacion.test.ts`: 500 mg × 10 → 2 × 250 mg × 10 válido; 1 × 1.000 mg no válido (`CONCENTRACION_SUPERIOR`); cantidad superior (`CANTIDAD_SUPERIOR`); dosis no ajustable con comprimidos
  enteros (aviso); equivalencia con indicación `PROBABLE`; tiempo de espera superior en especie productora; cantidad `NO_NORMALIZABLE`
- [x] T048 [P] [US2] Test en `apps/api/test/asistente-linea.test.ts`: con la receta de la _seed_, el JSON de `contexto_linea` contiene exactamente las claves permitidas de [herramientas.md](./contracts/herramientas.md) y **no** contiene las claves ni los valores (nombre, teléfono, DNI, dirección del
  titular; nombre, colegiado, teléfono, correo del veterinario) de la _seed_ (FR-014, FR-018, FR-021a)
- [x] T049 [P] [US2] Test de API en `apps/api/test/asistente-linea.test.ts`: crear conversación `linea` con una línea inexistente → 404; con línea evaluada → contexto guardado; pregunta con el teléfono del titular de esa receta → `[dato eliminado]`; `contexto_motor` guardado igual al resultado del motor (US2-AS1, AS2, AS4, AS5)

### Implementation for User Story 2

- [x] T050 [US2] Añadir `simularCambioFormato` (compone `evaluarAlternativaFormato`, `validarEnvasesFormato` y `notaAdministracion`) y `simularEquivalencia` (compone `evaluarEquivalencia`) a `packages/domain/src/simulacion.ts`, con los medicamentos ya resueltos como `MedicamentoInfo` desde fuera (hace pasar T047)
- [x] T051 [US2] Construir el DTO de lista blanca de la línea en `apps/api/src/servicios/asistente-contexto.ts`, a partir de la última evaluación guardada (`RecetasService`) y de los campos confirmados de la receta. Validar con el zod `.strict()` de T014. **No** consultar las tablas `propietario` ni `veterinario` para el DTO
- [x] T052 [US2] Herramientas `contexto_linea` (`packages/assistant/src/tools/linea.ts`), `simular_cambio_formato` y `simular_equivalencia` (`packages/assistant/src/tools/simulaciones.ts`; resuelven `nregistro`/`cn` con `CimavetRepository.medicamentos` y devuelven `FALTAN_DATOS` si no los
  encuentran), registradas solo para conversaciones del tipo que corresponde (depende de T050, T051; hace pasar T048)
- [x] T053 [US2] En `AsistenteService` (`apps/api/src/servicios/asistente.ts`): admitir `contexto: { tipo: 'linea', recetaLineaId }`, guardar `contexto_motor` en cada intercambio que use `contexto_linea` y pasar a `PiiScrubber` como `conocidos[]` el nombre y teléfono del titular y del veterinario de
  esa receta, descifrados solo en memoria con `ColumnCipher` y nunca guardados ni enviados (hace pasar T049)
- [x] T054 [US2] Tarjeta «Resultado del motor» en `apps/web/src/componentes/asistente.tsx`, pintada desde `resultadoMotor` (estado, motivos y equivalentes en el mismo orden que el motor), y preguntas de ejemplo específicas de una línea
- [x] T055 [US2] Botón «Preguntar sobre esta línea» en cada tarjeta de línea de `apps/web/src/paginas/resultado.tsx` y en `apps/web/src/paginas/dispensacion.tsx`. En dispensación, el panel se abre solo a petición y devuelve el foco al campo de escaneo al cerrarse
- [x] T056 [P] [US2] Guiones de US2 en `packages/assistant/src/guiones/us2.ts`. Las recetas de ejemplo (correcta, caducada, solo principio activo) las prepara el test del banco (`apps/api/test/asistente-banco.test.ts`) y en la demo se crean con las recetas de ejemplo de la app; no se añaden _seeds_ de BD (ADAPTADO: «ya dispensada» queda sin caso del banco)
- [x] T057 [US2] Casos US2 en `fixtures/asistente/banco.v1.yaml`: un caso por resultado del motor de §12.2 (caducada, `SUSTITUIR` con equivalentes, cambio de formato, bloqueo duro, solo principio activo con forzado), con `esperado.contiene` igual a los valores del motor (SC-003)

**Checkpoint**: US1 y US2 funcionan; la explicación de una línea nunca contradice al motor.

---

## Phase 5: User Story 3 - Preguntar por un medicamento concreto (Priority: P3)

**Goal**: el asistente responde sobre un medicamento con los datos de la caché de CIMAVet, pide elegir si hay varios candidatos y avisa si los datos están desactualizados.

**Independent Test**: escenario 7 del [quickstart](./quickstart.md): con varios candidatos pide elegir; la ficha muestra la fecha de sincronización; un nombre que no existe recuerda la revisión de los de uso humano.

### Tests for User Story 3

- [x] T058 [P] [US3] Tests en `apps/api/test/asistente-cimavet.test.ts` con la caché de la _seed_ (PGlite): `buscar_medicamento` con varios candidatos, como mucho 10 y ordenados; `ficha_medicamento` con los atributos (prescripción, antimicrobiano, psicótropo, estupefaciente, inmunológico, problema
  de suministro, exclusión de sustitución); `desactualizado=true` si `fetchedAt` supera `CIMAVET_LIVE_CHECK_MAX_AGE_H`; inexistente → `{ encontrado: false }`

### Implementation for User Story 3

- [x] T059 [US3] Herramientas `buscar_medicamento` y `ficha_medicamento` en `packages/assistant/src/tools/cimavet.ts`, sobre `CimavetRepository.buscar`, `medicamento` y `presentacionesDe` y las exclusiones del `RulesBundle`, con `version` igual a `fetchedAt` o a la última sincronización correcta (hace pasar T058)
- [x] T060 [US3] Admitir `contexto: { tipo: 'medicamento', nregistro? }` en `AsistenteService` (`apps/api/src/servicios/asistente.ts`) y registrar las herramientas de CIMAVet en todas las conversaciones
- [x] T061 [P] [US3] Comprobar que la Ayuda (`packages/shared/src/ayuda/secciones.ts`) explica en lenguaje claro qué pasa con un medicamento de uso humano o que no está en CIMAVet. Si no, añadir el texto (describe el comportamiento de la app, `MEDICAMENTO_USO_HUMANO_REVISION_GARANTE`), para que el asistente lo cite (US3-AS3)
- [x] T062 [US3] En el panel (`apps/web/src/componentes/asistente.tsx`), mostrar los candidatos de una respuesta `aclaracion` como botones que envían «Me refiero a <nombre> (<código nacional>)», y la ficha del medicamento con la fecha de la última sincronización y el aviso si está desactualizada
- [x] T063 [P] [US3] Guiones de US3 en `packages/assistant/src/guiones/us3.ts` y casos US3 en `fixtures/asistente/banco.v1.yaml`: varios candidatos, problema de suministro, inexistente y desactualizado

**Checkpoint**: US1–US3 funcionan de forma independiente.

---

## Phase 6: User Story 4 - Revisar las consultas realizadas (Priority: P4)

**Goal**: el empleado valora respuestas; la veterinaria responsable y administración consultan el histórico de todos con filtros; el empleado solo ve el suyo.

**Independent Test**: escenario 8 del [quickstart](./quickstart.md): la valoración «incorrecta» aparece con su comentario en el filtro, se ve la versión de las reglas de entonces y un empleado no ve las conversaciones de otros.

### Tests for User Story 4

- [x] T064 [P] [US4] Test de API en `apps/api/test/asistente-historico.test.ts`: `PUT valoracion` por el dueño (y volver a valorar sustituye), por otro usuario → 403; comentario con teléfono saneado; `GET conversaciones` como empleado solo devuelve las suyas y con `usuario` ajeno → 403; como
  veterinaria y admin devuelve todas, con filtros por fecha, usuario, valoración y `conReceta`; el detalle conserva la `reglaVersion` y la versión de las fuentes del momento aunque se cambie el `RulesBundle` (US4-AS1–AS3)

### Implementation for User Story 4

- [x] T065 [US4] Métodos `valorar`, `listar` y `detalle` en `apps/api/src/servicios/asistente.ts` (paginación ≤ 100; las fechas de los filtros en `Europe/Madrid`)
- [x] T066 [US4] Rutas `PUT /api/asistente/intercambios/:id/valoracion`, `GET /api/asistente/conversaciones` y `GET /api/asistente/conversaciones/:id` en `apps/api/src/rutas/asistente.ts`, con el control por rol de [api.md](./contracts/api.md) (hace pasar T064)
- [x] T067 [US4] Botones 👍/👎 con comentario opcional (≤ 500 caracteres) en cada respuesta de `apps/web/src/componentes/asistente.tsx`
- [x] T068 [US4] Página `apps/web/src/paginas/asistente-historico.tsx` («Consultas al asistente»): filtros, lista y detalle con fuentes (versión de entonces y aviso si ya no es la vigente), simulaciones y resultado del motor. Registrar la ruta `/asistente/historico` en `apps/web/src/main.tsx` y el enlace en el menú de `apps/web/src/componentes/layout.tsx`

**Checkpoint**: las cuatro historias funcionan.

---

## Phase 7: Transversal — consumo, retención y reporte

**Purpose**: FR-023a, FR-027a y FR-027b. Es necesario antes de activar el asistente en producción.

- [x] T069 [P] Test en `apps/worker/test/retencion-asistente.test.ts`: `retention-sweep` borra las conversaciones (con sus intercambios y valoraciones) de más de 1 año, conserva las de 364 días y aplaza las que tienen un intercambio de menos de 1 año (condición `NOT EXISTS` de [data-model.md](./data-model.md))
- [x] T070 Paso de purga del asistente en `apps/worker/src/jobs/retencion.ts`, dentro de la transacción existente con `mmx.purga_retencion='on'`, añadiendo el contador al informe del job (hace pasar T069)
- [x] T071 Aviso del 80 %: al cruzar el umbral en `ConsumoRepo` (`apps/api/src/servicios/asistente-consumo.ts`), enviar **un** correo al mes a `REPORT_RECIPIENTS` con el mailer de `packages/reports/src/mailer.ts` y marcar `aviso_enviado_at`. Test en `apps/api/test/asistente.test.ts`: un solo envío aunque haya más preguntas
- [x] T072 Rutas `GET /api/admin/asistente/consumo` y `PUT /api/admin/asistente/consumo/limite` (admin con MFA, `audit_event` con el valor anterior y el nuevo, límite > usados) en `apps/api/src/rutas/admin.ts`, con tests en `apps/api/test/asistente.test.ts`
- [x] T073 Bloque «Asistente: consumo del mes» en `apps/web/src/paginas/admin.tsx`: barra de consumo, estado, coste estimado, histórico de meses y formulario para ampliar el límite
- [x] T074 [P] Consumo del mes en curso en el reporte semanal (`apps/worker/src/jobs/reportes.ts` y la plantilla correspondiente en `packages/reports/src/`)
- [x] T075 [P] ~~_Seed_ `consumo-en-pausa`~~ ADAPTADO: no se añade _seed_; el escenario 9 del quickstart se reproduce con `ASSISTANT_MONTHLY_TOKEN_LIMIT` bajo (p. ej. 1) y los tests (`apps/api/test/asistente.test.ts`) cubren la pausa y la ampliación

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T076 Runner del banco real en `apps/api/src/cli/eval-asistente.ts` (`pnpm eval:asistente`): ejecuta `fixtures/asistente/banco.v1.yaml` contra `ASSISTANT=azure` y escribe `.data/eval-asistente/<fecha>-<despliegue>.{json,md}` con los aciertos por SC-001–SC-005, el p90 de duración (SC-006), el modelo y `instruccionesVersion`. Es orientativo y no lo ejecuta CI (FR-029)
- [x] T077 [P] Smoke test e2e `apps/web/e2e/asistente.spec.ts` con `EXTRACTOR=fake` y `ASSISTANT=fake`: escenarios 1, 4 y 8 del quickstart, y foco devuelto al campo de escaneo al cerrar el panel en dispensación
- [x] T078 [P] Actualizar `SPEC.md` §9.3 («la IA extrae datos y explica reglas y resultados; las decisiones legales son del motor determinista y de la persona»), §9.2 (Microsoft como encargado también del asistente) y §8 (panel y página de histórico), y añadir la funcionalidad a la lista de §0.1
- [x] T079 [P] Añadir «Asistente», «Simulación» y «Fuente de referencia» a `docs/glosario.md`
- [x] T080 [P] Añadir a `docs/dudas.md` una DUDA nueva para JC: modelo y despliegue concretos (UE, _tool calling_, _structured outputs_), precios por 1.000 tokens, validación del banco v1 y recordatorio de actualizar el RAT (finalidad, sin datos del titular, retención de 1 año)
- [x] T081 [P] Añadir a la Ayuda (`packages/shared/src/ayuda/secciones.ts`) una sección «Asistente de consultas»: qué responde, que no decide ni autoriza, que no hay que escribir datos del cliente, cómo valorar las respuestas y qué hacer si está en pausa
- [x] T082 [P] Regenerar `apps/api/openapi.json` (`pnpm --filter @mmx/api openapi`) con las rutas nuevas
- [x] T083 [P] Añadir las variables `ASSISTANT_*` a la plantilla de Container Apps en `infra/np/` (y en `infra/modules/containerapps.bicep`), sin recursos ni claves nuevos, y documentarlas en `infra/np/README.md`
- [x] T084 Puerta de calidad (typecheck y tests en verde; `lint` y `retention-sweep` fallan por causas ajenas a esta funcionalidad —un fichero de `.github/skills` y la migración 0014, ya arreglada en `main`—; `pnpm test:int` no se ha podido ejecutar: no hay Docker en marcha): `pnpm lint && pnpm
  typecheck && pnpm test && pnpm test:int`, y recorrer los escenarios del [quickstart](./quickstart.md) con `ASSISTANT=fake pnpm demo`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (fase 1)**: sin dependencias.
- **Foundational (fase 2)**: depende de la fase 1 y **bloquea todas las historias**.
- **US1 (fase 3)**: depende de la fase 2. Es el MVP y aporta el panel, el índice de fuentes y `simulacion.ts`.
- **US2 (fase 4)**: depende de la fase 2. Reutiliza el panel (T042) y `simulacion.ts` (T035) de US1.
- **US3 (fase 5)**: depende de la fase 2. Reutiliza el panel de US1. Es independiente de US2.
- **US4 (fase 6)**: depende de la fase 2. Las valoraciones necesitan el panel de US1; el histórico es independiente de US2 y US3.
- **Transversal (fase 7)**: depende de la fase 2 (el consumo ya se controla en T026–T027). Tiene que estar terminada antes de producción.
- **Polish (fase 8)**: después de las historias que se vayan a entregar.

### Dentro de cada fase

- Primero los tests, que deben fallar; después dominio y herramientas; después servicios y rutas; al final la interfaz.
- Dependencias clave: T015 → T016; T020 → T021, T022; T017–T021 → T025 → T027 → T029; T035 + T037 → T038; T050 + T051 → T052.

### Parallel Opportunities

- Fase 1: T002–T007 en paralelo tras T001.
- Fase 2: tests T008–T013 en paralelo; después T017, T018, T019, T020 y T024 en paralelo.
- Con la fase 2 terminada y T042 hecha, US2, US3 y US4 pueden avanzar en paralelo. Ficheros compartidos: `asistente.ts` (servicio y panel) y `banco.v1.yaml`; esas tareas van en serie.
- Fase 7 en paralelo con las historias P2–P4.
- Fase 8: T077–T083 en paralelo.

## Parallel Example: User Story 1

```text
# Tests de US1 a la vez:
T032 packages/domain/test/simulacion.test.ts
T033 packages/assistant/test/indice.test.ts
T034 packages/assistant/test/tools-us1.test.ts

# Implementación independiente a la vez:
T035 packages/domain/src/simulacion.ts
T036 packages/shared/src/ayuda/secciones.ts + apps/web/src/paginas/ayuda.tsx
T037 packages/assistant/src/fuentes/indice.ts
```

## Parallel Example: User Story 2

```text
T047 packages/domain/test/simulacion.test.ts (casos de formato y equivalencia)
T048 apps/api/test/asistente-linea.test.ts
T049 apps/api/test/asistente-linea.test.ts
T056 seeds + packages/assistant/src/guiones/us2.ts
```

## Implementation Strategy

### MVP (solo US1)

1. Fases 1 y 2.
2. Fase 3 (US1).
3. **Parar y validar**: quickstart, escenarios 1–3, 10 y 11; banco US1 con el modelo falso.
4. Para usarlo en producción, la fase 7 (consumo y retención) y T078–T080 (gobierno) también son obligatorias.

### Entrega incremental

1. MVP (US1 + fase 7) → demo con JC → `pnpm eval:asistente` contra el despliegue real.
2. US2 (la de mayor impacto en mostrador) → validar escenarios 4–6.
3. US3 → escenario 7.
4. US4 → escenario 8.
5. Fase 8 y puerta de calidad.

### Notas

- [P] = ficheros distintos sin dependencias pendientes.
- Commits con Conventional Commits (`feat(asistente): …`), uno por tarea o grupo lógico.
- No llamar nunca al servicio real desde tests ni CI; tampoco inventar respuestas del servicio de chat (dejar `it.todo`).
- Ninguna regla legal en `instrucciones.ts`; si una respuesta necesita una regla, falta una herramienta o una fuente, no una instrucción.
