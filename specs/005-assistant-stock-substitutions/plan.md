# Implementation Plan: Asistente de sustitución de medicamentos con consulta de CIMAVet y stock en tiempo real

**Branch**: `005-assistant-stock-substitutions` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-assistant-stock-substitutions/spec.md`

## Summary

Esta funcionalidad corrige el asesoramiento del asistente conversacional ante consultas de sustitución por falta de existencias y resuelve la confusión de rol en la atención al mostrador:
1. **Alineación de rol y destinatario**: El asistente asume explícitamente como interlocutor al personal del establecimiento dispensador (no al tutor/dueño del animal), eliminando advertencias improcedentes de «consulte a su veterinario antes de cambiar el fármaco» y orientando al procedimiento regulatorio de sustitución en mostrador (RD 1157/2021).
2. **Herramienta `buscar_sustitutos`**: Integra búsqueda en CIMAVet (`nregistrosMismosPa`) con las reglas de equivalencia determinista (`evaluarEquivalencia` en `@mmx/domain`) y el puerto de inventario (`StockPort` / Siweb360) para devolver candidatos autorizados desglosados en «con stock en farmacia» y «sin stock».
3. **Herramienta `consultar_stock`**: Permite al asistente verificar existencias por Código nacional (CN) en el almacén de la farmacia.
4. **Recordatorio reglamentario**: Estructura las respuestas recordando las 3 obligaciones legales para el dispensador (consentimiento del tutor, notificación al prescriptor y receta física apartada para firma en modo POST del garante).

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
│       └── asistente.ts            # Añadir ArgsBuscarSustitutos y ArgsConsultarStock
├── assistant/
│   ├── src/
│   │   ├── instrucciones.ts        # Actualizar prompt de sistema: rol de personal dispensador y reglas de sustitución
│   │   ├── tools/
│   │   │   ├── contexto.ts         # Añadir stock?: StockPort a DepsHerramientas
│   │   │   ├── sustitucion.ts      # [NEW] Herramienta buscar_sustitutos
│   │   │   ├── stock.ts            # [NEW] Herramienta consultar_stock
│   │   │   └── index.ts            # Registrar buscar_sustitutos y consultar_stock
│   │   └── index.ts                # Exportar nuevas herramientas y tipos
│   └── test/
│       ├── tools-sustitucion.test.ts # [NEW] Tests de buscar_sustitutos y consultar_stock
│       └── orchestrator.test.ts    # Actualizar / añadir caso de consulta de sustitución
apps/
└── api/
    └── src/
        └── crear-deps.ts           # Inyectar d.stock en crearHerramientas(...)
```

---

## Complexity Tracking

> Ninguna violación a la constitución identificada. Se reutilizan las estructuras de datos y puertos existentes.
