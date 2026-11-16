# Implementation Plan: Tabla filtrable de recepciones de mercancía

**Branch**: `014-receptions-filterable-table` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-receptions-filterable-table/spec.md`

## Summary

La lista «Recepciones recientes» (50 últimas, sin proveedor, estado con código interno) pasa a ser una tabla con
seis columnas (Nº de albarán o factura, Proveedor, Fecha de recepción, Fecha de compra, Fecha de registro, Estado),
filtrable, ordenable y paginada. El filtrado, el orden y la paginación se hacen **en la API** sobre todas las
recepciones, ampliando el `GET /api/recepciones` que ya existe con parámetros de consulta validados con zod y una
respuesta paginada `{ filas, total, pagina, porPagina, proveedores }`. La web guarda filtros, orden y página en la
dirección (`validateSearch` de la ruta `/recepciones`), de modo que se conservan al volver del detalle. No hay
cambios de base de datos, reglas de negocio, auditoría ni variables de entorno.

## Technical Context

**Language/Version**: TypeScript estricto, Node.js 22

**Primary Dependencies**: Fastify + zod (API), Drizzle ORM, React + TanStack Router/Query + Tailwind (web). Nada nuevo.

**Storage**: PostgreSQL 16, tablas `recepcion` y `distribuidor` existentes. Sin migraciones.

**Testing**: Vitest (API con `apps/api/test/entorno`, web con Testing Library); `it.each` para la validación de la consulta.

**Target Platform**: Navegador de escritorio de la farmacia (también usable en pantalla estrecha) + API en Azure Container Apps.

**Project Type**: Aplicación web (monorepo `apps/api` + `apps/web` + `packages/*`).

**Performance Goals**: con 5.000 recepciones, respuesta de un cambio de filtro < 1 s (SC-003).

**Constraints**: fechas de registro comparadas en Europe/Madrid; sin datos personales en la respuesta; textos en español claro.

**Scale/Scope**: una farmacia; decenas de recepciones por semana (miles en varios años). 1 endpoint ampliado, 1 pantalla.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumple | Cómo |
|---|---|---|
| I. Calidad: zod, tipos inferidos, errores tipados | ✅ | Consulta validada con `ListarRecepcionesQuery` (zod); un rango «desde > hasta» devuelve el error de validación estándar (400) que la UI ya traduce. Respuesta con esquema zod. |
| I. Dominio puro / reglas fuera de UI | ✅ | No hay reglas legales: es una consulta. La traducción de `estado` a texto es presentación (el `code` se traduce en la UI, como pide AGENTS.md). |
| II. Pruebas | ✅ | API: filtros, combinación, orden, paginación, descartadas, límite de día en Madrid (00:30 CET/CEST) y rango inválido. Web: tabla, filtros en la dirección y estado vacío. Nada llama a servicios reales. |
| III. Datos personales y seguridad | ✅ | Solo se devuelven datos de la recepción y el nombre del proveedor (empresa). No se expone `empleado` ni nada del documento. Mismo `preHandler` de roles que hoy. Búsqueda con parámetros enlazados (sin SQL dinámico; comodines `%`/`_` escapados). |
| III. Append-only | ✅ | Solo lectura; no se toca `recepcion_linea`, `dispensacion` ni `audit_event`. |
| IV. Mantenibilidad | ✅ | Sin dependencias nuevas, sin variables de entorno nuevas, sin migración. Se regenera `openapi.json`. Un PR. |
| V. Idioma | ✅ | Interfaz en español claro («Nº de albarán o factura», «Error al enviar»); identificadores en inglés salvo términos del dominio (`recepcion`, `albaran`, `distribuidor`). |
| Trazabilidad | ✅ | Las descartadas siguen consultables (filtro de estado); no se borra ni oculta nada de forma irreversible. |

**Re-check tras el diseño (Phase 1)**: sin cambios; ninguna violación. No hace falta ADR.

## Project Structure

### Documentation (this feature)

```text
specs/014-receptions-filterable-table/
├── plan.md              # Este fichero
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── api-recepciones-lista.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── src/schemas.ts                    # + ListarRecepcionesQuery, ListaRecepcionesDto
├── src/servicios/recepciones.ts      # listar(filtros) → { filas, total, pagina, porPagina, proveedores }
├── src/rutas/operativa.ts            # GET /api/recepciones con querystring
├── openapi.json                      # regenerado (pnpm --filter api openapi)
└── test/
    ├── recepciones-lista.test.ts     # nuevo: filtros, orden, paginación, Madrid
    └── flujos.test.ts                # ajustar la comprobación de descartadas a la nueva respuesta

apps/web/src/
├── main.tsx                          # validateSearch de /recepciones: + filtros, orden y página
├── lib/recepciones-filtros.ts        # nuevo, puro: filtros de la dirección, ESTADO_RECEPCION, diaMadrid
├── lib/recepciones-filtros.test.ts
├── paginas/recepciones.tsx           # sustituye «Recepciones recientes» por <TablaRecepciones/>
├── paginas/recepciones-tabla.tsx     # nuevo: filtros + tabla + paginación
└── paginas/recepciones-tabla.test.tsx
```

**Structure Decision**: monorepo existente; el cambio vive en `apps/api` y `apps/web`. La tabla va en un fichero
nuevo porque `recepciones.tsx` ya tiene ~1.800 líneas.

## Complexity Tracking

Sin violaciones que justificar.
