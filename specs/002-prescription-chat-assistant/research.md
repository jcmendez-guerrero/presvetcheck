# Investigación (Fase 0): Asistente de consultas

No quedaban `NEEDS CLARIFICATION` en el contexto técnico. Este documento recoge las decisiones de diseño, por qué
se toman y qué alternativas se descartaron.

## R1 · Servicio de IA: Azure OpenAI directo o a través de Azure AI Foundry

- **Decisión**: un único cliente HTTP compatible con la API de _chat completions_ de Azure OpenAI
  (`POST {endpoint}/openai/deployments/{deployment}/chat/completions?api-version=…`), con _tool calling_ y
  _structured outputs_ (`response_format: json_schema`). Un despliegue de Azure OpenAI dentro de un recurso de
  Azure AI Foundry expone el mismo endpoint, así que ambas opciones son la misma integración y solo cambia la URL
  configurada (`ASSISTANT_ENDPOINT`). La credencial es la de la app, como en Document Intelligence; no se añade
  ninguna clave ni ningún recurso de infraestructura.
- **Requisito del despliegue**: tipo _Data Zone Standard_ UE o regional en una región de la UE (FR-021), con un
  modelo que admita _tool calling_ y _structured outputs_ (familia GPT-4o / GPT-4.1 o posterior). El nombre del
  despliegue va en la configuración (`ASSISTANT_DEPLOYMENT`) y se guarda en cada intercambio.
- **Por qué**: el proyecto ya tiene el patrón de cliente HTTP propio contra Cognitive Services
  (`DocumentIntelligenceClient`), sin SDK. Hacer lo mismo evita dependencias pesadas (constitución I) y permite
  probar con MSW.
- **Alternativas descartadas**:
  - SDK `openai` o `@azure/ai-projects`: añaden dependencias y no aportan nada que haga falta aquí.
  - _Agents_ de Foundry (estado y herramientas en el servicio): las herramientas tienen que ejecutarse dentro de
    la API para usar el motor y la caché, la conversación se guarda en nuestra base de datos para trazabilidad y
    retención, y los hilos guardados en el servicio complicarían cumplir FR-023a.

## R2 · Cómo se apoyan las respuestas en las fuentes: herramientas frente a RAG vectorial

- **Decisión**: el modelo dispone de **herramientas** (contrato en [contracts/herramientas.md](./contracts/herramientas.md)):
  - `consultar_reglas(tema)`: devuelve el fragmento del YAML activo y su versión;
  - `buscar_guia(consulta)` y `buscar_ayuda(consulta)`: devuelven secciones de la guía y de la Ayuda;
  - `buscar_medicamento` y `ficha_medicamento`: consultan la caché de CIMAVet;
  - `contexto_linea`: devuelve el resultado del motor y los campos permitidos de la línea;
  - `simular_*`: ejecutan el motor sobre un caso hipotético.

  La guía (2.470 líneas) se divide por encabezados y se indexa en memoria con búsqueda léxica sobre texto
  normalizado (`packages/shared/src/text.ts`) y una lista corta de sinónimos del dominio (antibiótico ↔
  antimicrobiano, caducidad ↔ validez…).

- **Por qué**:
  - FR-006: cambiar el YAML cambia la respuesta sin tocar el asistente, porque las reglas se leen en el momento.
  - FR-007: cada resultado de herramienta lleva un `fuenteId` con versión que se puede citar y abrir.
  - FR-009: los cálculos solo los hace el motor.
  - El volumen de fuentes es pequeño y estable, así que no compensa un índice vectorial (Azure AI Search o
    pgvector), que añadiría infraestructura, coste y otro paso de sincronización.
- **Alternativas descartadas**:
  - Meter todas las fuentes en el prompt: es caro en cada turno, roza el límite de contexto e incumple el
    espíritu de FR-006.
  - Azure AI Search: es un recurso nuevo con coste fijo y no lo necesita el volumen actual.
  - pgvector: añade embeddings y otra llamada al modelo, con poca ganancia sobre la búsqueda léxica con sinónimos.

