# Feature Specification: El diálogo «Usar el móvil» siempre cabe en la pantalla

**Feature Branch**: `008-fix-mobile-qr-dialog`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "the movile popup to use the camera to scan is loading over the top so cutting in half and impossible to load"

## Context

El personal abre el diálogo «Usar el móvil» desde la cabecera de la página para emparejar un móvil con el PC. Después,
el móvil funciona como cámara para fotografiar recetas y leer los códigos de los envases. El diálogo muestra un título,
una explicación breve, el código QR, el enlace de emparejamiento, el estado de la conexión, la hora de caducidad y dos
botones («Desconectar el móvil» y «Cerrar»).

**Defecto observado**: al abrirse, el diálogo sobresale por el borde superior de la ventana. El título, la explicación
y la parte de arriba del código QR quedan cortados y no se puede llegar a ellos desplazando, así que el móvil no puede
leer el QR y es imposible emparejarlo. El resto de la página no se oscurece detrás del diálogo. Se observó en la
pantalla de administración del entorno no productivo.

Es una regresión: el emparejamiento funcionaba cuando se publicó (2026-10-15) y dejó de funcionar con el rediseño de
la cabecera del 2026-11-08 (feature 007). El defecto afecta a cualquier tamaño de ventana, no solo a las ventanas
bajas; en las ventanas bajas es peor porque el diálogo es más alto que el espacio disponible.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Leer el código QR en una pantalla baja (Priority: P1)

Una persona del personal, en un portátil con la ventana del navegador baja, abre el diálogo de emparejamiento y lee
el código QR entero con la cámara del móvil.

**Why this priority**: es el defecto. Sin el código QR entero en pantalla el móvil no se puede emparejar, y el
personal se queda sin la cámara del móvil para recetas y códigos.

**Independent Test**: abrir el diálogo en una ventana de 430 px de alto (la altura del informe) y comprobar que el
código QR se ve entero y que un móvil lo lee.

**Acceptance Scenarios**:

1. **Given** una ventana más baja que el diálogo, **When** la persona abre el diálogo de emparejamiento, **Then** la
   parte superior del diálogo (el título) queda en el borde superior de la ventana o por debajo, y el código QR entero
   se puede poner a la vista.
2. **Given** un diálogo más alto que la ventana, **When** la persona desplaza el contenido del diálogo, **Then** se
   puede llegar a todas sus partes (título, explicación, código QR, enlace, estado, caducidad y botones).
3. **Given** una ventana con altura suficiente para el diálogo, **When** el diálogo se abre, **Then** se ve entero,
   centrado sobre toda la página y sin barra de desplazamiento, como los demás diálogos de la aplicación.

---

### User Story 2 - Cerrar o desconectar en una pantalla baja (Priority: P2)

Una persona con una pantalla baja siempre puede llegar a los botones «Cerrar» y «Desconectar el móvil».

**Why this priority**: si los botones quedan fuera de la pantalla, la persona se queda atrapada detrás del diálogo o
no puede desconectar un móvil en el que ya no confía.

**Independent Test**: con el diálogo abierto en una ventana de 430 px de alto, llegar a «Cerrar» y pulsarlo solo con
el ratón, y después solo con el teclado.

**Acceptance Scenarios**:

1. **Given** el diálogo abierto en una ventana baja, **When** la persona se desplaza hasta el final del diálogo,
   **Then** los dos botones se ven y funcionan.
2. **Given** el diálogo abierto en una ventana baja, **When** la persona lo recorre con la tecla Tab, **Then** cada
   elemento que recibe el foco se desplaza hasta quedar a la vista.

---

### Edge Cases

- Ventana redimensionada (o página ampliada) con el diálogo abierto: el diálogo sigue cabiendo sin volver a abrirlo.
- Ventana muy baja (por ejemplo, 300 px): el contenido se desplaza; nada queda cortado fuera de alcance.
- Ventana estrecha (tamaño móvil o pantalla dividida): el enlace largo de emparejamiento se parte en líneas y el
  diálogo cabe a lo ancho.
- Mientras el código QR se está generando («Preparando el código…») o se muestra un error, el diálogo también cabe.
- La página de detrás del diálogo no debe desplazarse en lugar del diálogo.
- El móvil se conecta mientras la persona ha desplazado el diálogo: el diálogo se sigue cerrando solo, como ahora.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El diálogo de emparejamiento NUNCA DEBE sobresalir por el borde superior ni por el inferior de la
  ventana del navegador.
- **FR-002**: Si el contenido del diálogo es más alto que la ventana, la persona DEBE poder desplazarse hasta
  cualquier parte de él.
- **FR-003**: El código QR DEBE mostrarse entero y con un tamaño que la cámara de un móvil pueda leer (no más pequeño
  que el actual en ventanas con altura suficiente).
- **FR-004**: Los botones «Cerrar» y «Desconectar el móvil» DEBEN poder alcanzarse siempre con ratón, pantalla táctil
  y teclado.
- **FR-005**: En ventanas con altura suficiente para todo el diálogo, DEBE verse entero y centrado, sin barra de
  desplazamiento, igual que los demás diálogos de la aplicación; su contenido y sus acciones no cambian.
- **FR-009**: Con el diálogo abierto, toda la página de detrás DEBE quedar oscurecida y sin poder pulsarse, como con
  los demás diálogos.
- **FR-006**: El diálogo DEBE seguir cabiendo cuando se redimensiona la ventana o cambia la ampliación de la página
  con el diálogo abierto.
- **FR-007**: Los demás diálogos con el mismo patrón de maquetación DEBERÍAN recibir el mismo arreglo, para que el
  defecto no reaparezca en otras pantallas bajas.
- **FR-008**: Una comprobación automática DEBE cubrir la apertura del diálogo en una ventana baja y comprobar que se
  puede llegar al título, al código QR entero y a los botones.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En una ventana de 430 px de alto, un móvil se empareja a la primera en el 100 % de los intentos durante
  las pruebas de aceptación.
- **SC-002**: En ventanas de 300 px a 1080 px de alto, todas las partes del diálogo quedan al alcance (comprobado a
  300, 430, 600 y 1080 px).
- **SC-003**: El personal puede cerrar el diálogo en menos de 5 segundos con cualquiera de esas alturas de ventana.
- **SC-004**: Tras la publicación no llegan nuevos avisos de que el diálogo de emparejamiento se corte.

## Assumptions

- El defecto es una regresión del rediseño de la cabecera (feature 007) y es solo de maquetación; la generación del
  QR, el emparejamiento y la caducidad de la sesión funcionan bien y no cambian.
- En ventanas bajas es aceptable desplazar el contenido del diálogo; reducir el código QR por debajo de un tamaño
  legible no lo es.
- El arreglo se aplica a todas las pantallas que abren el diálogo (está en la cabecera común), no solo a la de
  administración.
- No afecta a ninguna regla regulatoria, de protección de datos ni de trazabilidad; el enlace del QR y los datos de la
  sesión no cambian.
- No hacen falta textos nuevos en la interfaz, así que no hay nuevos textos en español que revisar.
