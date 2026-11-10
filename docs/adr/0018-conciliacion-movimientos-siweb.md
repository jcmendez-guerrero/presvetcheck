# ADR-18 · Activar la escritura de entradas con el historial de movimientos de Siweb360

- **Estado:** propuesta (pendiente de aprobación de JC)
- **Especificación:** `specs/011-siweb-stock-entries-enable/`

## Contexto

La app ya sabe enviar a Siweb360 la entrada de stock de cada línea de recepción (outbox, ADR-08), pero la escritura
está apagada (`SIWEB_STOCK_WRITE_MODE=off`). La SPEC (§5.2.4) solo permite encenderla tras la prueba de escritura
(§12.3) y cuando se puedan detectar las entradas hechas a mano en Siweb360, porque si no el stock se duplica. Además,
un envío con respuesta dudosa (corte de red) quedaba siempre para una persona, sin forma de saber si llegó.

La especificación de la API 1.3.0 (9 de noviembre de 2026) no cambia el ajuste de stock, pero confirma que
`GET inventory/movements` devuelve por cada movimiento la variante, el lote, la caducidad, las unidades, el motivo y
la **nota libre** donde la app guarda su referencia (`MMX-REC-{recepción}-L{línea}`).

## Decisión

- **Verificación de envíos dudosos.** El job `outbox-dispatcher` busca la referencia exacta en el historial. Si
  aparece una vez, el envío se da por hecho (lo audita el sistema); si no aparece o aparece varias veces, queda en
  revisión con esa evidencia. **Nunca se reenvía solo.** Se comprueba a los 10 minutos y cada 15 minutos durante
  24 horas.
- **Cierre por cualquier usuario.** «Revisado» o «Resuelto a mano en Siweb360», con nota. Reenviar y descartar
  siguen siendo de administración.
- **Prueba de escritura dentro de la app.** Se lanza desde Administración, comprueba también que el historial
  devuelve la nota y queda en la auditoría. Sin una superada en los últimos 30 días, el outbox no envía nada.
- **Conciliación de todos los movimientos de medicamentos.** Cada noche (con la conciliación de ventas) se lee el
  historial desde `ENTRY_CUTOVER_DATE`, se guarda en `siweb_movimiento` (solo inserción) y se vincula solo lo que
  tiene pareja: entradas por su referencia y ventas por su ticket ya conciliado. El resto va a la bandeja
  «Movimientos sin justificar», donde una persona lo vincula o lo justifica con un motivo. Las justificaciones son
  de solo inserción (`movimiento_justificacion`): una corrección sustituye a la anterior, nunca la edita.
- **Registro de bajas.** Toda salida justificada con motivo aparece como `BAJA` en el registro (y en el de
  psicótropos si lo es); si la justificación se sustituye, se añade su anulación.
- En producción, `SIWEB_STOCK_WRITE_MODE=entries_only` exige `ENTRY_CUTOVER_DATE`.

## Consecuencias

- Se puede encender la escritura sin perder trazabilidad: lo que entra por la app, lo que vende el TPV y cualquier
  ajuste hecho en Siweb360 queda explicado.
- La regla de vinculación de ventas supone que `reference_id` del movimiento es el id del ticket. No hay una muestra
  real: queda `TODO(decision D-02b)` y un `it.todo` pidiendo `fixtures/siweb/movements-ticket.json`. Si no fuera así,
  las ventas irían a la bandeja (más trabajo, nunca un error de registro).
- Las justificaciones de entradas (devolución de cliente, recuento al alza) no entran en el registro (DUDA-30).
- Las horas del historial llegan sin zona horaria y se interpretan como hora de Madrid.

## Alternativas descartadas

- **Reenviar solo los envíos dudosos que no aparecen en el historial:** el historial puede tardar en reflejar un
  ajuste; un reenvío automático duplicaría stock. Lo decide una persona.
- **Controlar solo las entradas manuales (informe semanal):** no explica roturas, caducados ni ventas sin
  dispensación.
- **Reutilizar la tabla `discrepancia`:** su estado se edita; las justificaciones deben ser de solo inserción.
