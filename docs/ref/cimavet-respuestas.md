# CIMAVet REST: forma observada de las respuestas

Observada el 14/10/2026 con peticiones manuales a `https://cimavet.aemps.es/cimavet/rest/`
(`medicamento?nregistro=1868 ESP`, `medicamento?nregistro=1077 ESP`, `presentaciones?nregistro=…`,
`presentacion/570016`, `registroCambios?fecha=01/10/2026`, `maestras?maestra=7`, `notas/…`).
Solo se documenta la **forma**; los tests generan los valores desde el Nomenclátor XML
(`packages/cimavet/test/api-desde-xml.ts`). Resuelve las incógnitas de la doc v1.4.

## Diferencias con la especificación v1.4

| Tema | Doc v1.4 | API real |
|---|---|---|
| Listas paginadas | sin especificar | `{ totalFilas, pagina, tamanioPagina (25), resultados: [] }`; una página fuera de rango devuelve `resultados: []` |
| Fechas | "Unix timestamp" / "Fecha" | milisegundos epoch de la **medianoche de Madrid** (1207778400000 = 2008-04-10 00:00 CEST) |
| Forma farmacéutica | `forma` | `formasFarmaceuticas: [{ id, nombre }]` |
| Mayúsculas | `Comerc`, `Id` | `comerc`, `id` (el cliente sigue normalizando por tolerancia) |
| `registroCambios` | `cambios` | `cambio: [string]`, `fecha` en ms, `tipoCambio` |
| `notas/:nregistro` sin notas | sin especificar | **404 con HTML** → se trata como lista vacía |
| Tiempos de espera | sin tejido | `{ especie{id,nombre}, tejido{id,nombre}, cantidad, formaFarmaceutica{id,nombre}, viaAdministracion{id,nombre}, unidadTiempo{id,nombre} }` (tejido/cantidad/unidad ausentes cuando no aplica) |
| Composición | `unidad` | `unidad` sin base de concentración ("mg"): la base solo está en el Nomenclátor |
| Fraccionada | — | la API **no** expone `sw_dispensacion_fraccionada` ni `fracciones_autorizadas`: solo el Nomenclátor |

## `GET medicamento`

```
nregistro, nombre, pactivos ("A;B"), excip, labtitular, labcomercializador,
dispensacion{id,nombre}, tipoMedicamento{id,nombre}, administracion{id,nombre},
primeraAutorizacion(ms), estado{aut[,susp][,rev]}(ms), comerc, psum, receta, estupefaciente,
psicotropo, antibiotico, notas, ema, docs[{tipo,url,secc,fecha}],
atcs[{codigo,nombre,nivel,antibiotico}], formasFarmaceuticas[{id,nombre}],
principiosActivos[{id,codigo,nombre,cantidad,unidad,orden}], excipientes[…],
viasAdministracion[{id,nombre}], especies[{id,nombre}],
indicaciones[{especie?{id,nombre},id,nombre}], contraindicaciones[…], interacciones[…],
reaccionesAdversas[…], tiemposEspera[…], presentaciones[{cn,nombre,estado,comerc,psum}]
```

## `GET presentaciones` / `presentacion/:cn`

Cada presentación repite los datos del medicamento (`nregistro, cn, nombre, pactivos, labtitular,
dispensacion, estado, comerc, receta, estupefaciente, psicotropo, docs, principiosActivos…`).

## Nomenclátor (descarga)

`https://listadomedicamentos.aemps.gob.es/prescripcionVET.zip` (enlazado desde
`cimavet/publico/nomenclator.html`). Requiere un `User-Agent` de navegador (sin él responde 403).
