# Feature Specification: Albarán o factura y códigos QR desde el móvil en la recepción de mercancía

**Feature Branch**: `013-mobile-albaran-qr-scan`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "we need to add the capability to scan from mobile the bill or delivery note on the reception of new inventory and also allow the mobile to scan QR as well"

## Context

Hoy, en «Recepción de mercancía», el ordenador puede **leer el albarán o la factura** del proveedor: rellena la
cabecera (distribuidor, nº de albarán, fecha de compra), avisa de posibles duplicados y propone las líneas con su lote
y caducidad para revisarlas con el envase (SPEC.md §4.9). Pero el documento solo se puede subir **desde el
ordenador** (archivo o cámara del propio equipo).

El móvil emparejado con el PC (diálogo «Usar el móvil») solo sirve para dos cosas: **fotografiar recetas** y **leer el
código del envase**. Cuando la mercancía llega, el albarán en papel está en la mano de quien descarga las cajas, no
junto al ordenador, y no hay forma de fotografiarlo con el móvil.

En cuanto a los códigos del envase: la lectura hecha con el móvil ya llega al campo de escaneo de la recepción, y el
lector del móvil ya reconoce QR, pero la pantalla solo habla de «DataMatrix o código de
barras» y el sistema solo entiende el contenido GS1 clásico (el del DataMatrix). Los envases que llevan un **QR con
enlace GS1 (GS1 Digital Link)**, es decir, una dirección web que contiene el código del producto, el lote y la
caducidad, no se pueden aprovechar hoy.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fotografiar el albarán con el móvil al recibir la mercancía (Priority: P1)

Una persona del personal tiene el móvil emparejado con el ordenador. Al llegar un pedido, elige en el móvil «Albarán
o factura», fotografía el documento (una o varias páginas) y lo envía. En el ordenador, la pantalla de nueva
recepción se rellena con lo leído (distribuidor, nº de albarán, fecha, líneas propuestas y posibles duplicados),
exactamente igual que si el documento se hubiera subido desde el ordenador.

**Why this priority**: es la petición principal. Evita llevar el papel al ordenador o escanearlo aparte, y reutiliza
la lectura de albaranes que ya existe.

**Independent Test**: con el lector de documentos de pruebas, emparejar un móvil, enviar desde él la foto de un
albarán de ejemplo y comprobar que la nueva recepción del ordenador muestra la cabecera y las líneas propuestas del
documento.

**Acceptance Scenarios**:

1. **Given** un móvil emparejado y la pantalla de recepción de mercancía abierta en el ordenador, **When** la persona
   envía desde el móvil la foto de un albarán, **Then** el ordenador muestra la cabecera rellenada y las líneas
   propuestas, y el móvil muestra solo «Enviado al ordenador» (sin datos del documento).
2. **Given** un albarán de varias páginas, **When** la persona añade todas las páginas en el móvil antes de enviar,
   **Then** el ordenador recibe un único documento con todas las páginas y propone las líneas de todas ellas.
3. **Given** que el albarán leído coincide con uno ya registrado para ese distribuidor, **When** llega al ordenador,
   **Then** se muestra el mismo aviso de duplicado que con una subida desde el ordenador.
4. **Given** un móvil emparejado y el ordenador en otra pantalla, **When** llega un albarán desde el móvil, **Then**
   el ordenador avisa de forma visible («Ha llegado un albarán desde el móvil») con un botón para abrir la nueva
   recepción con lo leído; el documento no se pierde.
5. **Given** que la lectura de documentos no está configurada, **When** la persona abre la página del móvil, **Then**
   la opción «Albarán o factura» no se ofrece (o aparece desactivada con la explicación), igual que en el ordenador.

---

### User Story 2 - Leer con el móvil el QR de un envase en la recepción (Priority: P2)

Durante una recepción de mercancía, la persona lee con el móvil el **QR** de un envase (el código 2D del envase que,
en vez de DataMatrix, viene como QR). El ordenador lo trata igual que un DataMatrix: rellena el código nacional, el lote y la caducidad
y aplica las mismas comprobaciones (coincidencia con el medicamento elegido, caducidad mínima, suma de unidades del
mismo lote).

**Why this priority**: completa el escaneo de envases desde el móvil. Tiene menos impacto que el albarán porque la
mayoría de los envases veterinarios llevan DataMatrix.

