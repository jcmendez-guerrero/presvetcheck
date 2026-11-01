# Modelo de datos (Fase 1): Asistente de consultas

Las tablas nuevas van en la migración `packages/db/migrations/0015_asistente.sql` y en el esquema Drizzle
`packages/db/src/schema/asistente.ts`. Convenciones del repositorio:

- `pk()` es un `uuid`;
- los marcadores de tiempo son `timestamptz`;
- los usuarios se referencian por `usuario.entra_oid`;
- el mes natural y la fecha de negocio se calculan en `Europe/Madrid`.

**Ninguna tabla contiene datos personales del titular ni la identidad del veterinario** (FR-018, FR-021a).

## asistente_conversacion

Sesión de consulta de un empleado.

| Campo             | Tipo                               | Reglas                                                                                                                                              |
| ----------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | uuid PK                            |                                                                                                                                                     |
| `usuario_oid`     | text                               | obligatorio; propietario de la conversación. Sin FK a `usuario` (solo la _seed_ la rellena; el resto de registros guarda el id de Entra como texto) |
| `usuario_nombre`  | text                               | nombre del empleado al abrirla (para el histórico)                                                                                                  |
| `contexto_tipo`   | text                               | `general` \| `linea` \| `medicamento`                                                                                                               |
| `receta_linea_id` | uuid → `receta_linea.id`, nullable | obligatorio si `contexto_tipo='linea'`. Sin `ON DELETE CASCADE`: la purga a 5 años de recetas exige antes que la conversación (1 año) ya no exista  |
| `nregistro`       | text, nullable                     | si `contexto_tipo='medicamento'` y ya se ha elegido el medicamento                                                                                  |
| `estado`          | text                               | `abierta` \| `cerrada`                                                                                                                              |
| `created_at`      | timestamptz                        | fecha de inicio; base de la retención de 1 año                                                                                                      |
| `cerrada_at`      | timestamptz, nullable              |                                                                                                                                                     |

- Índices: `(usuario_oid, created_at desc)` y `(created_at)` para la purga y los filtros.
- Transiciones: `abierta → cerrada`, cuando se pulsa «Nueva conversación», al cerrar sesión o tras 8 h sin
  actividad. No hay más estados. Una conversación cerrada no admite más preguntas.

## asistente_intercambio _(solo inserción)_

Cada par pregunta-respuesta (FR-022).

| Campo                              | Tipo                                                 | Reglas                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`                               | uuid PK                                              |                                                                                                                         |
| `conversacion_id`                  | uuid → `asistente_conversacion.id` ON DELETE CASCADE |                                                                                                                         |
| `orden`                            | int                                                  | correlativo dentro de la conversación; único `(conversacion_id, orden)`                                                 |
| `pregunta`                         | text                                                 | **ya saneada** por `PiiScrubber`; 1–2.000 caracteres                                                                    |
| `pii_eliminada`                    | boolean                                              | se eliminaron datos personales de la pregunta (FR-019)                                                                  |
| `estado`                           | text                                                 | `respondida` \| `error` \| `limite`                                                                                     |
| `tipo_respuesta`                   | text, nullable                                       | `respondida` \| `sin_informacion` \| `fuera_de_ambito` \| `aclaracion` \| `rechazo_reglas`; null si `estado≠respondida` |
| `respuesta`                        | text, nullable                                       | texto mostrado; null si hubo error                                                                                      |
| `fuentes`                          | jsonb                                                | `FuenteCitada[]` (ver más abajo), validadas contra las herramientas del turno                                           |
| `simulaciones`                     | jsonb                                                | `SimulacionGuardada[]`: entrada supuesta, resultado del motor y `reglaVersion`                                          |
| `contexto_motor`                   | jsonb, nullable                                      | instantánea del resultado del motor de la línea en ese momento (estado, motivos, equivalentes, `reglaVersion`)          |
| `regla_version`                    | text                                                 | `RulesBundle.version` vigente al responder                                                                              |
| `fuentes_version`                  | text                                                 | hash de la guía y de la Ayuda indexadas (`guia@hash8+ayuda@hash8`)                                                      |
| `modelo`                           | text                                                 | nombre del despliegue y modelo informado por el servicio (`fake` en tests)                                              |
| `instrucciones_version`            | text                                                 | `instrucciones.v1@hash8`                                                                                                |
| `tokens_entrada` / `tokens_salida` | int                                                  | suma de todas las rondas del turno                                                                                      |
| `rondas_herramientas`              | int                                                  | 0–4                                                                                                                     |
| `duracion_ms`                      | int                                                  |                                                                                                                         |
| `error_code`                       | text, nullable                                       | `ASISTENTE_NO_DISPONIBLE`, `ASISTENTE_LIMITE_MENSUAL`…                                                                  |
| `created_at`                       | timestamptz                                          | fecha y hora de respuesta (FR-022)                                                                                      |

- _Trigger_ `mmx_asistente_solo_insercion`: rechaza `UPDATE` siempre, y `DELETE` salvo con
  `current_setting('mmx.purga_retencion', true)='on'` y `created_at < now() - interval '1 year'` (FR-023,
  FR-023a).
- Índices: `(conversacion_id, orden)` y `(created_at)`.

**`FuenteCitada`** (zod en `packages/shared/src/schemas/asistente.ts`):
`{ fuenteId: string; tipo: 'regla' | 'guia' | 'ayuda' | 'cimavet' | 'motor'; titulo: string; version: string;
ancla?: string }`.

Ejemplos de `fuenteId`:

- `regla:validez#antimicrobiano`, con versión `validez.v1@1a2b3c4d`;
- `guia:§validez-de-la-receta`, con versión `guia@9f8e7d6c`;
- `ayuda:sustitucion`, con versión `ayuda@…`;
- `cimavet:1868 ESP`, con versión = `fetchedAt` ISO;
- `motor:linea/<id>`, con versión = `reglaVersion`.

