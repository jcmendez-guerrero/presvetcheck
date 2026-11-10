# Feature Specification: Activar la escritura de entradas de stock en Siweb360

**Feature Branch**: `claude/stock-update-api-spec-988373`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "enable the stock update if possible according to the last api specification (siweb360-openapi 1.3.0)"

## Context

La app ya sabe dar de alta el stock de medicamentos en Siweb360 al finalizar una recepción: cada línea genera un ajuste
de entrada con lote y caducidad que se envía a través de una cola de envíos segura. Hoy esa escritura está **apagada**
en todos los entornos (`SIWEB_STOCK_WRITE_MODE=off`) y el personal sigue dando las entradas a mano en Siweb360.

La SPEC (§5.2.4) solo permite encenderla (`entries_only`) cuando:

1. se ha superado la prueba controlada de escritura sobre una variante de prueba (§12.3), y
2. existe forma de detectar entradas hechas a mano en Siweb360 después de la fecha de corte (si no, el stock se duplica).

Además, la SPEC (§5.2.5) dice que "la API no permite consultar movimientos", por lo que un envío con respuesta dudosa
(p. ej. un corte de red) queda siempre para que una persona lo revise a ciegas.

**Qué dice la última especificación de Siweb360 (1.3.0, revisada el 2026-11-09)**:

- La operación de ajuste de stock, la de stock ilimitado y la de transferencia **no cambian** respecto a la 1.2.0 que ya
  usa la app. No hay ningún bloqueo técnico nuevo ni nada que adaptar en el envío.
- El historial de movimientos de inventario (ya presente desde la 1.2.0) devuelve por cada movimiento la variante, el
  lote, la caducidad, las unidades, el motivo y **la nota libre** donde la app guarda su referencia única
  (`MMX-REC-{recepción}-L{línea}`). Con esto se puede: (a) saber si un envío dudoso llegó o no a Siweb360, y
  (b) detectar entradas de medicamentos hechas fuera de la app.
- La ficha de variante añade coste y si precio/coste llevan IVA y su tipo. No afecta a la escritura de stock.

**Conclusión**: sí es posible activarlo. Lo que falta no es el envío (ya existe), sino las dos salvaguardas que la SPEC
exigía y que ahora la API permite construir, más los pasos controlados de puesta en marcha.

## Clarifications

### Session 2026-11-09

- Q: Si un envío dudoso aparece exactamente una vez en el historial de Siweb360, ¿se marca como enviado solo o lo
  confirma una persona? → A: Se marca como enviado automáticamente, sin confirmación humana; la auditoría registra
  "resuelto por el sistema" con el movimiento encontrado.
- Q: ¿Quién puede actuar sobre los avisos de la bandeja (envíos en revisión y entradas manuales detectadas)? → A:
  Reenviar o descartar un envío: solo administración. Cualquier usuario de la app puede cerrar un aviso marcándolo como
  "Revisado" o "Resuelto a mano en Siweb360", con nota obligatoria; queda en la auditoría.
- Q: ¿La app exige una prueba controlada superada antes de enviar stock, o es solo un paso de la lista de puesta en
  marcha? → A: La app lo exige: sin una prueba superada registrada en los últimos 30 días no se envía nada; la
  pantalla de estado lo muestra.
- Q: ¿Cómo se controlan las entradas de medicamentos hechas a mano en Siweb360 tras el corte? → A: Con una conciliación
  completa: todo movimiento de medicamento en Siweb360 (entradas, ventas del TPV y ajustes) debe quedar vinculado a un
  registro de la app o justificado con un motivo (revisión de inventario, de lote, de caducidad, caducado, rotura,
  etc.). Se ejecuta cada noche.
- Q: ¿Una salida justificada (caducado, rotura, robo o pérdida, devolución a proveedor, etc.) entra en el registro
  regulatorio de movimientos? → A: Sí, para todos los medicamentos: toda salida justificada se añade al registro de
  movimientos como "BAJA" con su motivo.

