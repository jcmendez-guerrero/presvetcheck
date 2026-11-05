# Feature Specification: Conciliación TPV, Espacio de Revisión de Recetas en Pantalla Completa e Integración Siweb360 API 1.2.0

**Feature Branch**: `003-conciliation-prescription-siweb`

**Created**: 2026-11-05

**Status**: Ready for Planning

**Input**: User description: "/speckit-specify It is required to check the conciliation due that there is a pending concilation with the TPV and the system is not cpable to find it { \"registros\": [], \"sinConciliar\": { \"configurado\": true, \"salidas\": [ { \"id\": \"01a1abc1-ad23-7013-9ff7-26e8a346de64\", \"cn\": \"590948\", \"nombre\": \"BONQAT 50 mg/ml SOLUCION ORAL PARA GATOS, Caja con 1 Frasco de 2 ml y una jeringa - EU/2/21/273/001\", \"lote\": \"3038691\", \"unidades\": 1, \"fecha\": \"2026-11-05T12:49:19.134Z\", \"recetaId\": \"01a1abbe-192a-7529-94a7-cabda84b9811\", \"fraccion\": false } ] }, \"sustituciones\": [], \"discrepancias\": [] } This one have a ticket in the system created XXX-2026-000458. In the other hand the precription section please use the full screen as in the reception of things with the detected data of the OCR next to the image so it is not needed to scroll full to use th OCR detected data. In the other hand, please find the updated version of the API which contian the stock update and cost"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Diagnosticar y Resolver Conciliación con Ticket del TPV (Priority: P1)

Como personal del establecimiento veterinario (empleado o farmacéutico garante), cuando una dispensación permanece como "pendiente de conciliar" porque el sistema no localizó automáticamente su ticket (por ejemplo, salida de BONQAT CN 590948 frente a ticket registrado como `XXX-2026-000458`), necesito que el sistema intente resolver el medicamento automáticamente por catálogo/variante o, si no lo encuentra, me permita buscar el ticket por su número directo e indicar la línea correspondiente para conciliar la salida reglamentaria con la venta del TPV sin generar falsas discrepancias.

**Why this priority**: Es la necesidad operativa crítica inmediata: evitar discrepancias erróneas y bloqueos en el cierre diario de ventas de medicamentos regulados cuando existe un ticket real emitido en el TPV.

**Independent Test**: Puede probarse de forma independiente registrando una salida de medicamento y conciliándola contra un ticket que carece del texto "CN" explícito o especificando manualmente el número de ticket `XXX-2026-000458`, verificando que la salida pasa de pendiente a conciliada y se vincula el identificador del ticket.

**Acceptance Scenarios**:

1. **Given** una salida de dispensación pendiente (ej. BONQAT CN 590948, 1 unidad) y un ticket emitido en el TPV con número `XXX-2026-000458`, **When** el usuario introduce el número de ticket en la interfaz de pendientes o ejecuta la búsqueda asistida, **Then** el sistema recupera el ticket desde Siweb360, muestra sus líneas y permite al empleado confirmar la correspondencia, marcando la salida como conciliada.
2. **Given** un ticket emitido cuya línea contiene el nombre del fármaco o referencia a la variante en catálogo pero no contiene la etiqueta de texto literal "CN", **When** se evalúa la conciliación automática, **Then** el sistema intenta identificar la variante mediante el catálogo mapeado (`siweb_variant_map`), y si no resulta concluyente, deja la salida disponible para que el empleado indique el ticket manualmente.
3. **Given** una salida que no encuentra coincidencia automática al pulsar "Conciliar ahora", **When** el usuario revisa la lista de salidas pendientes, **Then** el sistema ofrece un campo/botón de acción directa para "Indicar ticket por número" y muestra el detalle de las líneas del ticket descargado para verificar unidades y medicamento antes de confirmar.

---

### User Story 2 - Espacio de Trabajo de Receta en Pantalla Completa con OCR al lado de la Imagen (Priority: P2)

Como usuario que revisa o dispensa una receta veterinaria, necesito que la pantalla de revisión de receta utilice todo el ancho disponible del navegador (ancho completo, tal como ocurre en la vista de recepciones de albaranes) y que el texto reconocido por OCR se ubique al lado de la imagen de la receta en la columna documental izquierda, para poder cotejar los datos leídos con el documento original sin necesidad de desplazarse verticalmente hasta el final de la pantalla.

**Why this priority**: Resuelve la ergonomía y velocidad operativa del proceso central de la farmacia: cotejar la imagen de la prescripción con los datos extraídos por el OCR para validar y dispensar en segundos sin fricción visual ni scroll repetitivo.

**Independent Test**: Puede probarse accediendo a la pantalla de revisión de cualquier receta (`/recetas/:id/revision`): la interfaz debe aprovechar el ancho completo de la ventana del navegador y presentar en la columna izquierda el visor de imagen y el texto reconocido por OCR lado a lado o contiguos, a la vez que el formulario de datos permanece en la columna derecha.

