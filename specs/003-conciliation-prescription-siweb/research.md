# Research: Conciliación TPV, Revisión Pantalla Completa y Siweb360 API 1.2.0

**Feature**: `specs/003-conciliation-prescription-siweb/spec.md`  
**Date**: 2026-11-05

## Decision 1: Estrategia de Búsqueda y Resolución Asistida de Tickets del TPV

### Contexto
En Siweb360, el endpoint `GET /api/public/tickets` admite filtros `fecha_desde`, `fecha_hasta`, `estado` y el parámetro `search` (búsqueda por número de ticket u observaciones). Los tickets emitidos en el TPV contienen líneas (`items[]`) con `nombre` y `cantidad`. Frecuentemente, el TPV emite el ticket con el nombre comercial del medicamento (p. ej. "BONQAT 50 mg/ml...") sin formatear explícitamente el prefijo literal `CN590948`. En el caso reportado, el ticket `XXX-2026-000458` existe en Siweb360, pero la lectura automática descartaba la línea al no casar con la expresión regular `SIWEB_TICKET_CN_REGEX`, impidiendo que la salida se concilie.

### Decisión
1. **Resolución automática en cascada**:
   - Primero intenta extraer el CN del nombre de la línea mediante `SIWEB_TICKET_CN_REGEX` (ej. `CN590948` o `CN 590948`).
   - Si no hay coincidencia por regex, busca si el nombre de la línea contiene un CN de 6 dígitos aislado (`\b\d{6}\b`) que coincida con una dispensación pendiente o un producto de `siweb_variant_map`.
   - Si aún no coincide, intenta relacionar la línea mediante coincidencia de texto con los nombres de variantes registrados en `siweb_variant_map`.
2. **Búsqueda y Asociación Manual en la UI**:
   - En la tarjeta "Salidas pendientes de conciliar con el TPV" de `/pendientes`, para cada salida pendiente se añade una acción "Indicar ticket".
   - Al pulsarla, se abre un diálogo/campo donde el empleado introduce el número de ticket (p. ej. `XXX-2026-000458`).
   - La API (`GET /api/conciliacion/tickets?search=XXX-2026-000458`) consulta Siweb360 mediante el parámetro `search`, recupera el ticket completo y sus líneas, y las presenta en la interfaz (número, fecha, estado, productos y cantidades).
   - El empleado selecciona la línea correspondiente y pulsa "Confirmar asociación".
   - La API (`POST /api/conciliacion/asociar`) registra la fila en `conciliacion` (`dispensacionId`, `movimientoId`, `ticket: numero`, `loteVerificado: false`, `origen: 'manual'`) y añade el correspondiente `audit_event`.

### Alternativas descartadas
- *Solo búsqueda automática por texto*: Descartada porque si el TPV usa un nombre genérico o abreviado ("BONQAT"), un algoritmo de similitud difusa podría emparejar erróneamente con otra presentación o dosificación.
- *Escribir salida de stock desde la app*: Descartada por violación constitucional (Principio de trazabilidad y regla SPEC §5.2.4: las salidas las descuenta exclusivamente el TPV).

---

## Decision 2: Arquitectura del Visor de Recetas en Pantalla Completa con OCR Contiguo

### Contexto
La vista de revisión de recetas (`/recetas/:id/revision`) estaba limitada a un contenedor de ancho estándar (`max-w-6xl`), y el componente `VisorReceta` apilaba verticalmente la tarjeta de la imagen escaneada y la tarjeta de texto OCR reconocido. Debido a que la imagen ocupa una altura sustancial (`70vh`), el texto OCR quedaba oculto bajo el pliegue visual, exigiendo scroll vertical repetitivo para consultar los datos extraídos y cotejarlos con el formulario.

### Decisión
1. **Ruta a ancho completo**:
   - Modificar la definición de la ruta `/recetas/$id/revision` en `apps/web/src/main.tsx` para incorporar `staticData: { anchoCompleto: true }` (idéntico a la ruta `/recepciones/$id`).
2. **Diseño de dos columnas con columna izquierda dividida**:
   - En `Revision` (`apps/web/src/paginas/revision.tsx`) y en el componente contenedor `ConReceta`, la distribución horizontal principal se fija en `grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]`.
   - La columna izquierda (documental) se divide a su vez en dos paneles contiguos en paralelo:
     - **Panel 1 (Izquierdo)**: Imagen de la receta con controles de zoom y selección de página.
     - **Panel 2 (Derecho dentro de columna documental)**: Texto reconocido por OCR en panel con scroll independiente y botón de copia rápida por secciones/bloques.
   - Ambos paneles tienen altura fija adaptada a la ventana (`max-h-[calc(100vh-10rem)]`), de modo que no requieren scroll en la página principal y permanecen fijos (`sticky`) frente al formulario de validación de la columna derecha.

### Alternativas descartadas
- *Pestañas entre imagen y OCR*: Descartada porque obliga al usuario a alternar pestañas continuamente, perdiendo la vista de la imagen mientras consulta el texto reconocido.
- *3 columnas principales iguales (Imagen | OCR | Formulario)*: Descartada en monitores de 1366x768 o 1080p estándar porque dejaba el formulario excesivamente estrecho e incómodo para desplegables y avisos de incidencias.

---

## Decision 3: Integración de Siweb360 API 1.2.0 (Pricing y Movimientos de Stock)

### Contexto
El usuario aportó la especificación OpenAPI v1.2.0 de Siweb360 (`siweb360-openapi.yaml`). La versión anterior carecía de la documentación para actualización de tarifas de coste/precio (`/api/public/inventory/variants/{id}/pricing`) y de consulta general de movimientos de stock (`/api/public/inventory/movements`).

### Decisión
1. **Actualización de la especificación de referencia**:
   - Convertir `siweb360-openapi.yaml` v1.2.0 a `docs/ref/siweb360-openapi.json` para mantener el formato JSON estándar del repositorio.
2. **Cliente Siweb360 (`@mmx/siweb`)**:
   - Agregar método `actualizarPrecios(variantId: number, body: { price_cents?: number; cost_cents?: number })` usando `PUT /api/public/inventory/variants/{id}/pricing`.
   - Agregar método `movimientos(filtros: FiltrosMovimientos)` usando `GET /api/public/inventory/movements`.
   - Esquemas zod en `packages/siweb/src/schemas.ts` para validar inputs y outputs.
3. **Flujo de Recepciones y Outbox**:
   - Al finalizar una recepción en `apps/api/src/servicios/recepciones.ts`, para cada línea que tenga `actualizarPrecio: true`, `siwebVariantId !== null` y `precioCoste !== null`:
     - Se calcula `cost_cents` utilizando `decimal.js` (`new Decimal(linea.precioCoste).mul(100).toNumber()`).
     - Se registra una entrada en la tabla `outbox` con tipo `siweb_actualizar_precio`.
   - El despachador del outbox (`apps/worker/src/jobs/outbox-dispatcher.ts` y `packages/siweb/src/outbox.ts`) procesa el evento llamando a `client.actualizarPrecios()`.

### Alternativas descartadas
- *Llamada síncrona directa a la API de Siweb360 durante la petición HTTP de finalización de recepción*: Descartada para cumplir la regla constitucional de resiliencia y el patrón outbox: ninguna escritura en Siweb360 se hace síncrona en la petición HTTP del usuario.
