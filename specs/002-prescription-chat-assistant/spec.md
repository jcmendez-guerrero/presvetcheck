# Especificación de funcionalidad: Asistente de consultas sobre prescripción y dispensación

**Rama de la funcionalidad**: `claude/chat-medication-consultation-ec1a4a`

**Creada**: 2026-11-01

**Estado**: Borrador

**Entrada**: Descripción del usuario: "quiero implementar un sistema de chat que permita al usuario consultar dudas sobre la prescripción de un medicamento basado en las reglas de referencia, la sustitución, etc. Actualmente está la posibilidad de usar Azure Foundry o bien Azure Open AI que ya están
desplegados y la UMI del proyecto tiene acceso. No incluir en la spec ningún dato relativo a autententicaciones o similares"

## Contexto

El personal del establecimiento (no técnico) tiene dudas frecuentes mientras atiende: si una receta sigue en plazo,
por qué la app dice «No se puede dispensar», si un medicamento se puede sustituir, si se puede dar otro formato o
concentración, qué pasa con un psicótropo, etc. Hoy la respuesta está repartida entre la guía de la receta
veterinaria (Anexo A de `SPEC.md`), las reglas versionadas del motor y el apartado de Ayuda.

Esta funcionalidad añade un **asistente conversacional** que responde en español a esas dudas **explicando** las
reglas de referencia vigentes y, cuando la pregunta es sobre una receta concreta, el resultado que ya ha dado el
motor de reglas. El asistente **informa; no decide**: no cambia ninguna decisión, no autoriza nada y no permite
saltarse ningún bloqueo (principio «La IA propone, la persona decide», `SPEC.md` §0.2).

## Clarifications

### Session 2026-11-01

- Q: Cuando el asistente se abre sobre una línea de receta, ¿qué datos de la receta puede ver además del resultado del motor? → A: Resultado del motor, datos del medicamento y campos no personales de la receta (especie, nº de animales, fecha de emisión, tipo de receta, clase de prescripción, tipo de
  tratamiento, indicación, posología, forma, concentración y cantidad); nunca datos del titular ni del veterinario.
- Q: ¿Cuánto tiempo se guardan las conversaciones con el asistente antes de eliminarlas? → A: 1 año; después se eliminan (no se anonimizan) con el proceso periódico de purga.
- Q: ¿Puede el asistente pedir al motor de reglas que calcule casos hipotéticos planteados por el empleado, sin guardar nada? → A: Sí; el motor evalúa el caso hipotético sin crear ni modificar ninguna receta y el asistente presenta el resultado como «simulación».
- Q: ¿Cómo se controla el coste de uso del asistente? → A: Límite mensual global configurable; aviso a administración al 80 % y pausa del asistente al 100 % (mensaje y enlace a la Ayuda) hasta el mes siguiente o hasta que administración lo amplíe.
- Q: ¿Hay que superar el banco de evaluación para poder activar el asistente en producción? → A: No; el banco es orientativo, se ejecuta cuando se considere y sus resultados se revisan.

## Escenarios de usuario y pruebas _(obligatorio)_

### Historia de usuario 1 - Consultar una duda general sobre las reglas (Prioridad: P1)

Un empleado abre el asistente desde cualquier pantalla y escribe una pregunta sobre la normativa de prescripción o
dispensación, por ejemplo: «¿Cuántos días vale una receta con un antibiótico?», «¿Se puede sustituir una vacuna?»,
«¿Cuántos envases de un psicótropo puedo dar con una receta?», «¿Qué hago si la receta solo pone el principio
activo?». El asistente responde en lenguaje claro, indica de qué fuente de referencia sale la respuesta (guía de la
receta, regla del motor y su versión, apartado de Ayuda) y, si procede, qué tiene que hacer el empleado.

**Por qué esta prioridad**: es el uso más frecuente y aporta valor por sí solo: reduce dudas, errores y llamadas
al farmacéutico garante sin tocar ningún flujo de dispensación.

