# Feature Specification: El código del envase leído con el móvil llega siempre al ordenador

**Feature Branch**: `016-fix-mobile-code-not-sent`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "When reading from phone the omnimatrix or GS1 code the code is read locally in phone but is not sent to the system"

## Context

El móvil emparejado con el PC (diálogo «Usar el móvil») sirve, entre otras cosas, para leer el código del envase
(DataMatrix, QR o código de barras). La lectura se hace en el propio móvil y se envía al sistema, que la entrega al
campo de escaneo que esté abierto en el ordenador (dispensación o recepción de mercancía), como si se hubiera leído
con el lector del PC.

**Defecto observado**: al leer con el móvil el DataMatrix (o código GS1) de un envase, el móvil **lee** el código, pero
**no llega al sistema**: en el ordenador no pasa nada, ni se rellena el campo de escaneo ni aparece ningún aviso. La
persona no sabe si el fallo está en la lectura, en el envío o en el ordenador, y tiene que escribir el código a mano.

Hoy hay varios puntos donde la lectura puede perderse sin que nadie lo note:

- el móvil cierra la cámara en cuanto lee el código y el envío al sistema ocurre después; si falla, el aviso de error
  queda en la pantalla del móvil, que la persona ya no mira porque tiene la vista en el ordenador;
- el móvil solo confirma («código enviado») con una marca verde en una lista pequeña, fácil de no ver;
- el ordenador entrega el código solo si hay un campo de escaneo abierto en ese momento; si no lo hay, solo muestra un
  aviso pequeño con el principio del código;
- el ordenador consulta los códigos recibidos cada pocos segundos: si el emparejamiento ha caducado, el móvil o el
  ordenador no lo explican hasta mucho después.

Este arreglo no cambia cómo se interpreta el contenido GS1 (eso sigue en el dominio y no se toca); solo garantiza que
**lo que el móvil lee llega al ordenador, o que la persona sabe de inmediato por qué no ha llegado**.

## Clarifications

### Session 2026-11-17

- Q: Cuando llega un código del móvil y no hay campo de escaneo abierto, ¿se aplica solo al abrir uno o solo cuando la persona lo decide? → A: Solo cuando la persona lo decide: aviso visible y botón «Usar el código recibido» en el campo de escaneo.
- Q: ¿Cuánto tiempo sigue disponible un código recibido sin campo de escaneo abierto? → A: 5 minutos; después se descarta y se avisa de que hay que volver a leer el envase.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Leer el DataMatrix con el móvil y verlo en el ordenador (Priority: P1)

Una persona con el móvil emparejado y la pantalla de dispensación o de recepción abierta en el ordenador lee con el
móvil el DataMatrix de un envase. El código llega al campo de escaneo del ordenador, que lo procesa igual que una
lectura del lector USB: se rellena el código nacional, el lote y la caducidad y se aplican las mismas comprobaciones.

**Why this priority**: es el defecto. Sin esto el móvil no sirve como lector de envases y el personal teclea los
códigos a mano, con el riesgo de errores de lote y caducidad que el escaneo evita.

**Independent Test**: emparejar un móvil, abrir una recepción en el ordenador, leer con el móvil un DataMatrix GS1 de
prueba (GTIN, lote y caducidad) y comprobar que la línea se rellena en menos de 5 segundos sin tocar el ordenador.

**Acceptance Scenarios**:

1. **Given** un móvil emparejado y un campo de escaneo abierto en el ordenador, **When** la persona lee un DataMatrix
   GS1 con el móvil, **Then** el ordenador recibe el código entero (con los separadores de grupo GS1 intactos) y lo
   procesa como una lectura de cámara.
2. **Given** el mismo caso con un código de barras EAN-13 o un QR, **When** se lee con el móvil, **Then** también
   llega al ordenador y se procesa igual.
3. **Given** una lectura por foto del código (móvil sin cámara en vivo), **When** el móvil encuentra el código en la
   foto, **Then** llega al ordenador igual que una lectura en vivo.
