# Feature Specification: Asistente de sustitución de medicamentos con consulta de CIMAVet y stock en tiempo real

**Feature Branch**: `005-assistant-stock-substitutions`

**Created**: 2026-11-06

**Status**: Draft

**Input**: User description: "the assitant is not providing a good advice on substitutions, also is considering the user as the owner of the dog but not the one that is serving the medicines. The assistant should have an MCP or similar that is capable to connect to CIMAVET API or similar and get the information or drive inside the information that is the app and generate the information according to what is correct and checking actually what is on stock and what is not"

## Clarifications

### Session 2026-11-07
- Q: ¿Cómo debe normalizar y resolver el sistema la equivalencia de especie, vía de administración e indicación en CIMAVet para evitar falsos negativos en la búsqueda y simulación de sustitutos? → A: Mapeo canónico estricto para especie (filtrar exclusivamente `id > 0`, descartando IDs negativos/sintéticos devueltos por la API de CIMAVet) y armonización de códigos oficiales de vía de administración. Si la consulta de mostrador no aporta una indicación clínica explícita, el asistente debe solicitar aclaración de la patología/indicación antes de emitir la simulación de equivalencia definitiva, en lugar de asumir la indicación común autorizada.
- Q: ¿Cómo y dónde debe generarse y representarse la tabla comparativa de criterios de sustitución (A frente a B)? → A: Estructurada en el motor de simulación de equivalencia con criterios legibles para humanos (principio activo, concentración, forma farmacéutica, vía de administración, especie, indicación y tiempos de espera) e indicadores de coincidencia booleana, y renderizada de forma nativa en la tarjeta de simulación del asistente mediante una tabla comparativa visual con distintivos de cumplimiento (✓ / ✗).
- Q: ¿Cómo debe estructurarse la experiencia de usuario para la selección y sobreescritura de sustitutos en la pantalla de dispensación y la nueva sección del comparador de vademécum? → A: Opción A: Doble integración: 1) En la pantalla de resultado/dispensación se añade un buscador/selector de sustitutos alternativos con evaluación en vivo del motor y posibilidad de sobreescritura/forzado por el garante si no es un bloqueo legal duro. 2) Se crea una nueva página dedicada en el menú principal (`/vademecum` o `/comparador-sustitucion`) para consultar y comparar libremente medicamentos de CIMAVet con la tabla de criterios normativos.
- Q: ¿Cómo debe gestionarse la confirmación y sobreescritura (override) cuando el sustituto seleccionado manualmente presenta advertencias de equivalencia o discrepancias no bloqueantes? → A: Se requiere introducir obligatoriamente una razón o justificación textual por parte del usuario dispensador, pero no es necesaria la confirmación previa del farmacéutico garante en pantalla (se registra la justificación y auditoría, dejando la receta en la bandeja de sustituciones para su firma en modo posterior).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta de sustitución por falta de stock con candidatos reales y stock disponible (Priority: P1)

Un empleado de la farmacia veterinaria está atendiendo en el mostrador una receta de un medicamento que no tiene en stock (por ejemplo, «Prednicortone 5 mg 30 comprimidos para perro»). Abre el asistente y pregunta qué alternativa puede dispensar. El asistente:
1. Trata al usuario como profesional del establecimiento dispensador (no como al dueño del perro).
2. Comprueba en CIMAVet los datos del medicamento prescrito (principio activo «prednisolona», concentración «5 mg», forma «comprimido», especie «perro») y busca los medicamentos veterinarios autorizados y comercializados equivalentes.
3. Comprueba el stock en Siweb360 en el almacén de la farmacia tanto para el medicamento prescrito como para los candidatos equivalentes.
4. Responde indicando si la sustitución es legalmente posible por falta de stock (RD 1157/2021), enumera los medicamentos equivalentes autorizados desglosando claramente cuáles **tienen stock disponible** en la farmacia y cuáles están agotados, e indica los pasos obligatorios que el empleado debe realizar (consentimiento del tutor, comunicación al veterinario y apartar la receta para la firma del farmacéutico garante).

