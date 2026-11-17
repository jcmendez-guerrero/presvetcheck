# Research: Formation mode dispense flow

Hallazgos del código (sin llamadas a servicios reales).

## R1 — Causa raíz

- **Decision**: corregir la evaluación del servidor, no la pantalla.
- **Evidence**:
  - `apps/web/src/paginas/revision.tsx` (≈L283-310) ya ofrece «Modo formación (retrospectivo)» y la fecha, y los
    guarda en `confirmacion.modo` / `confirmacion.fechaOriginal` (`packages/shared/src/schemas/receta.ts:115`).
  - `RecetasService.evaluar` (`apps/api/src/servicios/recetas.ts` ≈L847-960) solo salta el stock real si
    `r.origen === 'manual'`; con `conf.modo === 'retrospectivo'` sigue llamando a `leerStock` (stock de hoy).
  - Sin stock → `decidirLinea` devuelve `PEDIR`; `resultado.tsx` solo muestra «Dispensar» para
    `DISPENSAR`/`DISPENSAR_CON_AVISO` (≈L251) y para `PEDIR` ofrece «Añadir a lista de pedido» (≈L173-200).
  - La pantalla de dispensación sí aplica el modo (`dispensaciones.ts: retrospectivoDe`), pero nunca se llega a ella.
- **Alternatives**: (a) arreglar solo la UI mostrando «Dispensar» en `PEDIR` → rechazado: dejaría la decisión
  del dominio incorrecta y la regla legal viviría en el componente (constitución III). (b) inferir formación
  cuando el stock es 0 → rechazado (spec: elección explícita).

## R2 — Qué sustituye al stock actual en formación

- **Decision**: en formación (no alta manual) el stock del prescrito se toma de los movimientos `sale_shipment`
  del día original, reutilizando `evaluarMovimientosRetrospectivos` (dominio, ya con tabla de casos) y la
  consulta a Siweb360 de `DispensacionesService.revisarRetrospectivo`. Con venta encontrada se aplica el mismo
  stock sintético que el alta manual (`disponible = cantidadEnvases`, lote «(entregado)»); sin venta o parcial,
  `SIN_MOVIMIENTO_STOCK_RETROSPECTIVO` (forzable con motivo → botón «Dispensar igualmente» existente);
  fecha antigua → `AVISO_FECHA_RETROSPECTIVA_ANTIGUA`; Siweb caído → `SIWEB_NO_DISPONIBLE`, nunca «sin movimientos».
- **Alternatives**: duplicar la consulta en `RecetasService` → rechazado; se extrae a un colaborador compartido
  (`RetrospectivoService`) inyectado en ambos servicios.

## R3 — Alcance de equivalentes y sustitución

- **Decision**: en formación solo se evalúa el producto prescrito/dispensado; no se consultan equivalentes en
  stock (el stock de hoy no es relevante) ni se sugiere pedido. Reglas de validez, especie, solo-PA y
  psicotrópicos se evalúan igual que en vivo (FR-002).
- **Alternatives**: mantener candidatos con stock actual → rechazado: mezcla dos fechas.

## R4 — Alta manual y modo desactivado

- **Decision**: `origen === 'manual'` conserva su camino (sin consulta de movimientos, spec 011). Si
  `RETROSPECTIVE_DISPENSATION_MODE=disabled` y `conf.modo === 'retrospectivo'` (no manual), la evaluación se
  rechaza con `MODO_RETROSPECTIVO_DESHABILITADO`, igual que dispensar (`dispensaciones.ts` ≈L266).

## R5 — Ticket ya emitido y pedidos

- **Decision**: sin cambios. El vínculo con el ticket en «Pagado» y la ausencia de movimientos de stock salientes
  ya están en spec 004; este plan solo los verifica en `quickstart.md`. `POST /api/pedidos` solo se invoca desde
  el botón manual, así que al no salir `PEDIR` no se añade nada.

## R6 — Decisiones abiertas y constitución

- Sin variables de entorno nuevas; sin decisiones D-xx nuevas; sin ADR (no cambia arquitectura).
- Sin datos personales en logs: solo `cn`, fecha y recuentos en las incidencias.