4. **Given** una lectura enviada, **When** el sistema la acepta, **Then** el móvil lo confirma a la persona de forma
   clara, y solo después de que el sistema haya aceptado el código.

---

### User Story 2 - Saber en el momento si el código no ha llegado (Priority: P1)

Si el código no puede llegar al sistema (sin conexión, emparejamiento caducado, error del servidor), el móvil lo dice
de forma que la persona no pueda pasarlo por alto, y le deja reintentar el envío con el mismo código sin tener que
volver a escanear el envase.

**Why this priority**: el defecto es silencioso. Aunque se arreglen las causas conocidas, siempre puede fallar la red
del almacén; lo que no puede pasar es que la persona crea que ha enviado algo que no se ha enviado.

**Independent Test**: con el móvil emparejado, cortar la conexión del móvil, leer un código y comprobar que aparece
un aviso grande de «No se ha enviado» con un botón «Reintentar»; restablecer la conexión, pulsar «Reintentar» y
comprobar que el código llega al ordenador.

**Acceptance Scenarios**:

1. **Given** un móvil sin conexión, **When** la persona lee un código, **Then** el móvil muestra de forma destacada
   que el código no se ha enviado y por qué, con un sonido o vibración de error distinto al de éxito.
2. **Given** un envío fallido, **When** la persona pulsa «Reintentar», **Then** se envía el mismo código sin volver a
   escanear y, si llega, desaparece el aviso.
3. **Given** un emparejamiento caducado o cerrado desde el ordenador, **When** el móvil intenta enviar un código,
   **Then** explica «El emparejamiento ha caducado: vuelve a leer el código QR del ordenador» y no ofrece reintentar
   (reintentar no puede funcionar).
4. **Given** un envío fallido, **When** pasa el tiempo, **Then** el código no se pierde mientras la página del móvil
   siga abierta: sigue disponible para reintentar.

---

### User Story 3 - El ordenador avisa de un código recibido sin campo de escaneo (Priority: P2)

Si el móvil envía un código y en el ordenador no hay ningún campo de escaneo abierto, el ordenador lo hace notar y
permite usarlo después, en lugar de dejarlo en un aviso pequeño que se puede ignorar.

**Why this priority**: es la otra mitad del síntoma «no llega al sistema»: el código sí llegó, pero la persona no lo
ve. Es menos grave que perderlo, pero produce la misma confusión.

**Independent Test**: con el móvil emparejado y el ordenador en la pantalla de inicio (sin campo de escaneo), leer un
código con el móvil y comprobar que el ordenador muestra un aviso visible; abrir después una dispensación o una
recepción y comprobar que el código se ofrece o se aplica.

**Acceptance Scenarios**:

1. **Given** ningún campo de escaneo abierto en el ordenador, **When** llega un código del móvil, **Then** el
   ordenador muestra un aviso visible con el código recibido y la hora.
2. **Given** un código recibido sin destino, **When** la persona abre una pantalla con campo de escaneo, **Then** el
   código NO se aplica solo: el campo ofrece el botón «Usar el código recibido» y el código (el más antiguo vigente si
   hay varios) se entrega una sola vez, solo cuando la persona lo pulsa, sin repetirlo en lecturas posteriores.
3. **Given** un código que no se entiende (no es un código de envase), **When** llega al ordenador, **Then** el campo
   de escaneo lo trata como cualquier lectura no válida y lo explica en lenguaje claro; no se descarta en silencio.

---

### Edge Cases

- Dos códigos leídos con pocos segundos de diferencia: llegan los dos, en el mismo orden en que se leyeron, sin
  perder ninguno ni duplicarlo.
- El mismo código leído dos veces seguidas por error (doble lectura de la cámara): el ordenador recibe las dos
  lecturas; decidir si la segunda suma una unidad o se ignora es regla de la pantalla de escaneo, no de este arreglo.