**Why this priority**: Es el caso de uso central del mostrador cuando un fármaco prescrito está agotado. Proporciona valor directo e inmediato al evitar dispensaciones erróneas, ahorrar tiempo buscando manualmente en múltiples pantallas y garantizar el cumplimiento normativo.

**Independent Test**: Se puede probar preguntando por una prescripción sin stock (por ejemplo, Prednicortone 5 mg para perro). El asistente debe devolver candidatos equivalentes reales identificando cuáles tienen existencias en el almacén y detallando los pasos de sustitución para el empleado, sin sugerir al usuario que «consulte a su veterinario».

**Acceptance Scenarios**:

1. **Given** un empleado consulta «tengo una receta de prednicortone de 5mg 30comprimidos para un perro pero no tengo, ¿por qué otro podría sustituirlo?», **When** el asistente procesa la consulta, **Then** identifica que el usuario es el personal dispensador y no un propietario particular, evitando frases como «debes consultar con tu veterinario para que te indique un medicamento sustituto».
2. **Given** el medicamento prescrito tiene sustitutos autorizados en CIMAVet con la misma composición (prednisolona 5 mg), misma forma farmacéutica y misma especie (perro), **When** el asistente consulta el stock en Siweb360, **Then** presenta la lista de candidatos priorizando aquellos con stock mayor que cero en el almacén «Farmacia», mostrando su Código nacional (CN), nombre comercial y unidades disponibles.
3. **Given** se identifican sustitutos válidos con stock, **When** el asistente formula la respuesta, **Then** informa que la sustitución es reglamentaria por falta de existencias (RD 1157/2021) y enumera los pasos operativos: recabar consentimiento del tutor, notificar al veterinario prescriptor (o justificar urgencia) y apartar la receta física en la bandeja de sustituciones para firma del farmacéutico garante en modo posterior (POST).
4. **Given** una consulta sobre una prescripción concreta en el contexto de una receta ya cargada en la aplicación, **When** el empleado consulta al asistente desde dicha línea, **Then** el asistente toma los datos de la línea sin requerir que el usuario vuelva a teclearlos y verifica el stock de las alternativas.

---

### User Story 2 - Consulta de candidatos equivalentes en CIMAVet y verificación de inventario (Priority: P1)

El asistente dispone de herramientas de consulta (herramientas internas / MCP) capaces de buscar de forma autónoma en la base de datos de CIMAVet los medicamentos que cumplan los criterios de sustitución exacta para un principio activo, concentración, forma farmacéutica y especie destino, y de consultar el inventario actual en Siweb360 para dichos códigos nacionales.

**Why this priority**: Sin herramientas de búsqueda de sustitutos y consulta de stock, el modelo de lenguaje carece de información factual del catálogo y del almacén, viéndose forzado a inventar datos o a pedir parámetros técnicos que el empleado no tiene a mano.

**Independent Test**: Se comprueba invocando la herramienta de búsqueda de candidatos con un medicamento de referencia y verificando que devuelve únicamente registros autorizados en CIMAVet que cumplen los criterios de equivalencia técnica, junto con el stock verificado en Siweb360.

**Acceptance Scenarios**:

1. **Given** un medicamento prescrito (por nombre comercial o número de registro), **When** el asistente ejecuta la búsqueda de equivalentes para una especie, **Then** obtiene de CIMAVet únicamente medicamentos veterinarios autorizados y comercializados con el mismo principio activo, misma concentración y forma compatible.
2. **Given** una lista de medicamentos candidatos devuelta por CIMAVet, **When** el asistente comprueba sus existencias en el inventario, **Then** consulta en Siweb360 el stock disponible por lote y almacén para cada Código nacional obtenido.
3. **Given** que el medicamento prescrito sí tiene existencias en el almacén de la farmacia, **When** el empleado pregunta por sustituirlo, **Then** el asistente advierte que el medicamento prescrito dispone de stock y recuerda que por normativa la sustitución solo procede ante indisponibilidad en el establecimiento dispensador.