## R3 · Validación de la respuesta (fidelidad y citas)

- **Decisión**: el modelo responde siempre con salida estructurada
  `{ tipo, texto, fuentes[], simulaciones[], aclaracion? }`, donde `tipo ∈ respondida | sin_informacion |
fuera_de_ambito | aclaracion | rechazo_reglas`. La API valida:
  1. Que cada `fuenteId` citado fue devuelto por una herramienta **en ese mismo turno**.
  2. Que una respuesta `respondida` cita al menos una fuente.
  3. Que cada `simulacionId` existe en el turno.

  Si algo falla, se reintenta una vez avisando al modelo del error. Si vuelve a fallar, se sustituye la
  respuesta por la de «sin información» (FR-008). Las simulaciones, los equivalentes y los motivos de la línea
  **se pintan en la interfaz desde los datos de la herramienta** (tarjetas «Simulación» y «Resultado del motor»),
  no desde el texto del modelo. Así se garantiza FR-015 y SC-003 aunque el texto parafrasee. Contrato en
  [contracts/salida-modelo.md](./contracts/salida-modelo.md).

- **Alternativas descartadas**:
  - Confiar solo en las instrucciones: no se puede verificar.
  - Un segundo modelo que juzgue la respuesta: duplica coste y tiempo y tampoco es determinista.

## R4 · Instrucciones del modelo sin reglas legales

- **Decisión**: `packages/assistant/src/instrucciones.ts` (constante TypeScript, para que viaje en el empaquetado; versión guardada en cada intercambio) contiene solo
  comportamiento:
  - el rol;
  - responder en español claro;
  - usar las herramientas para cualquier regla o dato;
  - no calcular;
  - citar;
  - declinar lo clínico y lo que está fuera de ámbito;
  - no autorizar ni forzar;
  - pedir aclaración si faltan datos;
  - ignorar las peticiones de saltarse las reglas.

  Un test (`instrucciones.test.ts`) falla si las instrucciones contienen plazos, cantidades o porcentajes
  (patrones `\d+\s*(días|meses|mg|%|envase)`) o nombres de códigos de regla.

- **Por qué**: lo exige la constitución III («legal rules are never embedded in AI prompts») y FR-006.

## R5 · Datos personales (FR-018 a FR-021a)

- **Decisión**: hay tres capas.
  1. **Lista blanca de lo que sale hacia el modelo**: `contexto_linea` construye un DTO zod `.strict()` solo con
      los campos permitidos por la aclaración Q1. Los datos del titular y del veterinario no se cargan en la
      consulta.
  2. **`PiiScrubber` sobre lo que escribe el empleado**, antes de enviar y de guardar:
      - DNI/NIE con letra de control (reutiliza `packages/domain/src/dni.ts`);
      - teléfonos españoles (`[6789]\d{8}` con o sin prefijo y separadores);
      - correos;
      - direcciones (vía + número, con heurística);
      - y, si hay receta en contexto, coincidencia sin acentos ni mayúsculas con el nombre y el teléfono del
        titular y del veterinario, que se descifran **solo en memoria** para comparar.

      Lo detectado se sustituye por `[dato eliminado]`, se marca `piiEliminada=true` y la interfaz avisa.

  3. **Logger**: se añaden `*.pregunta`, `*.respuesta` y `*.texto` a `REDACCION` y nunca se registra el cuerpo de
      las llamadas al modelo.
- **Limitación conocida**: un nombre propio sin receta en contexto no se puede detectar de forma fiable. La
  interfaz muestra de forma permanente «No escribas datos del cliente». SC-005 se mide con el banco y con la
  muestra mensual; si aparecen casos, se amplían los patrones.
- **Alternativas descartadas**: un servicio de detección de datos personales (Azure AI Language PII): es un
  recurso nuevo y enviaría el texto a otro servicio más, justo lo que se quiere evitar.

