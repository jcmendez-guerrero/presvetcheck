# Quickstart: validar el alta manual de recetas

## Requisitos

```bash
pnpm i && pnpm dev
```

En `.env`: `AUTH_MODE=dev`, `EXTRACTOR=fake`, `MANUAL_PRESCRIPTION_ENTRY=enabled`. CIMAVet y Siweb360 con MSW y
`fixtures/` (nunca servicios reales).

## Escenarios

1. **Acceso** — Usuario `dev-empleado` y `dev-admin`: no ven «Alta manual de receta»; `POST /api/recetas/manual`
   responde `403 PROHIBIDO`. Con `MANUAL_PRESCRIPTION_ENTRY=disabled` y `dev-veterinaria`: `403
   ALTA_MANUAL_DESHABILITADA`.
2. **Alta con CIMAVet** — `dev-veterinaria`: alta en papel con motivo y custodia → revisión sin imagen. Buscar
   «bonqat», elegir presentación: forma, principio activo y concentración aparecen de solo lectura. Guardar sin
   medicamento elegido → «Elige el medicamento de la lista de CIMAVet».
3. **Validez en la fecha original** — Emisión 2026-10-20, sin antimicrobiano, fecha original 2026-10-25 → conforme.
   Con antimicrobiano y fecha original 2026-10-28 → caducada; solo se guarda forzando con motivo.
4. **Fechas inválidas** — fecha original mañana o anterior a la emisión → `FECHA_ORIGINAL_INVALIDA`.
5. **Duplicado** — receta con número y colegiado presentes en una salida importada → `RECETA_YA_DISPENSADA`, sin
   botón de forzar.
6. **Registro y conciliación** — La salida aparece en Registros con fecha original y etiqueta «Alta manual», y en
   Pendientes de conciliar. MSW confirma que no hubo ninguna escritura de stock a Siweb360.
7. **Corrección** — Anular la dispensación con motivo: la original sigue y aparece su contramovimiento.

## Pruebas

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:int
```

Unitarias: `it.each` de validación del alta (motivo, custodia/plataforma) y de fecha original (futura, anterior a la
emisión, día de cambio de hora). Integración: escenarios 1, 2, 3, 5 y 6 contra la API. Playwright: escenario 2→6 con
`EXTRACTOR=fake`.