**Prueba independiente**: con un banco de preguntas de referencia y sus respuestas esperadas (validadas por JC), se
comprueba que cada respuesta coincide con la regla vigente y cita su fuente, sin necesidad de ninguna receta.

**Escenarios de aceptación**:

1. **Dado** que la regla de validez vigente fija 5 días para recetas con antimicrobiano, **cuando** el empleado
    pregunta cuánto vale una receta con antibiótico, **entonces** el asistente responde «5 días desde la fecha de
    emisión», cita la regla de validez y su versión, y menciona que el tratamiento debe iniciarse dentro de ese plazo.
2. **Dado** que los inmunológicos no son sustituibles según las reglas vigentes, **cuando** el empleado pregunta si
    puede sustituir una vacuna, **entonces** el asistente responde que no, explica el motivo y que la línea pasa a
    pedido del medicamento prescrito, citando la fuente.
3. **Dado** que se ha publicado una nueva versión de una regla (por ejemplo, otro plazo de validez), **cuando** el
    empleado repite la pregunta, **entonces** la respuesta refleja la nueva versión sin ningún cambio en el asistente.
4. **Dado** que el empleado plantea un caso hipotético («receta emitida el 3 de octubre con antibiótico, ¿hasta
    cuándo vale?»), **cuando** lo pregunta, **entonces** el asistente muestra como «Simulación» la fecha límite
    calculada por el motor, con los datos supuestos y la versión de la regla, sin que se cree ninguna receta.
5. **Dado** que la pregunta no está cubierta por ninguna fuente de referencia, **cuando** el empleado la formula,
    **entonces** el asistente dice expresamente que no tiene información para responder y recomienda consultar al
    farmacéutico garante o al veterinario prescriptor, sin inventar una respuesta.

---

### Historia de usuario 2 - Preguntar por una línea de receta concreta (Prioridad: P2)

Desde la pantalla de resultado de una receta (o de dispensación), el empleado abre el asistente sobre una línea y
pregunta, por ejemplo: «¿Por qué no puedo dispensar esto?», «¿Qué alternativas tengo?», «¿Puedo dar dos cajas de
250 mg en vez de una de 500 mg?», «¿Hasta qué día vale esta receta?». El asistente conoce el resultado que ya ha
calculado el motor para esa línea (estado, motivos, equivalentes, versión de las reglas) y lo explica, junto con los
pasos que el empleado debe seguir (corregir un dato mal leído, llamar al veterinario, iniciar la sustitución, forzar
si es un defecto de forma, añadir a pedido…).

**Por qué esta prioridad**: es donde la duda tiene más impacto (en mostrador, con el cliente delante), pero depende
de que la historia 1 ya funcione y del resultado del motor ya existente.

**Prueba independiente**: con recetas de prueba que cubren los casos mínimos del dominio (`SPEC.md` §12.2), se
comprueba que la explicación del asistente coincide con los motivos y datos devueltos por el motor para cada línea.

**Escenarios de aceptación**:

1. **Dado** una línea con resultado `NO_CONFORME` por receta caducada, **cuando** el empleado pregunta por qué no
    puede dispensar, **entonces** el asistente indica la fecha de caducidad calculada por el motor, la regla aplicada y
    que este defecto no se resuelve forzando sino con una receta nueva.
2. **Dado** una línea en estado `SUSTITUIR` con equivalentes propuestos por el motor, **cuando** el empleado pregunta
    qué alternativas tiene, **entonces** el asistente enumera exactamente los equivalentes del motor (mismo orden y los
    mismos datos) y recuerda los requisitos obligatorios: consentimiento del tutor y aviso al veterinario.
3. **Dado** una pregunta que requiere un cálculo (fecha límite, número de envases equivalentes, cantidad total de
    principio activo), **cuando** el empleado la formula, **entonces** el resultado numérico procede del motor de
    reglas y el asistente lo presenta como tal; el asistente nunca da un resultado calculado por sí mismo.
