# Feature Specification: Alta manual de recetas sin imagen

**Feature Branch**: `011-manual-prescription-entry`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "To add an admin capability that is capable to manually introduce prescriptions without the prescription. This is useful in this weeks for introducing the prescriptions that are out of the program or because of any reason were not able to be introduced. Manually does not mean that all is free text, the fields that can be filled from cimavet are needed to be filled using cimavet"

## Contexto

Durante estas semanas de puesta en marcha hay recetas que se dispensaron **fuera de la aplicación** (antes de usarla, con
la app caída, sin cámara, etc.) o que por cualquier motivo no se pudieron capturar. Hoy la única vía para dar de alta una
receta es fotografiarla o subir su imagen y pasar por la extracción. Sin una vía alternativa, esas recetas quedan fuera
del registro de salidas y de la conciliación con el TPV.

Esta funcionalidad permite dar de alta una receta **sin imagen**, rellenando los datos a mano, con una condición: todo
dato que exista en CIMAVet (medicamento, presentación, principio activo, forma farmacéutica, concentración, especie) se
**elige** de CIMAVet; no se escribe como texto libre.

Se apoya en lo que ya existe: el motor de reglas (`SPEC.md` §4), la resolución del medicamento contra CIMAVet (§4.2),
el modo retrospectivo de dispensación con fecha original (`specs/004-multi-rx-ticket-training-mode`) y la conciliación
con el TPV (`specs/003-conciliation-prescription-siweb`).

## Clarifications

### Session 2026-11-09

- Q: ¿Qué registra un alta manual? → A: La receta **y** la dispensación ya realizada, con su fecha original (siempre
  ambas; no se da de alta una receta para dispensarla después).
- Q: ¿Quién puede usarla? → A: Solo `veterinaria_responsable`; `admin` no (se respeta `SPEC.md` §9.1).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dar de alta una receta sin imagen con datos de CIMAVet (Priority: P1)

La veterinaria responsable abre «Alta manual de receta», indica por qué se da de alta sin imagen y dónde está guardada la
receta en papel (o su identificador en la plataforma de receta electrónica), y rellena los bloques habituales: receta,
veterinario, titular y animal, y líneas. En cada línea busca el medicamento en CIMAVet (por nombre, principio activo o
código nacional), lo selecciona y elige la presentación; la forma farmacéutica, la concentración y los principios
activos se rellenan solos a partir de esa selección y no se pueden editar a mano. La especie también se elige de la
lista de especies de CIMAVet. Al guardar, el motor de reglas evalúa la receta igual que una receta escaneada.

**Why this priority**: Es el núcleo de la petición: sin esto no hay forma de registrar recetas que no se pudieron
capturar, y el registro de salidas queda incompleto.

**Independent Test**: Con CIMAVet simulado, dar de alta una receta sin imagen con una línea de un medicamento real del
fixture; comprobar que la receta queda guardada con origen «manual», que los campos del medicamento coinciden con
CIMAVet y que el resultado del motor se muestra por línea.

**Acceptance Scenarios**:

1. **Given** la veterinaria responsable en «Alta manual de receta», **When** escribe «bonqat» en el buscador de la línea,
   **Then** ve candidatos de CIMAVet con nombre, presentación y código nacional, y al elegir uno la forma farmacéutica,
   la concentración y el principio activo se rellenan desde CIMAVet y aparecen como no editables.
2. **Given** una línea sin medicamento seleccionado de CIMAVet, **When** intenta guardar, **Then** el sistema no lo
   permite e indica «Elige el medicamento de la lista de CIMAVet».
3. **Given** el formulario completo, **When** guarda, **Then** el sistema evalúa la receta con el motor de reglas y
   muestra el resultado por línea (conforme, aviso, no se puede dispensar) con los mismos motivos que en una receta
   escaneada.
4. **Given** que no se indica motivo del alta manual ni la ubicación de la receta en papel (o el identificador de receta
   electrónica), **When** intenta guardar, **Then** el sistema no lo permite.
5. **Given** una persona con rol `empleado` o `admin`, **When** intenta acceder por la interfaz o directamente al
   servicio, **Then** no ve la opción y el servicio rechaza la petición.

---

### User Story 2 - Registrar la dispensación ya hecha con su fecha original (Priority: P1)

En la misma alta, la veterinaria responsable registra lo que realmente se entregó: para cada línea, fecha original de la
dispensación, presentación entregada (de CIMAVet), unidades, lote y caducidad. El sistema evalúa la validez de la receta
**en la fecha original** (no en la de hoy), con la versión de reglas activa (que queda registrada), guarda la dispensación
como retrospectiva y la deja pendiente de conciliar con el ticket del TPV, como cualquier otra salida. No se escribe
stock en Siweb360.

