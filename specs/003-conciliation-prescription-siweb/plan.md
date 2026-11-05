# Implementation Plan: Conciliación TPV, Revisión Pantalla Completa y Siweb360 API 1.2.0

**Branch**: `003-conciliation-prescription-siweb` | **Date**: 2026-11-05 | **Spec**: [specs/003-conciliation-prescription-siweb/spec.md](spec.md)

**Input**: Feature specification from `specs/003-conciliation-prescription-siweb/spec.md`

## Summary

Implementar mejoras operativas en el flujo de farmacia veterinaria compuestas por:
1. **Conciliación TPV**: Búsqueda asistida de tickets por número (ej. `XXX-2026-000458`) y emparejamiento manual de líneas de venta cuando el producto carece de prefijo literal `CN` en el TPV, resolviendo dispensaciones pendientes como BONQAT CN 590948 con auditoría completa.
2. **Espacio de Revisión de Recetas en Pantalla Completa**: Habilitar `anchoCompleto: true` en la revisión de recetas y reorganizar la columna documental en un panel dividido donde la imagen y el texto OCR reconocido se visualizan lado a lado de forma contigua, eliminando el scroll vertical.
3. **Integración Siweb360 API 1.2.0**: Actualizar la especificación y el cliente `@mmx/siweb` incorporando `PUT /api/public/inventory/variants/{id}/pricing` y `GET /api/public/inventory/movements`, sincronizando costes y precios desde el outbox tras la recepción de albaranes.

## Technical Context

**Language/Version**: Node.js 22, TypeScript 5.6+ en modo estricto (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`).

**Primary Dependencies**: Fastify 5 (API), React 18 / TanStack Router / TanStack Query (Web), Drizzle ORM (Base de datos), Zod (Validación de contratos y esquemas), `decimal.js` (Cálculos monetarios y céntimos), Lucide React (Iconografía UI).

**Storage**: PostgreSQL 16 (tablas `dispensacion`, `conciliacion`, `audit_event`, `outbox`, `siweb_variant_map`), Azure Blob Storage / Azurite (documentos e imágenes).

**Testing**: Vitest (tests unitarios y de integración con MSW para Siweb360 y fixtures), Testcontainers (PostgreSQL en integración).

**Target Platform**: Navegadores modernos (Google Chrome, Firefox, Safari) en desktop/portátil para el personal de farmacia, y backend en Node.js contenedorizado (Azure Container Apps).

**Project Type**: Monorepo TypeScript (pnpm workspaces): `packages/domain` (puro), `packages/shared`, `packages/db`, `packages/siweb`, `apps/api`, `apps/web`, `apps/worker`.

**Performance Goals**: Búsqueda e inspección de tickets en < 1 segundo; renderizado simultáneo del visor de imagen y transcripción OCR a 60 fps; cálculo de céntimos sin latencia.

**Constraints**:
- El dominio (`packages/domain`) permanece estrictamente puro: sin I/O ni dependencias externas.
- Ninguna salida de stock se escribe directamente en Siweb360 (regla constitucional SPEC §5.2.4: las salidas las descuenta exclusivamente el ticket del TPV).
- Actualizaciones en Siweb360 pasan obligatoriamente por el outbox transaccional.
- Cero fugas de datos personales en logs o errores.

**Scale/Scope**: ~10-100 dispensaciones diarias, ~50 tickets diarios de TPV, 3 pantallas web modificadas/ampliadas (`/pendientes`, `/recetas/:id/revision`, visor compartido).

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Principio I (Calidad de código y pureza del dominio)**: `packages/domain` no realiza I/O ni invoca APIs externas. Las reglas de conciliación (`conciliar`) devuelven estructuras tipadas. Moneda calculada con `decimal.js`. Zod schemas centralizados.
- [x] **Principio II (Disciplina de pruebas)**: Cobertura con Vitest y MSW usando fixtures representativas para tickets con nombres sin CN y llamadas a `PUT /variants/:id/pricing`. No hay llamadas a APIs reales durante los tests automáticos.
- [x] **Principio III (Seguridad y protección de datos)**: Los tickets y logs no almacenan ni transmiten datos de carácter personal del cliente. Todo enlace manual de tickets queda registrado en `audit_event`.
- [x] **Principio IV (Mantenibilidad)**: Variables de entorno documentadas en `.env.example`. Commits convencionales.
- [x] **Principio V (Castellano en producto, inglés en código genérico)**: Textos de UI y mensajes en español de España sin anglicismos ni jerga técnica ("Código nacional", "Ticket", "Conciliación").
- [x] **Trazabilidad regulatoria**: No se actualizan ni borran dispensaciones finalizadas. El outbox gestiona de forma desacoplada la escritura de precios en Siweb360.

---

## Project Structure

### Documentation (this feature)

```text
specs/003-conciliation-prescription-siweb/
├── spec.md              # Requisitos funcionales y decisiones ratificadas
├── plan.md              # Este documento de arquitectura técnica
├── research.md          # Fase 0: Decisiones técnicas y alternativas
├── data-model.md        # Fase 1: Entidades, modelos de base de datos y UI
├── quickstart.md        # Fase 1: Guía ejecutable de verificación
└── contracts/           # Fase 1: Contratos de API y UI
    ├── api-conciliacion.md
    ├── api-siweb360.md
    └── ui-receta-completa.md
```

### Source Code (repository layout)

```text
packages/
├── domain/src/
│   └── conciliacion.ts        # Tipos y función pura de conciliación
├── siweb/src/
│   ├── schemas.ts             # Esquemas Zod (precios, movimientos, tickets)
│   ├── client.ts              # Cliente Siweb (actualizarPrecios, ticketPorNumero)
│   ├── ventas.ts              # Adaptador de tickets con resolución de nombres
│   ├── conciliacion.ts        # Lógica de conciliación contra base de datos
│   └── outbox.ts              # Manejador de evento siweb_actualizar_precio
├── db/src/
│   └── schema.ts              # Esquema Drizzle (origen en conciliacion)
apps/
├── api/src/
│   ├── servicios/
│   │   ├── conciliacion.ts    # Búsqueda de tickets y asociación manual
│   │   └── recepciones.ts     # Encolado de outbox para precios
│   └── rutas/
│       └── registros.ts       # Endpoints /api/conciliacion/tickets y /asociar
├── web/src/
│   ├── main.tsx               # Ruta /recetas/$id/revision con anchoCompleto
│   ├── componentes/
│   │   └── visor-receta.tsx   # VisorReceta en panel dividido con OCR contiguo
│   └── paginas/
│       ├── revision.tsx       # Layout de revisión a ancho completo
│       └── pendientes.tsx     # Diálogo de búsqueda y asociación de ticket
└── worker/src/jobs/
    └── outbox-dispatcher.ts   # Despacho de actualizaciones de precio
docs/ref/
└── siweb360-openapi.json      # Especificación actualizada a v1.2.0
```

---

## Complexity Tracking

*No violations identified. The design strictly adheres to the project constitution, existing outbox pattern, and pure domain separation.*
