# Contrato API: escritura de stock y conciliación de movimientos (feature 011)

Esquemas zod en `packages/shared`; los roles se comprueban en la API (`requiereRol`). Errores con `DomainError.code`
estable; la UI traduce el código.

## Outbox

### `POST /api/outbox/:id/cerrar` — nuevo · roles `operativa` + `admin`

```json
{ "accion": "revisado" | "resuelto_a_mano", "nota": "string (≥ 5)" }
```

- 200 `{ ok: true }`. 409 `CONFLICTO` si la fila no está en `needs_reconciliation` o `failed`.
- Auditoría `outbox_cerrar_{accion}` con autor, nota y estado anterior.

### `POST /api/admin/outbox/:id/resolver` — existente · `admin`

Sin cambios (`confirmar_aplicada` | `reenviar` | `descartar`).

### `GET /api/admin/outbox` — existente · `admin`; amplía cada fila con

```json
{
  "verificaciones": 3,
  "proximaComprobacion": "ISO | null",
  "evidencia": "No consta en Siweb360 a … | Posible duplicado … | null"
}
```

### `GET /api/outbox/revision` — nuevo · `operativa` + `admin`

Lista para la bandeja de usuarios: filas `needs_reconciliation`/`failed` de entradas con CN, nombre, lote, unidades,
recepción, `evidencia` y stock actual. Sin payload crudo.

## Prueba de escritura

### `POST /api/admin/siweb/prueba-escritura` — nuevo · `admin`

```json
{ "sku": "TEST-…", "confirmacion": "SI" }
```

- 400 `SKU_NO_TEST` si el SKU no empieza por `TEST-`; 400 si `confirmacion !== "SI"`.
- 200 `{ ok, coherente, historialOk, lote, variantId, movimientos: [ids] }`; siempre se audita (`siweb_prueba_escritura`).
- Escribe +1 y −1 en Siweb360 con `notes = MMX-SPIKE-{AAAAMMDD}-ENTRADA / -REVERSION`. Única ruta que escribe una salida, y solo sobre `TEST-`.

### `GET /api/admin/estado-stock` — nuevo · `admin`

```json
{
  "escrituraStock": "off | entries_only",
  "fechaCorte": "AAAA-MM-DD | null",
  "almacenStock": "Farmacia",
  "ultimaPruebaEscritura": "ISO | null",
  "pruebaEscrituraVigente": true,
  "outbox": { "pendientes": 0, "fallidos": 0, "enRevision": 0 },
  "movimientosSinJustificar": 0
}
```

No se añade a `GET /api/config/publica` porque esa ruta no exige sesión.

### `POST /api/admin/recepciones/:id/enviar-siweb` — nuevo · `admin`

`{ "nota": "string (≥ 5)" }` → `{ "encoladas": 2, "pendientesAlta": 0, "escrituraDesactivada": false }`

- Encola el stock (sin precios) de una recepción finalizada con `syncEstado = ESCRITURA_DESACTIVADA` (FR-013). Se
  despacha como cualquier otra fila del outbox, sujeta a la prueba de escritura.
- 409 `CONFLICTO` si la recepción no está en ese estado (incluido un segundo envío); 409
  `SIWEB_ESCRITURA_DESACTIVADA` si la escritura está apagada; 404 si no existe.
- Auditoría `recepcion_enviar_siweb_manual` con la nota.

## Movimientos de Siweb360

### `GET /api/movimientos-siweb?estado=sin_justificar|justificados&desde=&hasta=` — nuevo · `operativa` + `admin`

```json
[{ "id": 77120, "fecha": "ISO", "cn": "590948", "nombre": "…", "lote": "…", "caducidad": "AAAA-MM-DD",
   "unidades": -2, "motivoSiweb": "sale_shipment", "referencia": "FAC-0231",
   "justificacion": null | { "id", "tipo", "motivo", "nota", "actor", "at", "recepcionLineaId", "dispensacionId" } }]
```

### `POST /api/movimientos-siweb/:id/justificar` — nuevo · `operativa` + `admin`

```json
{ "tipo": "VINCULO_RECEPCION", "recepcionLineaId": "uuid", "nota": "string (≥ 5)" }
{ "tipo": "VINCULO_DISPENSACION", "dispensacionId": "uuid", "nota": "string (≥ 5)" }
{ "tipo": "MOTIVO", "motivo": "ROTURA | … | OTRO", "nota": "string (≥ 5)" }
```

- Si el movimiento ya tiene justificación vigente, la nueva la **sustituye** (`sustituye_a`); nunca se edita.
- 404 si el movimiento no existe; 422 `MOTIVO_INCOMPATIBLE` si `DEVOLUCION_CLIENTE` va con `unidades < 0` o
  `CADUCADO`/`ROTURA`/`ROBO_PERDIDA`/`DEVOLUCION_PROVEEDOR` con `unidades > 0`.
- 409 `CONFLICTO` si el vínculo no es una de las candidatas (mismo código nacional, mismo día y mismo sentido).
- Auditoría `movimiento_justificar`.

### `GET /api/movimientos-siweb/:id/candidatos` — nuevo · `operativa` + `admin`

```json
{ "candidatos": [{ "tipo": "VINCULO_RECEPCION | VINCULO_DISPENSACION", "id": "uuid", "fecha": "ISO",
                   "nombre": "…", "lote": "…" | null, "unidades": 3 }] }
```

- Entradas → líneas de recepciones finalizadas; salidas → dispensaciones vigentes. Mismo código nacional y día
  (Madrid). 404 si el movimiento no existe.

## Siweb360 (consumido)

| Operación                                                                                                   | Uso                                             | Cambio                                |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------- |
| `POST inventory/stock/adjustments`                                                                          | outbox (entradas) y prueba de escritura         | ninguno                               |
| `GET inventory/movements` (`variant_id`, `warehouse_id`, `reason`, `date_from`, `date_to`, `page`, `limit`) | verificación de dudosos y conciliación nocturna | `reference_id` admite número o cadena |