**Why this priority**: Sin la dispensación, la receta no aparece en el registro de salidas, que es el objetivo final.
El alta manual registra siempre la receta **y** la dispensación ya realizada con su fecha original; no se usa para
dejar recetas pendientes de dispensar por el flujo normal (ver Clarifications).

**Independent Test**: Dar de alta una receta manual con fecha de emisión 2026-10-20 y registrar una dispensación con
fecha original 2026-10-25; comprobar que aparece en el registro de salidas con esa fecha, marcada como retrospectiva y
de alta manual, y pendiente de conciliar.

**Acceptance Scenarios**:

1. **Given** una receta manual emitida el 2026-10-20 sin antimicrobianos, **When** se registra una dispensación con
   fecha original 2026-10-25, **Then** la validez se calcula a 2026-10-25, la línea es conforme y la salida queda en el
   registro con esa fecha.
2. **Given** una receta manual con un antimicrobiano emitida el 2026-10-20, **When** se registra la dispensación con
   fecha original 2026-10-28, **Then** el motor indica como aviso que la receta estaba caducada en esa fecha (plazo de
   5 días); la dispensación se guarda sin forzar y queda marcada para revisar en el reporte semanal.
3. **Given** una fecha original posterior a hoy o anterior a la fecha de emisión, **When** intenta guardar, **Then** el
   sistema lo rechaza con un mensaje claro.
4. **Given** una dispensación manual guardada, **When** se consulta el registro de salidas, **Then** la fila muestra la
   fecha original, el lote, la caducidad, la marca «alta manual» y el estado de conciliación con el TPV.
5. **Given** una dispensación manual guardada, **When** se revisa la actividad con Siweb360, **Then** no se ha enviado
   ningún movimiento de stock de salida.

---

### User Story 3 - Revisión y corrección de lo dado de alta a mano (Priority: P2)

Quien tenga acceso a los registros puede filtrar el registro de salidas y la lista de recetas por
«alta manual», ver quién la dio de alta, cuándo, con qué motivo y dónde está el papel. Si hay un error en una
dispensación ya guardada, se corrige con una anulación (contramovimiento) y una nueva alta, nunca editando la fila.

**Why this priority**: Garantiza la trazabilidad y la revisión posterior; no bloquea el alta en sí.

**Independent Test**: Dar de alta dos recetas manuales y una escaneada; filtrar por «alta manual» y comprobar que solo
salen las dos manuales con su autor, motivo y ubicación del papel. Anular una y comprobar que queda la fila original y su
contramovimiento.

**Acceptance Scenarios**:

1. **Given** recetas manuales y escaneadas, **When** se filtra por «alta manual», **Then** solo aparecen las manuales,
   con autor, fecha de alta, motivo y ubicación del papel.
2. **Given** una dispensación manual con un lote equivocado, **When** se anula con motivo, **Then** la dispensación
   original sigue guardada, aparece su anulación y se puede registrar la correcta.
3. **Given** el reporte semanal, **When** se genera, **Then** incluye un apartado con las recetas dadas de alta a mano
   en la semana.

---

### Edge Cases

- **CIMAVet no responde**: se busca en la copia local de CIMAVet y se muestra un aviso con la fecha de la última
  sincronización. Si el medicamento no está tampoco en la copia local, no se puede dar de alta esa línea (no hay
  alternativa de texto libre) y se indica que se reintente más tarde o se sincronice CIMAVet.
- **Medicamento que hoy está suspendido o revocado pero no lo estaba en la fecha original**: se muestra el estado actual
  como aviso, con la fecha de sincronización; no se impide el alta si la persona confirma que se dispensó antes del
  cambio.
- **Medicamento que no existe en CIMAVet** (p. ej. de uso humano, fórmula magistral): no se puede dar de alta a mano por
  esta vía; se aplica la regla existente (`MEDICAMENTO_USO_HUMANO_REVISION_GARANTE`, revisión del garante).
- **Receta duplicada**: si ya existe en la app (o en los registros importados) una receta con el mismo número y número de
  colegiado, el alta se rechaza como `RECETA_YA_DISPENSADA` (bloqueo que no se puede forzar).