## asistente_valoracion

Valoración del empleado sobre un intercambio (FR-024).

| Campo            | Tipo                                                | Reglas                                         |
| ---------------- | --------------------------------------------------- | ---------------------------------------------- |
| `id`             | uuid PK                                             |                                                |
| `intercambio_id` | uuid → `asistente_intercambio.id` ON DELETE CASCADE |                                                |
| `usuario_oid`    | text                                                | solo el dueño de la conversación puede valorar |
| `valor`          | text                                                | `util` \| `incorrecta`                         |
| `comentario`     | text, nullable                                      | ≤ 500 caracteres, saneado con `PiiScrubber`    |
| `created_at`     | timestamptz                                         |                                                |

- Único `(intercambio_id, usuario_oid)`. Volver a valorar sustituye la anterior (es una tabla de opinión, no un
  registro legal; se purga con la conversación).

## asistente_consumo_mes

Consumo acumulado por mes natural (FR-027a, FR-027b).

| Campo                              | Tipo                         | Reglas                                                                       |
| ---------------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `mes`                              | text PK                      | `YYYY-MM` en `Europe/Madrid`                                                 |
| `tokens_entrada` / `tokens_salida` | bigint                       | incremento atómico (`INSERT … ON CONFLICT DO UPDATE SET x = x + excluded.x`) |
| `preguntas`                        | int                          |                                                                              |
| `limite_tokens`                    | bigint                       | se copia de `ASSISTANT_MONTHLY_TOKEN_LIMIT` al crear la fila                 |
| `limite_ampliado`                  | bigint, nullable             | ampliación de administración para el mes; si existe, es el límite efectivo   |
| `ampliado_por` / `ampliado_at`     | text / timestamptz, nullable | también genera `audit_event`                                                 |
| `aviso_enviado_at`                 | timestamptz, nullable        | aviso del 80 % enviado (una vez al mes)                                      |
| `pausado_at`                       | timestamptz, nullable        | se alcanzó el 100 %                                                          |

**Estado derivado** (función pura `estadoConsumo` en `@mmx/assistant`, con `it.each`):

```
efectivo = limite_ampliado ?? limite_tokens
usados   = tokens_entrada + tokens_salida
usados <  0,8·efectivo → normal
usados ≥  0,8·efectivo → aviso      (envía el aviso si aviso_enviado_at es null)
usados ≥  efectivo     → en_pausa   (no se llama al modelo; ASISTENTE_LIMITE_MENSUAL)
```

- Al ampliar el límite por encima de lo usado, el estado vuelve a `normal` o `aviso` sin más acción. En el mes
  siguiente se crea una fila nueva y el estado vuelve a `normal`.
- No se purga: no tiene datos personales y sirve como histórico de coste.
- El coste estimado en euros se calcula al leer, con `decimal.js` y los precios configurados. No se guarda.

## Entidades no persistidas

- **Fuente de referencia** (`FuenteIndexada`): sección de la guía o de la Ayuda indexada en memoria al arrancar
  (`{ fuenteId, titulo, texto, version }`). Las reglas se leen del `RulesBundle` ya cargado.
- **Simulación** (`ResultadoSimulacion`, `packages/domain/src/simulacion.ts`):
  `ResultadoMotor<DecisionSimulacion, EvidenciasSimulacion> & { supuestos: Record<string, unknown> }`, con
  `DecisionSimulacion = 'VALIDA_HASTA' | 'PERMITIDA' | 'NO_PERMITIDA' | 'EQUIVALENTE' | 'NO_EQUIVALENTE' |
'FALTAN_DATOS'`. Se guarda dentro del intercambio (`simulaciones`).
- **Caso de evaluación**: entrada de `fixtures/asistente/banco.v1.yaml` (schema zod `CasoEvaluacion`).

## Relaciones

```
usuario 1─* asistente_conversacion 1─* asistente_intercambio 1─* asistente_valoracion
receta_linea 0..1─* asistente_conversacion           (solo referencia; sin datos personales)
asistente_consumo_mes                                  (independiente, por mes)
```

## Retención (`retention-sweep`, paso nuevo)

Dentro de la transacción existente y con la marca `mmx.purga_retencion='on'`:
`DELETE FROM asistente_conversacion c WHERE c.created_at < now() - interval '1 year' AND NOT EXISTS (SELECT 1
FROM asistente_intercambio i WHERE i.conversacion_id = c.id AND i.created_at >= now() - interval '1 year')`.

Las cascadas eliminan los intercambios y las valoraciones. La condición `NOT EXISTS` evita que el _trigger_ de
solo inserción rechace la cascada: un intercambio puede ser unas horas posterior al inicio de la conversación,
que se cierra a las 8 h sin actividad. Esas conversaciones se purgan en la ejecución mensual siguiente. El
contador se añade al informe del job. Nunca se borra antes de 1 año.
