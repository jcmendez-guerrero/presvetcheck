# Implementation Plan: Asistente de consultas sobre prescripción y dispensación

**Branch**: `claude/chat-medication-consultation-ec1a4a` (feature `001-prescription-chat-assistant`) | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Especificación de `specs/001-prescription-chat-assistant/spec.md`

## Summary

Asistente conversacional en español que explica las reglas de prescripción, validez, sustitución, cambio de
formato, psicótropos, etc., y el resultado del motor para una línea de receta. El enfoque técnico es **un modelo
de lenguaje con herramientas deterministas**:

- El modelo (un despliegue de Azure OpenAI ya existente, al que se accede directamente o a través de Azure AI
  Foundry) **no lleva ninguna regla legal en sus instrucciones**. Solo tiene instrucciones de comportamiento:
  citar fuentes, no calcular, declinar lo que está fuera de ámbito y responder en español.
- Para responder, el modelo llama a **herramientas** que ejecuta la API:
  - lectura de las reglas versionadas de `config/rules/*.yaml`;
  - búsqueda en la guía de la receta (`docs/ref/guia-receta-veterinaria.md`) y en la Ayuda;
  - consulta de la caché de CIMAVet;
  - contexto de una línea sin datos personales;
  - **simulaciones** con el motor de `packages/domain`.
- La API valida la salida estructurada del modelo: las fuentes citadas tienen que proceder de llamadas a
  herramientas hechas en ese mismo turno, y las cifras y los equivalentes se pintan desde los datos del motor,
  no desde el texto del modelo.
- La API elimina los datos personales antes de enviar nada al modelo, registra cada intercambio con un rastro
  inmutable (se purga al año) y controla el consumo mensual.
- Hay un proveedor falso para los tests y un banco de evaluación orientativo (`pnpm eval:asistente`).

## Technical Context

**Language/Version**: TypeScript 5.8 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Node.js 22

**Primary Dependencies**: las que ya hay en el monorepo: Fastify 5 + `fastify-type-provider-zod`, zod 4,
Drizzle ORM, React + Vite (web), `@azure/identity` (ya presente), `decimal.js`, `@js-temporal/polyfill`. El
cliente del modelo es HTTP propio con `fetch`, como `DocumentIntelligenceClient`. **No se añade ningún SDK de IA
ni una base vectorial** (research R2, R3).

**Storage**: PostgreSQL 16 (tablas nuevas `asistente_*`, migración `0015_asistente.sql`) y PGlite en los tests.
Índice léxico en memoria para la guía y la Ayuda, construido al arrancar.

**Testing**: Vitest (dominio con `it.each`, servicio con `FakeAssistantModel`, cliente Azure con MSW y
respuestas grabadas en `fixtures/asistente/`), Playwright (smoke test del panel con `ASSISTANT=fake`) y banco de
evaluación manual `pnpm eval:asistente`.

**Target Platform**: el contenedor actual en Azure Container Apps (entorno `np`, North Europe) y la PWA en las
tablets y PC de la farmacia.

**Project Type**: aplicación web (monorepo `apps/api`, `apps/web`, `apps/worker` + `packages/*`).

**Performance Goals**: el 90 % de las respuestas en menos de 10 s (SC-006). Como mucho 4 rondas de herramientas
por turno, con un tiempo máximo de 20 s por turno.

**Constraints**:
- Ningún dato del titular ni la identidad del veterinario llegan al modelo (FR-018, FR-021a).
- Procesamiento en la UE: despliegue *Data Zone* UE o regional UE.
- Ninguna regla legal en las instrucciones del modelo (FR-006).
- Ninguna llamada a servicios reales desde CI.
- Si el asistente falla o no está disponible, nada más en la app se ve afectado (FR-026).

