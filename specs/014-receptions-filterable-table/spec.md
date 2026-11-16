# Feature Specification: Tabla filtrable de recepciones de mercancía

**Feature Branch**: `014-receptions-filterable-table`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "In the receptions section it is needed to change the list of the receptions to a table that can be actually filtered, the table should show the Albaran/Factura , Provider, Date received, Purchase date, Date registered and Status."

## Context

Hoy la sección **Recepciones** muestra las recepciones como una lista de enlaces en una sola línea
(«Compra 12/11/2026 · recibida 13/11/2026 · A-1234 · FINALIZADA»). Esa lista:

- solo enseña las 50 recepciones más recientes, así que una recepción antigua no se puede encontrar;
- no muestra el proveedor;
- enseña el estado con el código interno (`FINALIZADA`, `ERROR_SINCRONIZACION`) en lugar de un texto claro;
- no permite filtrar ni ordenar.

Esta funcionalidad sustituye esa lista por una tabla con columnas que el personal puede filtrar y ordenar. Lo que
pasa al abrir una recepción y el alta de recepciones nuevas no cambia.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver las recepciones en una tabla con columnas claras (Priority: P1)

Una persona de la farmacia entra en Recepciones y ve una tabla con una fila por recepción y estas columnas:
**Nº de albarán o factura**, **Proveedor**, **Fecha de recepción**, **Fecha de compra**, **Fecha de registro**
y **Estado**. Al pulsar una fila se abre esa recepción, igual que ahora.

**Why this priority**: es la base de todo lo demás. Por sí sola ya mejora la lista actual porque muestra el
proveedor y un estado fácil de entender.

**Independent Test**: con varias recepciones de distintos proveedores y estados, abrir Recepciones y comprobar que
cada fila tiene las seis columnas con los valores correctos y que al pulsarla se abre su detalle.

**Acceptance Scenarios**:

1. **Given** una recepción del proveedor «Distribuidora Norte» con albarán «A-1234», comprada el 10/11/2026,
   recibida el 12/11/2026 y registrada el 12/11/2026, **When** se abre Recepciones, **Then** su fila muestra
   «A-1234», «Distribuidora Norte», «12/11/2026», «10/11/2026», «12/11/2026» y su estado en texto claro.
2. **Given** una recepción sin número de albarán ni fecha de recepción, **When** se muestra en la tabla, **Then**
   esas celdas dicen «Sin albarán» y «—» en lugar de quedar vacías.
3. **Given** una recepción en estado de error al enviar, **When** se muestra en la tabla, **Then** el estado se lee
   como texto claro (p. ej. «Error al enviar») y se distingue visualmente de las demás.
4. **Given** la tabla con recepciones, **When** se pulsa (o se activa con el teclado) una fila, **Then** se abre el
   detalle de esa recepción.

---

### User Story 2 - Filtrar para encontrar una recepción concreta (Priority: P1)

La persona necesita encontrar una recepción concreta (p. ej. para responder a un proveedor o revisar una factura)
y filtra por número de albarán o factura, por proveedor, por estado o por rango de cualquiera de las tres fechas.
Los filtros buscan en **todas** las recepciones, no solo en las más recientes.

**Why this priority**: es lo que pide expresamente el usuario («a table that can be actually filtered») y lo que la
lista actual no permite.

**Independent Test**: con más de 50 recepciones, filtrar por el número de albarán de una recepción antigua y
comprobar que aparece; combinar proveedor y estado y comprobar que solo quedan las que cumplen ambos.

**Acceptance Scenarios**:

1. **Given** una recepción antigua con albarán «F-2025-0099» que no está entre las 50 más recientes, **When** se
   escribe «0099» en el filtro de albarán o factura, **Then** aparece esa recepción.
2. **Given** recepciones de varios proveedores, **When** se elige «Distribuidora Norte» en el filtro de proveedor,
   **Then** solo se muestran las recepciones de ese proveedor.
