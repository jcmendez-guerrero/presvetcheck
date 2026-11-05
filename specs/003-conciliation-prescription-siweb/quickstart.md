# Quickstart & Validation Guide: Conciliación TPV, Revisión Pantalla Completa y Siweb360 API 1.2.0

**Feature**: `specs/003-conciliation-prescription-siweb/spec.md`  
**Date**: 2026-11-05

Este documento describe los escenarios de verificación ejecutables de extremo a extremo para validar la implementación de la funcionalidad.

---

## Prerrequisitos

1. Entorno de desarrollo local iniciado (`pnpm dev` con base de datos PostgreSQL y Azurite).
2. Dependencias instaladas y actualizadas (`pnpm i`).
3. Base de datos con migraciones aplicadas (`pnpm db:migrate`).

---

## Escenario 1: Conciliación Manual de Ticket TPV (`XXX-2026-000458`)

**Objetivo**: Verificar que una salida de BONQAT CN 590948 que no se concilia automáticamente puede buscarse por número de ticket `XXX-2026-000458` y asociarse desde la UI de Pendientes.

1. **Crear o identificar la dispensación de prueba**:
   - Navegar a `/pendientes`.
   - Comprobar que en la tarjeta "Salidas pendientes de conciliar con el TPV" figura la salida:
     `BONQAT 50 mg/ml SOLUCION ORAL PARA GATOS ... · CN 590948 · lote 3038691 · 1 envase(s)`
2. **Buscar el ticket**:
   - En la línea de la salida, pulsar el botón "Indicar ticket".
   - Introducir en el campo de búsqueda: `XXX-2026-000458` y pulsar "Buscar".
   - Verificar que se muestra la tarjeta con el detalle del ticket:
     - Número: `XXX-2026-000458`
     - Estado: `Pagado`
     - Línea: `BONQAT 50 mg/ml SOLUCION ORAL PARA GATOS 2 ml` · Cantidad: `1`
3. **Confirmar la asociación**:
   - Seleccionar la línea y pulsar "Confirmar asociación".
   - Verificar que aparece el mensaje de éxito "Salida conciliada correctamente con ticket XXX-2026-000458".
   - La salida desaparece de la lista de pendientes de conciliar.
   - En `/registros`, comprobar que la dispensación muestra su correspondiente ticket TPV vinculado.

---

## Escenario 2: Revisión de Receta en Pantalla Completa con OCR Contiguo

**Objetivo**: Comprobar que el espacio de trabajo de recetas utiliza todo el ancho del monitor y muestra la imagen y el texto OCR lado a lado sin scroll vertical.

1. **Acceder a la revisión**:
   - Crear o abrir una receta pendiente en `/recetas/:id/revision`.
2. **Verificar el ancho completo**:
   - Comprobar que el elemento `<main>` no está constreñido por `max-w-6xl`, sino que abarca el ancho de ventana disponible con padding lateral uniforme.
3. **Verificar la disposición del visor y OCR**:
   - En la mitad izquierda de la pantalla, comprobar que se muestran en paralelo:
     - Visor de imagen (o PDF) con botones de zoom y paginación.
     - Panel de texto reconocido por OCR con scroll interno independiente y botón de copia.
   - En la mitad derecha de la pantalla, comprobar que el formulario de validación se encuentra perfectamente visible y alineado sin requerir desplazamiento vertical de la página para cotejar el OCR con los campos.

---

## Escenario 3: Sincronización de Precio y Coste en Siweb360 vía Outbox

**Objetivo**: Verificar que la finalización de un albarán de recepción con `actualizarPrecio: true` encola y ejecuta la actualización tarifaria (`PUT /inventory/variants/:id/pricing`) en Siweb360.

1. **Crear recepción con cálculo de costes**:
   - En `/recepciones`, crear una recepción e introducir una línea con producto mapeado a una variante en Siweb360.
   - Indicar precio bruto y descuentos, resultando en un precio de coste neto calculado (ej. `14.25 €`).
   - Marcar la casilla "Actualizar precio / coste en Siweb360".
2. **Finalizar la recepción**:
   - Pulsar "Finalizar recepción".
   - Comprobar que en la tabla `outbox` se inserta un evento con `tipo = 'siweb_actualizar_precio'` y `payload` conteniendo `costCents: 1425`.
3. **Ejecutar el despachador**:
   - Ejecutar el worker del outbox:
     ```bash
     pnpm worker outbox-dispatcher
     ```
   - Comprobar en los logs que el evento se procesa llamando a `PUT /api/public/inventory/variants/{id}/pricing` y queda marcado como procesado sin errores.
