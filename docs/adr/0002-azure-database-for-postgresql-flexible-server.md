# ADR-02 · Azure Database for PostgreSQL Flexible Server B1ms (PG16)

- **Estado:** aceptada (SPEC §1)

## Contexto
Datos relacionales, búsqueda difusa de nombres de medicamento (`pg_trgm`, `unaccent`) y JSONB para los crudos de CIMAVet. B1ms entra en la cuenta gratuita 12 meses y después es el SKU más barato.

## Decisión
PostgreSQL 16 en Flexible Server B1ms, acceso privado, copias 7–14 días.

## Alternativa descartada
SQLite (no apto para retención legal de 5 años con varios procesos); Cosmos DB (sin necesidad).
