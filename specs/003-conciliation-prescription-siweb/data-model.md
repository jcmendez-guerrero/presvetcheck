# Data Model: Conciliación TPV, Revisión Pantalla Completa y Siweb360 API 1.2.0

**Feature**: `specs/003-conciliation-prescription-siweb/spec.md`  
**Date**: 2026-11-05

## 1. Entidades del Dominio y Base de Datos

```
+--------------------+        1:N       +----------------------+
|    dispensacion    |----------------->|     conciliacion     |
| (salida regulada)  |                  | (vínculo con ticket) |
+--------------------+                  +----------------------+
          |                                        |
          | 1:1 (si abierta)                       | 1:1
          v                                        v
+--------------------+                  +----------------------+
|    discrepancia    |                  |      audit_event     |
|  (falta / desfase) |                  | (traza de asociación)|
+--------------------+                  +----------------------+
```

### 1.1 `dispensacion` (Existente)
Representa la salida formal de medicamento dispensado bajo receta veterinaria.
- `id`: UUID (Primary Key).
- `recetaId`: UUID (Foreign Key a `receta`).
- `cn`: Código nacional de 6 dígitos (ej. `"590948"`).
- `lote`: String identificador del lote entregado (ej. `"3038691"`).
- `unidades`: Entero positivo (ej. `1`).
- `fechaVenta`: Timestamp de registro en Europe/Madrid.
- `unidadesForma`: Decimal o null (si null = envase entero; si no null = fracción).
- `anulaDispensacionId`: UUID o null (contra-movimiento si fue anulada).

### 1.2 `conciliacion` (Existente, ampliada con origen y ticket)
Registra el emparejamiento formal entre una dispensación y una línea de ticket de venta del TPV.
- `id`: Serial/Int (Primary Key).
- `dispensacionId`: UUID (Foreign Key a `dispensacion.id`, Unique).
- `movimientoId`: String (ej. `"ticket:7001:1"` o `"7001:1"`).
- `ticket`: String identificador del ticket (ej. `"XXX-2026-000458"`).
- `loteVerificado`: Boolean (falso en tickets de Siweb360 al no registrar lote la línea del TPV).
- `origen`: Enum/String:
  - `'registro'`: Conciliación inmediata al completar la receta.
  - `'bajo-demanda'`: Botón "Conciliar ahora" en la pantalla de pendientes.
  - `'cierre-diario'`: Proceso nocturno de cierre.
  - `'manual'`: Asociación asistida por el empleado desde la interfaz.
- `at`: Timestamp de conciliación.

### 1.3 `audit_event` (Existente)
Registro inmutable de trazabilidad de acciones operativas.
- `id`: Serial/Int (Primary Key).
- `actor`: UUID del usuario que realiza la acción.
- `accion`: `'conciliar'` | `'conciliar_manual'`.
- `entidad`: `'conciliacion'`.
- `entidadId`: String o null.
- `despues`: JSON con detalle de la asociación:
  ```json
  {
    "dispensacionId": "01a1abc1-ad23-7013-9ff7-26e8a346de64",
    "cn": "590948",
    "ticket": "XXX-2026-000458",
    "movimientoId": "ticket:7001:1",
    "motivo": "Asociación manual por empleado"
  }
  ```
- `at`: Timestamp.

---

## 2. Modelos de Integración Siweb360 (OpenAPI 1.2.0)

### 2.1 Modelo de Búsqueda de Ticket (`TicketResumen` y `TicketDetalle`)
- `id`: Número identificador en Siweb360.
- `numero`: String número de serie del ticket (ej. `"XXX-2026-000458"`).
- `fecha`: String ISO date (`"YYYY-MM-DD"`).
- `hora`: String (`"HH:MM"`).
- `estado`: `'Pagado'` | `'Pendiente'` | `'Cancelado'`.
- `total`: Decimal/Number importe total en euros.
- `items`: Lista de líneas:
  - `id`: Número identificador de línea.
  - `nombre`: Nombre del producto en la línea del ticket (ej. `"BONQAT 50 mg/ml SOLUCION ORAL..."`).
  - `cantidad`: Número de unidades vendidas.
  - `precio_unitario`: Importe unitario.
  - `subtotal`: Importe neto de la línea.

### 2.2 Payload de Outbox para Actualización de Precio y Coste (`siweb_actualizar_precio`)
Almacenado en la tabla `outbox`:
- `tipo`: `'siweb_actualizar_precio'`.
- `payload`:
  ```json
  {
    "variantId": 9001,
    "recepcionLineaId": "01a1abc...",
    "cn": "590948",
    "costCents": 1425.5,
    "priceCents": 2495
  }
  ```
- Reglas de validación:
  - `variantId`: Entero positivo obligatorio.
  - `costCents`: Número mayor o igual a 0, hasta 2 decimales de céntimo (4 decimales de euro).
  - `priceCents`: Opcional, entero o decimal en céntimos.

---

## 3. Modelo de Estado de UI (Visor de Receta en Pantalla Completa)

### 3.1 `VisorRecetaState`
- `imagenes`: Lista de páginas `{ pagina: number, url: string, mime: string }`.
- `paginaActiva`: Índice de la página visualizada.
- `zoom`: Nivel de ampliación (1x a 4x).
- `ocrTexto`: Texto reconocido completo o por bloques.
- `distribucion`:
  - `anchoCompleto`: `true` (enrutamiento TanStack Router).
  - `modoVisualizacion`: Panel dividido lado a lado (imagen a la izquierda del visor, texto OCR a la derecha del visor) con altura máxima acotada al viewport (`max-h-[calc(100vh-10rem)]`).
