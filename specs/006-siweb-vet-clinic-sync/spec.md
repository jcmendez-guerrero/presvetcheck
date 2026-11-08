# Feature Specification: Sincronización y autorrelleno de veterinarios y clínicas con SiWeb (ERP)

**Feature Branch**: `006-siweb-vet-clinic-sync`

**Created**: 2026-11-06

**Status**: Draft

**Input**: User description: "It is required that the system is capable to read from siweb if the Veterinary and the Clinit exist in SiWeb as customers or providers, if not exist, we can create after the register, so when we are filling the data of the vet or the clinit it is being filled form ERP data if detected and reducing the time of the prescription adding. In the contacts api we can add in the notes a json or something that you can read from the API to identify the Licence of the vet or other data that can't enter in the other fields of the API"

## Clarifications

### Session 2026-11-07

- Q: ¿Cómo debe gestionar el sistema el alta de un contacto en SiWeb si la receta no incluye una dirección de correo electrónico del veterinario o de la clínica? → A: Solicitar el correo en el diálogo de alta en SiWeb, permitiendo rellenar con un clic un marcador técnico temporal con el dominio `@sin-mail.mundo-mascotix.es` (ej. `col.<numColegiado>@sin-mail.mundo-mascotix.es` o `clinica.<cif>@sin-mail.mundo-mascotix.es`) si no se dispone del correo en mostrador.
- Q: Si el usuario autocompleta un veterinario o clínica desde SiWeb pero modifica algún dato en el formulario (por ejemplo, el teléfono o la dirección), ¿cómo debe actuar el sistema con la ficha del ERP? → A: Mostrar un diálogo de confirmación al guardar preguntando si desea actualizar también la ficha en SiWeb o solo aplicar los cambios en esta receta.
- Q: Cuando una receta incluye tanto a un veterinario individual (persona física) como a una clínica (entidad o centro) y ninguno existe en SiWeb, ¿cómo debe gestionarse el alta en el ERP? → A: Permitir elegir en el diálogo de alta si se desea crear la ficha del veterinario (vinculando la clínica en sus notas), la ficha de la clínica o ambas entidades de forma separada.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Búsqueda y autorrelleno ágil de veterinario y clínica desde SiWeb durante la entrada de receta (Priority: P1)

El personal del establecimiento dispensador está registrando o revisando los datos de una receta veterinaria. Al empezar a teclear el nombre del veterinario, su número de colegiado, el nombre de la clínica o su CIF (o al procesar la extracción automática de la receta), el sistema consulta los contactos registrados en el ERP (clientes y proveedores). Si detecta coincidencias:

1. Muestra sugerencias contextuales claras indicando si constan como cliente o proveedor, su localidad y su número de colegiado/CIF.
2. Al seleccionar un contacto, autorrellena automáticamente todos los datos del profesional (nombre, teléfono, correo, número de colegiado, colegio oficial/provincia) y de la clínica (nombre del centro, dirección, CIF, teléfono).
3. Si el contacto en el ERP almacena información profesional en su campo de notas en formato estructurado (número de colegiado, colegio de pertenencia, clínica habitual), el sistema la interpreta de forma transparente para completar los campos reglamentarios de la receta.

**Why this priority**: Es el núcleo de la mejora de productividad: reduce el tiempo manual de tecleo de datos repetitivos de minutos a segundos y previene errores tipográficos en el número de colegiado o en la dirección profesional requerida para el registro oficial de salidas.

**Independent Test**: Puede probarse introduciendo una receta y buscando un veterinario o clínica existente en el ERP: al seleccionarlo, los campos del formulario se completan inmediatamente con la información del ERP (incluyendo el número de colegiado extraído de las notas estructuradas) sin requerir introducción manual.

**Acceptance Scenarios**:

