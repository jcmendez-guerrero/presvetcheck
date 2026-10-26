# ADR-15 · Corrección de la unidad «µg» del Nomenclátor y corrección de importaciones con CIMAVet

- **Estado:** aceptada (26/10/2026)

## Contexto
- El diccionario `DICCIONARIO_UNIDAD_COMPOSICION.xml` del Nomenclátor de la AEMPS trae **«l»** en el código 3.
  Los principios activos con ese código son, sin embargo, microgramos: 227 de los 306 medicamentos que lo usan
  llevan «microgramos» o «µg» en el nombre (CANITROID 400 microgramos, GALASTOP 50 microgramos/ml…) y la **API de
  CIMAVet** devuelve `unidad: "µg"` para todos los comprobados el 26/10/2026 (también vacunas sin la unidad en el
  nombre: LEUCOGEN, IMPROVAC, BLUEVAC…). Con «l» la app escribía «400 l» en el registro y comparaba mal la
  concentración al buscar equivalentes.
- Se importaron 173 salidas anteriores con el nombre, el principio activo y la forma del Excel de la farmacia, que
  no coinciden con CIMAVet. Las filas importadas son de solo inserción (ADR-14).

## Decisión
- Al leer el Nomenclátor, el código 3 de la **unidad del principio activo** se toma como «µg»
  (`CORRECCION_UNIDAD_PRINCIPIO_ACTIVO`). No se cambia en otros usos del diccionario (base de concentración,
  contenido del envase), donde no está comprobado. Se recarga el Nomenclátor para corregir la caché.
- Job `importaciones-corregir`: pone nombre, principio activo y forma según el código nacional en CIMAVet. No
  modifica filas: crea una importación corregida (los datos del propietario se copian cifrados tal cual) y anula la
  original con el motivo. Sin `--aplicar` solo informa.

## Consecuencias
- Si la AEMPS corrige su diccionario, la corrección no cambia nada (el valor ya será «µg»).
- La importación original sigue guardada y auditada; los registros e informes solo cuentan la corregida.