---

### User Story 3 - Tratamiento de casos donde no hay sustituto con stock disponible (Priority: P2)

Un empleado consulta por una sustitución pero ninguno de los medicamentos equivalentes autorizados en CIMAVet cuenta con stock en el almacén de la farmacia (o no existen equivalentes directos autorizados para esa especie).

**Why this priority**: El personal necesita saber inmediatamente si no hay opción dispensable al momento para pedir el medicamento a distribución o aplicar el protocolo de no disponibilidad sin demorar la atención al cliente.

**Independent Test**: Consultar por un medicamento cuyos equivalentes tengan stock cero en Siweb360. El asistente debe indicar los equivalentes teóricos existentes en CIMAVet, aclarar que ninguno está en stock físico, y recomendar generar pedido a distribuidor o contactar al veterinario prescriptor para valorar nueva prescripción.

**Acceptance Scenarios**:

1. **Given** existen equivalentes autorizados en CIMAVet pero todos tienen stock cero en el almacén, **When** el asistente responde, **Then** lista los medicamentos autorizados indicando explícitamente «Sin stock en almacén» y sugiere registrar un pedido al distribuidor (`PEDIR`).
2. **Given** no existe ningún medicamento equivalente autorizado en CIMAVet para esa especie y principio activo, **When** el asistente responde, **Then** indica claramente que no existen sustitutos veterinarios equivalentes autorizados y que el cambio de principio activo o tratamiento requiere prescripción del veterinario.

---

### User Story 4 - Bloqueo de sustitución para medicamentos no sustituibles por ley (Priority: P2)

Un empleado consulta por la sustitución de un medicamento que por regulación no puede ser sustituido (medicamentos biológicos, inmunológicos, antimicrobianos en supuestos restringidos, o incluidos en la lista de exclusión por estrecho margen terapéutico según RD 1157/2021 y especificación §4.4.1).

**Why this priority**: Evitar sustituciones ilegales que constituyan una infracción sanitaria grave o pongan en riesgo la salud animal.

**Independent Test**: Consultar por la sustitución de una vacuna o medicamento inmunológico. El asistente debe denegar taxativamente la sustitución explicando la regla legal y orientando a la solicitud de pedido (`PEDIR`).

**Acceptance Scenarios**:

1. **Given** una consulta de sustitución sobre un medicamento catalogado como inmunológico o biológico en CIMAVet, **When** el asistente analiza la petición, **Then** informa que por normativa sanitaria (RD 1157/2021 y guía de dispensación) estos medicamentos no pueden ser sustituidos en ningún caso y deben pedirse al distribuidor si no hay stock.
2. **Given** una consulta sobre una prescripción excepcional (en cascada), **When** se solicita sustitución, **Then** el asistente recuerda que las prescripciones excepcionales no admiten sustitución por el dispensador.

---

### User Story 5 - Tabla comparativa visual de criterios de sustitución entre medicamentos (Priority: P2)

Cuando el personal de farmacia pregunta por la sustitución de un medicamento prescrito frente a un medicamento candidato concreto (o cuando el simulador evalúa la equivalencia entre ambos), la interfaz del asistente muestra una tabla comparativa desglosando los criterios reglamentarios exigidos para la sustitución (principio activo, concentración, forma farmacéutica, vía de administración, especie de destino, indicación y tiempos de espera). Cada criterio muestra el valor prescrito, el valor candidato y su coincidencia visual (✓ / ✗), permitiendo entender de inmediato la causa de aceptación o denegación.

**Why this priority**: Evita la incertidumbre y frustración del usuario cuando una alternativa rechazada parece idéntica a simple vista, proporcionando transparencia regulatoria inmediata sobre el motivo exacto de la no equivalencia técnica.

**Independent Test**: Consultar al asistente comparando dos medicamentos (por ejemplo, Hedylon frente a Prednicortone). La tarjeta de simulación debe presentar una tabla comparativa clara con el desglose de los campos evaluados y sus respectivos estados de coincidencia o discrepancia.

