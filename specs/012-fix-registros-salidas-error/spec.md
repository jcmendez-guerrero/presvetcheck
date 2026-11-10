# Feature Specification: Los registros de salidas fallan con «Se ha producido un error»

**Feature Branch**: `012-fix-registros-salidas-error`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "There is a bug in the system when trying to check the registries:
`GET /api/registros/movimientos?desde=2026-11-01&hasta=2026-11-10&plantilla=A&formato=json&incluirPropietario=0`
responde `ERROR_INTERNO` («Se ha producido un error. Inténtalo de nuevo.»)" (entorno NP; URL del entorno omitida
porque el repositorio es público).

## Contexto

En la pantalla **Registros y reportes**, al pulsar «Ver entradas y salidas» para el periodo 01/11/2026–10/11/2026 la
app muestra «Se ha producido un error. Inténtalo de nuevo.» y no enseña nada. Reintentar no lo arregla.

Diagnóstico (registro de la API en NP, 2026-11-10): el fallo está en la consulta de **salidas**, no en la de
entradas. Desde la alta manual de recetas (specs/011), una salida cuenta en el registro en su *fecha de registro*
(la fecha original de la entrega si se dio de alta a posteriori; si no, la de la venta). El filtro por periodo
compara esa fecha calculada con los límites del periodo sin indicar a la base de datos qué tipo de dato son; la base
de datos de producción rechaza la consulta, mientras que la base de datos en memoria de los tests la acepta. Por eso
los tests pasan y el entorno real falla.

Ese mismo filtro lo usan todos los informes de salidas y el libro de psicótropos, así que el fallo no es solo de
«Ver entradas y salidas»: afecta a todas las vistas y descargas que incluyen salidas.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultar y descargar los registros de salidas de un periodo (Priority: P1)

La veterinaria responsable (o administración) elige un periodo en **Registros y reportes** y consulta o descarga las
salidas (plantillas A, B o C, «Todas las salidas», «Ver entradas y salidas» y sus Excel/CSV). Ve las salidas del
periodo, cada una en su fecha de registro, sin errores.

**Why this priority**: Es el registro legal de salidas de medicamentos veterinarios. Si no se puede consultar ni
exportar, la farmacia no puede atender una inspección ni llevar el libro al día.

**Independent Test**: Con salidas normales y salidas de alta manual en el periodo, abrir cada vista/descarga de
salidas en un entorno con la misma base de datos que producción y comprobar que responde con las filas esperadas.

**Acceptance Scenarios**:

1. **Given** un periodo con salidas registradas, **When** se pulsa «Ver entradas y salidas», **Then** se muestran
   entradas y salidas juntas por fecha, sin mensaje de error.
2. **Given** el mismo periodo, **When** se pulsa «Ver salidas», «Salidas XLSX», «Salidas CSV», «Todas las salidas»,
   «Todas las salidas XLSX» o «Entradas y salidas XLSX», **Then** cada una responde con sus datos o su fichero.
3. **Given** una salida dada de alta a mano con fecha original anterior al periodo, **When** se consulta el periodo,
   **Then** esa salida no aparece; **and** al consultar el periodo de su fecha original, sí aparece en ese día.
4. **Given** una salida normal hecha el último día del periodo a última hora (hora de Madrid), **When** se consulta
   el periodo, **Then** aparece; una hecha al día siguiente a las 00:30 (Madrid) no aparece.
5. **Given** un periodo sin salidas, **When** se consulta, **Then** se muestra la tabla vacía, no un error.

---

### User Story 2 - Consultar el libro de psicótropos (Priority: P2)

La veterinaria responsable abre «Registro de psicótropos» para el periodo y ve los movimientos de psicótropos,
incluidas las anulaciones en el día en que se anulan.

**Why this priority**: Usa el mismo filtro por fecha que falla; es un libro legal pero de uso menos frecuente que el
de salidas.

**Independent Test**: Con una salida de psicótropo y su anulación en el periodo, abrir el registro de psicótropos y
sus descargas en un entorno con la misma base de datos que producción.

**Acceptance Scenarios**:

1. **Given** salidas de psicótropos en el periodo, **When** se abre «Registro de psicótropos» (pantalla, XLSX o
   CSV), **Then** se muestran sin error.
