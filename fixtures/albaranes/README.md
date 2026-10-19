# Albaranes y facturas de proveedor (lectura con Document Intelligence)

| Fichero | Contenido |
|---|---|
| `sintetico-1.pdf` | Albarán **sintético** (proveedor, cliente y CIF ficticios) generado para las pruebas. |
| `sintetico-1.invoice.json` | Respuesta **real** de Azure AI Document Intelligence (`prebuilt-invoice`, API 2024-11-30, `locale=es-ES`) a `sintetico-1.pdf` (`analyzeResult`). |

Lo que enseña la respuesta real y usa `packages/extraction/src/albaran.ts`:

- Cabecera: `VendorName`, `InvoiceId` (nº de albarán o factura) e `InvoiceDate` (`valueDate`).
- Líneas en `Items.valueArray[].valueObject`: `ProductCode`, `Description`, `Quantity` (`valueNumber`),
  `UnitPrice` y `Amount` (`valueCurrency.amount`). A veces falta `Quantity`: se deduce de importe ÷ precio.
- El lote y la caducidad no son campos del modelo: se leen de la línea de texto de la fila (`Lote …`,
  `Cad. MM/AAAA`).

No se versionan albaranes ni facturas reales (datos de terceros). Para añadir casos reales, analízalos y guarda
solo la respuesta anonimizada.
