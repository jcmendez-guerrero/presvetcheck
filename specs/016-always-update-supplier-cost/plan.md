# Implementation Plan: Coste de proveedor siempre actualizado en Siweb360 al recibir mercancía

**Branch**: `016-always-update-supplier-cost` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-always-update-supplier-cost/spec.md`

## Summary

Al finalizar una recepción, cada línea de medicamento con coste y producto de Siweb360 encola **siempre** una
operación nueva del outbox, `siweb_actualizar_coste_proveedor`, que fija el coste de compra del proveedor de la
recepción para el producto (`PUT /api/public/inventory/products/{id}/suppliers/{contact_id}`, API 1.3.0). Es
independiente de la casilla «actualizar precio», que sigue gobernando solo el coste general de la variante
(`PUT …/variants/{id}/pricing`, sin cambios) y el coste de referencia de la app.

El proveedor de Siweb360 (`contact_id`) se resuelve **al enviar**, no al encolar (no hay llamadas de red dentro de la
transacción): primero el `siweb_contact_id` recordado en el distribuidor; si no hay, se busca por CIF (la lista de
contactos de Siweb360 no devuelve CIF, así que se cruza con el detalle del contacto y con la lista de proveedores del
producto) y, si hay una única coincidencia, se recuerda en el distribuidor. Si no se puede identificar, la operación
pasa a `needs_supplier` (nada se envía, nada se adivina), es visible en la pantalla de administración del outbox y se
reintenta sola cuando el proveedor se vincula. Se añade una columna al distribuidor (migración 0022).

## Technical Context

**Language/Version**: TypeScript estricto, Node.js 22, pnpm 9

**Primary Dependencies**: Fastify + zod (API), Drizzle ORM, `decimal.js`, MSW + Vitest, React + TanStack (web). Nada nuevo.

**Storage**: PostgreSQL 16. Una columna nueva `distribuidor.siweb_contact_id` (migración `0022`). Un valor nuevo de
texto en `outbox.status` (`needs_supplier`; la columna ya es `text`, sin cambio de esquema).

**Testing**: Vitest. `packages/siweb` con MSW y fixtures nuevas (lista de proveedores del producto, actualización de
proveedor, detalle de contacto con CIF). `it.each` para el cálculo del coste y la normalización del CIF. Test de
integración del outbox (Testcontainers) para el encolado y la reanudación.

**Target Platform**: API en Azure Container Apps + job `outbox-dispatcher`; web de escritorio de la farmacia.

**Project Type**: Aplicación web en monorepo (`apps/api`, `apps/web`, `apps/worker`, `packages/*`).

**Performance Goals**: sin objetivo propio; como máximo unas decenas de líneas por recepción. La búsqueda por CIF
ocurre una vez por distribuidor (después se recuerda).

**Constraints**: nunca llamar a Siweb360 real desde tests; respetar `SIWEB_STOCK_WRITE_MODE` y la prueba de escritura
vigente; sin datos personales en logs; sin `UPDATE`/`DELETE` de líneas finalizadas (solo se añade al outbox).

**Scale/Scope**: una farmacia; 1 operación nueva del outbox, 1 migración, 1 cliente nuevo en `packages/siweb`,
1 texto de ayuda, 1 acción de administración (vincular proveedor).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumple | Cómo |
|---|---|---|
| I. Calidad: zod, tipos inferidos, errores tipados | ✅ | Esquemas zod nuevos en `packages/siweb` (proveedores del producto, actualización, contacto con CIF), tipos inferidos. Errores con `DomainError` (`SIWEB_PROVEEDOR_NO_RESUELTO`). Dinero con `decimal.js` (céntimos, nunca `number` en el cálculo). |
| I. Dominio puro / reglas fuera de UI | ✅ | El valor enviado como coste se decide en una función pura (`costeProveedorCents`) dirigida por `config/rules/precios.v1.yaml`; normalización de CIF pura. La UI solo muestra texto. |
| II. Pruebas sin servicios reales | ✅ | MSW + fixtures; casos de error: 4xx, 5xx, timeout, campos en otra capitalización, campos nuevos, 0/1/varias coincidencias de CIF, proveedor recordado inexistente. Timeout → `needs_reconciliation`, nunca reintento automático. |
| III. Datos personales | ✅ | Solo se guardan identificadores de empresa (`contact_id`, CIF de empresa ya existente). Sin datos del dueño de la mascota; logs sin nombres ni importes identificables. |
| III. Append-only | ✅ | No se modifica `recepcion_linea` finalizada ni `audit_event`; se añade una fila de outbox por línea. |
| IV. Mantenibilidad | ✅ | Sin variables de entorno nuevas. Decisión abierta (valor enviado: precio de coste o neto) como configuración en `precios.v1.yaml` con `TODO(decision D-15)` y valor por defecto. Glosario actualizado (`proveedor de Siweb360`). Un PR. |
| V. Idioma | ✅ | Ayuda y mensajes en español claro («Coste de proveedor pendiente: falta vincular el proveedor en Siweb360»); identificadores en inglés salvo términos de dominio (`distribuidor`, `recepcion`). |
| Regulatorio / outbox | ✅ | Toda escritura a Siweb360 va por el outbox, respeta `SIWEB_STOCK_WRITE_MODE` (`off` no encola) y la prueba de escritura; nunca salidas de stock. |

Sin violaciones. **Re-check tras el diseño (Phase 1)**: sin cambios. No hace falta ADR (se extiende un patrón
existente); la decisión de resolución del proveedor queda en `research.md`.

## Project Structure

### Documentation (this feature)

```text
specs/016-always-update-supplier-cost/
├── plan.md              # Este fichero
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/
│   └── siweb-proveedor.md   # Fase 1: endpoints de Siweb360 usados + contrato interno del outbox
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/
├── db/
│   ├── src/schema/config.ts            # distribuidor.siwebContactId (nullable)
│   └── migrations/0022_distribuidor_siweb_contacto.sql  (+ meta/_journal.json)
├── domain/
│   └── src/precio.ts                   # costeProveedorCents(), normalizarCif() (puras, con it.each)
├── siweb/
│   ├── src/schemas.ts                  # ProveedorProductoSchema, ContactDetailSchema (con cif)
│   ├── src/client.ts                   # proveedoresDeProducto(), actualizarCosteProveedor(), contacto(), buscarProveedorPorCif()
│   ├── src/outbox.ts                   # OPERACION_ACTUALIZAR_COSTE_PROVEEDOR, clave MMX-PRV-…, encolado y envío, needs_supplier
│   └── test/                           # outbox + cliente con MSW
├── shared/                             # tipos/esquemas de la acción de vincular proveedor
config/rules/precios.v1.yaml            # coste_proveedor_base: precio_coste (TODO(decision D-15))
fixtures/siweb/                         # doc-product-suppliers.json, doc-supplier-update.json, doc-contact-detail.json
apps/
├── api/src/rutas/admin.ts              # POST /api/admin/distribuidores/:id/proveedor-siweb (vincular + reencolar)
├── api/src/servicios/recepciones.ts    # sin cambio de contrato; el encolado vive en el outbox
└── web/src/
    ├── lib/ayudas.ts                   # texto de la casilla «actualizar precio»
    └── paginas/                        # administración outbox: estado «Falta vincular el proveedor» + acción
docs/glosario.md                        # términos nuevos
```

**Structure Decision**: se extiende el patrón existente del outbox (`packages/siweb`) sin crear módulos nuevos. La
resolución del proveedor vive junto al cliente de Siweb360; la regla del valor enviado, en `packages/domain`.

## Complexity Tracking

Sin violaciones que justificar.