3. **Given** recepciones en varios estados, **When** se eligen los estados «Abierta» y «Error al enviar», **Then**
   solo se muestran las recepciones en alguno de esos dos estados.
4. **Given** un rango de fecha de recepción del 01/11/2026 al 15/11/2026, **When** se aplica, **Then** solo se
   muestran las recepciones recibidas entre esos días, ambos incluidos.
5. **Given** varios filtros a la vez, **When** se aplican, **Then** la tabla muestra solo las recepciones que cumplen
   todos ellos.
6. **Given** filtros que no coinciden con ninguna recepción, **When** se aplican, **Then** la tabla dice que no hay
   recepciones con esos filtros y ofrece quitarlos.
7. **Given** filtros aplicados, **When** se pulsa «Quitar filtros», **Then** la tabla vuelve a mostrar todas las
   recepciones (salvo las descartadas).

---

### User Story 3 - Ordenar y conservar los filtros al volver (Priority: P2)

La persona ordena la tabla por cualquier columna y, tras abrir una recepción y volver atrás, encuentra la tabla
con los mismos filtros, orden y página.

**Why this priority**: evita repetir la búsqueda cada vez que se revisan varias recepciones seguidas, pero la tabla
ya es útil sin ello.

**Independent Test**: filtrar y ordenar, abrir una recepción, volver atrás y comprobar que filtros, orden y página
se mantienen; copiar la dirección en otra pestaña y ver el mismo resultado.

**Acceptance Scenarios**:

1. **Given** la tabla sin orden elegido, **When** se abre, **Then** aparecen primero las recepciones registradas
   más recientemente.
2. **Given** la tabla, **When** se pulsa la cabecera «Fecha de compra», **Then** se ordena por esa fecha y una
   segunda pulsación invierte el orden.
3. **Given** filtros y orden aplicados, **When** se abre una recepción y se vuelve atrás, **Then** la tabla conserva
   los filtros, el orden y la página.

---

### Edge Cases

- **Muchas recepciones**: la tabla se muestra por páginas (25 filas por defecto) e indica cuántas recepciones
  cumplen los filtros en total.
- **Recepciones descartadas**: no se muestran por defecto (como hoy); se pueden ver eligiendo el estado
  «Descartada» en el filtro, para no perder la trazabilidad.
- **Rango de fechas al revés** («desde» posterior a «hasta»): no se aplica y se avisa con un mensaje claro.
- **Solo «desde» o solo «hasta»**: se acepta un rango abierto por un lado.
- **Búsqueda de albarán**: no distingue mayúsculas, minúsculas ni espacios al principio o al final, y encuentra
  coincidencias parciales.
- **Fechas en el límite del día**: la fecha de registro se interpreta en hora de Madrid, de modo que una recepción
  registrada a las 00:30 del 16/11 (hora de Madrid) cae en el 16/11 aunque en UTC sea el 15/11.
- **Error al cargar**: si la tabla no se puede cargar se muestra un mensaje claro con opción de reintentar, sin
  perder los filtros escritos.
- **Pantalla estrecha**: en pantallas pequeñas la tabla sigue siendo legible (desplazamiento horizontal o columnas
  apiladas) y las seis columnas siguen accesibles.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La sección Recepciones MUST mostrar las recepciones en una tabla con las columnas, en este orden:
  Nº de albarán o factura, Proveedor, Fecha de recepción, Fecha de compra, Fecha de registro y Estado.
- **FR-002**: Las fechas MUST mostrarse en formato dd/mm/aaaa; las celdas sin dato MUST mostrar un texto claro
  («Sin albarán», «—») en lugar de quedar vacías.
- **FR-003**: El estado MUST mostrarse con un texto claro en español (Abierta, Finalizada, Enviada, Error al enviar,
  Descartada), nunca con el código interno, y los estados que piden atención (Abierta, Error al enviar) MUST
  distinguirse visualmente sin depender solo del color.
