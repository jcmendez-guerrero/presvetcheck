# Fixtures de CIMAVet

`docs/ref/CIMAVet_REST_API.md` (v1.4) describe los **campos** de cada tipo devuelto, pero no incluye
respuestas JSON de ejemplo ni el envoltorio de las listas paginadas. Estas fixtures se han construido
**solo** con:

- los nombres de campo de las tablas de la especificación, respetando sus mayúsculas inconsistentes
  (`Comerc`, `Id`, `tipoMedicamento`, `principiosActivos`…), para probar la normalización;
- valores reales del Nomenclátor (`fixtures/nomenclator/`): CLAVUBAY (1868 ESP, CN 570016) y
  AEROFAR (1077 ESP, CN 570004).

Lo que **no** se sabe y queda pendiente de una respuesta real (`it.todo` en
`packages/cimavet/test/client.test.ts`):

- envoltorio de las listas paginadas (array directo u objeto con metadatos de paginación);
- formato exacto de las fechas (`primeraAutorizacion` dice "Unix timestamp"; estado `aut/susp/rev` dice "Fecha");
- campo de tejido en `tiemposEspera` (la tabla de la doc no lo incluye);
- si `PrincipioActivo.unidad` incluye la base de la concentración (p. ej. "mg/ml").

**Para completar:** guardar aquí respuestas reales (`GET medicamento?nregistro=1868 ESP`,
`GET medicamentos?nombre=amoxicilina&pagina=1`, `GET presentaciones?nregistro=1868 ESP`,
`GET registroCambios?fecha=…`, `GET maestras?maestra=7`) y sustituir estas fixtures.
