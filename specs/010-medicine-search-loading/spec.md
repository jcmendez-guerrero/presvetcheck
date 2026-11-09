# Feature Specification: Indicador de carga y búsquedas estables en los buscadores de medicamentos

**Feature Branch**: `010-medicine-search-loading`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "When searching for and specific medicine in any of the fileds that have that integration the system should show a load wheel or similar that indicates the user that it is being serach and avoid changing the execution of the search with more data or similar"

## Clarifications

### Session 2026-11-09

- Q: ¿Qué hace el campo mientras una búsqueda está en marcha? → A: La persona puede seguir escribiendo y solo
  vale la última búsqueda; la lista anterior se atenúa y no se puede seleccionar. El campo nunca se bloquea.

## Contexto

Hoy hay cuatro sitios donde la persona escribe para buscar un medicamento en el catálogo (CIMAVet):

1. **Revisión de la receta** — buscar el medicamento de cada línea de la receta.
2. **Resultado de la comprobación** — "Buscar sustituto en vademécum o almacén".
3. **Recepciones** — buscar el medicamento al añadir una línea de entrada.
4. **Vademécum (comparar medicamentos)** — los dos buscadores, "Medicamento A" y "Medicamento B".

Su comportamiento no es igual: en algunos no se ve nada mientras se busca, y en los buscadores de vademécum y de
sustituto cada letra lanza una búsqueda nueva sin anular la anterior, de modo que una respuesta lenta de una
búsqueda vieja puede llegar después y sustituir a la buena (la lista no corresponde a lo que está escrito).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver que la búsqueda está en marcha (Priority: P1)

Una persona del mostrador escribe parte del nombre de un medicamento. Mientras el sistema busca, junto al campo
aparece un indicador animado con el texto "Buscando…". Cuando llegan los resultados, el indicador desaparece y se
muestra la lista; si no hay resultados, se dice claramente "No se ha encontrado ningún medicamento".

**Why this priority**: sin indicador, la persona no sabe si el sistema está buscando, si ha fallado o si no hay
resultados, y tiende a volver a escribir o a elegir un medicamento equivocado. Es lo que pide el usuario.

**Independent Test**: en cualquiera de los cuatro buscadores, con una respuesta del catálogo retrasada
artificialmente, escribir un texto válido y comprobar que el indicador aparece durante la espera y desaparece al
mostrar resultados, "sin resultados" o un error.

**Acceptance Scenarios**:

1. **Given** un buscador de medicamentos vacío, **When** la persona escribe un texto con la longitud mínima,
   **Then** aparece el indicador "Buscando…" junto al campo hasta que llega la respuesta.
2. **Given** una búsqueda en marcha, **When** llega la respuesta con resultados, **Then** el indicador
   desaparece y se muestra la lista.
3. **Given** una búsqueda en marcha, **When** llega una respuesta vacía, **Then** el indicador desaparece y se
   muestra "No se ha encontrado ningún medicamento".
4. **Given** una búsqueda en marcha, **When** el catálogo falla o no responde, **Then** el indicador desaparece y
   se muestra un mensaje de error comprensible con la opción de volver a intentarlo, sin mostrar una lista vacía
   como si no hubiera resultados.
5. **Given** un lector de pantalla activo, **When** empieza y termina una búsqueda, **Then** se anuncia
   "Buscando…" y después el número de resultados (o que no hay).

---

### User Story 2 - Que la lista siempre corresponda a lo escrito (Priority: P1)

La persona escribe "amoxi", sigue escribiendo hasta "amoxicilina" o corrige el texto mientras la primera búsqueda
todavía no ha terminado. La lista que acaba viendo corresponde siempre a lo que hay escrito en el campo en ese
momento; los resultados de búsquedas anteriores nunca sustituyen a los de la última.

**Why this priority**: es un riesgo de dispensación. Si la lista muestra resultados de un texto anterior, la
persona puede seleccionar un medicamento que no es el que buscaba. La regulación pide que la decisión de
dispensación sea trazable y correcta, así que esto pesa tanto como el indicador.

**Independent Test**: con respuestas del catálogo cuya demora se controla (la primera más lenta que la segunda),
escribir un texto, cambiarlo antes de que termine la primera búsqueda y comprobar que solo se muestran los
resultados del último texto.

**Acceptance Scenarios**:

1. **Given** una búsqueda en marcha para "amoxi", **When** la persona cambia el texto a "amoxicilina" y la
   respuesta de "amoxi" llega después que la de "amoxicilina", **Then** la lista muestra los resultados de
   "amoxicilina" y la respuesta de "amoxi" se descarta.
2. **Given** que la persona escribe deprisa varias letras seguidas, **When** termina de escribir, **Then** el
   sistema no lanza una búsqueda por cada letra, sino que espera una pausa breve y busca el texto final.
3. **Given** una búsqueda en marcha, **When** la persona borra el texto por debajo de la longitud mínima,
   **Then** el indicador desaparece, la lista se vacía y la respuesta pendiente se descarta.
4. **Given** una búsqueda en marcha, **When** la persona sigue escribiendo en el campo, **Then** el campo nunca
   se bloquea, la lista anterior se atenúa y no se puede seleccionar, y solo vale la última búsqueda: la que
   estaba en marcha se anula o su respuesta se descarta.

