# Data Model: coste de proveedor en Siweb360

## Cambios de esquema (migración `0022_distribuidor_siweb_contacto`)

| Tabla | Cambio | Detalle |
|---|---|---|
| `distribuidor` | `siweb_contact_id integer NULL` | Contacto proveedor de Siweb360 recordado. Sin datos personales (identificador de empresa). Índice no único (dos distribuidores podrían compartir contacto tras una fusión; se valida en la acción de vincular). |
| `outbox` | sin cambio de esquema | Nuevo valor de `status`: `needs_supplier`. Nueva `operation`: `siweb_actualizar_coste_proveedor`. |

Reversible: la columna es nula por defecto y puede borrarse sin pérdida.

## Operación del outbox: `siweb_actualizar_coste_proveedor`

- **Clave de idempotencia**: `MMX-PRV-{recepcionId}-L{numeroLinea}` (única; `onConflictDoNothing`).
- **Entidad**: `recepcion_linea`, `entidadId = linea.id`.
- **Payload** (zod en `packages/siweb`):
  - `variant_id: number`
  - `distribuidor_id: uuid`
  - `cost_cents: number` (≥ 0; céntimos calculados con `decimal.js`)
  - `product_id?: number` (se rellena al resolver, para auditoría)
  - `contact_id?: number` (ídem)
- **Se encola si**: modo de escritura ≠ `off`, la recepción no se finaliza «sin precios», la línea es de
  medicamento, tiene coste (`precio_coste` o `precio_neto_compra` no nulo) y `siweb_variant_id` no es nulo.
  **No depende** de `actualizar_precio` ni de `actualizar_stock`.
- **Diferida**: si la línea está en `PENDIENTE_ALTA_SIWEB`, se encola al vincular la variante
  (`reencolarPendientesAlta`), igual que el coste de variante, pero sin mirar la casilla.

### Estados (`outbox.status`)

```text
pending ──envío ok──────────────▶ sent
   │ ├─4xx──────────────────────▶ failed
   │ ├─timeout/5xx/ambiguo──────▶ needs_reconciliation   (sin reintento automático)
   │ └─proveedor no resuelto────▶ needs_supplier ──vincular proveedor / barrido diario──▶ pending
```

`needs_supplier` guarda en `last_error` el motivo estable: `SIN_CIF`, `SIN_COINCIDENCIA`, `VARIAS_COINCIDENCIAS`,
`PROVEEDOR_INEXISTENTE` (el código se traduce a español en la UI).

## Entidades (de la spec)

- **Línea de recepción**: sin cambios de columnas. Se reutilizan `precio_coste`, `precio_neto_compra`,
  `siweb_variant_id`, `actualizar_precio` (solo gobierna el coste de variante y el de referencia).
- **Distribuidor**: gana `siweb_contact_id`; ya tiene `cif`.
- **Mapa variante↔producto** (`siweb_variant_map`): `product_id` ya existe; se completa si es nulo.

## Validaciones
- `cost_cents` ≥ 0 y finito; nunca se envía `null` (no se borra un coste existente: FR-004).
- CIF normalizado (mayúsculas, sin separadores, sin `ES`) para comparar.
- Vincular proveedor: el contacto debe existir en Siweb360 como `Proveedor`; si el CIF del contacto no coincide con
  el del distribuidor se pide confirmación explícita y queda en auditoría.