1. **Given** un contacto registrado en el ERP como veterinario prescriptor con número de colegiado y colegio almacenados en las notas estructuradas, **When** el usuario teclea las primeras letras de su nombre o su número de colegiado en la pantalla de revisión de receta, **Then** el sistema presenta el contacto coincidente en una lista desplegable con su nombre, número de colegiado y localidad.
2. **Given** la selección de un contacto de tipo veterinario procedente del ERP, **When** el usuario confirma la selección, **Then** el formulario de la receta se cumplimenta automáticamente con su nombre completo, número de colegiado, provincia/colegio, teléfono, correo electrónico, nombre de clínica asociada y dirección profesional.
3. **Given** un contacto registrado en el ERP como clínica veterinaria, **When** el usuario busca por el nombre de la clínica o CIF, **Then** el sistema permite asociar la clínica a la receta, autorrellenando la razón social/nombre comercial, el CIF y la dirección completa.
4. **Given** una receta escaneada donde la extracción automática detecta el nombre o colegiado de un veterinario existente en el ERP, **When** se abre la pantalla de revisión, **Then** el sistema resalta la coincidencia detectada en el ERP y ofrece vincularla con un solo clic.

---

### User Story 2 - Detección de contacto inexistente y alta en SiWeb tras el registro de la receta (Priority: P1)

Durante la cumplimentación de una receta, el usuario introduce un veterinario o una clínica que no existe previamente en el directorio de contactos del ERP (ni como cliente ni como proveedor).

1. El sistema avisa de forma no intrusiva de que el profesional o la clínica no figuran en el ERP.
2. Tras registrar la receta (o mediante una acción explícita «Dar de alta en ERP»), el sistema ofrece crear la ficha de contacto en el ERP.
3. Si la receta incluye tanto datos del facultativo individual como de la clínica asociada, el diálogo de alta permite seleccionar si registrar al profesional, al centro clínico o a ambos por separado.
4. El sistema transfiere los datos generales del contacto (nombre o razón social, teléfono, email, CIF/NIF, dirección postal, código postal, municipio, provincia) y codifica los datos específicos que no disponen de campo nativo en el ERP (número de colegiado, colegio oficial, clínica vinculada) dentro del campo de notas en formato estructurado JSON.
5. Los nuevos contactos quedan guardados en el ERP y disponibles para futuras recetas.

**Why this priority**: Cierra el ciclo de datos evitando que el personal tenga que abrir el ERP por separado para registrar a nuevos prescriptores o clínicas colaboradoras, asegurando que la base de datos empresarial se mantenga actualizada y enriquecida de forma orgánica.

**Independent Test**: Registrar una receta con un veterinario nuevo; solicitar su alta en el ERP; comprobar que el contacto se crea en el ERP con sus datos básicos y que su campo de notas contiene el bloque JSON con el número de colegiado y colegio.

**Acceptance Scenarios**:

1. **Given** una receta con datos de un veterinario prescriptor que no arroja coincidencias en el ERP, **When** el usuario finaliza o revisa la receta, **Then** el sistema indica «Profesional no registrado en ERP» y habilita la opción de crearlo como nuevo contacto.
2. **Given** la confirmación de alta de un veterinario en el ERP, **When** se envía la creación, **Then** el sistema genera el contacto con sus datos de contacto y guarda en el campo de notas un bloque estructurado que incluye el número de colegiado y el colegio profesional.
3. **Given** que el usuario decide no dar de alta al contacto en el ERP en ese instante, **When** continúa con la receta, **Then** la receta se registra con normalidad en el sistema local sin bloquear la dispensación ni forzar el alta externa.
4. **Given** un contacto de clínica veterinaria no existente en el ERP, **When** se solicita su alta, **Then** se crea en el ERP con su nombre, CIF y dirección, quedando vinculado para próximas prescripciones.
5. **Given** una receta con veterinario y clínica no existentes en SiWeb, **When** se abre el diálogo de alta, **Then** el usuario puede marcar si desea dar de alta al veterinario, a la clínica o a ambos simultáneamente.

---

### User Story 3 - Lectura e interpretación de metadatos profesionales en notas del ERP (Priority: P2)