**Independent Test**: con el móvil emparejado y una recepción abierta, leer un QR de prueba con enlace GS1 que contenga
GTIN, lote y caducidad, y comprobar que la línea se rellena igual que con el DataMatrix equivalente.

**Acceptance Scenarios**:

1. **Given** una recepción abierta en el ordenador, **When** la persona lee con el móvil un QR con enlace GS1 que
   contiene producto, lote y caducidad, **Then** la línea se rellena con el código nacional, el lote y la caducidad,
   igual que con el DataMatrix equivalente.
2. **Given** un QR con contenido GS1 clásico (el mismo texto que un DataMatrix), **When** se lee con el móvil,
   **Then** se interpreta igual que el DataMatrix.
3. **Given** un QR que no contiene datos de producto (por ejemplo, la web del laboratorio o un enlace cualquiera),
   **When** se lee, **Then** el ordenador explica en lenguaje claro que ese código no identifica el medicamento y
   pide leer el DataMatrix o escribir los datos; nunca abre el enlace ni rellena campos con datos inventados.
4. **Given** la página del móvil, **When** la persona ve la tarjeta de códigos, **Then** el texto indica que lee
   «DataMatrix, código QR o código de barras».
5. **Given** el escáner de cámara o el lector USB del ordenador, **When** lee el mismo QR con enlace GS1, **Then** el
   resultado es el mismo que desde el móvil.

---

### Edge Cases

- Más de 10 páginas en un envío: el móvil no deja añadir más y explica el máximo («Un albarán admite hasta 10
  páginas»).
- El móvil envía el albarán pero la sesión de emparejamiento ha caducado o se ha desconectado: el móvil lo explica
  («El emparejamiento ha caducado: vuelve a leer el código QR del ordenador») y no se pierde ningún dato del
  ordenador.
- Foto borrosa, oscura o que no es un albarán: el ordenador muestra el mismo mensaje que con una subida que no se puede
  leer y deja registrar la recepción a mano.
- La lectura tarda (hasta un minuto): el móvil indica «Enviando y leyendo el albarán…» y el ordenador muestra que está
  leyendo, como con las recetas.
- Se envía un segundo albarán desde el móvil mientras el ordenador tiene uno leído sin guardar: el ordenador no lo
  sobrescribe sin avisar; pregunta si sustituir el leído por el nuevo.
- La misma foto se reenvía dos veces (doble pulsación): solo se crea una lectura.
- El QR con enlace GS1 trae la caducidad con día «00»: se toma el último día del mes, como en el DataMatrix.
- El QR con enlace GS1 usa un dominio distinto del de GS1 (los laboratorios pueden usar el suyo): se interpreta igual
  si la ruta sigue el formato GS1.
- El QR con enlace GS1 trae el GTIN pero no lote ni caducidad: se rellena el producto y se piden los datos que falten.
- El archivo enviado desde el móvil es un PDF (por ejemplo, la factura recibida por correo): se acepta igual que una
  foto.

## Requirements *(mandatory)*

### Functional Requirements

**Albarán o factura desde el móvil**

- **FR-001**: La página del móvil emparejado DEBE ofrecer una opción «Albarán o factura», además de «Receta» y
  «Código del envase».
- **FR-002**: La persona DEBE poder fotografiar una o varias páginas, o elegir un archivo de imagen o PDF, y enviarlo
  al ordenador en un solo envío.
- **FR-003**: El albarán enviado desde el móvil DEBE leerse con la misma lectura de albaranes que ya usa el ordenador
  y producir el mismo resultado: cabecera propuesta, líneas propuestas, totales y aviso de duplicados.
- **FR-004**: Lo leído desde el móvil DEBE ser solo una PROPUESTA, igual que hoy: nada se guarda como recepción hasta
  que la persona lo revisa y pulsa crear en el ordenador, y cada línea se sigue cotejando con el envase.
- **FR-005**: El ordenador DEBE mostrar lo leído en la pantalla de nueva recepción si está abierta; si no, DEBE
  mostrar un aviso visible con acceso directo a esa pantalla con lo leído.
- **FR-006**: El móvil NO DEBE mostrar los datos leídos del documento; solo el estado del envío (enviando, leyendo,
  enviado, error).