### Session 2026-11-10

- Q: ¿Las entradas justificadas a mano (devolución de cliente, recuento al alza) van al registro regulatorio? (DUDA-30)
  → A: Solo las de psicótropos, como "ALTA" con su motivo. Las devoluciones de cliente del resto de medicamentos van a
  "no conformes", que no exige registro y se tratará en otra feature; aquí quedan solo justificadas en la auditoría.
- Q: ¿La nota es obligatoria en toda justificación o solo con "Otro"? → A: Siempre obligatoria (mínimo 5 caracteres),
  también en los vínculos manuales.
- Q: Si `reference_id` resulta no ser el id del ticket del TPV, ¿qué se hace con las ventas? (D-02b) → A: Van a la
  bandeja "Movimientos sin justificar" hasta tener una muestra real del historial de una venta; con ella se ajusta el
  emparejamiento. No se empareja por aproximación.
- Q: ¿Qué candidatas propone el buscador para vincular a mano? (T052) → A: Solo registros del mismo código nacional y
  del mismo día que el movimiento.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - El stock entra solo al finalizar una recepción (Priority: P1)

El responsable de recepción finaliza una recepción de medicamentos. Sin hacer nada más, cada línea aparece en el
inventario de Siweb360 en el almacén «Farmacia» con su lote, caducidad y unidades, y el personal deja de darlas a mano.

**Why this priority**: es el objetivo de la feature; elimina el doble trabajo y los errores de teclear lote y caducidad.

**Independent Test**: con la escritura activada contra un entorno simulado, finalizar una recepción de dos líneas y
comprobar que se envían dos entradas con lote, caducidad, unidades y referencia correctos, y que la recepción las
muestra como enviadas.

**Acceptance Scenarios**:

1. **Given** la escritura de entradas está activada y la prueba controlada se ha superado, **When** se finaliza una
   recepción con 2 líneas, **Then** cada línea genera una sola entrada en Siweb360 con su lote, caducidad, unidades y
   referencia única, y la recepción muestra "Enviado a Siweb360" en cada línea.
2. **Given** la escritura está apagada, **When** se finaliza una recepción, **Then** no se envía nada y la pantalla
   recuerda que el stock debe darse de alta a mano (comportamiento actual).
3. **Given** la variante tiene stock ilimitado en Siweb360, **When** se envía la entrada, **Then** no se reintenta, la
   línea queda como fallida con un mensaje claro ("Este producto tiene stock ilimitado en Siweb360") y aparece en la
   bandeja de administración.
4. **Given** se intenta enviar una salida (venta/dispensación) por cualquier vía, **When** el sistema la procesa,
   **Then** se rechaza: la app nunca escribe salidas.

---

### User Story 2 - Un envío dudoso se comprueba contra Siweb360 antes de molestar a nadie (Priority: P1)

Si un envío de entrada termina sin respuesta clara (corte de red, tiempo agotado), la app consulta el historial de
movimientos de Siweb360 buscando su referencia única. Si la encuentra, da el envío por hecho. Si no la encuentra, lo
deja en la bandeja de administración con esa evidencia para que una persona decida reenviarlo o descartarlo.

**Why this priority**: sin esto, cada fallo de red obliga a revisar a mano el stock y aumenta el riesgo de duplicar o
perder entradas; es la salvaguarda que hace aceptable encender la escritura.

**Independent Test**: simular un tiempo agotado tras enviar; con un historial simulado que contiene la referencia, el
envío pasa a "enviado"; con un historial sin ella, queda en revisión con el mensaje "No consta en Siweb360".

**Acceptance Scenarios**:

1. **Given** un envío quedó en revisión por respuesta dudosa, **When** se comprueba y el historial de Siweb360 contiene
   un movimiento con su referencia única, **Then** el envío pasa a "enviado", se guarda el identificador del movimiento
   encontrado y se registra en la auditoría que se resolvió automáticamente.