**Acceptance Scenarios**:

1. **Given** una simulación de equivalencia entre un medicamento prescrito y un candidato, **When** el motor de simulación evalúa la regla, **Then** devuelve en la información estructurada de evidencias una comparativa criterio a criterio con nombres legibles para humanos y estado de coincidencia booleano.
2. **Given** una respuesta del asistente con simulación de equivalencia o no equivalencia, **When** el usuario visualiza la tarjeta de simulación en la interfaz, **Then** se muestra una tabla comparativa accesible con columnas «Criterio», «Prescrito», «Candidato» y «Estado».
3. **Given** que uno o más criterios no coinciden (por ejemplo, vía de administración o especie no autorizada), **When** se renderiza la tabla comparativa, **Then** se marcan visualmente con distintivos de discrepancia (✗) frente a los que sí coinciden (✓), facilitando la identificación inmediata de los impedimentos reglamentarios.

---

### User Story 6 - Selección interactiva de sustituto y sobreescritura en pantalla de resultado de dispensación (Priority: P1)

Un empleado atiende una receta donde el medicamento prescrito no tiene existencias o el motor ha determinado `PEDIR` (por ejemplo, Bioclanic 50/12,5 mg comprimidos para felino). En la pantalla de resultado, el sistema ofrece al usuario la posibilidad de buscar y seleccionar un producto alternativo del vademécum (por ejemplo, Clavusan 50/12,5 mg). Al seleccionarlo:
1. El motor de sustitución evalúa en tiempo real la equivalencia y presenta la tabla comparativa de criterios normativos.
2. Si el sustituto es equivalente o presenta condiciones que admiten valoración profesional (y no incurre en un bloqueo legal duro), permite al usuario registrar la razón o justificación de la sustitución para sobreescribir la recomendación inicial y habilitar la dispensación del sustituto sin requerir confirmación previa de garante en pantalla (quedando la receta separada para la firma posterior del garante).

**Why this priority**: Resuelve la rigidez del mostrador cuando existen alternativas válidas en existencias no detectadas automáticamente o cuando el criterio farmacéutico fundamentado permite sustituir con justificación registrada.

**Independent Test**: Cargar una receta con Bioclanic 50/12,5 mg en estado PEDIR. Seleccionar Clavusan 50/12,5 mg desde el buscador de sustitutos en la pantalla de resultado; el sistema debe mostrar la comparativa de criterios y permitir sobreescribir indicando la razón para proceder a la dispensación.

**Acceptance Scenarios**:

1. **Given** una línea de receta con medicamento prescrito sin existencias o con decisión `PEDIR`, **When** el usuario visualiza la pantalla de resultado, **Then** dispone de una opción interactiva para buscar y seleccionar un sustituto alternativo del catálogo de CIMAVet y almacén.
2. **Given** un medicamento sustituto seleccionado por el usuario (ej. Clavusan 50/12,5 mg frente a Bioclanic 50/12,5 mg), **When** se pulsa comprobar, **Then** el motor ejecuta la evaluación y renderiza la tabla comparativa de los 7 criterios reglamentarios (principio activo, concentración, forma, vía, especie, indicación y tiempos de espera).
3. **Given** una propuesta de sustitución que no constituye un bloqueo legal duro (`BLOQUEANTE_DURO`), **When** el usuario confirma la sustitución indicando la razón justificada, **Then** el sistema permite sobreescribir la línea, actualiza la decisión a sustitución autorizada y habilita el paso a la pantalla de dispensación.
4. **Given** un candidato que incumple prohibiciones legales insubsanables (inmunológico, biológico, prescripción excepcional o no autorizado), **When** se evalúa, **Then** el botón de sobreescritura permanece deshabilitado informando que se trata de un bloqueo reglamentario estricto no forzable.

---

### User Story 7 - Sección dedicada de consulta y comparador de sustitución en Vademécum (Priority: P2)

