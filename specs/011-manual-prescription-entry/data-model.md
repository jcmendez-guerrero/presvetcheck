# Data Model: Alta manual de recetas sin imagen

Solo cambios sobre el modelo existente (`packages/db/src/schema/recetas.ts`). Migración nueva
`packages/db/migrations/0019_receta_alta_manual.sql`.

## receta (ampliada)

| Campo | Tipo | Regla |
|-------|------|-------|
| `origen` | text not null default `'escaneo'` | `escaneo` \| `manual`. No cambia al adjuntar imagen después. |
| `motivo_alta` | text null | Obligatorio si `origen = 'manual'`; mínimo 15 caracteres. |
| `custodia_papel` | text null | Papel: dónde se guarda el original (obligatorio). Electrónica: null (se usan `plataforma_id` + `id_plataforma`, obligatorios). |

- Restricción: `check (origen <> 'manual' or motivo_alta is not null)`.
- Índice: `(origen)` para el filtro de registros.
- `sha256`/`phash` quedan null en las manuales (no hay imagen); la detección de resubida no aplica.
- `primera_dispensacion_at`: en manuales se fija con la **fecha original** de la primera dispensación (Europe/Madrid,
  00:00), no con la hora del registro (research R2).
- Sin datos personales nuevos: `motivo_alta` y `custodia_papel` se describen en la UI como «sin nombres ni teléfonos».

## receta_linea (sin cambios de esquema)

En recetas manuales, al confirmar, el servidor fija desde CIMAVet: `nregistro`, `cnPrescrito`, y en la confirmación
`formaTexto`, `principioActivoTexto`, `concentracionTexto`. Sin `cn` válido en CIMAVet → `MEDICAMENTO_NO_SELECCIONADO`.

## dispensacion (sin cambios de esquema)

Para recetas manuales: `modo = 'retrospectivo'`, `fecha_original` obligatoria (≥ `fecha_emision`, ≤ hoy),
`metodo_captura` habitualmente `manual`. Sigue siendo append-only; las correcciones son anulaciones. La marca «alta
manual» se obtiene con `join receta on receta.origen = 'manual'`.

## audit_event (nuevos tipos)

| Acción | Entidad | Después |
|--------|---------|---------|
| `receta_alta_manual` | receta | `{ tipo, motivoAlta, custodiaPapel \| idPlataforma }` |
| `receta_imagen_adjunta` | receta | `{ pagina, sha256 }` |

Confirmación, evaluación, dispensación, forzado y anulación usan los eventos ya existentes.

## Configuración

| Variable | Valores | Por defecto |
|----------|---------|-------------|
| `MANUAL_PRESCRIPTION_ENTRY` | `enabled` \| `disabled` | `disabled` |

## Estados

`BORRADOR` (alta creada) → `CONFIRMADA` (revisión guardada, CIMAVet validado) → `DISPENSADA` (todas las líneas
registradas) — los mismos estados que una receta escaneada; la manual nunca pasa por `EXTRAIDA`.