2. **Given** un envío en revisión, **When** la referencia no aparece en el historial, **Then** el envío sigue en
   revisión, **nunca se reenvía solo**, y la bandeja muestra "No consta en Siweb360 a {fecha y hora}" junto al stock
   actual de la variante.
3. **Given** el historial de Siweb360 no responde, **When** se intenta la comprobación, **Then** el envío sigue en
   revisión sin cambios y se reintentará la comprobación (no el envío) más tarde.
4. **Given** aparecen dos o más movimientos con la misma referencia, **When** se comprueba, **Then** el envío queda en
   revisión marcado como "posible duplicado en Siweb360" para que una persona lo corrija.

---

### User Story 3 - Conciliar todos los movimientos de medicamentos de Siweb360 (Priority: P2)

Desde la fecha de corte, cada movimiento de stock de un medicamento en Siweb360 (entradas, ventas del TPV y cualquier
ajuste) debe estar **vinculado** a un registro de la app o **justificado**. Cada noche la app lee el historial de
movimientos y vincula automáticamente lo que puede: entradas con la referencia de una línea de recepción y ventas del
TPV con su dispensación (conciliación existente de la spec 003). Lo que no se puede vincular aparece en la bandeja
"Movimientos sin justificar". Un usuario lo cierra vinculándolo a mano a una recepción o dispensación, o
justificándolo con un motivo de la lista (revisión de inventario, revisión de lote, revisión de caducidad, caducado,
rotura, devolución de cliente, devolución a proveedor, robo o pérdida, otro) y una nota.

**Why this priority**: es la condición de la SPEC para el corte operativo y da trazabilidad completa del stock de
medicamentos: ninguna entrada doble, venta sin receta registrada o baja de stock queda sin explicación. Va después de
US1/US2 porque solo tiene sentido una vez activada la escritura.

**Independent Test**: con un historial simulado que mezcla entradas con y sin referencia de la app, ventas con y sin
dispensación, ajustes de rotura y movimientos de productos no medicamento, ejecutar la conciliación y comprobar que se
vinculan solos los que tienen pareja, que solo los medicamentos sin pareja posteriores al corte llegan a la bandeja, y
que al justificar uno desaparece de la bandeja y queda en la auditoría.

**Acceptance Scenarios**:

1. **Given** una entrada en Siweb360 con la referencia de una línea de recepción, **When** se ejecuta la conciliación,
   **Then** queda vinculada a esa línea sin intervención.
2. **Given** una entrada de un medicamento sin referencia de la app posterior al corte (dada de alta a mano),
   **When** se ejecuta la conciliación, **Then** aparece en "Movimientos sin justificar" con fecha, código nacional,
   nombre, lote, caducidad, unidades y motivo de Siweb360.
3. **Given** una salida de stock por rotura hecha en Siweb360, **When** un usuario la justifica como "Rotura" con una
   nota, **Then** sale de la bandeja, la justificación queda en la auditoría con autor y fecha, y el registro de
   movimientos muestra una "BAJA" por rotura con su lote y unidades.
4. **Given** una venta del TPV de un medicamento sin dispensación, **When** se ejecuta la conciliación, **Then**
   aparece en la bandeja y el usuario puede vincularla a una dispensación existente o justificarla.
5. **Given** movimientos de productos que no son medicamento (accesorios, alimentación) o anteriores a la fecha de
   corte, **When** se ejecuta la conciliación, **Then** no aparecen.
6. **Given** no hay fecha de corte configurada, **When** se ejecuta la conciliación, **Then** no se ejecuta y el
   informe lo indica ("Conciliación de movimientos sin fecha de corte").
7. **Given** se elige cualquier motivo o un vínculo manual, **When** se intenta guardar sin nota, **Then** no se
   permite.

---

### User Story 4 - Puesta en marcha controlada (Priority: P2)