- **FR-007**: El documento original enviado desde el móvil DEBE guardarse y quedar unido a la recepción que se cree,
  igual que el subido desde el ordenador.
- **FR-008**: Cada envío desde el móvil DEBE quedar en el registro de auditoría a nombre de la persona que abrió el
  emparejamiento.
- **FR-009**: Si la lectura de documentos no está configurada, la opción del móvil NO DEBE poder usarse, y la persona
  DEBE ver por qué.

**Códigos QR**

- **FR-010**: El sistema DEBE interpretar los QR con enlace GS1 (GS1 Digital Link) y obtener de ellos, cuando estén,
  el producto (GTIN → código nacional), el lote, la caducidad y el número de serie.
- **FR-011**: Un QR con contenido GS1 clásico DEBE interpretarse igual que un DataMatrix.
- **FR-012**: Los datos obtenidos de un QR DEBEN pasar exactamente por las mismas comprobaciones que los de un
  DataMatrix (coincidencia con el medicamento elegido, caducidad mínima, suma de unidades del mismo lote, número de
  serie repetido).
- **FR-013**: Un QR que no identifica un producto DEBE rechazarse con un mensaje claro y sin rellenar ningún campo; el
  sistema NUNCA DEBE abrir ni consultar el enlace leído.
- **FR-014**: La interpretación del QR DEBE ser la misma venga del móvil, de la cámara del ordenador o del lector USB.
- **FR-015**: El texto de la tarjeta de códigos del móvil DEBE mencionar «DataMatrix, código QR o código de barras».
- **FR-016**: El alcance del QR es solo el código del envase (el que sustituye al DataMatrix) leído durante la
  recepción de mercancía. Quedan fuera el QR tributario de facturas (VeriFactu) y el QR de recetas electrónicas.
  Como la interpretación es común (FR-014), las demás pantallas de escaneo lo entenderán igual sin trabajo aparte.

### Key Entities

- **Envío desde el móvil**: lo que el móvil manda al ordenador en una sesión de emparejamiento. Hoy puede ser una
  receta o un código; se añade el **albarán o factura** (una o varias páginas, o un PDF), con su estado (leyendo,
  leído, error).
- **Lectura de albarán**: la propuesta de cabecera, líneas y totales obtenida del documento; la misma que ya existe
  para las subidas desde el ordenador.
- **Código leído**: el texto de un DataMatrix, QR o código de barras; se interpreta como datos GS1 (producto, lote,
  caducidad, número de serie) venga en formato clásico o como enlace GS1.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona puede pasar de tener el albarán en papel en la mano a ver la cabecera y las líneas propuestas
  en el ordenador en menos de 90 segundos, sin tocar el ordenador hasta la revisión.
- **SC-002**: Con el mismo documento, la lectura enviada desde el móvil y la subida desde el ordenador dan el mismo
  resultado (cabecera, líneas y avisos de duplicado) en el 100 % de los albaranes de prueba.
- **SC-003**: El 100 % de los QR de prueba con enlace GS1 (con producto, lote y caducidad) rellenan la línea igual que
  su DataMatrix equivalente.
- **SC-004**: Ningún QR sin datos de producto rellena un campo ni hace que se abra un enlace (0 casos en las pruebas).
- **SC-005**: Ninguna recepción se crea sin que la persona haya revisado y confirmado lo leído en el ordenador.

## Assumptions

- Se reutiliza el emparejamiento móvil ↔ PC actual (mismo diálogo, mismo token, misma caducidad); no se añade inicio
  de sesión en el móvil.
- Se reutiliza la lectura de albaranes actual (SPEC.md §4.9); esta feature no cambia qué datos
  se extraen ni cómo se validan las líneas.
- Los albaranes y facturas de proveedor no contienen datos personales de propietarios de mascotas; aun así no se
  muestran en el móvil ni se registran en los logs.
- La revisión y la creación de la recepción se siguen haciendo en el ordenador (o tablet) con sesión; el móvil solo
  envía.
- El formato GS1 Digital Link sigue la norma pública de GS1; las pruebas usan QR de ejemplo generados por el equipo,
  no envases reales.
- Las fotos de albaranes reales no se guardan en el repositorio; las pruebas usan los albaranes sintéticos de ejemplo.