El personal de la farmacia veterinaria accede a una sección dedicada e independiente en el menú principal de la aplicación (`/vademecum` o `/comparador-sustitucion`) para consultar medicamentos del vademécum oficial de CIMAVet y comparar de forma interactiva cualquier medicamento A frente a un candidato B para una especie e indicación determinadas.

**Why this priority**: Facilita la consulta regulatoria y técnica previa sin requerir escanear una receta física, agilizando la atención telefónica o previa en mostrador.

**Independent Test**: Navegar a la sección del comparador en el menú principal, seleccionar dos medicamentos (ej. Bioclanic y Clavusan), especificar especie felina y verificar que se genera la comparativa reglamentaria completa y su conclusión.

**Acceptance Scenarios**:

1. **Given** un usuario autenticado en la aplicación, **When** accede al menú principal, **Then** encuentra un enlace directo a la sección «Comparador de Sustitución / Vademécum».
2. **Given** la página del comparador de vademécum, **When** el usuario busca y selecciona un medicamento de referencia (A), un candidato alternativo (B) y la especie de destino, **Then** el sistema presenta la comparación detallada de los 7 criterios normativos con indicación de coincidencia y la conclusión de sustituibilidad.

---

### Edge Cases

- **Medicamento prescrito no encontrado en CIMAVet**: Si el nombre no coincide exactamente con ningún registro, el asistente ofrece los nombres más cercanos en el catálogo y solicita confirmación al empleado, sin asumir un medicamento erróneo.
- **Discrepancia de identificadores sintéticos o códigos en catálogos de CIMAVet**: Cuando la maestra de CIMAVet devuelva registros duplicados con identificadores negativos para especies o vías (p. ej. «Perros» con `id: -29` frente a `id: 14`), el sistema descarta los registros con `id <= 0` y selecciona el identificador canónico positivo coincidente con las autorizaciones de las fichas técnicas (`especieIds`).
- **Consulta de sustitución sin indicación clínica expresa**: Si la consulta en mostrador no especifica la patología o indicación prescrita, el asistente lista los candidatos equivalentes en composición, forma y especie clasificados por stock en la farmacia y solicita aclaración de la indicación concreta antes de validar la sustitución definitiva.
- **Diferente tamaño de envase o número de comprimidos**: Si el sustituto tiene una presentación con diferente número de unidades (ej. 10 comprimidos en lugar de 30), el asistente calcula e indica el número de envases necesarios según las reglas de cambio de formato permitidas, o señala si requiere fraccionamiento.
- **Fallo temporal de conexión con Siweb360 o CIMAVet**: Si el servicio de inventario o de catálogo no responde, el asistente informa de que los datos de stock o de registro no están disponibles en tiempo real, indica la fecha de la última información en caché y previene al empleado de confirmar la existencia física en balda antes de dispensar.
- **Múltiples presentaciones del mismo principio activo con diferente concentración**: El asistente advierte que la sustitución exige idéntica concentración y dosificación, salvo que la regla de cambio de formato autorice expresamente el ajuste con confirmación del garante.
- **Stock reservado o pendiente de recepción**: Si el inventario refleja unidades comprometidas o pendientes de albarán, el asistente aclara solo las unidades netas disponibles para venta inmediata.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El asistente MUST asumir en todo momento el rol de interlocutor con el **personal del establecimiento dispensador** (técnico, auxiliar o farmacéutico), formulando sus respuestas con instrucciones operativas de dispensación y eliminando cualquier asunción de que el usuario es el tutor o dueño del animal.
- **FR-002**: El asistente MUST prohibir en sus respuestas advertencias dirigidas a propietarios tales como «consulte a su veterinario antes de cambiar el medicamento», sustituyéndolas por el procedimiento legal que debe seguir el personal dispensador (consentimiento del tutor, comunicación preceptiva al veterinario y firma del farmacéutico garante).
- **FR-003**: El sistema MUST proveer al asistente una herramienta de búsqueda de candidatos de sustitución (`buscar_sustitutos` / tool / MCP) que consulte la base de datos de CIMAVet y determine los medicamentos autorizados y comercializados que cumplen los requisitos de equivalencia reglamentaria (mismo principio activo, concentración equivalente, forma farmacéutica compatible y especie autorizada).
- **FR-004**: El sistema MUST proveer al asistente una herramienta de consulta de inventario (`consultar_stock` / tool / MCP) que consulte en Siweb360 las existencias disponibles en el almacén «Farmacia» para uno o varios Códigos nacionales (CN).
- **FR-005**: Al responder a una consulta de sustitución por falta de existencias, el asistente MUST invocar la comprobación de stock tanto del medicamento prescrito como de los candidatos equivalentes devueltos por CIMAVet.
- **FR-006**: El asistente MUST presentar las opciones de sustitución categorizadas de forma visual y textual: primero los candidatos con stock disponible en el establecimiento (indicando unidades y presentación) y posteriormente aquellos sin existencias inmediatas.
- **FR-007**: Si el medicamento prescrito sí dispone de stock físico en el almacén, el asistente MUST advertir que la sustitución reglamentaria requiere indisponibilidad del producto en el establecimiento, antes de sugerir alternativas.
- **FR-008**: Si el medicamento prescrito es no sustituible por ley (inmunológico, biológico, prescripción excepcional o incluido en la lista de exclusión), el asistente MUST informar de la prohibición de sustituir y recomendar la vía de pedido al distribuidor (`PEDIR`).
- **FR-009**: Cada propuesta de sustitución formulada por el asistente MUST incluir el recordatorio de las tres obligaciones normativas del establecimiento: 
  1. Obtención del consentimiento previo del tutor del animal.
  2. Notificación al veterinario prescriptor (o justificación documental de urgencia).
  3. Separación de la receta física en la bandeja de sustituciones para su firma por el farmacéutico garante (procedimiento de sustitución POST).
