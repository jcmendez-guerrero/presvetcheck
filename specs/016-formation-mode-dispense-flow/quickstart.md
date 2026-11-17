# Quickstart: validar formación sin «Añadir a lista de pedido»

Requisitos: `pnpm i`; `RETROSPECTIVE_DISPENSATION_MODE=enabled`; `AUTH_MODE=dev`; `EXTRACTOR=fake`. Siweb360 solo
con MSW/fixtures (nunca servicios reales).

1. Pruebas de dominio y API (con MSW): `pnpm --filter @mmx/api test -- dispensacion-retrospectiva evaluar-formacion`
   - Producto sin stock actual + venta `sale_shipment` en la fecha original → línea `DISPENSAR`, sin `pedido`.
   - Sin venta → `NO_CONFORME` forzable; con motivo se puede continuar y queda auditado.
   - Siweb 5xx/timeout → `SIWEB_NO_DISPONIBLE`.
   - Modo desactivado → `MODO_RETROSPECTIVO_DESHABILITADO`.
   - Receta en vivo sin stock → sigue `PEDIR` (regresión).
2. Manual (`pnpm dev`): subir receta de prueba → Revisión → marcar «Modo formación» + fecha → Resultado muestra
   «Dispensar» (no «Añadir a lista de pedido») → Dispensación abre con modo y fecha → confirmar → vincular el ticket
   ya emitido (también en «Pagado»).
3. Comprobar: no hay filas nuevas en la lista de pedidos, ni movimientos de stock salientes, y la dispensación
   queda con `modo=retrospectivo` y `fecha_original`.
4. Final: `pnpm lint && pnpm typecheck && pnpm test`.