**Scale/Scope**: un establecimiento, unas 5–10 personas usuarias, se estiman ≤ 200 preguntas al día. Hay 4
historias de usuario, unas 10 rutas nuevas, 1 panel, 1 página de histórico y 1 bloque de administración.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo se cumple | Estado |
|---|---|---|
| **I. Calidad de código** | Las simulaciones viven en `packages/domain/src/simulacion.ts`: puras, con `Clock` inyectado y devolviendo `{ decision, motivos[], evidencias, reglaVersion }`. Las entradas y salidas de las herramientas y de la API son schemas zod en `packages/shared/src/schemas/asistente.ts`. Los errores son `DomainError` con `code` estable (`ASISTENTE_NO_DISPONIBLE`, `ASISTENTE_LIMITE_MENSUAL`, `ASISTENTE_DESACTIVADO`…). El consumo económico se calcula con `decimal.js` y las fechas en `Europe/Madrid`. No hay dependencias pesadas nuevas. | ✅ |
| **II. Disciplina de pruebas** | Tablas `it.each` para las simulaciones, el saneado de datos personales y la validación de citas. `FakeAssistantModel` con guiones de llamadas a herramientas. MSW con respuestas grabadas de la API de chat (incluidos 5xx, *timeout*, campos desconocidos y `content_filter`). Ninguna llamada real en CI. Smoke test de Playwright. Si falta una respuesta real grabada, se deja un `it.todo` indicando qué fichero hace falta. | ✅ |
| **III. Seguridad y datos** | Saneado previo de lo que escribe el empleado (DNI/NIE con `dni.ts`, teléfono, correo, dirección y coincidencia exacta con el titular y el veterinario de la receta en contexto). El contexto de la línea sale de un DTO con lista blanca de campos (zod `.strict()`). Se redactan `*.pregunta` y `*.respuesta` en el logger. Los intercambios son de solo inserción (protección en la BD, como en la migración 0004) con purga solo por retención. El asistente no tiene herramientas de escritura, así que no puede forzar ni autorizar nada. **Las reglas legales no están en las instrucciones**: hay un test que lo comprueba. Sin claves en la configuración (se reutiliza la credencial de la app, como en Document Intelligence). Variables nuevas validadas con zod. | ✅ |
| **IV. Mantenibilidad** | Variables `ASSISTANT_*` en `.env.example`. ADR-16 nuevo. `SPEC.md` §9.3 se modifica: la IA también explica, pero sigue sin decidir. Términos nuevos en `docs/glosario.md` (asistente, simulación, fuente de referencia). PR propia: esta funcionalidad no pertenece a ningún bloque de §12.1 (ver Complexity Tracking). | ✅ con justificación |
| **V. Idioma** | Interfaz, instrucciones del modelo, mensajes y documentación en español. Identificadores genéricos en inglés (`AssistantModel`, `ChatOrchestrator`, `PiiScrubber`). Términos regulatorios en español (`receta`, `nregistro`, `cn`). Los `code` de error se traducen en `errores.es.json`. | ✅ |
| **Cumplimiento y trazabilidad** | Cada intercambio guarda `reglaVersion`, versión de las fuentes, modelo y versión de instrucciones. El asistente no escribe en Siweb360 ni en los registros. Hay que actualizar el RAT de Facilita: finalidad «consultas internas», sin datos del titular, retención de 1 año. | ✅ (la acción sobre el RAT es externa al código) |
| **Workflow** | `pnpm lint && pnpm typecheck && pnpm test` y `pnpm test:int` (migración y protección de solo inserción). ADR escrito junto con el cambio. | ✅ |

**Resultado de la puerta**: superada. Las dos justificaciones están en Complexity Tracking.

### Revisión tras el diseño (Fase 1)

| Punto | Comprobación sobre los artefactos | Estado |
|---|---|---|
| Reglas fuera de las instrucciones | [herramientas.md](./contracts/herramientas.md): las reglas solo llegan por `consultar_reglas` o `simular_*`; R4 añade un test contra reglas en las instrucciones | ✅ |
| Decisiones del motor nunca como booleano | Las simulaciones devuelven `{ decision, motivos[], evidencias, reglaVersion }` más `supuestos` ([data-model.md](./data-model.md)) | ✅ |
| Datos personales | DTO `.strict()` de `contexto_linea`, `PiiScrubber` en pregunta, comentario y texto (V7), redacción en el logger. Ninguna tabla guarda datos del titular | ✅ |
| Inmutabilidad | `asistente_intercambio` es de solo inserción con *trigger*; la purga solo por retención, con la marca de sesión existente | ✅ |
| Ningún servicio real en tests | `FakeAssistantModel` y MSW con `fixtures/asistente/chat/*.json`; el banco real es manual (`pnpm eval:asistente`) | ✅ |
| Datos externos no inventados | Las respuestas grabadas del servicio de chat tienen que proceder de llamadas reales anonimizadas. Si no están, los tests del cliente Azure quedan como `it.todo` indicando qué fichero falta | ✅ |
| *Seeds* de la demo | El quickstart usa *seeds* que hay que crear en las tareas: receta caducada, receta ya dispensada y consumo en pausa | ⚠️ pendiente para `/speckit-tasks` |

Resultado: superada, sin violaciones nuevas.

## Project Structure

### Documentation (this feature)