## R6 · Simulaciones con el motor (FR-009a)

- **Decisión**: un módulo puro nuevo `packages/domain/src/simulacion.ts` que compone las funciones existentes,
  con entradas hipotéticas validadas por zod:
  - `simularValidez` → `calcularValidez` / `casoLinea`;
  - `simularCambioFormato` → `evaluarAlternativaFormato` y `validarEnvasesFormato`;
  - `simularSustituibilidad` → `sustitucionPermitida` y las exclusiones;
  - `simularEquivalencia(prescrito, candidato, especie, indicación)` → `evaluarEquivalencia`.

  Cada una devuelve `ResultadoMotor` (`{ decision, motivos[], evidencias, reglaVersion }`) más `supuestos` (los
  datos usados). Si faltan datos obligatorios, devuelve `decision: 'FALTAN_DATOS'` con la lista de campos, y el
  modelo los pide (no supone). Los medicamentos de las simulaciones de formato y equivalencia se resuelven por
  `nregistro` y `cn` en la caché; el modelo nunca inventa composiciones.

- **Por qué**: reutiliza el motor real (sin lógica duplicada), es determinista, se prueba con `it.each` y no
  escribe nada.

## R7 · Persistencia, inmutabilidad y retención a 1 año

- **Decisión**:
  - Tablas `asistente_conversacion`, `asistente_intercambio`, `asistente_valoracion` y `asistente_consumo_mes`
    (ver [data-model.md](./data-model.md)).
  - `asistente_intercambio` es de solo inserción, con un _trigger_ que rechaza `UPDATE` y `DELETE` salvo con la
    marca de sesión `mmx.purga_retencion='on'` y filas de más de 1 año (mismo patrón que la migración 0004).
  - El job `retention-sweep` (mensual) añade un paso que borra las conversaciones de más de 1 año en cascada
    (intercambios y valoraciones). La valoración es una fila nueva por intercambio: una por empleado, que se puede
    sustituir mientras la conversación sea suya.
- **Por qué**: cumple FR-022 a FR-023a y reutiliza el mecanismo de purga que ya está auditado.

## R8 · Consumo mensual y límite (FR-027a, FR-027b)

- **Decisión**:
  - Se mide en **tokens** (`usage.total_tokens` de cada llamada, sumando todas las rondas de herramientas del
    turno). Hay una estimación en euros, solo informativa, con precios configurables
    (`ASSISTANT_PRICE_IN_PER_1K_EUR` y `ASSISTANT_PRICE_OUT_PER_1K_EUR`, en `decimal.js`).
  - El límite por defecto es `ASSISTANT_MONTHLY_TOKEN_LIMIT=3000000`. Administración puede ampliarlo para el mes
    en curso; queda en `asistente_consumo_mes.limite_ampliado` y genera `audit_event`.
  - El incremento es un _upsert_ atómico por `mes` (`YYYY-MM` en `Europe/Madrid`).
  - Antes de cada turno se comprueba el estado; si está `en_pausa`, se devuelve `ASISTENTE_LIMITE_MENSUAL` y no se
    llama al modelo.
  - Al cruzar el 80 % se envía **un único** correo a `REPORT_RECIPIENTS` con el mailer existente
    (`aviso_enviado_at`) y aparece un aviso en Administración.
  - El reporte semanal añade el consumo del mes.
- **Por qué**: los tokens son deterministas y los da la propia respuesta; los euros dependen de la tarifa.
- **Alternativa descartada**: consultar el coste real en Azure Cost Management: tiene retraso de horas y no sirve
  para cortar a tiempo.

## R9 · Disponibilidad y errores (FR-026)

