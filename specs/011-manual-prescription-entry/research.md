# Research: Alta manual de recetas sin imagen

Fase 0 de `/speckit-plan`. No quedan dudas abiertas en la spec (Clarifications 2026-11-09); aquí se decide **cómo**
reutilizar lo que ya existe en lugar de construir un flujo paralelo.

## R1. ¿Flujo nuevo o reutilizar revisión → resultado → dispensación?

- **Decision**: Reutilizar el flujo existente. Un alta manual crea una `receta` **sin páginas** con `origen = 'manual'`
  y entra en las mismas pantallas: `/recetas/$id/revision` (sin visor de imagen) → `/resultado` →
  `/recetas/$id/dispensar/$linea` en modo retrospectivo.
- **Rationale**: El formulario de revisión ya tiene los bloques receta/veterinario/titular/líneas, la selección de
  especie de CIMAVet, el buscador de medicamentos (`/api/medicamentos/buscar`) y el relleno desde CIMAVet
  (`completarDesdeCimavet`, `/api/medicamentos/presentaciones/:cn/resumen`). La dispensación ya aplica forzado,
  bloqueos duros, psicótropos, lotes manuales (`metodoCaptura = 'manual'`) y modo retrospectivo. Duplicarlo rompería
  la regla de que el motor es único.
- **Alternatives considered**: Pantalla única nueva con receta + dispensación en un paso (más código, segunda copia
  de validaciones de la UI); ampliar la importación de Excel (`importacion`) (no pasa por el motor de reglas ni por
  CIMAVet, que es justo lo que pide la spec).

## R2. Fecha de referencia de la validez

- **Decision**: Para recetas `origen = 'manual'`, `primeraDispensacionAt` se fija con la **fecha original** de la
  primera dispensación (no con `ahora`), y la evaluación previa a dispensar se hace con esa fecha.
- **Rationale**: El dominio ya calcula la validez con `fechaReferenciaValidez(primeraDispensacion, hoy)`
  (`packages/domain/src/evaluacion.ts`). Pasarle la fecha original da la validez correcta sin tocar el dominio. El modo
  retrospectivo de formación (specs/004) hoy guarda `ahora`, que para formación da igual pero aquí daría caducidades
  falsas.
- **Alternatives considered**: Inyectar un `Clock` fijado a la fecha original (también cambiaría comprobaciones como
  «fecha de emisión futura», que deben seguir contra hoy).

## R3. Versión de reglas

- **Decision**: Se evalúa con la versión de reglas **activa al registrar** y se guarda en `reglaVersion` (como toda
  evaluación). La spec (FR-013) se ajusta a esto.
- **Rationale**: La app carga un único bundle de reglas al arrancar; no hay selección por fecha. La constitución exige
  que cada decisión quede ligada a la versión con la que se tomó, y la decisión del alta manual se toma hoy. En el
  periodo afectado (octubre–noviembre 2026) los ficheros de `config/rules` solo han cambiado por funcionalidades nuevas,
  no por cambios de plazos legales.
- **Alternatives considered**: Cargar versiones históricas desde `regla_version` por `aprobadaAt` (mucho código para
  un caso que hoy no cambia el resultado).

## R4. Control de acceso

- **Decision**: Nuevo grupo `ROLES.altaManual = ['veterinaria_responsable']`. El endpoint de alta exige ese rol, y
  `RecetasService`/`DispensacionesService` comprueban en cada operación sobre una receta `origen = 'manual'`
  (obtener, confirmar, evaluar, dispensar, anular) que el usuario tenga ese rol. Interruptor
  `MANUAL_PRESCRIPTION_ENTRY=enabled|disabled` (por defecto `disabled`); desactivado → `ALTA_MANUAL_DESHABILITADA`.
- **Rationale**: Las rutas de recetas usan el grupo `operativa` (empleado + veterinaria); sin la comprobación por
  receta, un empleado podría terminar una receta manual por su id. El interruptor sigue el patrón de
  `RETROSPECTIVE_DISPENSATION_MODE`.
- **Alternatives considered**: Rutas duplicadas `/api/recetas-manuales/*` (más superficie, mismo efecto).

## R5. Modo retrospectivo para recetas manuales

- **Decision**: Las dispensaciones de una receta manual son **siempre** `modo = 'retrospectivo'` con `fechaOriginal`
  obligatoria, y se permiten aunque `RETROSPECTIVE_DISPENSATION_MODE` esté desactivado (manda
  `MANUAL_PRESCRIPTION_ENTRY`). Se reutiliza la comprobación de venta en Siweb360 del día original
  (`retrospectivoDe`): sin venta → bloqueo forzable con motivo; fecha antigua → aviso.
- **Rationale**: Es exactamente lo que pasó en la realidad: una venta en el TPV un día pasado. No se escribe stock
  (el TPV ya lo descontó).
- **Alternatives considered**: Exigir activar también el modo de formación (mezcla dos interruptores con fines
  distintos).

## R6. Datos de CIMAVet obligatorios en el servidor

- **Decision**: Al confirmar una receta manual, el servidor exige en cada línea un `cn` que exista en CIMAVet (en vivo
  o en caché) y una especie con `especieId`; **sobrescribe** `nregistro`, `formaTexto`, `principioActivoTexto` y
  `concentracionTexto` con los de CIMAVet (sin el `??` que hoy conserva el texto leído). Error estable
  `MEDICAMENTO_NO_SELECCIONADO` / `ESPECIE_NO_SELECCIONADA`.
- **Rationale**: La spec prohíbe texto libre en esos campos; validarlo solo en la UI no basta (AGENTS.md).
- **Alternatives considered**: Solo bloquear los campos en la UI.

## R7. Duplicados frente a registros importados

- **Decision**: Ampliar la comprobación `yaDispensada` para recetas manuales con una consulta a `salida_importada`
  (mismo `numeroReceta` y `numColegiado`, importación no anulada).
- **Rationale**: Las recetas de estas semanas pueden estar ya en las salidas importadas desde Excel.

## R8. Trazabilidad del alta

- **Decision**: Columnas nuevas en `receta`: `origen` (`escaneo` | `manual`, por defecto `escaneo`), `motivoAlta`,
  `custodiaPapel`. Evento de auditoría `receta_alta_manual`. Filtro `origen=manual` en el listado de salidas y apartado
  «Altas manuales» en el reporte semanal. La marca en la dispensación se deriva por join con la receta (no hace falta
  columna en `dispensacion`, que es append-only).
- **Rationale**: Mínimo cambio de esquema; la dispensación ya guarda empleado y fechas.

## R9. Adjuntar imagen más tarde (FR-024)

- **Decision**: `POST /api/recetas/:id/imagenes` para recetas manuales: guarda la página en Blob y `receta_imagen`
  sin lanzar la extracción y sin cambiar `origen`. Prioridad baja (última tarea).