```text
specs/001-prescription-chat-assistant/
├── plan.md              # Este fichero
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/
│   ├── api.md           # Rutas HTTP del asistente
│   ├── herramientas.md  # Herramientas que el modelo puede llamar (contrato modelo ↔ API)
│   └── salida-modelo.md # Salida estructurada del modelo y su validación
├── checklists/requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/
├── domain/src/
│   └── simulacion.ts                # NUEVO: simulaciones puras (validez, formato, sustituibilidad, equivalencia)
├── shared/src/
│   ├── schemas/asistente.ts         # NUEVO: zod de herramientas, salida del modelo, DTO y API
│   ├── ayuda/                       # NUEVO: contenido de la Ayuda como datos (lo usan la web y el índice)
│   │   └── secciones.ts
│   ├── config.ts                    # + variables ASSISTANT_*
│   └── i18n/errores.es.json         # + códigos ASISTENTE_*
├── assistant/                       # NUEVO paquete @mmx/assistant
│   ├── src/
│   │   ├── model.ts                 # puerto AssistantModel
│   │   ├── fake.ts                  # FakeAssistantModel (guiones)
│   │   ├── azure/chat-client.ts     # cliente HTTP de chat completions (Azure OpenAI / Foundry)
│   │   ├── factory.ts               # crearModeloAsistente(config) → fake | azure | desactivado
│   │   ├── instrucciones.v1.md      # instrucciones de comportamiento (sin reglas legales)
│   │   ├── orchestrator.ts          # ChatOrchestrator: ronda de herramientas, validación y respuesta
│   │   ├── tools/                   # herramientas: reglas, guía, ayuda, cimavet, línea, simulaciones
│   │   ├── fuentes/indice.ts        # índice léxico de la guía y la Ayuda por secciones
│   │   ├── pii.ts                   # PiiScrubber
│   │   ├── citas.ts                 # validación de citas y respuestas «sin información»
│   │   └── eval/run.ts              # pnpm eval:asistente
│   └── test/
└── db/
    ├── src/schema/asistente.ts      # NUEVO: tablas asistente_*
    └── migrations/0015_asistente.sql

apps/
├── api/src/
│   ├── rutas/asistente.ts           # NUEVO
│   ├── servicios/asistente.ts       # NUEVO: conversaciones, consumo, histórico, contexto de línea
│   ├── deps.ts / crear-deps.ts      # + asistente
│   └── app.ts                       # + rutas de redacción (*.pregunta, *.respuesta)
├── web/src/
│   ├── componentes/asistente.tsx    # NUEVO: botón flotante + panel lateral
│   ├── paginas/asistente-historico.tsx # NUEVO
│   ├── paginas/ayuda.tsx            # pasa a pintar packages/shared/src/ayuda
│   ├── paginas/resultado.tsx, dispensacion.tsx # + «Preguntar al asistente» por línea
│   └── paginas/admin.tsx            # + bloque de consumo del asistente
└── worker/src/jobs/
    ├── retencion.ts                 # + purga a 1 año de las tablas asistente_*
    └── reportes.ts                  # + consumo del mes en el reporte semanal

fixtures/asistente/
├── banco.v1.yaml                    # banco de evaluación (validado por JC)
└── chat/*.json                      # respuestas grabadas de la API de chat para MSW

docs/
├── adr/0016-asistente-de-consultas-con-herramientas-deterministas.md
└── glosario.md                      # + términos
```

**Structure Decision**: se sigue la estructura del monorepo. Un paquete nuevo `@mmx/assistant` aísla el
proveedor de IA (igual que `@mmx/extraction`). Las simulaciones van a `packages/domain`, porque son reglas. Los
schemas compartidos van a `packages/shared`. El contenido de la Ayuda sale de JSX a datos para que lo usen tanto
la web como el índice del asistente.

## Complexity Tracking

| Violación / desviación | Por qué hace falta | Alternativa más simple descartada porque |
|---|---|---|
| Se reintroduce un servicio de IA generativa, retirado en DUDA-27, y se amplía `SPEC.md` §9.3 («la IA solo extrae datos») | La funcionalidad es una conversación en lenguaje natural que no se puede resolver con reglas | Un buscador de preguntas frecuentes no entiende preguntas con otras palabras ni casos hipotéticos. Se mantiene el principio: la IA no decide, el motor calcula y la persona decide (ADR-16) |
| PR fuera de los bloques de §12.1 | §12.1 describe la Fase 0; esta funcionalidad es posterior | Meterla en otro bloque mezclaría cambios sin relación |
| Paquete nuevo `@mmx/assistant` | Aísla el proveedor y el orquestador, con tests propios, como `@mmx/extraction` | Meterlo en `apps/api` mezclaría la integración externa con las rutas y haría más difícil el banco de evaluación |