- **Bloqueos que no se pueden forzar** (`BLOQUEANTE_DURO`, p. ej. estupefacientes): la entrega ya ocurrió, así que se
  registra con el defecto como aviso y queda marcada para revisar (excepción de la constitución III, 1.1.0). Solo la
  receta duplicada sigue bloqueando.
- **Stock**: no se consulta el stock actual ni las ventas del día en Siweb360; la entrega ya descontó el stock en el TPV.
- **Psicótropos**: se pide el DNI/NIE de quien retiró y el tope de un envase por receta; si falta o se supera, se
  registra con aviso para revisar.
- **Receta electrónica**: en lugar de ubicación del papel se exige plataforma e identificador; si la plataforma no está
  reconocida, aviso como en el flujo normal.
- **Lote que no consta en ninguna recepción**: se permite (las recepciones anteriores a la app pueden no estar), con
  aviso «Lote no encontrado en las recepciones registradas».
- **Fecha original muy antigua**: si supera el máximo configurado para el modo retrospectivo, se avisa pero se permite.
- **Varias líneas y varias fechas**: cada dispensación de cada línea lleva su propia fecha original; la validez se
  calcula con la primera dispensación de la receta, como en las entregas diferidas.
- **Sesión que expira a mitad**: el borrador se guarda en el servidor y no se pierde lo escrito.
- **Función desactivada**: si la configuración la desactiva, la opción no aparece y el servicio rechaza las peticiones
  con un código estable.

## Requirements *(mandatory)*

### Functional Requirements

**Acceso y control**

- **FR-001**: El sistema MUST ofrecer una pantalla «Alta manual de receta» accesible solo al rol
  `veterinaria_responsable`. Ni `empleado` ni `admin` pueden usarla (se mantiene `SPEC.md` §9.1: `admin` solo para
  configuración técnica).
- **FR-002**: El servicio MUST comprobar el rol en cada petición, no solo ocultar la opción en la interfaz.
- **FR-003**: La función MUST poder activarse o desactivarse por configuración, con el valor por defecto documentado; con
  ella desactivada, la interfaz oculta la opción y el servicio rechaza las peticiones con un código de error estable.
- **FR-004**: Cada alta MUST exigir un motivo (mínimo 15 caracteres) y, según el tipo de receta, la ubicación física
  del papel o la plataforma y el identificador de la receta electrónica.

**Datos de CIMAVet (no texto libre)**

- **FR-005**: El medicamento de cada línea MUST elegirse de CIMAVet (búsqueda por nombre, principio activo o código
  nacional); no se admite texto libre para el medicamento.
- **FR-006**: La presentación (código nacional y formato) MUST elegirse entre las presentaciones de CIMAVet del
  medicamento elegido.
- **FR-007**: Principios activos, forma farmacéutica y concentración MUST rellenarse desde CIMAVet a partir de la
  selección y no ser editables a mano.
- **FR-008**: La especie MUST elegirse de la lista de especies de CIMAVet.
- **FR-009**: El sistema MUST preseleccionar pero nunca autoseleccionar el candidato de CIMAVet; la persona confirma
  cada selección (igual que `SPEC.md` §4.2).
- **FR-010**: El sistema MUST aplicar la verificación en vivo contra CIMAVet y, si no responde, usar la copia local con
  aviso y fecha de la última sincronización.
- **FR-011**: Los datos que no existen en CIMAVet (número de receta, fechas, veterinario, titular, identificación del
  animal, indicación, posología, tiempo de espera, lote, caducidad, unidades) se introducen a mano con la misma
  validación de formato que en la revisión de una receta escaneada. El veterinario se elige de los ya registrados o se
  da de alta con sus datos profesionales.

**Evaluación y dispensación**

- **FR-012**: Al guardar, el sistema MUST evaluar la receta con el mismo motor de reglas y la misma tabla de campos y
  severidades que una receta escaneada; el resultado incluye decisión, motivos, evidencias y versión de reglas.
- **FR-013**: Para cada dispensación ya realizada, el sistema MUST pedir la fecha original y evaluar la validez de la
  receta en esa fecha; la evaluación usa la versión de reglas activa al registrar y la deja guardada.
- **FR-014**: El sistema MUST rechazar fechas originales futuras o anteriores a la fecha de emisión.
- **FR-015**: Todo defecto (de forma o no forzable) MUST registrarse como aviso, sin forzado, y la entrega MUST quedar
  marcada para revisar (hoja «8 Altas manuales» del reporte semanal, columna de avisos). Solo `RECETA_YA_DISPENSADA`
  MUST impedir el registro. El stock actual y las ventas del día en Siweb360 MUST NOT consultarse ni limitar el registro.
  (Cambio del 2026-11-10 a petición de la responsable; constitución III, 1.1.0.)
