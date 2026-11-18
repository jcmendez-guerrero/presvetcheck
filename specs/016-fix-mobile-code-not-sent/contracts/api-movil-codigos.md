# Contrato: envío del código desde el móvil

**Feature**: [spec.md](../spec.md) | **Modelo**: [data-model.md](../data-model.md)

## `POST /api/movil/m/codigos`

Autenticación: cabecera `x-movil-token` (token del QR). Sin sesión de usuario.

**Cuerpo** (zod en `packages/shared`):

```json
{ "raw": "(01)08470000570016(17)261130(10)ABC123", "id": "3f0c2c7e-8d5e-4b53-9d7a-5b1f3c2a9e10" }
```

| Campo | Regla |
|-------|-------|
| `raw` | texto, 1–512 caracteres |
| `id` | UUID opcional; reenviar el mismo `id` en la misma sesión es seguro |

**Respuestas**

| Estado | Cuándo | El móvil muestra |
|--------|--------|------------------|
| 204 | Código aceptado (o `id` ya publicado) | «Enviado» (solo ahora) |
| 400 | `raw` vacío, > 512 o `id` mal formado | «El código no es válido» / «El código es demasiado largo para enviarlo»; sin «Reintentar» |
| 401 | Token ausente, caducado o sesión cerrada | «El emparejamiento ha caducado: vuelve a leer el código QR del ordenador»; sin «Reintentar» |
| 5xx, sin red, cuerpo que no es de la API | Fallo temporal | «No se ha enviado: comprueba la conexión del móvil»; con «Reintentar» |

El contenido de `raw` no se escribe en los registros (redacción ya aplicada a `x-movil-token`; el cuerpo no se registra).

## `GET /api/movil/sesiones/:id/eventos?desde=N` (sin cambios de contrato)

Devuelve los eventos con `seq > desde` en orden creciente. Un evento `codigo` lleva `{ seq, tipo: 'codigo', raw }`; el
`id` no se devuelve al PC (solo sirve para la deduplicación en el servidor).