**Acceptance Scenarios**:

1. **Given** una receta con imagen escaneada y texto extraído por OCR, **When** el usuario accede a la pantalla de revisión, **Then** la página se renderiza a ancho completo (`anchoCompleto: true`) ocupando el espacio horizontal disponible en monitores de escritorio.
2. **Given** la columna documental izquierda de la receta, **When** el usuario visualiza el documento prescrito, **Then** el texto reconocido por OCR se presenta inmediatamente al lado de la imagen de la receta (panel dividido contiguo), permitiendo leer ambos sin hacer scroll vertical hacia abajo.
3. **Given** pantallas de menor resolución o dispositivos móviles/tablets, **When** el ancho de ventana se reduce, **Then** la distribución se adapta responsivemente apilando ordenadamente los paneles sin desbordamientos horizontales indeseados.

---

### User Story 3 - Integración con Siweb360 API 1.2.0 para Movimientos de Stock y Actualización de Precios/Costes (Priority: P3)

Como responsable de gestión de stock y recepción de medicamentos, necesito que el sistema incorpore la especificación OpenAPI v1.2.0 de Siweb360, permitiendo registrar la actualización de costes y precios de las variantes recibidas (`PUT /api/public/inventory/variants/{id}/pricing`) y consultar el historial de movimientos de inventario (`GET /api/public/inventory/movements`), manteniendo la trazabilidad y exactitud de precios y stock.

**Why this priority**: Alinea el cliente de integración y los esquemas de datos con la API real actualizada del proveedor de ERP/TPV (Siweb360 v1.2.0), habilitando la sincronización de coste de adquisición en albaranes finalizados y la auditoría de movimientos de stock.

**Independent Test**: Puede probarse enviando una solicitud de actualización de precio y coste de una variante a través del cliente Siweb con los valores en céntimos especificados en la API v1.2.0, verificando la serialización y la respuesta exitosa con código 200.

**Acceptance Scenarios**:

1. **Given** un albarán de recepción con líneas donde se ha calculado el precio de coste y se ha marcado la casilla `actualizarPrecio = true`, **When** la recepción se finaliza y se procesa el outbox, **Then** el sistema actualiza el coste (`cost_cents`) y el precio de venta (`price_cents`) en Siweb360 usando el endpoint `PUT /api/public/inventory/variants/{id}/pricing`.
2. **Given** la especificación de referencia del proyecto, **When** se actualiza `docs/ref/siweb360-openapi.json` con la versión 1.2.0 aportada en YAML, **Then** los esquemas y llamadas del paquete `@mmx/siweb` validan correctamente los nuevos endpoints de movimientos y fijación de precios.

---

### Edge Cases

- **Ticket en estado distinto de `Pagado`**: El ticket `XXX-2026-000458` fue creado en el TPV pero se encuentra en estado `Pendiente` o en proceso de cierre de caja. El sistema debe permitir consultar tickets por número independientemente del estado y avisar si no está aún marcado como cobrado antes de asociarlo.
- **Líneas de ticket sin CN en el texto**: La descripción del producto en el ticket de TPV no incluye el patrón `CN...` (por ejemplo, "BONQAT 50 mg/ml..."). El sistema intenta correlacionar la línea mediante el catálogo de variantes mapeadas y, si no hay coincidencia unívoca, el usuario selecciona e indica la línea correspondiente.
- **Discrepancia en número de unidades**: El ticket tiene una cantidad vendida diferente de las unidades dispensadas en la receta. Al asociar manualmente, el sistema registra una discrepancia de tipo `UNIDADES_DISTINTAS` con nota explicativa en lugar de rechazar la acción.
- **Actualización de precios con céntimos fraccionarios**: La API v1.2.0 admite hasta 2 decimales de céntimo (4 decimales de euro). El sistema transforma los importes de `decimal.js` al formato esperado en `price_cents` y `cost_cents` sin pérdida de precisión.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir conciliar salidas de dispensación mediante búsqueda directa por número de ticket (p. ej. `XXX-2026-000458`), además de la búsqueda automática por rango de fechas.
- **FR-002**: El sistema DEBE ofrecer en la interfaz de "Salidas pendientes de conciliar" una acción para que el empleado introduzca el número de ticket (ej. `XXX-2026-000458`), visualice sus líneas y asocie la salida correspondiente.
- **FR-003**: El sistema DEBE ampliar la estrategia de conciliación automática intentando primero resolver el CN mediante coincidencia con variantes mapeadas en catálogo (`siweb_variant_map`), y si no resulta concluyente o no encuentra coincidencia, mantener la salida como pendiente para que el empleado indique el ticket manualmente.
- **FR-004**: La pantalla de revisión de recetas (`/recetas/:id/revision`) DEBE configurarse para ocupar el ancho completo del navegador (`anchoCompleto: true`), al igual que la vista de detalle de recepciones.
- **FR-005**: El componente de visualización de recetas (`VisorReceta` y pantalla de revisión) DEBE presentar la visualización documental en su columna izquierda con la imagen de la receta y el texto OCR contiguo (lado a lado en panel dividido) frente a la columna derecha con el formulario de revisión, evitando el scroll vertical para cotejar la lectura.
- **FR-006**: El catálogo de integración y cliente de Siweb360 DEBE actualizarse a la especificación OpenAPI v1.2.0 incorporando los endpoints de fijación de precios (`PUT /api/public/inventory/variants/{id}/pricing`) y movimientos (`GET /api/public/inventory/movements`).
- **FR-007**: El sistema DEBE actualizar en Siweb360 el precio de coste (`cost_cents`) y el precio de venta (`price_cents`) mediante `PUT /api/public/inventory/variants/{id}/pricing` a través del outbox al finalizar una recepción si la opción `actualizarPrecio` está marcada en la línea.
- **FR-008**: Toda asociación manual de ticket y dispensación realizada por el empleado DEBE registrarse en el registro de auditoría (`audit_event`) con el usuario que la realiza, fecha y hora e identificadores de ambos registros.