El ERP almacena notas de contacto que pueden contener tanto anotaciones humanas libres como metadatos estructurados en formato JSON.

1. Al consultar un contacto desde el ERP, el sistema localiza e interpreta de manera segura la sección estructurada en las notas.
2. Extrae atributos clave: número de colegiado, colegio provincial, tipo de profesional y datos complementarios de la clínica.
3. Si el contacto ya contiene notas previas escritas por otros departamentos de la empresa, el sistema preserva el texto humano existente tanto en la lectura como en cualquier actualización posterior.

**Why this priority**: Garantiza la compatibilidad bidireccional entre sistemas sin alterar el funcionamiento habitual del ERP ni destruir anotaciones comerciales o administrativas preexistentes.

**Independent Test**: Configurar un contacto en el ERP con notas compuestas (texto libre comercial más bloque JSON con colegiado); buscarlo en el formulario de recetas y comprobar que el colegiado se extrae limpiamente y que una posterior sincronización no borra el texto libre comercial.

**Acceptance Scenarios**:

1. **Given** un contacto en el ERP cuyo campo de notas contiene un bloque JSON válido con el número de colegiado y el colegio oficial, **When** el sistema lee el contacto, **Then** extrae con precisión ambos valores y los asigna a los campos de prescripción correspondientes.
2. **Given** un contacto en el ERP con notas de texto libre humano sin formato JSON, **When** el sistema lo lee, **Then** utiliza los datos estándar disponibles (nombre, dirección, teléfono, correo) y deja el número de colegiado editable sin generar ningún error ni excepción.
3. **Given** la actualización o guardado de metadatos en un contacto con notas de texto libre previas, **When** el sistema guarda la información estructurada, **Then** mantiene el texto previo intacto e integra el bloque JSON de forma delimitada.

---

### User Story 4 - Búsqueda combinada y desambiguación de profesionales y centros (Priority: P3)

Cuando una clínica veterinaria cuenta con varios veterinarios asociados, o cuando existen profesionales con nombres similares en diferentes provincias:

1. El sistema permite al usuario distinguir con facilidad entre contactos individuales (personas físicas / veterinarios) y entidades jurídicas (clínicas o centros veterinarios).
2. La vista de resultados de búsqueda muestra información discriminatoria relevante (número de colegiado, localidad, provincia, NIF/CIF).
3. Permite asociar en la misma receta al veterinario prescriptor individual y a la clínica a la que pertenece.

**Why this priority**: Evita errores de asignación de recetas a profesionales homónimos o a la clínica en lugar del profesional actuante, manteniendo la trazabilidad regulatoria de la persona facultativa responsable.

**Independent Test**: Realizar una búsqueda de un nombre común con múltiples coincidencias; verificar que la interfaz muestra de forma visible provincia, colegiado y clínica para seleccionar el correcto.

**Acceptance Scenarios**:

1. **Given** múltiples contactos coincidentes con el término de búsqueda, **When** se despliega la lista de resultados, **Then** cada opción muestra de forma diferenciada el nombre, el número de colegiado, la provincia y la clínica habitual.
2. **Given** la selección de un veterinario que tiene una clínica habitual asociada en sus notas estructuradas, **When** se selecciona el veterinario, **Then** el sistema ofrece autocompletar simultáneamente los datos de la clínica vinculada.

---

### Edge Cases

