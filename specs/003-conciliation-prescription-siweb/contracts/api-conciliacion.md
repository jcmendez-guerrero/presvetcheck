# Contract: API de Conciliación y Búsqueda de Tickets TPV

**Feature**: `specs/003-conciliation-prescription-siweb/spec.md`  
**Base Path**: `/api/conciliacion`  
**Authentication**: Obligatoria (Roles: `empleado`, `veterinaria_responsable`, `admin`)

---

## 1. Buscar Tickets en el TPV (Siweb360)

Permite buscar tickets en Siweb360 por su número exacto o prefijo (ej. `XXX-2026-000458`) para examinar sus líneas y proceder a la conciliación manual.

- **Método**: `GET`
- **Ruta**: `/api/conciliacion/tickets`
- **Query Parameters**:
  - `search` (string, obligatorio, min 3 caracteres): Número de ticket u observaciones a buscar (ej. `XXX-2026-000458`).
  - `estado` (string, opcional): Filtrar por estado (`Pagado`, `Pendiente`, `Cancelado`). Por defecto busca cualquier estado o `Pagado`.
- **Response 200 OK**:
  ```json
  {
    "tickets": [
      {
        "id": 70458,
        "numero": "XXX-2026-000458",
        "fecha": "2026-11-05",
        "hora": "13:45",
        "estado": "Pagado",
        "total": 32.50,
        "items": [
          {
            "id": 1,
            "nombre": "BONQAT 50 mg/ml SOLUCION ORAL PARA GATOS 2 ml",
            "cantidad": 1,
            "precioUnitario": 32.50,
            "subtotal": 32.50
          }
        ]
      }
    ]
  }
  ```
- **Errores**:
  - `400 BAD_REQUEST`: Parámetro `search` no válido o inferior a 3 caracteres.
  - `502 BAD_GATEWAY`: Error de comunicación con la API de Siweb360.

---

## 2. Asociar Manualmente una Salida a un Ticket

Asocia de forma explícita y auditada una dispensación pendiente a una línea de un ticket del TPV.

- **Método**: `POST`
- **Ruta**: `/api/conciliacion/asociar`
- **Request Body**:
  ```json
  {
    "dispensacionId": "01a1abc1-ad23-7013-9ff7-26e8a346de64",
    "ticketId": 70458,
    "ticketNumero": "XXX-2026-000458",
    "lineaId": 1,
    "nota": "Asociación manual por empleado: producto sin CN en el ticket"
  }
  ```
- **Validaciones de negocio**:
  - La `dispensacionId` debe existir y no estar ya anulada ni conciliada.
  - El ticket debe existir en Siweb360 y contener la línea especificada.
  - Si la cantidad del ticket difiere de las unidades dispensadas, se registra la conciliación con discrepancia de tipo `UNIDADES_DISTINTAS`.
  - Se genera un evento en `audit_event` registrando al usuario autenticado, IP y los datos del emparejamiento.
- **Response 200 OK**:
  ```json
  {
    "ok": true,
    "conciliacion": {
      "dispensacionId": "01a1abc1-ad23-7013-9ff7-26e8a346de64",
      "ticket": "XXX-2026-000458",
      "movimientoId": "ticket:70458:1",
      "loteVerificado": false,
      "origen": "manual"
    }
  }
  ```
- **Errores**:
  - `404 NOT_FOUND`: Dispensación o ticket no encontrado.
  - `409 CONFLICT`: La dispensación ya fue previamente conciliada.