El administrador sigue una lista de pasos corta para encender la escritura en producción: ejecutar la prueba
controlada sobre la variante de prueba, fijar la fecha de corte, cambiar el modo a "solo entradas" y comprobar en la
pantalla de estado que está activa. Si algo va mal, apagarla devuelve al comportamiento actual sin perder nada.

**Why this priority**: el cambio es de configuración, pero debe ser seguro y reversible.

**Independent Test**: arrancar la app con modo "solo entradas" y sin fecha de corte → no arranca en producción con un
mensaje claro; con ambos valores → la pantalla de estado muestra "Escritura de entradas: activa desde {fecha}".

**Acceptance Scenarios**:

1. **Given** producción con modo "solo entradas" y sin fecha de corte, **When** arranca la app, **Then** se niega a
   arrancar e indica qué falta.
2. **Given** la escritura activa, **When** el administrador la apaga, **Then** las entradas pendientes de enviar se
   conservan sin enviarse y se envían cuando se vuelve a encender; no se pierde ninguna.
3. **Given** la escritura activa, **When** se abre la pantalla de estado, **Then** muestra el modo, la fecha de corte,
   el almacén de destino, la última prueba controlada superada y cuántos envíos hay pendientes, fallidos y en revisión.
4. **Given** la escritura activa y la última prueba controlada superada tiene más de 30 días (o no hay ninguna),
   **When** se finaliza una recepción, **Then** sus entradas quedan pendientes sin enviarse y la pantalla de estado
   muestra "Falta la prueba de escritura"; al registrar una prueba superada, se envían.

### Edge Cases

- Recepción finalizada justo antes de encender la escritura: sus líneas no se envían retroactivamente salvo que el
  administrador lo pida expresamente (evita duplicar lo ya dado de alta a mano).
- Línea cuyo producto aún no existe en Siweb360: sigue el flujo actual de "pendiente de alta en Siweb360" y se envía
  cuando se marca como hecha.
- Un código nacional con varias variantes en Siweb360: la entrada va a la variante mapeada en la recepción; si no hay
  una única elegida, la línea no se envía y se pide elegir.
- Lote con caducidad ya vencida o por debajo de la vida útil mínima de entrada: no se envía (la validación existente lo
  impide antes de finalizar).
- El historial de movimientos tarda en reflejar un ajuste recién hecho: la comprobación automática de un envío dudoso
  espera un margen mínimo antes de concluir "no consta".
- La nota de un movimiento editada a mano en Siweb360: la referencia se busca exacta; si no coincide se trata como
  "no consta" y lo decide una persona.
- Corrección de una entrada ya enviada: se hace con un contra-movimiento registrado, nunca editando ni borrando.
- Una justificación equivocada no se edita: se anula con una nueva justificación que la sustituye, y ambas quedan en
  la auditoría.
- Una venta del TPV dividida en varias líneas o lotes para una misma dispensación: se vinculan todas a esa
  dispensación.
- Un movimiento que se lee dos veces en noches distintas: se identifica por su identificador de Siweb360 y no se
  duplica en la bandeja.
- Una venta cuyo `reference_id` no corresponde a ningún ticket conciliado: va a la bandeja; nunca se vincula por
  aproximación (código nacional, fecha o unidades).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: El sistema MUST permitir activar la escritura de entradas de stock en Siweb360 solo mediante la
  configuración existente (`off` / `entries_only`), con `off` por defecto en todos los entornos.
- **FR-002**: Con la escritura activa, el sistema MUST enviar una entrada por línea de recepción finalizada, con lote,
  caducidad, unidades, motivo de compra y la referencia única de la línea, al almacén configurado.
- **FR-003**: El sistema MUST NOT escribir salidas de stock en Siweb360 por ninguna vía.
- **FR-004**: Ante una respuesta dudosa, el sistema MUST dejar el envío en revisión y MUST NOT reenviarlo
  automáticamente.
