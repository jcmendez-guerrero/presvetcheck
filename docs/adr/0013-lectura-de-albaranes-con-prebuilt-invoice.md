# ADR-13 · Lectura de albaranes y facturas de proveedor con `prebuilt-invoice`

- **Estado:** aceptada (19/10/2026)

## Contexto
Registrar una entrada exige teclear o escanear cada línea del albarán. Los albaranes y facturas de los
distribuidores son documentos comerciales con estructura de factura (proveedor, número, fecha y tabla de
productos con código, descripción, cantidad y precio), muy distintos entre proveedores.

## Decisión
- Se usa el modelo **precompilado `prebuilt-invoice`** del mismo recurso de Azure AI Document Intelligence que lee
  las recetas (ADR-12), sin entrenamiento: cabecera (`VendorName`, `InvoiceId`, `InvoiceDate`) y líneas (`Items`:
  `ProductCode`, `Description`, `Quantity`, `UnitPrice`, `Amount`).
- El lote y la caducidad no son campos del modelo: se leen de la línea de texto de cada fila (`Lote …`, `Cad.`).
  Sin cantidad leída, se deduce de importe ÷ precio si da un número entero.
- El resultado es una **propuesta**: no se añade ninguna línea sola. Cada línea se copia al formulario y la
  persona la comprueba con el envase (escaneo del DataMatrix); la API valida lo de siempre (CIMAVet, entrada
  caducada, campos obligatorios). El medicamento se identifica por código nacional o, si no, por nombre solo si
  la marca coincide.
- El documento se guarda en el contenedor privado `albaranes` como justificante de la entrada.
- En modo `EXTRACTOR=fake` (demo y tests) se devuelve la lectura de la fixture sintética.

## Consecuencias
- La estructura se ha comprobado con una respuesta real del servicio a un albarán sintético
  (`fixtures/albaranes/`). Con albaranes reales de los distribuidores habituales puede hacer falta afinar la
  lectura del lote y la caducidad; si un proveedor no encaja, se puede entrenar un modelo propio como en ADR-12.
