# Quickstart & Validation Guide: Asistente de sustitución y stock

**Feature**: `005-assistant-stock-substitutions`  
**Date**: 2026-11-06  
**Status**: Ready for Implementation

Este documento describe los escenarios de prueba y validación para verificar de extremo a extremo que el asistente de consultas ofrece asesoramiento correcto sobre sustitución veterinaria y consulta de stock real.

---

## 1. Prerrequisitos y Configuración

- Node.js 22 y pnpm instalados.
- Base de datos local activa o entorno de test (`pnpm test` / SQLite/Pglite en memoria).
- Caché de CIMAVet con medicamentos veterinarios de muestra (ej. *Prednicortone* u otros corticoides con principios activos comunes).

---

## 2. Escenarios de Validación

### Escenario 1: Consulta de sustitución por falta de existencias (Prednicortone 5 mg)

**Pregunta del usuario en mostrador**:
> «Tengo una receta de prednicortone de 5mg 30comprimidos para un perro pero no tengo, ¿por qué otro podría sustituirlo?»

**Comportamiento esperado**:
1. El asistente reconoce que el interlocutor es el **personal dispensador de mostrador**.
2. **No** emite respuestas del tipo «debes consultar con tu veterinario para que te indique un sustituto».
3. Ejecuta la herramienta `buscar_sustitutos` con `{ nombre: "prednicortone 5mg", especie: "perro" }`.
4. Evalúa que la prescripción ordinaria permite sustitución por falta de existencias (RD 1157/2021).
5. Consulta el stock en Siweb360 (`StockPort`) de los medicamentos equivalentes en CIMAVet (misma composición cuantitativa/cualitativa de prednisolona, comprimidos, para perro).
6. Responde presentando:
   - Alternativas disponibles **con stock en farmacia** (indicando Código nacional y unidades).
   - Alternativas autorizadas **sin existencias** en tienda.
   - Las 3 obligaciones legales del dispensador: recabar consentimiento del tutor, notificar al veterinario prescriptor (o justificar urgencia), y apartar la receta física para firma del garante (modo POST).

### Escenario 2: Intento de sustitución de un medicamento no sustituible (Inmunológico / Biológico)

**Pregunta del usuario en mostrador**:
> «No tengo stock de la vacuna Eurican DAP-L, ¿puedo sustituirla por otra?»

**Comportamiento esperado**:
1. El asistente invoca `buscar_sustitutos` sobre «Eurican DAP-L».
2. El motor de dominio detecta `INMUNOLOGICO` / `BIOLOGICO` (`sustitucionPermitida` = false).
3. El asistente deniega taxativamente la sustitución, cita la normativa de exclusión (RD 1157/2021) e indica que debe tramitarse un pedido al distribuidor (`PEDIR`).

### Escenario 3: Consulta directa de stock por Códigos Nacionales

**Pregunta del usuario en mostrador**:
> «¿Tenemos stock de los códigos nacionales 570016 y 590948?»

**Comportamiento esperado**:
1. El asistente invoca `consultar_stock` con `{ cns: ["570016", "590948"] }`.
2. Informa de las unidades disponibles de cada producto en el almacén de la farmacia.

### Escenario 4: Sustitución de Hedylon 5 mg por Prednicortone 5 mg y solicitud de indicación clínica

**Pregunta del usuario en mostrador**:
> «Tengo una receta de HEDYLON 5 MG 30 COMP el cual no tengo para un perro, ¿por cuál puedo sustituirlo si es posible?»

**Comportamiento esperado**:
1. El asistente reconoce al usuario como dispensador y ejecuta `buscar_sustitutos` para «HEDYLON 5 MG 30 COMP» y especie «perro».
2. El sistema resuelve la especie canónica de CIMAVet (`id: 14`, descartando el duplicado negativo `-29`), identificando como candidato a **Prednicortone 5 mg 30 comprimidos** (nregistro 3313 ESP, CN 584958).
3. Consulta el stock en Siweb360 y detecta existencias disponibles (ej. 7 unidades).
4. El asistente informa de la existencia de Prednicortone 5 mg con stock en la farmacia, pero solicita aclaración de la indicación clínica o patología prescrita para confirmar la coincidencia de indicación antes de formalizar la sustitución.
5. Recuerda las 3 obligaciones legales del dispensador (consentimiento del tutor, comunicación al prescriptor y firma en modo POST del farmacéutico garante).

---

## 3. Comandos de Verificación Automatizada

```bash
# Ejecutar los tests unitarios de las nuevas herramientas del asistente
pnpm --filter @mmx/assistant test

# Ejecutar los tests de integración del orquestador y prompt
pnpm --filter @mmx/assistant test test/orchestrator.test.ts

# Ejecutar el conjunto de linters y verificación de tipos de todo el monorepo
pnpm lint && pnpm typecheck && pnpm test
```