- **Fallo o indisponibilidad de la conexión con el ERP**: Si el servicio del ERP no responde o sufre lentitud excesiva, el sistema permite continuar con la introducción manual de datos sin bloquear el registro de la receta ni la dispensación en mostrador.
- **Formato corrupto en el campo de notas**: Si el campo de notas de un contacto contiene un JSON mal formado o caracteres extraños, el sistema ignora de forma tolerante el bloque defectuoso, permite la edición manual del número de colegiado y notifica discretamente la anomalía sin interrumpir el flujo.
- **Contacto existente con datos modificados en el formulario**: Si el usuario autocompleta desde SiWeb y edita algún campo (teléfono, correo, dirección o clínica), al guardar o confirmar la receta el sistema muestra un diálogo de confirmación preguntando si desea actualizar también la ficha del contacto en SiWeb o mantener los cambios únicamente en la receta actual.
- **Ausencia de correo electrónico obligatorio en el ERP**: El API de SiWeb exige email obligatorio en el alta de contactos. Si en la receta no consta el correo del veterinario o clínica, el modal de alta solicita el correo al usuario y ofrece un botón rápido para rellenar un marcador técnico temporal con el dominio `@sin-mail.mundo-mascotix.es` (por ejemplo, `col.<numColegiado>@sin-mail.mundo-mascotix.es` o `clinica.<cif>@sin-mail.mundo-mascotix.es`), evitando bloquear el registro en el ERP.
- **Protección de datos del tutor del animal**: Los datos de carácter personal del tutor del animal (nombre del dueño, teléfono particular, DNI y domicilio) NUNCA se enviarán al ERP ni se incluirán en el contacto del veterinario o clínica, preservando el principio de minimización de datos.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: El sistema DEBE permitir buscar contactos en el ERP en tiempo real (clientes y proveedores) por nombre, apellidos, CIF/NIF, número de colegiado, teléfono o nombre de clínica.
- **FR-002**: El sistema DEBE autocompletar los datos del veterinario (nombre, teléfono, correo electrónico, número de colegiado, colegio oficial/provincia, clínica y dirección) al seleccionar un contacto veterinario procedente del ERP.
- **FR-003**: El sistema DEBE autocompletar los datos de la clínica veterinaria (nombre comercial o razón social, CIF, dirección completa, teléfono y correo) al seleccionar un contacto de clínica procedente del ERP.
- **FR-004**: El sistema DEBE leer e interpretar un bloque estructurado en formato JSON alojado en el campo de notas del contacto del ERP para obtener atributos no nativos, en particular el número de colegiado, el colegio provincial y la clínica habitual vinculada.
- **FR-005**: El sistema DEBE tolerar notas con texto libre no estructurado o JSON inválido sin interrumpir el funcionamiento ni generar errores bloqueantes.
- **FR-006**: Cuando los datos de un veterinario o clínica introducidos en una receta no existan en el ERP, el sistema DEBE informar de la no existencia y ofrecer la posibilidad de registrarlos como nuevo contacto en el ERP.
- **FR-007**: Al solicitar el alta de un nuevo contacto en el ERP, el sistema DEBE mapear los campos nativos (nombre, CIF/NIF, teléfono, correo, dirección, código postal, localidad, provincia) y serializar los datos profesionales específicos (número de colegiado, colegio oficial, clínica) en el campo de notas como JSON estructurado, preservando cualquier texto previo si lo hubiera.
- **FR-008**: La creación y actualización de contactos en el ERP DEBE ejecutarse de forma desacoplada y con reintentos fiables mediante el patrón outbox para garantizar la entrega sin congelar la interfaz de usuario ante latencias de red.
- **FR-009**: La indisponibilidad del ERP o la falta de conectividad NO DEBE impedir en ningún caso la introducción manual de los datos, la verificación de la receta ni la dispensación de medicamentos en el establecimiento.
- **FR-010**: El sistema DEBE permitir clasificar el nuevo contacto en el ERP como cliente o proveedor (o asignar el tipo predeterminado configurable según la política de la empresa).
- **FR-011**: El sistema NO DEBE transferir jamás al ERP ni a las notas de los contactos datos personales pertenecientes al tutor o propietario del animal (nombre, DNI, dirección o teléfono personal del tutor).
- **FR-012**: En los resultados de búsqueda, el sistema DEBE presentar información discriminatoria suficiente (colegiado, CIF, localidad, tipo) para permitir la desambiguación rápida entre profesionales con nombres similares.
- **FR-013**: Si al dar de alta un contacto en SiWeb no se dispone de correo electrónico (obligatorio en SiWeb), el sistema DEBE permitir generar un marcador técnico con el dominio `@sin-mail.mundo-mascotix.es` para completar el registro sin bloquear la operativa.
- **FR-014**: Si el usuario modifica datos de un veterinario o clínica previamente autocompletados desde SiWeb, el sistema DEBE mostrar un diálogo de confirmación al confirmar la receta permitiendo elegir entre actualizar también la ficha del contacto en SiWeb o aplicar los cambios solo a la receta actual.
- **FR-015**: Cuando ni el veterinario ni la clínica consten en SiWeb, el diálogo de alta DEBE permitir al usuario seleccionar si desea dar de alta al profesional (vinculando la clínica en sus notas), a la clínica como entidad independiente, o a ambos contactos por separado.