2. **Given** una salida de psicótropo anulada otro día, **When** se consulta el periodo de la anulación, **Then** la
   anulación aparece en el día en que se anuló.

---

### User Story 3 - Que este tipo de fallo no vuelva a llegar a producción sin detectarse (Priority: P3)

El equipo quiere que una consulta de registros que funciona en los tests y falla en la base de datos real se detecte
antes de desplegar.

**Why this priority**: El fallo pasó todos los tests porque la base de datos de pruebas es más permisiva que la real.

**Independent Test**: Ejecutar las pruebas de integración de registros contra la misma base de datos que producción
y comprobar que fallan sin la corrección y pasan con ella.

**Acceptance Scenarios**:

1. **Given** el código anterior a la corrección, **When** se ejecutan las pruebas de integración de registros contra
   la base de datos real, **Then** fallan.
2. **Given** el código corregido, **When** se ejecutan, **Then** pasan.

### Edge Cases

- Periodo que cruza un cambio de hora (último domingo de octubre o de marzo): las salidas caen en su día de Madrid.
- Salida de alta manual con fecha original igual al primer o al último día del periodo: se incluye.
- Salida de alta manual y salida normal el mismo día: ambas aparecen, ordenadas por fecha de registro.
- Anulación de una salida de alta manual: en el libro de psicótropos cuenta el día de la anulación, no la fecha
  original.
- «Incluir datos del propietario» marcado o no: no cambia que la consulta funcione.
- Si una consulta de registros falla por otra causa, el registro técnico debe conservar la causa real del fallo (sin
  datos personales), no solo el texto de la consulta.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Todas las vistas y descargas de salidas (plantillas A/B/C, todas las salidas, entradas y salidas, en
  pantalla, XLSX y CSV donde aplique) MUST responder correctamente para cualquier periodo válido.
- **FR-002**: El registro de psicótropos (pantalla, XLSX y CSV) MUST responder correctamente para cualquier periodo
  válido.
- **FR-003**: Cada salida MUST contar en su fecha de registro: la fecha original si se dio de alta a mano con fecha
  pasada; si no, la fecha de la venta. Los límites del periodo MUST interpretarse en hora de Madrid. (Sin cambios de
  regla respecto a specs/011: solo se corrige el fallo.)
- **FR-004**: En el libro de psicótropos, una anulación MUST contar el día en que se anula.
- **FR-005**: Las pruebas automáticas de los registros de salidas y psicótropos MUST ejecutarse también contra el
  mismo motor de base de datos que producción, de modo que este fallo se detecte antes de desplegar.
- **FR-006**: Cuando una consulta de registros falle, el registro técnico MUST incluir la causa original del error
  devuelta por la base de datos, sin datos personales.
- **FR-007**: El mensaje al usuario ante un error inesperado MUST seguir siendo el genérico actual (sin detalles
  técnicos).

### Key Entities

- **Salida (dispensación)**: entrega de un medicamento; tiene fecha de venta y, si se dio de alta a mano, fecha
  original. Su *fecha de registro* decide en qué periodo cuenta.
- **Periodo de consulta**: fechas «desde» y «hasta» (ambas incluidas) en hora de Madrid.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de las vistas y descargas de salidas y de psicótropos responden sin error en el entorno NP
  para el periodo 01/11/2026–10/11/2026 y para un periodo sin datos.
- **SC-002**: Las salidas mostradas para un periodo coinciden una a una con las esperadas según su fecha de registro
  (0 de más, 0 de menos) en los casos de aceptación.
- **SC-003**: Al reintroducir el fallo, al menos una prueba automática falla antes de desplegar.
- **SC-004**: Ante un error de consulta, el registro técnico permite identificar la causa sin reproducirlo (sin
  datos personales).

## Assumptions

- El fallo se limita a las consultas que filtran por la fecha de registro calculada (salidas y psicótropos);
  entradas y bajas no usan ese filtro y no se tocan salvo que las pruebas demuestren lo contrario.
- Las reglas de qué fecha cuenta (specs/011) son correctas; solo se corrige cómo se aplica el filtro.
- Ya existe infraestructura de pruebas de integración contra la base de datos real (`pnpm test:int`); se reutiliza.
- No hace falta migrar datos: los datos guardados son correctos.
- Tras corregirlo hay que desplegar en NP y repetir la consulta del informe original para cerrarlo.
