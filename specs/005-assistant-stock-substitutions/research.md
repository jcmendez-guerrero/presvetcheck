# Research & Technical Decisions: Asistente de sustitución y stock

**Feature**: `005-assistant-stock-substitutions`  
**Date**: 2026-11-06  
**Status**: Completed

## 1. Contexto y Problema Detectado

En la implementación actual del asistente de consultas (`packages/assistant`):
1. **Confusión de rol/destinatario**: Al recibir la pregunta «tengo una receta de prednicortone de 5mg 30comprimidos para un perro pero no tengo, ¿por qué otro podría sustituirlo?», el modelo asume que quien pregunta es el tutor o propietario del animal en su domicilio («debes consultar con tu veterinario para que te indique un medicamento sustituto adecuado... ya que al tratarse de un fármaco sujeto a prescripción veterinaria no se debe cambiar sin supervisión profesional»). En realidad, el usuario es el **personal dispensador de la farmacia veterinaria** detrás del mostrador, quien legalmente puede realizar una sustitución ante falta de existencias conforme al RD 1157/2021 (SPEC §4.4).
2. **Carencia de herramientas para encontrar equivalentes**: El modelo solo disponía de `simular_equivalencia` (que exige conocer a priori el número de registro del candidato) y `simular_sustituibilidad`. No disponía de una herramienta para buscar automáticamente los medicamentos autorizados equivalentes en la base de datos de CIMAVet. Por ello, el modelo invocaba `simular_sustituibilidad` con parámetros hipotéticos inventados (`biologico: false, nregistro: "3313 ESP"`).
3. **Ausencia de consulta de stock en el asistente**: El asistente no tenía ninguna conexión ni herramienta para consultar el inventario de Siweb360 (`StockPort`), impidiendo saber qué medicamentos están físicamente en la farmacia y cuáles están agotados.

---

## 2. Decisiones Técnicas

### Decisión 1: Ajuste del Prompt de Sistema y Rol del Asistente

- **Decisión**: Modificar `INSTRUCCIONES` en `packages/assistant/src/instrucciones.ts` para fijar inequívocamente la identidad del usuario y las reglas de asistencia en mostrador:
  - El usuario es **personal del establecimiento comercial detallista / auxiliar de farmacia / farmacéutico garante**, atendiendo dispensaciones reales.
  - Se prohíbe explícitamente emitir advertencias de autoconsumo dirigidas a tutores («consulte con su veterinario antes de sustituir»).
  - Ante la falta de stock del medicamento prescrito en una receta ordinaria, el asistente debe orientar sobre el procedimiento de sustitución legal (RD 1157/2021):
    1. Invocar la herramienta `buscar_sustitutos` para localizar alternativas autorizadas y verificar su stock.
    2. Informar de qué alternativas tienen existencias en el almacén de la farmacia y cuáles no.
    3. Recordar las 3 obligaciones legales del dispensador:
       - Conformidad del tutor.
       - Notificación preceptiva al veterinario prescriptor (o justificación de urgencia).
       - Anotación al dorso y apartar la receta física en la bandeja de sustituciones para firma posterior del farmacéutico garante (modo POST).
- **Alternativas consideradas**:
  - *Mantener la prohibición general de consejo clínico*: Se mantiene que el modelo no altera posologías clínicas, pero se clarifica que orientar sobre la sustitución legal reglamentaria por falta de existencias es una función esencial del dispensador, no un «cambio de tratamiento».

---

### Decisión 2: Nueva Herramienta `buscar_sustitutos`

- **Decisión**: Crear una herramienta especializada de solo lectura `buscar_sustitutos` en `packages/assistant/src/tools/sustitucion.ts`.
- **Comportamiento**:
  1. Recibe `{ nregistro?: string; nombre?: string; especie: string; indicacion?: string }`.
  2. Si recibe un nombre, localiza el medicamento prescrito en CIMAVet (`cimavet.buscar` o `cimavet.medicamento`).
  3. Ejecuta la regla determinista de dominio `sustitucionPermitida(prescrito, clase, exclusiones)` (`packages/domain/src/sustitucion.ts`). Si el medicamento es biológico, inmunológico, prescripción excepcional o está en la lista de exclusión, devuelve inmediatamente que la sustitución está legalmente bloqueada y los motivos.
  4. Si es sustituible, ejecuta `cimavet.nregistrosMismosPa(prescrito.nregistro)` para obtener todos los medicamentos veterinarios con la misma composición cualitativa de principios activos.
  5. Carga sus datos y presentaciones (`cimavet.medicamentos` y `cimavet.presentacionesDe`).
  6. Para cada presentación candidata, evalúa `evaluarEquivalencia(prescrito, candidato, contexto, rules.equivalencia)`: verifica misma composición cuantitativa, misma forma farmacéutica, autorizada para la especie y vía compatible.
  7. Si el servicio de stock está disponible, consulta el stock del medicamento prescrito y de todos los CNs equivalentes.
  8. Devuelve una estructura clara para el modelo:
     - `prescrito`: nombre, nregistro, principio activo, forma, concentración y stock actual en almacén.
     - `sustitucionPermitida`: booleano y motivos.
     - `candidatosConStock`: lista de presentaciones equivalentes con stock disponible en la farmacia (CN, nombre, laboratorio, unidades).
     - `candidatosSinStock`: lista de presentaciones equivalentes autorizadas pero sin stock disponible.
     - `obligacionesDispensador`: recordatorio de los 3 pasos legales.