### Key Entities

- **ContactoERP**: Representación de la entidad de contacto en el ERP SiWeb. Atributos: identificador en el ERP, nombre o razón social, CIF/NIF, tipo de relación (cliente, proveedor), teléfono principal, correo electrónico general, dirección, código postal, municipio, provincia y notas generales.
- **MetadatosVeterinarioERP**: Objeto estructurado codificado dentro del campo de notas de un ContactoERP. Contiene: esquema de metadatos (`version`), tipo de profesional (`veterinario`, `clinica`), número de colegiado (`numColegiado`), código o nombre del colegio oficial (`colegio`), nombre y CIF de la clínica habitual (`clinicaNombre`, `clinicaCif`) y notas adicionales.
- **VeterinarioPrescriptor**: Entidad de dominio que representa al facultativo en la receta. Atributos: nombre, número de colegiado, colegio oficial/provincia, teléfono, correo electrónico, clínica y dirección profesional.
- **ClinicaPrescriptora**: Entidad que representa al centro, clínica u hospital veterinario emisor. Atributos: nombre o razón social, CIF, dirección completa, teléfono y correo electrónico.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: El tiempo medio para cumplimentar los datos de veterinario y clínica en una receta cuando el contacto existe en el ERP se reduce en al menos un 70% (de aproximadamente 45 segundos a menos de 10 segundos).
- **SC-002**: El 100% de los contactos de SiWeb con metadatos JSON válidos en su campo de notas son interpretados automáticamente asignando el número de colegiado y colegio a la receta sin necesidad de corrección manual.
- **SC-003**: Los usuarios pueden dar de alta a un veterinario o clínica en el ERP directamente desde el flujo de registro de la receta en un único paso y en menos de 5 segundos de interacción.
- **SC-004**: El 100% de las recetas pueden ser completadas y dispensadas incluso ante una caída total del servicio del ERP, garantizando cero interrupciones en el mostrador.
- **SC-005**: Cero transferencias accidentales de datos personales del tutor del animal al ERP o a las notas públicas del contacto, verificable en auditorías de protección de datos.

## Assumptions

- El ERP SiWeb360 dispone de endpoints públicos operativos para consulta y búsqueda de contactos (`/api/public/contacts`), consulta individual (`/api/public/contacts/{id}`) y creación/actualización (`/api/public/contacts`).
- El campo de notas (`notas`) de los contactos en el ERP admite cadenas de texto con longitud suficiente para albergar un bloque JSON de metadatos (habitualmente inferior a 500 caracteres) sin truncamiento.
- Se establece una convención estándar y delimitable para el bloque JSON dentro de las notas (por ejemplo, una etiqueta o delimitador estándar `---PRESVET---` o formato JSON aislado) que permite la coexistencia segura con notas de texto libre escritas por personal de administración o ventas.
- El tipo por defecto para nuevos contactos creados desde el sistema será `cliente`, permitiendo alternar a `proveedor` según configuración o selección del usuario.
- La búsqueda de contactos se realiza con un retardo mínimo (debounce) para no sobrecargar el API del ERP y cacheando resultados recientes en memoria durante la sesión.
