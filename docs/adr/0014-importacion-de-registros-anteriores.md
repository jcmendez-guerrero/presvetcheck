# ADR-14 · Importación de entradas y salidas anteriores a la app

- **Estado:** aceptada (19/10/2026)

## Contexto
La farmacia lleva el registro de entradas y salidas en Excel desde antes de la app. Los informes e inspecciones
cubren 5 años, así que esos datos tienen que poder consultarse y exportarse junto con los nuevos.

## Decisión
- Se importan ficheros **XLSX o CSV con las mismas columnas que exporta la app** (registro de entradas; salidas en
  las plantillas A, B o C o en el informe «Todas las salidas»), reconocidas por su nombre y en cualquier orden.
- Dos pasos: **analizar** (columnas reconocidas, errores fila a fila, sin guardar) e **importar**, que solo se
  hace si el fichero no tiene errores. El mismo fichero (hash) no se importa dos veces.
- Lo importado va a tablas propias (`importacion`, `entrada_importada`, `salida_importada`), **de solo inserción**
  (trigger): no se mezcla con las dispensaciones y recepciones hechas en la app ni con su conciliación. Aparece en
  los registros e informes con origen «importado»; en las salidas, la conciliación es «no aplica».
- Cada fila se valida contra CIMAVet y se guarda con **sus datos** (nombre, principio activo y forma), no con lo
  escrito a mano: por código nacional o, sin él, por el nombre si CIMAVet lo reconoce sin dudas (con aviso). Las
  importaciones anteriores a este cambio se corrigen con el job `importaciones-corregir` (crea una importación
  corregida y anula la original).
- Una importación equivocada se **anula** con motivo (deja de contar; sigue guardada y auditada). Los datos del
  propietario de las salidas se guardan cifrados. Se purgan a los 5 años de la fecha del movimiento.
- Solo pueden importar la veterinaria responsable y administración.

## Consecuencias
- El registro de psicótropos no incluye lo importado (sus saldos por lote empiezan con la app).