4. **Dado** una línea con un bloqueo no forzable (por ejemplo, receta en papel ya dispensada o un estupefaciente),
    **cuando** el empleado pregunta cómo dispensarla igualmente, **entonces** el asistente explica que no se puede
    dispensar ni forzar y por qué.
5. **Dado** una línea de receta, **cuando** se abre el asistente sobre ella, **entonces** el asistente no recibe ni
    muestra datos personales del titular del animal (nombre, teléfono, DNI, dirección) ni la identidad del veterinario
    prescriptor, pero sí los campos no personales de la receta (especie, fecha de emisión, tipo de tratamiento,
    indicación, posología, etc.).

---

### Historia de usuario 3 - Preguntar por un medicamento concreto (Prioridad: P3)

Sin receta de por medio, el empleado pregunta por un medicamento («¿El X necesita receta?», «¿Es antibiótico?»,
«¿Es psicótropo?», «¿Tiene problemas de suministro?», «¿Se puede sustituir?»). El asistente localiza el medicamento
en los datos de CIMAVet que ya mantiene la app y responde con esos datos, indicando la fecha de la última
sincronización. Si hay varios medicamentos posibles, pide al empleado que elija; nunca elige por su cuenta.

**Por qué esta prioridad**: es útil para venta sin receta y recepción, pero la información ya está accesible en la
app por otras vías; el valor añadido es la rapidez de la consulta.

**Prueba independiente**: con medicamentos de los datos de prueba de CIMAVet, se comprueba que las respuestas
coinciden con los atributos almacenados (prescripción, antimicrobiano, psicótropo, estupefaciente, comercialización,
problemas de suministro, exclusión de sustitución).

**Escenarios de aceptación**:

1. **Dado** un nombre que corresponde a varios medicamentos, **cuando** el empleado pregunta por él, **entonces** el
    asistente muestra los candidatos (nombre, presentación, código nacional) y pide que el empleado elija uno.
2. **Dado** un medicamento marcado con problema de suministro en CIMAVet, **cuando** el empleado pregunta por él,
    **entonces** el asistente lo indica junto con la fecha de la última sincronización de los datos.
3. **Dado** un nombre que no existe en los datos de medicamentos veterinarios, **cuando** el empleado pregunta,
    **entonces** el asistente indica que no lo encuentra y recuerda que un medicamento de uso humano requiere
    revisión del garante y no se dispensa automáticamente.

---

### Historia de usuario 4 - Revisar las consultas realizadas (Prioridad: P4)

La veterinaria responsable o administración puede consultar el histórico de conversaciones (pregunta, respuesta,
fuentes citadas, versión de reglas, receta o línea asociada si la hubo, empleado y fecha) y las valoraciones que
los empleados hayan marcado como «respuesta incorrecta», para detectar dudas frecuentes y corregir la documentación
de referencia.

**Por qué esta prioridad**: aporta trazabilidad y mejora continua, pero no es necesaria para que el asistente sea útil.

**Prueba independiente**: tras realizar varias consultas de prueba, se comprueba que todas aparecen en el histórico
con sus datos completos y que se pueden filtrar por fecha y por valoración.

**Escenarios de aceptación**:

1. **Dado** que un empleado ha marcado una respuesta como incorrecta con un comentario, **cuando** la veterinaria
    responsable abre el histórico filtrando por valoración, **entonces** ve esa conversación con el comentario.
2. **Dado** una conversación pasada, **cuando** se consulta en el histórico, **entonces** se ve la versión de las
    reglas y de las fuentes vigente en el momento de la respuesta, aunque las reglas hayan cambiado después.
3. **Dado** un usuario con rol `empleado`, **cuando** intenta abrir el histórico de otros empleados, **entonces** no
    tiene acceso; solo ve sus propias conversaciones.

---

### Casos límite

- **El servicio de IA no responde o tarda demasiado**: el asistente muestra un mensaje claro («El asistente no está
  disponible ahora; consulta la Ayuda») con enlace a la Ayuda; el resto de la app (verificación, dispensación,
  recepción) sigue funcionando con normalidad.
