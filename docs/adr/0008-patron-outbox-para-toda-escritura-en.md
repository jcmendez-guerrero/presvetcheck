# ADR-08 · Patrón outbox para toda escritura en Siweb360

- **Estado:** aceptada (SPEC §1)

## Contexto
La API de Siweb360 no ofrece claves de idempotencia: hay que evitar dobles ajustes de stock.

## Decisión
Tabla `outbox` con clave `MMX-…` en `notes`; ante timeout o respuesta ambigua, `needs_reconciliation` y decisión humana. Solo entradas; nunca salidas.

## Alternativa descartada
Llamadas síncronas directas.