- **FR-005**: El sistema MUST comprobar automáticamente los envíos en revisión contra el historial de movimientos de
  Siweb360, buscando la referencia única exacta, tras un margen mínimo desde el envío.
- **FR-006**: Si la referencia aparece exactamente una vez, el sistema MUST marcar el envío como enviado sin confirmación humana, guardar el
  movimiento encontrado y registrarlo en la auditoría como resolución automática.
- **FR-007**: Si la referencia no aparece, o aparece más de una vez, el sistema MUST mantener el envío en revisión y
  mostrar esa evidencia (y el stock actual de la variante) en la bandeja de administración.
- **FR-008**: Reenviar o descartar un envío en revisión MUST estar permitido solo al rol de administración, comprobado
  en la API. Cualquier usuario de la app MUST poder cerrar un envío en revisión
  marcándolo como "Revisado" o "Resuelto a mano en Siweb360", con nota obligatoria. Toda decisión MUST quedar en la
  auditoría con autor, fecha, tipo de cierre y nota.
- **FR-009**: Cada noche el sistema MUST leer el historial de movimientos de Siweb360 desde la fecha de corte y
  vincular automáticamente cada movimiento de una variante mapeada a un código nacional con su registro en la app:
  entradas por la referencia de la línea de recepción y ventas por la conciliación ticket ↔ dispensación existente.
- **FR-009a**: Los movimientos de medicamentos sin vínculo MUST aparecer en la bandeja "Movimientos sin justificar" y
  en el informe semanal, hasta que se cierren.
- **FR-009b**: Cualquier usuario de la app MUST poder cerrar un movimiento sin justificar vinculándolo a mano a una
  línea de recepción o dispensación, o justificándolo con un motivo de una lista cerrada (revisión de inventario,
  revisión de lote, revisión de caducidad, caducado, rotura, devolución de cliente, devolución a proveedor, robo o
  pérdida, otro) y una nota obligatoria (mínimo 5 caracteres). Para vincular a mano, el sistema MUST proponer solo
  líneas de recepción o dispensaciones del mismo código nacional y del mismo día que el movimiento. El vínculo o la
  justificación MUST guardarse como registro
  nuevo en la auditoría; nunca se modifica el movimiento ni una justificación anterior.
- **FR-009d**: Toda salida de stock de un medicamento justificada con motivo (no vinculada a una dispensación) MUST
  añadirse al registro regulatorio de movimientos como "BAJA", con fecha del movimiento, código nacional, nombre, lote,
  unidades, motivo y referencia a la justificación. Si la justificación se sustituye, el registro MUST mostrar la
  anulación y la nueva baja, nunca editar la anterior.
- **FR-009e**: Toda entrada de stock de un **psicótropo** justificada con motivo MUST añadirse al registro de
  psicótropos como "ALTA" (y "ANULACIÓN ALTA" si se sustituye), con los mismos datos que una baja. Las entradas
  justificadas del resto de medicamentos MUST NOT ir al registro; quedan solo en la auditoría. Las devoluciones de
  cliente como no conformidad quedan fuera de alcance (otra feature).
- **FR-009c**: Los movimientos de productos no mapeados a un código nacional y los anteriores a la fecha de corte
  MUST NOT aparecer en la bandeja.
- **FR-010**: En producción, la app MUST negarse a arrancar con la escritura activa si falta la fecha de corte.
- **FR-010a**: La prueba controlada (§12.3) MUST registrar en la app cada ejecución con su resultado (superada o no),
  fecha, autor y variante de prueba usada, en la auditoría.
- **FR-010b**: Con la escritura activa, el sistema MUST NOT enviar ninguna entrada si no hay una prueba controlada
  superada registrada en los últimos 30 días; los envíos se quedan pendientes (no fallidos) y la pantalla de estado
  muestra "Falta la prueba de escritura" con la fecha de la última superada, si la hay.