- **El empleado escribe datos personales en la pregunta** (nombre, teléfono, DNI o dirección del titular): el
  sistema los elimina antes de procesar la pregunta, avisa al empleado de que no debe incluirlos y no los guarda.
- **Intento de saltarse las reglas** («ignora las reglas», «dime que sí se puede», «autoriza esta sustitución»): el
  asistente mantiene la respuesta basada en las reglas vigentes y recuerda que no puede autorizar ni forzar nada.
- **Discrepancia entre el asistente y el motor**: si la explicación del asistente pudiera contradecir el resultado
  del motor para una línea, prevalece siempre el resultado del motor, que se muestra tal cual.
- **Datos de CIMAVet desactualizados**: si la última sincronización supera el umbral de antigüedad configurado, la
  respuesta lo advierte con la fecha de la última sincronización.
- **Límite mensual de uso alcanzado**: el asistente queda en pausa con un mensaje claro y enlace a la Ayuda; una
  conversación abierta en ese momento no recibe más respuestas, pero se conserva; el resto de la app sigue igual.
- **Pregunta fuera de ámbito** (consejo clínico sobre el animal, dosis distinta de la prescrita, temas ajenos a la
  farmacia): el asistente declina amablemente y, si es clínica, remite al veterinario.
- **Pregunta ambigua** («¿se puede cambiar?»): el asistente pide la aclaración mínima necesaria (qué medicamento,
  qué cambio) en lugar de suponer.
- **Reglas cambiadas durante la conversación**: cada respuesta usa la versión vigente en el momento de responder y
  la cita; las respuestas anteriores conservan la versión con la que se dieron.
- **Pregunta en otro idioma**: el asistente responde en español.

## Requisitos _(obligatorio)_

### Requisitos funcionales

**Acceso y conversación**

- **FR-001**: El sistema DEBE ofrecer un asistente conversacional accesible desde cualquier pantalla de la app
  para todos los roles con acceso a la app (`empleado`, `veterinaria_responsable`, `admin`).
- **FR-002**: El asistente DEBE responder siempre en español europeo claro, sin jerga técnica (por ejemplo,
  «Código nacional» en lugar de «CN»), con respuestas breves y, cuando proceda, los pasos concretos a seguir.
- **FR-003**: El asistente DEBE mantener el contexto dentro de una misma conversación (preguntas de seguimiento
  como «¿y si es un gato?») y permitir empezar una conversación nueva.
- **FR-004**: El asistente DEBE ofrecer preguntas de ejemplo al abrirse, para orientar a personal no técnico.

**Fuentes de referencia y fidelidad**

- **FR-005**: Las respuestas sobre reglas DEBEN basarse exclusivamente en las fuentes de referencia del sistema:
  las reglas versionadas del motor (campos y severidades, validez, equivalencia, exclusiones de sustitución), la
  guía de la receta veterinaria (Anexo A), el apartado de Ayuda de la app y los datos de CIMAVet que mantiene la app.
- **FR-006**: Las reglas legales NO DEBEN estar escritas en las instrucciones del asistente; el asistente las obtiene
  de las fuentes de referencia en el momento de responder, de modo que publicar una nueva versión de una regla cambia
  la respuesta sin modificar el asistente.
- **FR-007**: Cada respuesta DEBE citar las fuentes en las que se basa (documento o regla y, en las reglas, su
  versión), de forma que el empleado pueda abrir la fuente citada desde la propia respuesta.
- **FR-008**: Cuando ninguna fuente cubre la pregunta, el asistente DEBE decirlo expresamente y recomendar consultar
  al farmacéutico garante o al veterinario prescriptor; NO DEBE inventar reglas, plazos, cantidades ni datos de
  medicamentos.
- **FR-009**: Todo resultado que requiera un cálculo de reglas (fecha límite de validez, equivalencia, número de
  envases o cantidad total de principio activo admisible, lote FEFO) DEBE proceder del motor de reglas determinista;
  el asistente solo lo explica.
