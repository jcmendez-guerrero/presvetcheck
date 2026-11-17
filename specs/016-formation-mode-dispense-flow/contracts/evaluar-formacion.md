# Contrato: `POST /api/recetas/:id/evaluar` en modo formación

Sin cambios en la forma de la petición ni de la respuesta (`EvaluarBody`, `EvaluacionReceta`); cambia el
comportamiento cuando la receta guardada tiene `confirmacion.modo = 'retrospectivo'` y `origen != 'manual'`.

| Caso | Resultado |
|---|---|
| Modo desactivado en configuración | Error `MODO_RETROSPECTIVO_DESHABILITADO` (409/422 según mapeo existente de `DomainError`) |
| Falta `fechaOriginal` | `VALIDACION` |
| Venta del día encontrada (≥ unidades) | Línea `DISPENSAR` (o `DISPENSAR_CON_AVISO` si fecha antigua); sin `pedido` |
| Sin venta o parcial | Incidencia `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` → `NO_CONFORME`, `forzable: true` con motivo |
| Siweb360 no responde | `SIWEB_NO_DISPONIBLE` (nunca se interpreta como «sin movimientos») |
| Receta en vivo | Idéntico a hoy (stock actual, `PEDIR` si no hay) |
| `origen = 'manual'` | Idéntico a hoy (spec 011) |

Los textos en español de cada `code` ya existen en el catálogo de mensajes; no se añaden códigos nuevos.