- **FR-010**: El asistente MUST basar sus decisiones de equivalencia en las reglas deterministas del motor (`@mmx/domain`) y los datos normalizados de CIMAVet, sin realizar inferencias clínicas ni inventar dosificaciones.
- **FR-011**: Cuando la consulta se inicie desde una línea de receta activa en la aplicación, el asistente MUST cargar automáticamente los datos del medicamento prescrito y la especie desde el contexto de la línea, sin requerir reentrada manual.
- **FR-012**: Todas las consultas a herramientas de catálogo y stock MUST ser de solo lectura, sin alterar el inventario ni registrar dispensaciones automáticamente.
- **FR-013**: La resolución de especies y vías de administración en CIMAVet MUST descartar identificadores menores o iguales a cero (`id <= 0`), seleccionando exclusivamente los identificadores canónicos positivos coincidentes con los registros de autorización de las fichas técnicas (`especieIds` y `viaIds`).
- **FR-014**: El motor de equivalencia MUST reconciliar las vías de administración a través de sus códigos maestros oficiales de administración, asegurando equivalencia coherente tanto si el registro proviene del Nomenclátor XML como de la API REST de CIMAVet.
- **FR-015**: Si una consulta de sustitución o simulación de equivalencia no contiene la indicación clínica o patología prescrita, el asistente MUST clasificar preliminarmente los candidatos equivalentes en composición, forma y especie con existencias en farmacia, y solicitar aclaración de la indicación clínica para completar la validación reglamentaria de equivalencia.
- **FR-016**: El motor de simulación de equivalencia MUST incluir en sus evidencias un desglose estructurado fila por fila de los criterios normativos de sustitución evaluados (principio activo, concentración, forma farmacéutica, vía de administración, especie de destino, indicación y tiempos de espera) con los valores legibles para humanos del prescrito y del candidato y su estado booleano de coincidencia, y la interfaz web MUST renderizar dicho desglose como una tabla comparativa visual accesible con distintivos de cumplimiento (✓ / ✗) en la tarjeta de simulación.
- **FR-017**: En la pantalla de resultado de receta (`ResultadoReceta`), cuando un medicamento prescrito carezca de existencias o la decisión sea `PEDIR`, la interfaz MUST permitir al usuario buscar y seleccionar interactivamente un medicamento sustituto del vademécum o almacén; al seleccionarlo, el motor MUST evaluar en tiempo real la equivalencia mostrando la tabla comparativa de criterios, y permitir sobreescribir la dispensación del sustituto siempre que no constituya un `BLOQUEANTE_DURO` registrando obligatoriamente la razón de la sustitución introducida por el dispensador (sin requerir confirmación previa de garante en pantalla), dejando la receta en la bandeja de sustituciones para su firma posterior.
- **FR-018**: La aplicación MUST disponer de una página dedicada en el menú principal (`/vademecum` o `/comparador-sustitucion`) que permita al personal seleccionar dos medicamentos de CIMAVet (prescrito y candidato) y evaluar su equivalencia técnica mediante el motor de sustitución, presentando la tabla comparativa de los 7 criterios normativos con sus distintivos de cumplimiento y conclusión reglamentaria.