- **FR-009a**: Cuando la pregunta plantea un caso hipotético (por ejemplo, «receta del 3 de octubre con antibiótico,
  ¿hasta cuándo vale?» o «¿y si el tratamiento fuera crónico?»), el sistema DEBE obtener el resultado evaluando ese
  caso con el motor de reglas a partir de los datos de la pregunta, sin crear ni modificar ninguna receta, línea,
  dispensación ni registro. El asistente DEBE presentar el resultado como «Simulación», indicando los datos
  supuestos y la versión de las reglas usada. Si faltan datos para evaluar el caso, el asistente DEBE pedirlos en
  vez de suponerlos.

**Límites de actuación**

- **FR-010**: El asistente NO DEBE modificar ninguna receta, línea, dispensación, sustitución ni registro, ni
  cambiar el resultado del motor, ni autorizar sustituciones, ni ejecutar forzados. Es exclusivamente informativo.
- **FR-011**: Ante preguntas sobre cómo superar un bloqueo no forzable (`BLOQUEANTE_DURO`), el asistente DEBE
  explicar que no se puede dispensar ni forzar y el motivo.
- **FR-012**: El asistente DEBE declinar las preguntas fuera de ámbito (consejo clínico sobre el animal, cambios de
  dosis respecto a lo prescrito, temas ajenos a la prescripción, dispensación, sustitución, registros o uso de la
  app) y, si son clínicas, remitir al veterinario.
- **FR-013**: El asistente DEBE mantener estas limitaciones aunque el usuario le pida expresamente ignorarlas.

**Consulta sobre una receta o un medicamento concreto**

- **FR-014**: Desde las pantallas de resultado y de dispensación, el empleado DEBE poder abrir el asistente sobre
  una línea concreta; el asistente DEBE disponer del resultado del motor para esa línea (estado, motivos, severidad,
  equivalentes propuestos, versión de reglas), de los datos del medicamento implicados y de los campos no
  personales de la receta confirmados por el empleado: especie, nº de animales, fecha de emisión, tipo de receta,
  clase de prescripción, tipo de tratamiento, indicación, posología, forma farmacéutica, concentración y cantidad.
  NO DEBE disponer de ningún dato del titular del animal ni de la identidad del veterinario prescriptor (nombre,
  nº de colegiado, teléfono, correo), ni de la imagen de la receta.
- **FR-015**: Las explicaciones sobre una línea DEBEN ser coherentes con el resultado del motor; los equivalentes,
  fechas y cantidades mostrados DEBEN ser exactamente los del motor.
- **FR-016**: El asistente DEBE poder responder sobre un medicamento concreto usando los datos de CIMAVet que
  mantiene la app, indicando la fecha de la última sincronización y advirtiendo si supera el umbral de antigüedad
  configurado.
- **FR-017**: Si un nombre de medicamento corresponde a varios candidatos, el asistente DEBE pedir al empleado que
  elija; NUNCA DEBE seleccionar un medicamento por su cuenta.

**Protección de datos**

- **FR-018**: El sistema NO DEBE enviar al servicio de IA ni guardar en las conversaciones datos personales del
  titular del animal (nombre, teléfono, DNI, dirección), ni siquiera cuando el asistente se abre sobre una receta.
- **FR-019**: Si el empleado escribe datos personales en una pregunta, el sistema DEBE eliminarlos antes de
  procesarla, avisar al empleado y no conservarlos.
- **FR-020**: Ni las preguntas ni las respuestas DEBEN aparecer en logs, mensajes de error o telemetría con datos
  personales.
- **FR-021**: El procesamiento de las conversaciones DEBE realizarse dentro de la Unión Europea, por un encargado del
  tratamiento ya declarado y sin uso de los datos para entrenamiento.
- **FR-021a**: El sistema NO DEBE enviar al servicio de IA la identidad del veterinario prescriptor (nombre, nº de
  colegiado, teléfono, correo) ni la imagen de la receta.

