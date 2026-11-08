# Implementation Plan: Sincronización y autorrelleno de veterinarios y clínicas con SiWeb (ERP)

**Branch**: `006-siweb-vet-clinic-sync` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-siweb-vet-clinic-sync/spec.md`

## Summary

Esta funcionalidad conecta el catálogo de contactos de SiWeb360 (ERP) con la pantalla de entrada y revisión de recetas en PresVetCheck para:

1. **Búsqueda y autorrelleno en tiempo real**: Detectar veterinarios y clínicas existentes en SiWeb (tanto clientes como proveedores) y autocompletar con un solo clic todos sus datos reglamentarios (nombre, colegiado, colegio oficial, teléfono, email, clínica y dirección).
2. **Serialización estructurada en notas**: Almacenar y leer de forma robusta los atributos facultativos que no disponen de campo nativo en el ERP (especialmente el número de colegiado y colegio oficial) empaquetados en un bloque JSON delimitado dentro del campo `notas` de SiWeb, preservando cualquier texto humano preexistente.
3. **Alta directa en SiWeb**: Ofrecer la posibilidad de registrar en SiWeb a un nuevo profesional o clínica cuando no exista previamente, con un solo clic desde el flujo de receta.
4. **Resiliencia y protección de datos**: Asegurar que la indisponibilidad del ERP no bloquee el mostrador y garantizar que ningún dato personal del tutor del animal se envíe a SiWeb.

---

## Technical Context

**Language/Version**: TypeScript 5.8+, Node.js 22 (ESM)  
**Primary Dependencies**: Fastify 5, Zod 3, React 19, Tailwind CSS, `@mmx/shared`, `@mmx/siweb`, `@mmx/db`  
**Storage**: PostgreSQL 16 (Drizzle ORM) para persistencia local de recetas y veterinarios; SiWeb360 REST API para contactos del ERP  
**Testing**: Vitest (`pnpm test`), mocks de MSW con fixtures versionadas en `fixtures/siweb/`  
**Target Platform**: Node.js backend (Azure Container Apps) + React PWA en navegador de mostrador  
**Project Type**: Integración transversal en `@mmx/shared`, `@mmx/siweb`, `apps/api` y `apps/web`  
**Performance Goals**: Búsqueda en SiWeb con respuesta en `< 300ms` (debounced); autocompletado en `< 100ms` tras selección  
**Constraints**:

- Dominio puro (`@mmx/domain` no realiza I/O).
- Respeto absoluto al Principio III de la Constitución: cero datos del tutor del animal enviados a SiWeb.
- Convivencia pacífica con texto libre existente en el campo `notas` de los contactos de SiWeb.
- No bloquear el flujo asistencial de dispensación ante fallos o latencias del ERP.  
  **Scale/Scope**: Catálogo de cientos de clínicas y veterinarios de la zona de influencia de la farmacia.

---

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                    | Check                                                                                             |  Status   | Justification / Implementation                                                                                                       |
| :------------------------------------------- | :------------------------------------------------------------------------------------------------ | :-------: | :----------------------------------------------------------------------------------------------------------------------------------- |
| **I. Code Quality**                          | Dominio puro, TypeScript estricto, Zod en shared, errores tipados                                 | ✅ PASSED | Esquemas Zod en `@mmx/shared/src/schemas/contactos-siweb.ts`. Funciones puras de formateo/parseo de notas. Sin I/O en `@mmx/domain`. |
| **II. Testing Discipline**                   | `pnpm lint && pnpm typecheck && pnpm test` green; MSW y fixtures; sin llamadas a servicios reales | ✅ PASSED | Fixtures y handlers de MSW para `GET /api/public/contacts`, `GET /api/public/contacts/{id}` y `POST /api/public/contacts`.           |
| **III. Security & Data Protection**          | Sin datos personales; bloqueos duros no forzables; sin auth dev en prod                           | ✅ PASSED | Se garantiza la exclusión explícita y testada de los datos del tutor del animal en todas las llamadas de sincronización con SiWeb.   |
| **IV. Maintainability**                      | Variables en `.env.example`; sin suposiciones ocultas; Conventional Commits                       | ✅ PASSED | Reutiliza la configuración existente de `SIWEB_BASE_URL` y `SIWEB_TOKEN`.                                                            |
| **V. Spanish Product, English Architecture** | Documentación y UI en español; código genérico en inglés técnico                                  | ✅ PASSED | Textos de UI y mensajes en español de España; tipos, clientes y contratos en inglés técnico.                                         |

---

## Project Structure

### Documentation (this feature)

```text
specs/006-siweb-vet-clinic-sync/
├── spec.md                         # Especificación funcional
├── plan.md                         # Plan de implementación (este documento)
├── research.md                     # Hallazgos y decisiones técnicas (delimitador en notas, API)
├── data-model.md                   # Modelos de datos y esquemas Zod
├── quickstart.md                   # Guía de validación y escenarios de prueba
├── contracts/
│   └── contactos-siweb.md          # Contrato de endpoints de contactos en la API
└── checklists/
    └── requirements.md             # Validación de calidad de la especificación
```

### Source Code Impact

```text
packages/
├── shared/
│   └── src/
│       ├── schemas/
│       │   └── contactos-siweb.ts  # [NEW] Esquemas Zod de metadatos de veterinario y contactos
│       ├── utils/
│       │   └── notas-siweb.ts      # [NEW] Parseo y formateo seguro de bloque delimitado ---PRESVET---
│       └── index.ts                # Re-exportar utilidades y esquemas
├── siweb/
│   ├── src/
│   │   ├── client.ts               # Añadir métodos contactos(), contacto(), crearContacto()
│   │   └── schemas.ts              # Añadir ContactDetailSchema y CreateContactSchema
│   └── test/
│       └── contactos.test.ts       # [NEW] Tests con MSW de búsqueda y creación de contactos
apps/
├── api/
│   ├── src/
│   │   ├── rutas/
│   │   │   └── contactos-siweb.ts  # [NEW] Endpoints GET y POST /api/contactos-siweb
│   │   └── server.ts               # Registrar rutas de contactos de SiWeb
│   └── test/
│       └── contactos-siweb.test.ts # [NEW] Tests de integración de las rutas
└── web/
    └── src/
        ├── componentes/
        │   └── selector-contacto-siweb.tsx # [NEW] Componente de sugerencias y autocompletado
        └── paginas/
            └── revision.tsx        # Integrar selector y botón de alta en SiWeb en tarjeta Veterinario
```
