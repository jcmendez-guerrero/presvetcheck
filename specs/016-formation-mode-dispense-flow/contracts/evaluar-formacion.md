# Contrato: `POST /api/recetas/:id/evaluar` en modo formación

Sin cambios en la forma de la petición ni de la respuesta (`EvaluarBody`, `EvaluacionReceta`); cambia el
comportamiento cuando la receta guardada tiene `confirmacion.modo = 'retrospectivo'` y `origen != 'manual'`.

| Caso | Resultado |
|---|---|
| Modo desactivado en configuración | Error `MODO_RETROSPECTIVO_DESHABILITADO` (HTTP 403, mapeo existente en `apps/api/src/plugins/errores.ts`) |
| Falta `fechaOriginal` | `VALIDACION` |
| `fechaOriginal` futura | `FECHA_ORIGINAL_INVALIDA` (422, código existente) |
| Venta del día encontrada (≥ unidades) | Línea `DISPENSAR`, con la incidencia `AVISO_FECHA_RETROSPECTIVA_ANTIGUA` si la fecha supera el plazo; sin `pedido` |
| Sin venta o parcial | Incidencia `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` → `NO_CONFORME`, `forzable: true` con motivo |
| Siweb360 no responde | Error `SIWEB_NO_DISPONIBLE`: la línea no se juzga, se pide reintentar (nunca se interpreta como «sin movimientos» ni se puede forzar) |
| Receta en vivo | Idéntico a hoy (stock actual, `PEDIR` si no hay) |
| `origen = 'manual'` | Idéntico a hoy (spec 011) |

Al dispensar, la petición con `modo=retrospectivo` también rige la evaluación (se pasa la fecha a `evaluar`) y, si la receta guardada ya está en formación, se adopta ese modo; en formación no se recomienda lote (el stock de hoy no cuenta).

Los textos en español de cada `code` ya existen en el catálogo de mensajes; no se añaden códigos nuevos.