### Key Entities

- **Dispensación**: Registro de salida de medicamento dispensado bajo receta veterinaria (identificador, CN, lote, unidades, fecha, receta vinculada).
- **Ticket TPV**: Comprobante de venta emitido por el terminal punto de venta en Siweb360 (número de ticket, fecha, estado, importe, líneas con nombre de producto y cantidad).
- **Conciliación**: Vínculo formal entre una dispensación reglamentaria y un movimiento/línea de ticket de TPV, indicando si el lote fue verificado o si fue una asociación directa/asistida por el empleado.
- **Espacio de Revisión de Receta**: Interfaz de verificación a ancho completo donde se presentan en columna izquierda la imagen escaneada original y los datos reconocidos por OCR contiguos, y en columna derecha los campos de confirmación.
- **Variante de Inventario (Siweb360)**: Producto en Siweb360 asociado a un CN que posee información de stock, precio de venta (`price_cents`) y coste de adquisición (`cost_cents`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las salidas pendientes que cuenten con un ticket emitido identificable (como `XXX-2026-000458`) pueden ser conciliadas con éxito, ya sea automáticamente por catálogo o mediante la indicación manual del ticket por el empleado en menos de 30 segundos por salida.
- **SC-002**: El usuario puede consultar el texto extraído por el OCR y la imagen de la receta al mismo tiempo sin necesidad de realizar scroll vertical en resoluciones de pantalla estándar (1080p o superiores).
- **SC-003**: Reducción del tiempo promedio de revisión y validación de una receta por parte del operador en al menos un 25% gracias a la disposición contigua de imagen y OCR en pantalla ancha.
- **SC-004**: Las operaciones de actualización de precio y coste en Siweb360 completan con éxito y reflejan los valores exactos en céntimos sin descuadre por redondeo.

## Assumptions

- El número de ticket `XXX-2026-000458` corresponde a un ticket efectivamente existente en Siweb360 en la empresa conectada, accesible mediante la API de tickets.
- Los usuarios utilizan principalmente navegadores de escritorio en pantallas con resolución mínima de 1280x720 para la revisión de recetas y la conciliación diaria.
- La app sigue manteniendo la regla constitucional de que las salidas de stock las descuenta exclusivamente el ticket de venta del TPV (no se generan salidas `sale_shipment` directas desde PresVetCheck).
- Los precios y costes enviados a Siweb360 respetan la política de moneda y redondeo institucional (`decimal.js` convertido a enteros de céntimos o con hasta dos decimales de céntimo).

---

## Decisions & Clarifications Ratified

- **D-SPEC-01 (Conciliación TPV)**: Se adopta el comportamiento combinado: el sistema intenta primero resolver el CN automáticamente contrastando la descripción con el catálogo de variantes (`siweb_variant_map`); si no lo encuentra o no coincide, la salida queda pendiente para que el empleado introduzca el número de ticket (ej. `XXX-2026-000458`) y confirme la asociación.
- **D-SPEC-02 (Distribución de Receta en Pantalla Completa)**: Columna izquierda dividida [Imagen de la receta + Texto OCR contiguo lado a lado] y Columna derecha [Formulario de revisión], todo dentro de `anchoCompleto: true`, manteniendo la consistencia con la vista de recepciones y evitando scroll vertical.
- **D-SPEC-03 (Actualización de Costes y Precios)**: Al finalizar una recepción de albarán, si la línea tiene marcado `actualizarPrecio = true` y tiene variante vinculada, se encola en el outbox la actualización de `cost_cents` y `price_cents` en Siweb360 mediante `PUT /api/public/inventory/variants/{id}/pricing`.
