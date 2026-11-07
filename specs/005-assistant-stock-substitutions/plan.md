# Implementation Plan: Asistente de sustitución de medicamentos con consulta de CIMAVet y stock en tiempo real

**Branch**: `005-assistant-stock-substitutions` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-assistant-stock-substitutions/spec.md`

## Summary

Esta funcionalidad corrige el asesoramiento del asistente conversacional ante consultas de sustitución por falta de existencias y resuelve la confusión de rol en la atención al mostrador:
1. **Alineación de rol y destinatario**: El asistente asume explícitamente como interlocutor al personal del establecimiento dispensador (no al tutor/dueño del animal), eliminando advertencias improcedentes de «consulte a su veterinario antes de cambiar el fármaco» y orientando al procedimiento regulatorio de sustitución en mostrador (RD 1157/2021).
2. **Herramienta `buscar_sustitutos`**: Integra búsqueda en CIMAVet (`nregistrosMismosPa`) con las reglas de equivalencia determinista (`evaluarEquivalencia` en `@mmx/domain`) y el puerto de inventario (`StockPort` / Siweb360) para devolver candidatos autorizados desglosados en «con stock en farmacia» y «sin stock».
3. **Herramienta `consultar_stock`**: Permite al asistente verificar existencias por Código nacional (CN) en el almacén de la farmacia.
4. **Normalización canónica de especies y vías en CIMAVet (FR-013, FR-014)**: Filtra exclusivamente identificadores maestros positivos (`id > 0`) para especies en CIMAVet (descartando identificadores sintéticos negativos como `-29` frente a `14` para «Perros») y armoniza los códigos de vía de administración entre el Nomenclátor XML y la API REST para evitar falsos negativos en `evaluarEquivalencia`.
5. **Aclaración interactiva de indicación clínica (FR-015)**: Cuando una consulta en mostrador no especifica la patología prescrita, el asistente presenta los candidatos coincidentes en composición, forma y especie con existencias y solicita aclaración de la indicación antes de emitir la confirmación definitiva.
6. **Recordatorio reglamentario**: Estructura las respuestas recordando las 3 obligaciones legales para el dispensador (consentimiento del tutor, notificación al prescriptor y receta física apartada para firma en modo POST del garante).
7. **Tabla comparativa de criterios de sustitución (FR-016)**: El motor de simulación (`simularEquivalencia` en `@mmx/domain`) genera en `evidencias.comparativa` un desglose estructurado fila a fila de los criterios reglamentarios evaluados (principio activo, concentración, forma, vía, especie, indicación y tiempos de espera) enriquecidos con nombres legibles vía `nombresFicha` de CIMAVet, y la interfaz web (`TarjetaSimulacion` en `apps/web`) renderiza una tabla comparativa visual con distintivos gráficos de cumplimiento (✓ / ✗).
8. **Selección interactiva de sustituto y sobreescritura con motivo en pantalla de Resultado (`ResultadoReceta`, US6, FR-017)**: Cuando una línea de receta no tiene stock o la decisión es `PEDIR` (por ejemplo, Bioclanic 50/12,5 mg), la pantalla de resultado permite buscar un medicamento sustituto del catálogo/almacén (ej. Clavusan 50/12,5 mg), evaluar en tiempo real la equivalencia mostrando la tabla de criterios de los 7 campos normativos, y habilitar la sobreescritura de la línea con motivo obligatorio introducido por el dispensador (sin requerir confirmación del garante en pantalla, separando la receta física para firma posterior en modo POST), siempre que no se vulnere un `BLOQUEANTE_DURO`.
9. **Página dedicada de Vademécum y Comparador de Sustitución (`/vademecum`, US7, FR-018)**: Nueva página en el menú de navegación principal (`apps/web/src/paginas/vademecum.tsx`) para la consulta libre y comparación de cualquier medicamento de referencia A frente a un candidato B para una especie e indicación dadas, invocando el endpoint de comparación y renderizando la tabla comparativa de criterios y conclusión reglamentaria.

---

## Technical Context

**Language/Version**: TypeScript 5.8+, Node.js 22 (ESM)  
**Primary Dependencies**: `@azure/openai` / `@google/genai` (asistente), Fastify, Zod 3, `@mmx/domain`, `@mmx/cimavet`, `@mmx/siweb`  
**Storage**: PostgreSQL 16 (Drizzle ORM) para caché de CIMAVet y trazabilidad del chat  
**Testing**: Vitest (`pnpm test`), mocks de MSW para Siweb y fixtures de CIMAVet  
**Target Platform**: Node.js backend (Azure Container Apps) + React PWA  
**Project Type**: Paquete `@mmx/assistant` + integración en API (`apps/api`) y esquemas en `@mmx/shared`  
**Performance Goals**: Búsqueda de sustitutos con comprobación de stock en `< 500ms`; respuesta total del asistente `< 3s`  
**Constraints**:
- Dominio puro (`@mmx/domain` no realiza I/O).
- Todas las herramientas del asistente son de **solo lectura** (no alteran inventario ni completan dispensaciones).
- Ningún dato personal (PII) en los mensajes o logs.
- Respuestas en español de España claro y sin códigos internos expuestos.  
**Scale/Scope**: Consultas interactivas en mostrador durante la atención farmacéutica diaria.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status | Justification / Implementation |
| :--- | :--- | :---: | :--- |
| **I. Code Quality** | Dominio puro, TypeScript estricto, Zod en shared, errores tipados | ✅ PASSED | La lógica de equivalencia y exclusión de sustitución se evalúa mediante funciones puras de `@mmx/domain`. Esquemas Zod en `@mmx/shared`. |
| **II. Testing Discipline** | `pnpm lint && pnpm typecheck && pnpm test` green; MSW y fixtures; sin llamadas a servicios reales | ✅ PASSED | Tests unitarios para las nuevas herramientas y tests de integración con el orquestador y mocks de stock. |
| **III. Security & Data Protection** | Sin datos personales; bloqueos duros no forzables; sin auth dev en prod | ✅ PASSED | Las consultas de candidatos y stock solo manejan identificadores de fármacos (nregistro, CN, especie), sin PII. |
| **IV. Maintainability** | Variables en `.env.example`; sin suposiciones ocultas; Conventional Commits | ✅ PASSED | Sigue la arquitectura establecida de herramientas en `ToolRegistry` y reutiliza el `StockPort` existente. |
| **V. Spanish Product, English Architecture** | Documentación y UI en español; código genérico en inglés técnico | ✅ PASSED | Respuestas del asistente y textos de UI en español de España; contratos, tipos e identificadores en inglés técnico. |

---

## Project Structure

### Documentation (this feature)

```text
specs/005-assistant-stock-substitutions/
├── spec.md                         # Especificación funcional
├── plan.md                         # Plan de implementación (este documento)
├── research.md                     # Hallazgos y decisiones técnicas
├── data-model.md                   # Modelos de datos y esquemas de herramientas
├── quickstart.md                   # Guía de validación y escenarios de prueba
├── contracts/
│   └── herramientas-sustitucion-stock.md  # Contrato de herramientas del asistente
└── checklists/
    └── requirements.md             # Validación de calidad de la especificación