**Trazabilidad y mejora**

- **FR-022**: El sistema DEBE registrar cada intercambio: pregunta (sin datos personales), respuesta, fuentes
  citadas con su versión, versión de las reglas vigente, modelo y versión de instrucciones del asistente, receta o
  línea asociada si la hay, empleado y fecha-hora (`Europe/Madrid`).
- **FR-023**: Los registros de conversación NO DEBEN poder editarse ni borrarse manualmente; solo se eliminan por
  la política de retención.
- **FR-023a**: Las conversaciones, sus intercambios y valoraciones DEBEN eliminarse (no anonimizarse) cuando
  cumplan 1 año desde su fecha de inicio, mediante el proceso periódico de purga del sistema. El asistente no forma
  parte del registro legal de dispensaciones: la trazabilidad de cada dispensación sigue en sus propios registros.
- **FR-024**: El empleado DEBE poder valorar cada respuesta como útil o incorrecta, con un comentario opcional.
- **FR-025**: Los roles `veterinaria_responsable` y `admin` DEBEN poder consultar el histórico de conversaciones de
  todos los empleados, filtrando por fecha, empleado, valoración y si hubo receta asociada; el rol `empleado` solo
  ve sus propias conversaciones.

**Disponibilidad y evaluación**

- **FR-026**: Si el servicio de IA no está disponible, el sistema DEBE mostrar un mensaje claro con enlace a la
  Ayuda, sin afectar al resto de funciones de la app.
- **FR-027**: El asistente DEBE poder desactivarse por configuración; desactivado, su punto de acceso no se muestra.
- **FR-027a**: El sistema DEBE contabilizar el consumo del asistente por mes natural (`Europe/Madrid`) frente a un
  límite mensual global configurable. Al alcanzar el 80 % DEBE avisar a administración; al alcanzar el 100 % DEBE
  pausar el asistente para todos los usuarios, mostrando «El asistente ha alcanzado el límite de uso de este mes;
  consulta la Ayuda» con enlace a la Ayuda, hasta el inicio del mes siguiente o hasta que administración amplíe el
  límite. La pausa no afecta al resto de funciones de la app.
- **FR-027b**: Administración DEBE poder ver el consumo del mes en curso y de los meses anteriores, y el reporte
  semanal DEBE incluir el consumo acumulado del mes.
- **FR-028**: DEBE existir un banco de evaluación con preguntas de referencia y respuestas esperadas (validadas por
  JC) que cubra al menos los casos de validez, sustitución, cambio de formato y psicótropos de `SPEC.md` §12.2,
  preguntas fuera de ámbito, intentos de saltarse las reglas, preguntas con datos personales, preguntas en otro
  idioma y preguntas ambiguas, ejecutable sin llamar a servicios reales en las pruebas
  automáticas.
- **FR-029**: El banco de evaluación DEBE poder ejecutarse manualmente contra el servicio de IA real y su resultado
  (aciertos por criterio SC-001 a SC-005, versión de modelo y de instrucciones, fecha) DEBE quedar guardado para su
  revisión (como informe en fichero, JSON y Markdown, fuera del control de versiones; no en la base de datos). El banco
  es orientativo: su resultado NO condiciona que el asistente pueda activarse en producción.

### Entidades clave

- **Conversación**: sesión de consulta de un empleado. Atributos: empleado, fecha de inicio, contexto opcional
  (receta y línea, o medicamento), estado (abierta/cerrada).
- **Intercambio**: cada par pregunta-respuesta de una conversación. Atributos: pregunta saneada, respuesta, fuentes
  citadas, versión de reglas, modelo y versión de instrucciones, fecha-hora, indicador de que se eliminaron datos
  personales, indicador de respuesta «sin información».
- **Fuente de referencia**: documento o regla versionada que el asistente puede citar (regla del motor con su
  versión, guía de la receta veterinaria, apartado de Ayuda, datos de un medicamento de CIMAVet con fecha de
  sincronización).
