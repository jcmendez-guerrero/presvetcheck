# ADR-17 · Asistente de consultas con herramientas deterministas

- **Estado:** propuesta (pendiente de aprobación de JC)
- **Especificación:** `specs/002-prescription-chat-assistant/`

## Contexto

El personal tiene dudas de mostrador (validez de una receta, sustitución, cambio de formato, psicótropos…) cuya
respuesta está repartida entre la guía de la receta, las reglas versionadas del motor y la Ayuda. ADR-12 (DUDA-27)
retiró Azure OpenAI de la extracción de recetas; esta decisión reintroduce un modelo generativo con un papel
distinto: **explicar**, nunca decidir.

## Decisión

Un asistente conversacional en español que usa un modelo de chat de Azure OpenAI ya desplegado (directo o
a través de Azure AI Foundry: la API de chat es la misma y solo cambia la URL configurada).

1. **Cliente HTTP propio** (como `DocumentIntelligenceClient`): sin SDK nuevo ni recursos de Azure nuevos; se
    usa la credencial de la propia app. El procesamiento es en la UE.
2. **Herramientas, no reglas en el prompt.** Las instrucciones del modelo solo dicen cómo comportarse. Las
    reglas se leen en el momento de responder (`config/rules/*.yaml`, guía, Ayuda, caché de CIMAVet) y los
    cálculos los hace `packages/domain` (simulaciones puras, sin escribir nada). Un test falla si las
    instrucciones contienen plazos, cantidades o códigos de regla.
3. **Todas las herramientas son de solo lectura:** el asistente no autoriza, no fuerza ni modifica nada.
4. **Fidelidad verificable:** salida estructurada; la API rechaza citas que no procedan de las herramientas del
    mismo turno, y las simulaciones y el resultado del motor se muestran desde los datos del motor, no desde el
    texto del modelo.
5. **Datos personales:** el contexto de una línea es una lista blanca (sin titular ni veterinario) y la pregunta
    se sanea antes de enviarla y de guardarla.
6. **Trazabilidad:** cada intercambio es de solo inserción con versión de reglas, fuentes, modelo e
    instrucciones; se eliminan al año.
7. **Coste:** límite mensual global de tokens; aviso al 80 %, pausa al 100 %.

## Alternativas descartadas

- Reglas dentro del prompt: incumple la constitución (III) y obliga a reescribir el prompt al cambiar una regla.
- Búsqueda vectorial (Azure AI Search, pgvector): coste e infraestructura sin ganancia para un corpus pequeño.
- _Agents_ de Foundry con estado en el servicio: las herramientas deben ejecutarse en la API y las
  conversaciones han de vivir en nuestra base de datos para cumplir la retención.
- Preguntas frecuentes estáticas: no entienden otras formulaciones ni casos hipotéticos.

## Consecuencias

- Actualizar `SPEC.md` §9.2 y §9.3 y el Registro de Actividades de Tratamiento (RAT).
- El banco de evaluación (`pnpm eval:asistente`) es orientativo y no condiciona la activación.