### Key Entities *(include if feature involves data)*

- **CandidatoSustitucion**: Representa un medicamento alternativo autorizado en CIMAVet evaluado para una prescripción. Atributos: `nregistro`, `nombreComercial`, `titular`, `principioActivo`, `formaFarmaceutica`, `concentracion`, `especies`, `presentaciones` (lista de CN y nombres de presentación).
- **DisponibilidadStockCandidato**: Información de stock asociada a un candidato o presentación. Atributos: `cn`, `nombrePresentacion`, `stockDisponible`, `almacen`, `tieneStock` (booleano).
- **RecomendacionSustitucion**: Resultado estructurado proporcionado al usuario y al componente de UI. Atributos: `prescrito` (datos del medicamento original y su stock), `esSustituibleLegalmente` (booleano), `motivoExclusion` (opcional), `candidatosConStock` (lista), `candidatosSinStock` (lista), `obligacionesDispensador` (lista de requisitos normativos).
- **CriterioComparativaSustitucion**: Elemento de la comparativa de sustitución entre dos medicamentos. Atributos: `criterio` (denominación del requisito normativo), `prescrito` (valor en medicamento prescrito), `candidato` (valor en medicamento candidato), `coincide` (booleano de conformidad reglamentaria), `detalle` (aclaración textual opcional).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de las respuestas a consultas de sustitución identifican al usuario como personal dispensador, sin ninguna referencia a «consulte con su veterinario para cambiar el fármaco».
- **SC-002**: El asistente proporciona candidatos de sustitución con stock real verificado en menos de 3 segundos desde la recepción de la pregunta.
- **SC-003**: En el 100 % de las consultas de sustitución donde existen equivalentes en el catálogo, el asistente discrimina con precisión entre los productos disponibles en balda y los que requieren pedido a distribución.
- **SC-004**: El 100 % de las propuestas de sustitución generadas por el asistente incluyen los requisitos reglamentarios obligatorios (consentimiento del tutor, comunicación al veterinario y receta apartada para el garante).
- **SC-005**: Reducción a 0 de las simulaciones con datos ficticios o inventados en consultas de sustitución cuando el medicamento existe en la base de datos de CIMAVet.

## Assumptions

- El establecimiento cuenta con acceso al almacén local «Farmacia» en Siweb360 con datos de stock sincronizados periódicamente o en tiempo real.
- La base de datos de CIMAVet cuenta con la sincronización habitual de principios activos, formas farmacéuticas y especies autorizadas cargadas en la aplicación.
- El procedimiento de sustitución del establecimiento opera bajo la modalidad de autorización posterior (`SUBSTITUTION_APPROVAL_MODE=POST`) aprobada por el farmacéutico garante conforme a la especificación general del proyecto.
- La búsqueda de sustitutos se limita a medicamentos veterinarios autorizados en España; no se consideran medicamentos de uso humano para sustitución en mostrador.