- **FR-004**: Cada fila MUST abrir el detalle de su recepción al pulsarla o activarla con el teclado.
- **FR-005**: Los usuarios MUST poder filtrar por: Nº de albarán o factura (texto parcial, sin distinguir
  mayúsculas), proveedor (uno), estado (uno o varios) y rango de fechas (desde/hasta) para la fecha de recepción,
  la fecha de compra y la fecha de registro.
- **FR-006**: Los filtros MUST aplicarse sobre todas las recepciones guardadas, no solo sobre las más recientes, y
  MUST combinarse entre sí (todas las condiciones a la vez).
- **FR-007**: Por defecto la tabla MUST ocultar las recepciones descartadas; MUST poder verse eligiendo ese estado en
  el filtro.
- **FR-008**: La tabla MUST poder ordenarse por cualquiera de sus columnas, ascendente o descendente; el orden por
  defecto MUST ser fecha de registro, de la más reciente a la más antigua.
- **FR-009**: La tabla MUST paginarse e indicar el número total de recepciones que cumplen los filtros.
- **FR-010**: Los filtros, el orden y la página MUST conservarse al abrir una recepción y volver atrás, y MUST poder
  compartirse copiando la dirección de la página.
- **FR-011**: MUST existir una acción «Quitar filtros» que devuelva la tabla a su estado por defecto, y un mensaje
  claro cuando ningún resultado cumple los filtros.
- **FR-012**: Un rango con «desde» posterior a «hasta» MUST rechazarse con un mensaje claro, sin aplicar el filtro.
- **FR-013**: Las fechas de registro MUST compararse en hora de Madrid (Europe/Madrid).
- **FR-014**: La tabla MUST ser usable con teclado y lector de pantalla (cabeceras de columna asociadas, orden
  anunciado, filtros con etiqueta).
- **FR-015**: Quien hoy puede ver la lista de recepciones MUST poder ver la tabla; no se amplían los permisos ni se
  muestran datos que hoy no se muestran fuera del detalle de la recepción.
- **FR-016**: El resto de la sección (crear una recepción nueva, abrir una desde el móvil, el detalle) MUST seguir
  funcionando igual.

### Key Entities *(include if feature involves data)*

- **Recepción**: entrada de mercancía de un proveedor. Atributos que se muestran: nº de albarán o factura
  (opcional), proveedor, fecha de compra, fecha de recepción (opcional), fecha de registro (cuándo se dio de alta
  en la aplicación) y estado.
- **Proveedor (distribuidor)**: empresa que vende la mercancía; se muestra por su nombre y sirve de filtro.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona encuentra una recepción concreta por su nº de albarán o factura, sea cual sea su
  antigüedad, en menos de 20 segundos.
- **SC-002**: El 100 % de las recepciones guardadas (no descartadas) se pueden localizar desde la tabla; hoy solo
  las 50 más recientes.
- **SC-003**: Con 5.000 recepciones guardadas, la tabla muestra el resultado de un cambio de filtro en menos de
  1 segundo en el uso habitual.
- **SC-004**: Ninguna celda de estado muestra un código interno; el personal identifica el estado de cada
  recepción sin ayuda.
- **SC-005**: Tras abrir una recepción y volver atrás, el 100 % de las veces se conservan filtros, orden y página.

## Assumptions

- **Fecha de registro** es el momento en que la recepción se dio de alta en la aplicación (no cuándo se finalizó).
  Si se quisiera la fecha de finalización, sería una columna distinta.
- **Proveedor** es el distribuidor asociado a la recepción; el filtro ofrece los proveedores que tienen al menos una
  recepción.
- El filtro de albarán busca en el número de albarán o factura que figura en la cabecera, no en el texto leído del
  documento escaneado.
- Las recepciones descartadas siguen ocultas por defecto, como en la lista actual.
- Tamaño de página por defecto: 25 filas.
- No se añade exportación a Excel/CSV desde esta tabla: los registros oficiales de entradas ya se exportan en
  Registros.
- No cambia ningún dato ni regla de negocio: es una mejora de consulta; no hay movimientos de stock ni auditoría
  nuevos.