- Código con caracteres de control (separador de grupo GS1) o muy largo (QR con enlace GS1): se envía íntegro; si
  supera el máximo admitido, el móvil lo dice en lenguaje claro en lugar de fallar en silencio.
- El móvil bloquea la pantalla o se cambia de aplicación justo después de leer: al volver a la página del móvil, el
  estado del último envío (enviado o por reintentar) sigue visible.
- El ordenador se queda con la pestaña en segundo plano: el código se recibe igualmente cuando la persona vuelve a la
  pestaña, y no se pierde.
- Dos pestañas del ordenador emparejadas con el mismo móvil: cada pestaña consulta por su cuenta, así que ambas reciben
  el código. Entregarlo a una sola pestaña queda fuera de este arreglo (ver Assumptions).
- Móvil emparejado pero cámara denegada o no disponible: se ofrece la lectura por foto (ya existente) y, si tampoco
  es posible, la entrada a mano; nunca se queda la persona sin salida. Si el lector de la foto no se puede cargar
  (sin red), se avisa y se puede intentar de nuevo; el lector se carga una sola vez y se reutiliza.
- El emparejamiento caduca mientras el ordenador espera códigos: el ordenador lo avisa en el diálogo «Usar el móvil»
  en lugar de seguir como si estuviera conectado.

## Requirements *(mandatory)*

### Functional Requirements

**Envío desde el móvil**

- **FR-001**: Todo código de envase leído con el móvil (DataMatrix, QR, EAN-13, Code 128, en vivo o por foto) DEBE
  enviarse al sistema y llegar al ordenador emparejado. Si la lectura de la foto falla (por ejemplo sin red al cargar
  el lector), el móvil lo avisa en español claro («No se ha podido leer el código de la foto: comprueba la conexión
  del móvil e inténtalo de nuevo») en lugar de no mostrar nada.
- **FR-002**: El código DEBE llegar íntegro, incluidos los separadores de grupo GS1 y otros caracteres de control, tal
  y como lo leyó el móvil.
- **FR-003**: El móvil SOLO DEBE mostrar «enviado» cuando el sistema haya aceptado el código; mientras tanto DEBE
  indicar que está enviando.
- **FR-004**: Si el envío falla, el móvil DEBE mostrar de forma destacada que el código no se ha enviado y el motivo en
  lenguaje claro, con aviso sonoro o vibración distinto al del éxito.
- **FR-005**: Tras un fallo recuperable (sin conexión, error temporal del servidor), el móvil DEBE conservar el código
  y ofrecer «Reintentar» sin volver a escanear. Tras un fallo no recuperable (emparejamiento caducado o cerrado) NO
  DEBE ofrecer reintentar y DEBE explicar cómo volver a emparejar. Un código rechazado por no ser válido (vacío o
  demasiado largo) tampoco se reintenta: se explica. La persona puede descartar cualquier envío fallido que no vaya a
  reintentar («Descartar»).
- **FR-006**: El móvil DEBE seguir mostrando el estado de la última lectura (enviada o por reintentar) al volver a la
  página tras bloquear la pantalla o cambiar de aplicación.

**Recepción en el ordenador**

- **FR-007**: Un código recibido con un campo de escaneo abierto DEBE entregarse a ese campo una sola vez, como lectura
  de cámara, y procesarse con las mismas reglas que una lectura del lector USB.
- **FR-008**: Un código recibido sin campo de escaneo abierto DEBE mostrarse en un aviso visible, con el código y la
  hora. Se conservan hasta 5 códigos pendientes, en orden de llegada. Al abrir después una pantalla con campo de
  escaneo, el campo DEBE ofrecer «Usar el código recibido» (entrega el más antiguo vigente); el código NUNCA se aplica
  sin que la persona lo decida y no se entrega dos veces. Un código sin usar caduca a los 5 minutos de recibirse: se
  descarta y el aviso explica que hay que volver a leer el envase.
- **FR-009**: Los códigos DEBEN llegar en el orden en que se leyeron y sin pérdidas ni duplicados, aunque el ordenador
  tarde en consultar o la pestaña haya estado en segundo plano. Sin campo de escaneo abierto se conservan (FR-008).