- **Alternativas consideradas**:
  - *Que el modelo llame sucesivamente a `buscar_medicamento`, `simular_equivalencia` y `consultar_stock` por cada candidato*: Descartado. Provocaría múltiples rondas de tool-calling lentas y propensas a que el modelo olvide evaluar candidatos o invente combinaciones. Una herramienta compuesta de alto nivel ejecuta todo el análisis en milisegundos de forma determinista.

---

### Decisión 3: Nueva Herramienta `consultar_stock`

- **Decisión**: Crear la herramienta `consultar_stock` en `packages/assistant/src/tools/stock.ts`.
- **Comportamiento**:
  - Recibe `{ cns: string[] }`.
  - Para cada CN, consulta `d.stock.lotes(cn, null)` o el puerto de stock inyectado.
  - Devuelve `{ items: [{ cn, nombre, unidadesDisponibles, tieneStock, estado }] }`.
- **Razón**: Permite al asistente responder preguntas directas de disponibilidad («¿tenemos stock de este medicamento o de este código nacional?»).

---

### Decisión 4: Inyección de Dependencias de Stock en `packages/assistant`

- **Decisión**:
  - Extender `DepsHerramientas` en `packages/assistant/src/tools/contexto.ts`:
    ```ts
    export interface DepsHerramientas {
      // ...
      stock?: StockPort | null;
    }
    ```
  - En `apps/api/src/crear-deps.ts`, suministrar `stock: d.stock` al instanciar `crearHerramientas(...)`.
  - En caso de que `stock` sea nulo o no responda, las herramientas degradan elegantemente indicando que el stock no pudo verificarse en vivo y debe comprobarse en la balda.

---

### Decisión 5: Compatibilidad con MCP (Model Context Protocol)

- **Decisión**: Las definiciones de las herramientas siguen el estándar `Herramienta` con JSON Schema generado mediante Zod (`z.toJSONSchema`). Esto permite tanto su ejecución interna directa en `ChatOrchestrator` como su fácil exposición como un servidor MCP de herramientas para clientes externos (por ejemplo, agentes IDE o herramientas externas de inspección).

---

### Decisión 6: Normalización Canónica de Especies y Vías en CIMAVet (`id > 0`)

- **Decisión**: Modificar la resolución de especies por texto (`especiePorTexto`) tanto en `packages/cimavet/src/repo.ts` como en `apps/api/src/servicios/medicamentos.ts` para exigir que los registros maestros evaluados tengan `id > 0` y ordenar por `id asc`:
  - **Problema resuelto**: En la API REST oficial de CIMAVet, `maestras?maestra=7&nombre=Perro` devuelve registros duplicados donde el primero es sintético/negativo (`{"id": -29, "nombre": "Perros"}`) y el segundo es canónico (`{"id": 14, "nombre": "Perros"}`). Como las fichas de los medicamentos autorizados vinculan exclusivamente al ID canónico (`14`), seleccionar `-29` provocaba que `autorizadoParaEspecie` fallara con falso negativo (`ESPECIE_NO_AUTORIZADA`).
  - **Armonización de vías**: En Nomenclátor XML, la vía oral se identifica con `cod_via_admin: 54`, mientras que en la API REST `id: 48` corresponde a `codigo: "54"`. El repositorio y motor normalizan el acceso considerando el código oficial para garantizar compatibilidad entre medicamentos sincronizados por diferentes vías.
- **Alternativas consideradas**:
  - *Filtrar solo en el asistente*: Descartado. La resolución errónea de especie afectaría también a la revisión manual y evaluación de recetas (`recetas.ts`). Debe corregirse a nivel de repositorio y servicio maestro.

---

### Decisión 7: Aclaración Interactiva de la Indicación Clínica en Mostrador

- **Decisión**: Si la consulta en mostrador no especifica la indicación o diagnóstico clínico prescrito (p. ej., «receta de Hedylon 5 mg para perro»):
  1. `buscar_sustitutos` evalúa la sustituibilidad técnica por principio activo, dosis, forma y especie destino, calculando las existencias en farmacia de los candidatos.
  2. Si no se proporcionó indicación explícita, marca `requiereAclaracionIndicacion: true`.
  3. El asistente presenta los medicamentos alternativos con existencias en el establecimiento e inmediatamente solicita aclaración de la patología/indicación antes de emitir la validación de sustitución definitiva, cumpliendo con la exigencia regulatoria sin bloquear la identificación preliminar de existencias.
- **Alternativas consideradas**:
  - *Asumir automáticamente la indicación autorizada común*: Rechazado por el usuario en la sesión de clarificación (Opción B elegida). Se debe pedir aclaración al profesional para verificar la patología específica.
