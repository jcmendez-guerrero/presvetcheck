# Feature Specification: Asistente de sustitución de medicamentos con consulta de CIMAVet y stock en tiempo real

**Feature Branch**: `005-assistant-stock-substitutions`

**Created**: 2026-11-06

**Status**: Draft

**Input**: User description: "the assitant is not providing a good advice on substitutions, also is considering the user as the owner of the dog but not the one that is serving the medicines. The assistant should have an MCP or similar that is capable to connect to CIMAVET API or similar and get the information or drive inside the information that is the app and generate the information according to what is correct and checking actually what is on stock and what is not"

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

### Edge Cases

- **Medicamento prescrito no encontrado en CIMAVet**: Si el nombre no coincide exactamente con ningún registro, el asistente ofrece los nombres más cercanos en el catálogo y solicita confirmación al empleado, sin asumir un medicamento erróneo.
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

### Key Entities *(include if feature involves data)*

- **CandidatoSustitucion**: Representa un medicamento alternativo autorizado en CIMAVet evaluado para una prescripción. Atributos: `nregistro`, `nombreComercial`, `titular`, `principioActivo`, `formaFarmaceutica`, `concentracion`, `especies`, `presentaciones` (lista de CN y nombres de presentación).
- **DisponibilidadStockCandidato**: Información de stock asociada a un candidato o presentación. Atributos: `cn`, `nombrePresentacion`, `stockDisponible`, `almacen`, `tieneStock` (booleano).
- **RecomendacionSustitucion**: Resultado estructurado proporcionado al usuario y al componente de UI. Atributos: `prescrito` (datos del medicamento original y su stock), `esSustituibleLegalmente` (booleano), `motivoExclusion` (opcional), `candidatosConStock` (lista), `candidatosSinStock` (lista), `obligacionesDispensador` (lista de requisitos normativos).

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
