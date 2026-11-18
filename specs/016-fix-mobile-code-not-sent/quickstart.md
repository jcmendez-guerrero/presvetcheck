# Quickstart: validar que el código del móvil llega al ordenador

**Feature**: [spec.md](spec.md) | **Contrato**: [contracts/api-movil-codigos.md](contracts/api-movil-codigos.md)

## Prerrequisitos

- `pnpm i` y `pnpm dev` (PostgreSQL + API + web); `AUTH_MODE=dev`, `EXTRACTOR=fake`.
- Un móvil en la misma red (la web local ofrece la IP del equipo en el QR) o el emulador del navegador con tamaño móvil.
- Un DataMatrix GS1 de prueba de `fixtures/` (nunca un envase real con datos de personas).

## 0. Diagnóstico (antes de cambiar código)

1. Abrir «Usar el móvil», leer el QR con el móvil y abrir una recepción en el PC.
2. Leer el DataMatrix con el móvil y observar en la consola remota del móvil la petición `POST /api/movil/m/codigos`.
3. Anotar en [research.md](research.md) el estado HTTP y si la respuesta viene de la API (H2) o no.

## 1. Pruebas automáticas

```bash
pnpm --filter @mmx/api test -- movil
pnpm --filter @mmx/web test -- movil envio-codigo
pnpm lint && pnpm typecheck && pnpm test
```

Resultados esperados:

- La API publica una sola vez un `id` reenviado y responde 204 las dos veces.
- Un código de 513 caracteres responde 400; un token caducado responde 401.
- El módulo de envío pasa por `enviando → enviada` y por `enviando → por-reintentar → enviando → enviada`; tras un 401 no
  permite reintentar.
- Los códigos pendientes (hasta 5) salen en orden de llegada, caducan a los 5 minutos y se entregan una sola vez.

## 2. Escenarios manuales (aceptación)

| # | Pasos | Resultado esperado |
|---|-------|--------------------|
| 1 | Móvil emparejado + recepción abierta; leer el DataMatrix | La línea se rellena en < 5 s (SC-001, SC-002) |
| 2 | Cortar los datos del móvil; leer un código | Aviso grande «No se ha enviado», vibración de error y «Reintentar» (SC-003) |
| 3 | Restablecer la conexión; pulsar «Reintentar» | El código llega al PC sin volver a escanear (SC-004) |
| 4 | Cerrar el emparejamiento desde el PC; leer un código | «El emparejamiento ha caducado…», sin «Reintentar» |
| 5 | PC en la pantalla de inicio; leer un código | Aviso visible en el PC con el código y la hora |
| 6 | Abrir una dispensación antes de 5 min | El campo ofrece «Usar el código recibido»; no se aplica solo |
| 7 | Esperar > 5 min y abrir una dispensación | El aviso dice que el código ha caducado |
| 8 | Bloquear la pantalla del móvil justo después de leer; desbloquear | El estado de la última lectura sigue visible |

## 3. Humo

`pnpm --filter @mmx/web e2e` — el flujo «código del móvil → campo de escaneo» con la API en modo desarrollo.