- **FR-010**: Si el emparejamiento ha caducado o se ha cerrado, el ordenador DEBE dejar de mostrar el móvil como
  conectado y avisarlo en el diálogo «Usar el móvil».

**Trazabilidad y datos personales**

- **FR-011**: El sistema NO DEBE escribir el código leído en registros técnicos ni en telemetría. El código de un
  envase no contiene datos de personas, pero los registros no deben depender de ello.
- **FR-012**: Cada código enviado desde el móvil DEBE quedar asociado a la persona que abrió el emparejamiento,
  igual que el resto de acciones del móvil.

**Textos**

- **FR-013**: Todos los avisos nuevos DEBEN estar en español claro para personal no técnico, sin jerga («Código
  nacional», no «CN»; «No se ha enviado», no «error 500»).

### Key Entities *(include if feature involves data)*

- **Sesión de móvil**: el emparejamiento entre un móvil y la sesión de una persona en el ordenador. Caduca o se cierra.
- **Lectura de código**: el texto leído por el móvil, el momento de la lectura y su estado en el móvil (enviándose,
  enviada, por reintentar, sin emparejamiento, rechazada). «Enviada» significa aceptada por el sistema; el móvil no
  sabe si el ordenador la ha usado.
- **Campo de escaneo**: el punto del ordenador (dispensación, recepción) que recibe los códigos, vengan del lector USB,
  de la cámara del PC o del móvil.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En una prueba de 20 lecturas de DataMatrix GS1 con el móvil emparejado y buena conexión, las 20 llegan
  al ordenador y se procesan igual que con el lector USB.
- **SC-002**: Una lectura llega al ordenador en menos de 5 segundos desde que el móvil la lee, con buena conexión.
- **SC-003**: Ninguna lectura se pierde en silencio: en el 100 % de los fallos de envío probados (sin conexión,
  emparejamiento caducado, error del servidor) la persona ve en el móvil un aviso destacado en el momento.
- **SC-004**: Tras un fallo de conexión recuperable, la persona envía el código por reintentar en un solo toque, sin
  volver a escanear el envase.
- **SC-005**: Un código recibido sin campo de escaneo abierto es visible para la persona en el ordenador y se puede
  usar sin volver a leer el envase durante 5 minutos en el 100 % de los casos probados; pasado ese tiempo se descarta
  con aviso.
- **SC-006**: El personal deja de teclear a mano códigos de envases que el móvil ya había leído (se comprueba en la
  prueba de aceptación con personal de farmacia).

## Assumptions

- No se conoce todavía la causa exacta del defecto: la investigación (lectura local sin envío, entrega al campo de
  escaneo, consulta del ordenador, límite de tamaño o caracteres de control del código) forma parte del plan. La
  especificación define el resultado esperado, no la causa.
- El defecto se observó con DataMatrix o código GS1 leídos con el móvil emparejado; se da por válido que la lectura
  local del móvil es correcta (el móvil sí «ve» el código).
- Los códigos leídos con el móvil siguen entregándose por el emparejamiento existente; no se cambia el modo de
  emparejar ni la duración de la sesión.
- La interpretación del contenido GS1 (código nacional, lote, caducidad) no cambia; sigue en el dominio y se prueba con
  los ejemplos de prueba existentes.
- Los móviles sin HTTPS siguen usando la lectura por foto del código, ya existente.
- Fuera de alcance: lectura de recetas y albaranes con el móvil, y el diseño del diálogo «Usar el móvil»
  (specs 008 y 013).
- Fuera de alcance: coordinar varias pestañas del ordenador emparejadas con el mismo móvil (cada una recibe el código).
- «Código pendiente» es solo un código recibido en el PC sin campo de escaneo abierto; un envío fallido en el móvil se
  llama «por reintentar».
- Las decisiones abiertas del `SPEC.md` §13 no afectan a este arreglo.