---

### User Story 3 - Mismo comportamiento en todos los buscadores (Priority: P2)

Los cuatro buscadores de medicamentos se comportan igual: mismo indicador, mismo texto, misma longitud mínima,
mismos mensajes de "sin resultados" y de error.

**Why this priority**: el personal no es técnico y trabaja con varias pantallas; un comportamiento distinto en
cada una provoca dudas y errores. Depende de que las historias 1 y 2 estén resueltas.

**Independent Test**: repetir las pruebas de las historias 1 y 2 en los cuatro buscadores y comprobar que el
resultado es el mismo.

**Acceptance Scenarios**:

1. **Given** cualquiera de los cuatro buscadores, **When** se escribe el mismo texto, **Then** el indicador, los
   mensajes y la longitud mínima para empezar a buscar son idénticos.

---

### Edge Cases

- Respuesta muy rápida: el indicador no debe parpadear de forma molesta; se admite no mostrarlo si la respuesta
  llega antes de un umbral breve.
- La persona selecciona un resultado mientras otra búsqueda está pendiente: se respeta la selección y la
  respuesta pendiente no cambia lo elegido.
- La persona sale de la pantalla o cierra el panel con una búsqueda en marcha: la respuesta se descarta sin
  errores visibles.
- El catálogo tarda mucho: el indicador sigue visible hasta un tiempo máximo; superado, se muestra el mensaje de
  error con opción de reintentar.
- En la revisión de la receta, el buscador también filtra por especie: un cambio de especie con una búsqueda en
  marcha cuenta como búsqueda nueva y solo vale la última.
- Texto escaneado de golpe (lector de código de barras o pegado): se trata como un texto completo, sin búsquedas
  intermedias.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Todos los buscadores de medicamentos (revisión de receta, sustituto, recepciones y los dos de
  vademécum) MUST mostrar un indicador de carga animado con el texto "Buscando…" junto al campo mientras haya una
  búsqueda en marcha.
- **FR-002**: El indicador MUST desaparecer en cuanto la búsqueda termina, ya sea con resultados, sin resultados o
  con error.
- **FR-003**: El sistema MUST distinguir de forma visible tres finales: resultados, "No se ha encontrado ningún
  medicamento" y error (con opción de reintentar). Un error nunca se muestra como "sin resultados".
- **FR-004**: La lista de resultados MUST corresponder siempre al texto (y filtros, como la especie) que hay en
  el campo en ese momento; las respuestas de búsquedas anteriores MUST descartarse.
- **FR-005**: El sistema MUST esperar una pausa breve en la escritura antes de lanzar la búsqueda, en lugar de
  buscar con cada letra.
- **FR-006**: El sistema MUST empezar a buscar solo a partir de la misma longitud mínima de texto en todos los
  buscadores.
- **FR-007**: Mientras una búsqueda esté en marcha, el campo MUST seguir admitiendo texto (nunca se bloquea) y
  la persona MUST NOT poder seleccionar un resultado que no corresponda al texto actual: la lista anterior se
  muestra atenuada y no seleccionable hasta que llegue la respuesta de la última búsqueda.
- **FR-008**: El inicio y el final de cada búsqueda MUST anunciarse a los lectores de pantalla, y el indicador
  MUST ser perceptible sin depender solo del color o de la animación (incluye el texto "Buscando…").
- **FR-009**: Las búsquedas que se descartan MUST NOT generar mensajes de error visibles.
- **FR-010**: Los textos MUST estar en español claro, sin jerga técnica, conforme a la constitución.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En el 100 % de las búsquedas de prueba con respuesta retrasada, el indicador es visible durante la
  espera en los cuatro buscadores.
- **SC-002**: En el 100 % de las pruebas en las que una respuesta antigua llega después de una nueva, la lista
  final corresponde al último texto escrito (cero resultados desfasados).
- **SC-003**: Escribir una palabra de 10 letras a velocidad normal lanza como mucho 2 búsquedas, no 10.
- **SC-004**: En una prueba con personal del mostrador, ninguna persona vuelve a escribir el texto por creer que
  el sistema "no hace nada" mientras busca.
- **SC-005**: Los cuatro buscadores pasan la misma batería de pruebas de comportamiento (indicador, sin
  resultados, error, respuesta desfasada).

## Assumptions

- La búsqueda en el catálogo ya existe y no cambia; esta funcionalidad solo afecta a cómo se presenta y se
  coordina en pantalla.
- Pausa de escritura por defecto: unos 300 ms; tiempo máximo de espera antes de mostrar error: unos 10 s.
  Longitud mínima común: 3 caracteres (la que ya usan revisión y recepciones). Son valores de presentación, no
  reglas legales.
- El indicador reutiliza el estilo de carga que ya existe en el sistema de diseño de la aplicación (feature 007).
- Otros campos que buscan cosas distintas de medicamentos (proveedores, veterinarios, asistente) quedan fuera de
  alcance.
- No se envían datos personales en la búsqueda; solo el texto del medicamento y, en su caso, la especie.
