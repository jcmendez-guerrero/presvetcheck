# Contrato: `GET /api/recepciones` (lista filtrable)

Mismos roles que hoy (`preHandler` de la ruta). **Cambio incompatible**: la respuesta deja de ser un array.

## Parámetros de consulta (todos opcionales)

| Parámetro | Tipo | Por defecto | Significado |
|---|---|---|---|
| `numero` | string 1–60 | — | Nº de albarán o factura contiene (sin mayúsculas). |
| `distribuidorId` | uuid | — | Proveedor. |
| `estado` | lista CSV de `ABIERTA,FINALIZADA,SINCRONIZADA,ERROR_SINCRONIZACION,DESCARTADA` | todos menos `DESCARTADA` | Estados. |
| `recibidaDesde` / `recibidaHasta` | `YYYY-MM-DD` | — | Fecha de recepción, ambos incluidos. |
| `compraDesde` / `compraHasta` | `YYYY-MM-DD` | — | Fecha de compra, ambos incluidos. |
| `registradaDesde` / `registradaHasta` | `YYYY-MM-DD` | — | Fecha de registro en Europe/Madrid, ambos incluidos. |
| `orden` | `albaran\|proveedor\|recibida\|compra\|registrada\|estado` | `registrada` | Columna. |
| `dir` | `asc\|desc` | `desc` | Sentido. Nulos siempre al final. |
| `pagina` | int ≥ 1 | 1 | Página. |
| `porPagina` | int 1–100 | 25 | Filas por página. |

## 200

```json
{
  "filas": [
    {
      "id": "uuid",
      "albaran": "A-1234",
      "proveedor": "Distribuidora Norte",
      "fechaRecepcion": "2026-11-12",
      "fechaCompra": "2026-11-10",
      "registradaAt": "2026-11-12T08:31:00.000Z",
      "estado": "FINALIZADA"
    }
  ],
  "total": 132,
  "pagina": 1,
  "porPagina": 25,
  "proveedores": [{ "id": "uuid", "nombre": "Distribuidora Norte" }]
}
```

`albaran` y `fechaRecepcion` pueden ser `null`. Página fuera de rango → `filas: []` con el `total` real.

## 400

Error de validación estándar de la API (parámetro desconocido en valor, fecha mal formada, `desde > hasta`,
`porPagina > 100`). La web comprueba los rangos antes de enviar.

## Ruta web `/recepciones` (parámetros de búsqueda)

`albaran` (id de documento del móvil, sin cambios) + `numero`, `proveedor` (= `distribuidorId`), `estado`,
`recibidaDesde`, `recibidaHasta`, `compraDesde`, `compraHasta`, `registradaDesde`, `registradaHasta`, `orden`, `dir`,
`pagina`. Los valores no válidos se ignoran.