- **Decisión**:
  - _Timeout_ de 20 s por turno (`ASSISTANT_TIMEOUT_MS`) y un reintento solo si hay 429 o 5xx con
    `retry-after` ≤ 3 s.
  - Cualquier fallo → `DomainError('ASISTENTE_NO_DISPONIBLE')` → mensaje «El asistente no está disponible ahora;
    consulta la Ayuda». La pregunta se guarda con `estado='error'` para trazabilidad, sin respuesta.
  - Un filtro de contenido del proveedor se trata como `fuera_de_ambito`.
  - El asistente se crea con _lazy init_: un fallo de configuración no impide que arranque la API, igual que
    `DisabledRecipeExtractor`.
- **Configuración**: `ASSISTANT=off|fake|azure` (por defecto `off`). Con `off` no se muestra el botón (FR-027).
  En producción, `ASSISTANT=azure` exige `ASSISTANT_ENDPOINT` y `ASSISTANT_DEPLOYMENT` (validado con zod).
  `ASSISTANT=fake` está prohibido en producción.

## R10 · Interfaz

- **Decisión**:
  - Botón flotante «Preguntar» en `layout.tsx` (objetivo táctil ≥ 44 px, accesible por teclado) que abre un panel
    lateral a pantalla completa en móvil.
  - Preguntas de ejemplo al abrir (FR-004).
  - Desde `resultado.tsx` y `dispensacion.tsx`, el botón «Preguntar sobre esta línea» abre el panel con
    `recetaLineaId`.
  - Cada respuesta muestra el texto, unas fichas de fuente que se pueden pulsar (abren un visor del fragmento con
    su versión), las tarjetas de «Simulación» o «Resultado del motor» y los botones 👍/👎 con comentario.
  - El panel **no roba el foco del campo de escaneo** en dispensación: se abre solo a petición y lo devuelve al
    cerrarse.
  - No hay _streaming_ en v1: un indicador «Buscando en las reglas…» basta para SC-006 y simplifica la validación
    de R3.
  - Página «Consultas al asistente» (histórico): `veterinaria_responsable` y `admin` ven todas; `empleado` solo las
    suyas.

## R11 · Banco de evaluación (FR-028, FR-029)

- **Decisión**:
  - `fixtures/asistente/banco.v1.yaml`: casos con `pregunta`, `contexto?`, `esperado.tipo`,
    `esperado.contiene[]` (frases o valores que deben aparecer), `esperado.fuentes[]` y `esperado.simulacion?`.
    Cubre los casos de §12.2, los de fuera de ámbito, los de saltarse las reglas y los que llevan datos personales.
  - En CI, `pnpm test` ejecuta el banco con `FakeAssistantModel` para comprobar el andamiaje (herramientas,
    validación, saneado). **Ningún test llama al servicio real.**
  - `pnpm eval:asistente` se ejecuta a mano contra el servicio real y escribe un informe en JSON y Markdown en
    `.data/eval-asistente/<fecha>-<modelo>.{json,md}` (ignorado por git), con los aciertos por SC-001 a SC-005, el
    modelo y la versión de las instrucciones.
  - Es orientativo: no condiciona la activación (aclaración Q5).
- **Alternativa descartada**: guardar el resultado en la base de datos: no aporta nada si no es una condición de
  salida, y el informe en fichero es más fácil de compartir con JC.

## R12 · Documentación y gobierno

- ADR-17 «Asistente de consultas con herramientas deterministas»: recoge R1–R4 y la reintroducción del servicio
  generativo (frente a DUDA-27).
- `SPEC.md` §9.3: «La IA extrae datos y explica reglas y resultados; las decisiones legales son del motor
  determinista y de la persona».
- `SPEC.md` §9.2: Microsoft como encargado, también para el asistente.
- `docs/glosario.md`: «Asistente», «Simulación», «Fuente de referencia».
- Nueva DUDA para JC: precio y modelo concreto del despliegue que se usará, y validación del banco v1 de preguntas.
- Tarea externa (no es código): actualizar el RAT con la finalidad del asistente, sin datos del
  titular y con retención de 1 año.