- **FR-011**: La pantalla de estado MUST mostrar el modo de escritura, la fecha de corte, el almacén de destino, la
  fecha de la última prueba controlada superada y los contadores de envíos pendientes, fallidos y en revisión.
- **FR-012**: Apagar la escritura MUST conservar los envíos pendientes sin enviarlos; volver a encenderla los envía.
- **FR-013**: Las recepciones finalizadas antes de activar la escritura MUST NOT enviarse automáticamente.
- **FR-014**: La copia de referencia de la API de Siweb360 del repositorio MUST actualizarse a la versión 1.3.0 y la
  SPEC (§5.2.4, §5.2.5) MUST dejar de afirmar que no se pueden consultar movimientos.
- **FR-015**: Ningún mensaje, registro o traza de esta feature MUST contener datos personales.

### Key Entities

- **Envío de entrada**: operación en la cola de envíos asociada a una línea de recepción; estado (pendiente, enviado,
  fallido, en revisión), referencia única, intentos, último error y, si se resolvió, el movimiento de Siweb360
  encontrado y cómo se resolvió (automático o persona).
- **Movimiento de Siweb360**: lectura del historial de inventario (variante, almacén, lote, caducidad, unidades,
  motivo, nota, fecha). Solo se lee.
- **Movimiento sin justificar**: movimiento de Siweb360 de un medicamento posterior al corte sin vínculo a un registro
  de la app; se identifica por el identificador del movimiento en Siweb360.
- **Justificación de movimiento**: registro inmutable que cierra un movimiento sin justificar, con vínculo (línea de
  recepción o dispensación) o motivo de la lista, nota, autor y fecha; puede ser sustituida por otra posterior.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Tras la puesta en marcha, el 100 % de las líneas de recepción finalizadas llegan a Siweb360 sin que nadie
  teclee lote ni caducidad.
- **SC-002**: Al menos el 90 % de los envíos que quedan en revisión por respuesta dudosa se resuelven solos en menos de
  1 hora, sin intervención humana.
- **SC-003**: Cero entradas duplicadas en Siweb360 causadas por reenvíos automáticos.
- **SC-004**: El 100 % de los movimientos de medicamentos posteriores al corte quedan vinculados o justificados, o
  aparecen en la bandeja al día siguiente; al menos el 95 % de las entradas y ventas se vinculan sin intervención.
- **SC-005**: Encender o apagar la escritura lleva menos de 10 minutos y no pierde ningún envío pendiente.

## Assumptions

- La especificación de Siweb360 1.3.0 (fichero aportado por JC, revisado el 2026-11-09) es la vigente; la operación de
  ajuste no cambia respecto a la 1.2.0 ya integrada.
- El historial de movimientos devuelve la nota libre tal como se envió en el ajuste y permite filtrar por variante,
  motivo y fechas. Se confirmará en la prueba controlada (§12.3), que debe comprobar también que el movimiento de
  prueba aparece en el historial con su nota.
- Margen mínimo antes de concluir "no consta": 10 minutos; comprobación cada 15 minutos durante 24 h, después solo
  manual.
- La prueba controlada la ejecuta una persona en producción con la variante `TEST-…`; esta feature no la automatiza,
  pero sí guarda su resultado para que la app pueda exigirlo.
- Las nuevas columnas de coste e IVA de la variante quedan fuera de alcance (no afectan a la escritura de stock).
- Las transferencias entre almacenes y el stock ilimitado quedan fuera de alcance: solo existe el almacén «Farmacia».
- La conciliación ticket ↔ dispensación (spec 003, D-02b) se reutiliza tal cual para vincular las ventas; esta feature
  solo añade la bandeja común y la justificación del resto de movimientos. Se supone que `reference_id` de una venta
  es el id del ticket; si no lo es, las ventas van a la bandeja hasta tener una muestra real y no se aproxima.
- La conciliación de movimientos se ejecuta cada noche junto al trabajo de conciliación de ventas existente (21:00).