```

### Source Code Impact

```text
packages/
├── shared/
│   └── src/schemas/
│       └── asistente.ts            # Añadir CriterioComparativaSustitucion, ArgsBuscarSustitutos, ArgsConsultarStock
├── domain/
│   ├── src/
│   │   └── simulacion.ts           # Generar comparativa en simularEquivalencia
│   └── test/
│       └── simulacion.test.ts      # Tests de evidencias.comparativa
├── cimavet/
│   └── src/
│       ├── repo.ts                 # Filtrar id > 0 en especiePorTexto y normalizar vías
│       └── normalizar.ts           # Mapear códigos de vía y especie canónicos
├── assistant/
│   ├── src/
│   │   ├── instrucciones.ts        # Actualizar prompt: rol dispensador, solicitud de indicación si falta
│   │   ├── tools/
│   │   │   ├── contexto.ts         # Añadir stock?: StockPort a DepsHerramientas
│   │   │   ├── sustitucion.ts      # Herramienta buscar_sustitutos con stock y flag aclaración
│   │   │   ├── stock.ts            # Herramienta consultar_stock
│   │   │   ├── simulaciones-medicamento.ts # Enriquecer nombresFicha en simular_equivalencia
│   │   │   └── index.ts            # Registrar buscar_sustitutos y consultar_stock
│   │   └── index.ts                # Exportar nuevas herramientas y tipos
│   └── test/
│       ├── tools-sustitucion.test.ts # Tests de buscar_sustitutos, stock y especies duplicadas
│       └── orchestrator.test.ts    # Caso de consulta de sustitución y aclaración
apps/
├── api/
│   └── src/
│       ├── crear-deps.ts           # Inyectar d.stock en crearHerramientas(...)
│       ├── rutas/
│       │   ├── medicamentos.ts     # POST /api/medicamentos/comparar
│       │   └── recetas.ts          # POST /api/recetas/:id/lineas/:orden/sustituir-manual
│       └── servicios/
│           └── medicamentos.ts     # especiePorTexto filtrando id > 0
└── web/
    └── src/
        ├── main.tsx                # Registrar ruta /vademecum
        ├── componentes/
        │   ├── asistente.tsx       # Renderizar tabla comparativa en TarjetaSimulacion
        │   └── layout.tsx          # Añadir enlace Vademécum al menú principal NAV
        └── paginas/
            ├── resultado.tsx       # Buscador interactivo de sustituto, tabla comparativa y sobreescritura con motivo
            └── vademecum.tsx       # Nueva página de consulta libre y comparador de sustitución A vs B
```

---

## Complexity Tracking

> Ninguna violación a la constitución identificada. Se reutilizan las estructuras de datos y puertos existentes.
