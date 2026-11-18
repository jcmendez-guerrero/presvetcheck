# Data Model: código leído con el móvil

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Sin cambios de esquema de base de datos ni migraciones. Se reutiliza `sesion_movil_evento` (`datos` jsonb).

## Evento `codigo` (API → PC)

| Campo | Tipo | Regla |
|-------|------|-------|
| `tipo` | `'codigo'` | fijo |
| `raw` | texto | 1–512 caracteres; íntegro, con separadores de grupo si los hay |
| `id` | UUID (opcional) | identificador de la lectura generado en el móvil; si ya existe un evento `codigo` con el mismo `id` en la sesión, no se publica otro |

`id` es opcional para no romper móviles con la página antigua en caché; sin `id` no hay deduplicación.

## Lectura del móvil (solo en el móvil, `sessionStorage`)

| Campo | Tipo | Nota |
|-------|------|------|
| `id` | UUID | identifica la lectura en los reintentos |
| `raw` | texto | el código leído |
| `leidoAt` | fecha-hora | para ordenar y mostrar la hora |
| `estado` | `enviando` \| `enviada` \| `por-reintentar` \| `sin-emparejamiento` \| `rechazada` | ver transiciones |
| `motivo` | texto o nulo | texto en español claro del último fallo |

Se guardan todas las lecturas no enviadas (nunca se pierde un código sin que la persona lo decida) y las 5 últimas
enviadas. Una lectura no enviada solo sale de la lista cuando se envía o cuando la persona pulsa «Descartar»; así un
aviso que no se puede reintentar (`sin-emparejamiento`, `rechazada`) no se queda para siempre.

### Transiciones

```text
(leído) → enviando → enviada                       [204]
                  → por-reintentar                  [sin red, 5xx, respuesta que no es de la API] → «Reintentar» → enviando
                  → sin-emparejamiento              [401: caducado o cerrado]  (sin «Reintentar»)
                  → rechazada                       [400: vacío o > 512]       (sin «Reintentar»: se explica y se vuelve a leer)
```

## Códigos pendientes (solo en el PC, memoria de la pestaña)

«Código pendiente» = código recibido del móvil sin campo de escaneo abierto (no confundir con el estado `por-reintentar`
del móvil, que es un envío fallido).

Cola ordenada de códigos pendientes; cada uno:

| Campo | Tipo | Regla |
|-------|------|-------|
| `raw` | texto | código recibido sin campo de escaneo abierto |
| `recibidoAt` | fecha-hora | caduca a los 5 minutos |

- Hasta 5 códigos, en orden de llegada (FR-009: no se pierde ninguno). Si llega un sexto, se descarta el más antiguo y
  el aviso dice «Se ha descartado el código más antiguo: solo se guardan 5».
- «Usar el código recibido» entrega al campo el más antiguo vigente, una sola vez, y lo borra de la cola; el aviso
  muestra cuántos quedan.
- Si hay un campo de escaneo abierto al llegar, no pasa por la cola: se entrega como lectura de cámara.
- Cada código caduca a los 5 minutos y se descarta. Se guarda `caducadoAt` del último descartado y el aviso dice
  «El código recibido ha caducado: vuelve a leer el envase» hasta que llegue un código nuevo o la persona lo cierre.

## Fin del emparejamiento (PC)

`motivoFin`: texto o nulo (p. ej. «El emparejamiento con el móvil ha caducado o se ha cerrado…»). Termina el
emparejamiento cuando la API responde `activa: false` o un 401, 403 o 404 (`emparejamientoTerminado`); otros fallos
(sin red, 5xx) son temporales. No se borra al abrir el emparejamiento nuevo, para que el diálogo explique por qué hay
un QR nuevo: se borra al cerrar el diálogo, al cerrar el aviso o cuando un móvil se vuelve a conectar. Una
desconexión voluntaria («Desconectar el móvil») no deja motivo.
