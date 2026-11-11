# Quickstart: validar el arreglo

## Requisitos

- Docker en marcha (Colima: ver la nota de entorno en [research.md](research.md)).
- `pnpm i`.

## 1. La prueba de integración reproduce el fallo

Antes del arreglo en `datos.ts`:

```bash
pnpm --filter @mmx/reports test:int
```

Esperado: falla con `ERR_INVALID_ARG_TYPE ... Received an instance of Date`.

Después del arreglo: pasa (salidas normales y de alta manual en su día; anulación de psicótropo en el día en que se
anula; periodo vacío → lista vacía).

## 2. Puertas de calidad

```bash
pnpm lint && pnpm typecheck && pnpm test
```

```bash
pnpm test:int
```

## 3. Entorno NP

Tras desplegar, en **Registros y reportes**, periodo 01/11/2026–10/11/2026:

- «Ver entradas y salidas», «Ver salidas» (A, B, C), «Todas las salidas» y «Registro de psicótropos» se muestran sin
  error.
- Las descargas XLSX/CSV de esos informes se bajan.
- Un periodo sin datos muestra tablas vacías.

Contrato esperado: [contracts/registros.md](contracts/registros.md).