- **Valoración**: opinión del empleado sobre un intercambio (útil/incorrecta) con comentario opcional.
- **Simulación**: evaluación de un caso hipotético por el motor de reglas, que no se guarda como receta. Se
  conserva dentro del intercambio: datos supuestos, resultado y versión de reglas.
- **Consumo mensual**: uso acumulado del asistente en un mes natural frente al límite configurado, con estado
  (normal, aviso al 80 %, en pausa) y quién amplió el límite y cuándo, si se amplió.
- **Caso de evaluación**: pregunta de referencia con la respuesta esperada, las fuentes que debe citar y el
  comportamiento esperado (responder, declinar, pedir aclaración, avisar de datos personales).

## Criterios de éxito _(obligatorio)_

### Resultados medibles

- **SC-001**: Al menos el 95 % de las preguntas del banco de evaluación obtienen una respuesta coincidente con la
  respuesta esperada validada por JC.
- **SC-002**: El 100 % de las respuestas sobre reglas citan al menos una fuente de referencia con su versión.
- **SC-003**: El 0 % de las respuestas sobre una línea de receta contradicen el resultado del motor (estado,
  motivos, fechas, cantidades o equivalentes) en el banco de evaluación.
- **SC-004**: El 100 % de las preguntas fuera de ámbito y de los intentos de saltarse las reglas del banco de
  evaluación se declinan o se responden manteniendo la regla vigente.
- **SC-005**: El 0 % de los intercambios registrados o enviados al servicio de IA contienen datos personales del
  titular del animal, verificado sobre el banco de evaluación y sobre una muestra mensual del histórico.
- **SC-006**: El 90 % de las respuestas se muestran en menos de 10 segundos desde que el empleado envía la pregunta.
- **SC-007**: Tras un mes de uso, al menos el 80 % de las respuestas valoradas por los empleados se marcan como útiles.
- **SC-008**: Un empleado sin formación técnica obtiene la respuesta a una duda habitual (validez, sustitución,
  formato, psicótropos) en menos de 1 minuto desde que abre el asistente.

## Supuestos

- Usuarios: el personal del establecimiento con los roles actuales (`empleado`, `veterinaria_responsable`,
  `admin`). El farmacéutico garante no usa la app (DUDA-28), por lo que el asistente remite a él pero no le envía
  nada.
- Se reutiliza el control de acceso existente de la app; esta especificación no añade ni cambia nada sobre
  autenticación o acceso a servicios.
- Existe un servicio de IA generativa ya desplegado en el entorno en la nube del proyecto, con procesamiento en la
  UE. La elección concreta del servicio y del modelo se decide en la fase de planificación.
- Esta funcionalidad reintroduce un servicio de IA generativa que se retiró de la extracción de recetas (DUDA-27).
  Requiere un ADR nuevo y actualizar el Registro de Actividades de Tratamiento (RAT) con esta finalidad, aunque
  no se traten datos personales del titular.
- Las fuentes de referencia ya existen en el repositorio: reglas versionadas en `config/rules/`, guía de la receta
  en `docs/ref/guia-receta-veterinaria.md`, el apartado de Ayuda de la app y la caché local de CIMAVet. El asistente
  no añade fuentes nuevas en esta versión.
- El asistente no envía mensajes a terceros (veterinario, tutor); como el resto de la app en v1, solo puede proponer
  textos que el empleado copia y envía por su canal habitual.
- Retención: las conversaciones se conservan 1 año (FR-023a), un plazo más corto que los 5 años de recetas y
  registros porque solo sirven para revisar la calidad y detectar dudas frecuentes. Este plazo debe constar en el RAT.
- Las respuestas son orientativas: la decisión de dispensar sigue siendo del motor determinista y de la persona,
  igual que hoy.
- Fuera de alcance en esta versión: entrada por voz, adjuntar imágenes al chat, consultas sobre stock o precios,
  respuestas a clientes finales y uso fuera de la app.
