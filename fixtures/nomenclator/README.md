# Nomenclátor Veterinario (no versionado)

Los XML de CIMAVet **no se guardan en git**. Se descargan del enlace oficial publicado en
<https://cimavet.aemps.es/cimavet/publico/nomenclator.html> (`NOMENCLATOR_URL`, por defecto
`https://listadomedicamentos.aemps.gob.es/prescripcionVET.zip`):

```bash
pnpm nomenclator:fetch             # descarga y genera la muestra de tests
pnpm nomenclator:fetch --si-falta  # solo si faltan (lo usan `pnpm dev`, `pnpm demo` y la CI)
```

El zip trae `PrescripcionVET.xml` (~140 MB), `PrescripcionVETDatosBasicos.xml`,
`AUTORIZACION_ESPECIAL_MEDICAMENTOS.xml` y los `DICCIONARIO_*.xml`. El script genera además
`PrescripcionVET.sample.xml`: copia literal de registros reales (todas las presentaciones de los
`nregistro` que usan los tests y ejemplos de psicótropos, estupefacientes, tiempos de espera con
`no_aplica_tejido`, suspendidos y dispensación fraccionada). Si un `nregistro` usado por los tests
desaparece del Nomenclátor, el script falla indicándolo.

En producción el job `nomenclator-import --descargar` (y `cimavet-full --descargar`) descarga el zip a
un directorio temporal, lo importa y lo borra.

Las respuestas JSON de la API REST que usan los tests se **derivan de estos XML**
(`packages/cimavet/test/api-desde-xml.ts`) con la forma observada en la API real
(`docs/ref/cimavet-respuestas.md`).