- **FR-016**: La dispensación MUST guardarse como retrospectiva (con fecha original), marcada como de alta manual, y
  quedar pendiente de conciliar con el ticket del TPV como cualquier otra salida.
- **FR-017**: El sistema MUST NOT escribir movimientos de stock de salida en Siweb360 por esta vía.
- **FR-018**: El sistema MUST rechazar recetas duplicadas (mismo número y número de colegiado) frente a las recetas de
  la app y las salidas importadas.

**Trazabilidad**

- **FR-019**: Cada receta y dispensación de alta manual MUST guardar quién la dio de alta, cuándo, el motivo, la
  ubicación del papel o identificador electrónico y el origen «manual» de cada dato (CIMAVet o introducido a mano).
- **FR-020**: Cada alta y cada anulación MUST generar un evento de auditoría con antes y después.
- **FR-021**: Las dispensaciones guardadas MUST NOT editarse ni borrarse; las correcciones se hacen con anulación
  (contramovimiento) y nueva alta.
- **FR-022**: El registro de salidas, la lista de recetas y el reporte semanal MUST permitir filtrar o ver por separado
  las altas manuales.
- **FR-023**: Los datos personales del titular MUST tratarse igual que en el resto de recetas (cifrado, fuera de logs,
  errores y telemetría) y seguir la misma retención.
- **FR-024**: Debe ser posible adjuntar más tarde una imagen de la receta en papel a una receta dada de alta a mano, sin
  cambiar su origen «manual».

### Key Entities

- **Receta (alta manual)**: receta existente con origen «manual», sin imagen obligatoria; añade motivo del alta,
  ubicación del papel o identificador electrónico, autor y fecha del alta.
- **Línea de receta**: medicamento (número de registro), presentación (código nacional), principios activos, forma y
  concentración tomados de CIMAVet; cantidad, posología y resto introducidos a mano; marca de origen por campo.
- **Dispensación retrospectiva**: salida existente (solo inserción) con fecha original, lote, caducidad, unidades,
  marca de alta manual, resultado del motor y, si aplica, datos del forzado; pendiente de conciliar con el TPV.
- **Evento de auditoría**: alta, forzado y anulación de recetas y dispensaciones manuales.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La veterinaria responsable da de alta una receta de una línea con su dispensación en menos de 4 minutos.
- **SC-002**: El 100 % de las líneas de alta manual tienen medicamento, presentación, principio activo, forma y
  concentración procedentes de CIMAVet (cero campos de medicamento escritos a mano).
- **SC-003**: El 100 % de las dispensaciones de alta manual aparecen en el registro de salidas con su fecha original y
  la marca de alta manual, y entran en la conciliación con el TPV.
- **SC-004**: Ninguna alta manual genera movimientos de stock de salida en Siweb360.
- **SC-005**: El 100 % de las altas manuales tienen autor, fecha, motivo y ubicación del papel o identificador
  electrónico consultables por la veterinaria responsable.
- **SC-006**: Ninguna receta duplicada se puede registrar por esta vía; toda entrega registrada con defectos aparece en
  el reporte semanal con sus avisos.

## Assumptions

- La receta en papel (o su registro en la plataforma electrónica) existe y se custodia fuera de la app; el alta manual
  sustituye la captura de la imagen, no la custodia del papel.
- Se reutiliza el modo retrospectivo de `specs/004` (fecha original, sin escritura de stock, aviso si no hay salida en
  Siweb360 ese día, aviso si la fecha supera el máximo configurado), pero el alta manual tiene su propio interruptor de
  configuración, independiente del de formación.
- El interruptor de configuración se crea desactivado por defecto y se activa por entorno durante las semanas en que se
  necesite; se documenta en `.env.example`.
- El veterinario prescriptor se elige de los veterinarios ya registrados (incluidos los sincronizados desde Siweb360) o
  se da de alta con datos profesionales; no viene de CIMAVet.
- No hace falta carga masiva (hoja de cálculo): para registros históricos en bloque ya existe la importación de
  registros; esta función es para altas individuales.
- Todos los textos de la interfaz están en español, claros para personal no técnico («Código nacional», no «CN»).
- Los mensajes de error usan códigos estables traducidos por la interfaz (p. ej. `ALTA_MANUAL_DESHABILITADA`,
  `MEDICAMENTO_NO_SELECCIONADO`, `FECHA_ORIGINAL_INVALIDA`).
