# Contrato API: Alta manual de recetas

Todas las rutas exigen `MANUAL_PRESCRIPTION_ENTRY=enabled` (si no: `403 ALTA_MANUAL_DESHABILITADA`) y el rol
`veterinaria_responsable` (si no: `403 PROHIBIDO`). Esquemas zod en `packages/shared/src/schemas/receta.ts`.

## POST /api/recetas/manual  — nuevo

```json
{
  "tipo": "papel",
  "motivo": "Dispensada el 25/10 con la app caída",
  "custodiaPapel": "Archivador recetas octubre, carpeta 2",
  "plataformaId": null,
  "idPlataforma": null
}
```

- `motivo` ≥ 15 caracteres. `tipo = papel` → `custodiaPapel` obligatorio. `tipo = electronica` → `plataformaId` e
  `idPlataforma` obligatorios.
- `201 { "id": "<uuid>" }`. Crea la receta en `BORRADOR` con `origen = 'manual'` y audita `receta_alta_manual`.

## Rutas existentes con comportamiento añadido para `origen = 'manual'`

| Ruta | Cambio |
|------|--------|
| `GET /api/recetas/:id` | Devuelve `origen`, `motivoAlta`, `custodiaPapel`; `imagenes: []`. Solo `veterinaria_responsable`. |
| `PUT /api/recetas/:id/confirmacion` | Exige `cn` de CIMAVet en cada línea (`MEDICAMENTO_NO_SELECCIONADO`) y `especie.especieId` (`ESPECIE_NO_SELECCIONADA`); sobrescribe forma, principios activos y concentración con CIMAVet. |
| `POST /api/recetas/:id/evaluar` | En manuales, la validez se calcula con `fechaReferencia` (cuerpo, opcional) o, si no, con `confirmacion.fechaOriginal` («Fecha en que se entregó», obligatoria al confirmar: entre la emisión y hoy). Sin stock real: la entrega ya ocurrió. |
| `POST /api/recetas/:id/validez` | En manuales, el aviso de caducada usa `fechaOriginal`. |
| `POST /api/dispensaciones` (con receta) | En manuales: `modo` forzado a `retrospectivo`, `fechaOriginal` obligatoria (`FECHA_ORIGINAL_INVALIDA` si es futura o anterior a la emisión); válido aunque `RETROSPECTIVE_DISPENSATION_MODE=disabled`. Duplicado en `salida_importada` → `RECETA_YA_DISPENSADA` (no forzable). |
| `GET /api/registros/salidas` | Filtro `origen=manual`; columna interna `ALTA MANUAL (S/N)`. Las entregas pasadas (con `fecha_original`) cuentan en su fecha original. |
| `POST /api/dispensaciones/:id/anular` | En manuales, solo `veterinaria_responsable`. |
| `GET /api/config/publica` | Expone `altaManualHabilitada`. |

## POST /api/recetas/:id/imagenes  — nuevo (FR-024)

`multipart/form-data` con una página. Solo recetas `origen = 'manual'`. Guarda en Blob y `receta_imagen`, no lanza la
extracción, no cambia `origen`. `201 { "pagina": n }`.

## Códigos de error nuevos

`ALTA_MANUAL_DESHABILITADA`, `MEDICAMENTO_NO_SELECCIONADO`, `ESPECIE_NO_SELECCIONADA`, `FECHA_ORIGINAL_INVALIDA`,
con su texto en `packages/shared/src/i18n/errores.es.json`.

## UI

- Inicio y menú: botón «Alta manual de receta» solo si `altaManualHabilitada` y el rol es `veterinaria_responsable`.
- `/recetas/manual/nueva`: formulario corto (tipo, motivo, dónde está el papel / plataforma e identificador) → crea y
  navega a `/recetas/$id/revision`.
- Revisión: sin visor de imagen (aviso «Receta dada de alta a mano, sin imagen» + motivo y custodia); forma, principio
  activo y concentración de solo lectura; sin casilla de dispensación ágil.
- Dispensación: modo retrospectivo activado y bloqueado, fecha original obligatoria.
- Registros: filtro «Alta manual» y etiqueta en la fila.
