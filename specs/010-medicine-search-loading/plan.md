# Implementation Plan: Indicador de carga y búsquedas estables en los buscadores de medicamentos

**Branch**: `010-medicine-search-loading` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-medicine-search-loading/spec.md`

## Summary

Los cuatro buscadores de medicamentos (revisión, recepciones, sustituto y los dos de vademécum) pasan a usar un
único hook, `useBusquedaMedicamentos`, y un único componente de estado, `EstadoBusqueda`. El hook espera 300 ms
de pausa en la escritura, anula la petición anterior, corta a los 10 s y mantiene la lista anterior atenuada y no
seleccionable hasta que llega la respuesta del texto actual. El componente muestra un icono giratorio con
"Buscando…", "No se ha encontrado ningún medicamento" o el error con "Volver a intentar", y lo anuncia a los
lectores de pantalla. Solo cambia el frontal (`apps/web`); la API de búsqueda no cambia. Detalle en
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript estricto, Node.js 22 (build), React 19

**Primary Dependencies**: `@tanstack/react-query` v5 (ya instalado), `lucide-react` (`Loader2`, ya usado en `ui.tsx`). Sin dependencias nuevas.

**Storage**: N/A (estado en memoria del navegador)

**Testing**: Vitest (función pura del estado, `it.each`) y Playwright (`page.route` para demoras y orden de respuestas)

**Target Platform**: navegador del mostrador (Chrome/Edge actuales, tableta 1024×768 y escritorio)

**Project Type**: aplicación web (monorepo pnpm: `apps/web` + `apps/api`); solo se toca `apps/web`

**Performance Goals**: 10 letras seguidas → como mucho 2 peticiones (SC-003)

**Constraints**: pausa 300 ms; tiempo máximo 10 s; mínimo 3 letras; el campo nunca se bloquea (aclaración Q1)

**Scale/Scope**: 4 pantallas, 5 campos de búsqueda; 1 hook, 1 componente, 1 cambio pequeño en `api.ts`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo se cumple | Estado |
|-----------|----------------|--------|
| I. Calidad de código | Sin cambios en `packages/domain`; TS estricto; sin dependencias nuevas (React Query y lucide ya están). | ✅ |
| II. Disciplina de pruebas | `it.each` para el estado; Playwright intercepta `/api/medicamentos/buscar`, nunca llama a CIMAVet. `pnpm lint && pnpm typecheck && pnpm test` al cerrar. | ✅ |
| III. Seguridad y datos | La búsqueda solo envía texto del medicamento y especie; ningún dato personal. Ninguna regla legal en la UI: solo presentación. | ✅ |
| IV. Mantenibilidad | Sin variables de entorno nuevas (300 ms / 10 s / 3 letras son constantes de presentación, no decisiones de §13). Un PR, Conventional Commits. Sin términos de dominio nuevos para el glosario. | ✅ |
| V. Español | Textos de UI y comentarios en español claro; identificadores genéricos en inglés técnico o ya existentes (`EstadoBusqueda`). | ✅ |
| Trazabilidad regulatoria | Mejora la trazabilidad: impide elegir un medicamento de una lista que no corresponde al texto escrito. | ✅ |

**Re-check tras el diseño (fase 1)**: sin cambios; ninguna violación. Complexity Tracking vacío.

## Project Structure

### Documentation (this feature)

```text
specs/010-medicine-search-loading/
├── plan.md              # Este fichero
├── research.md          # Fase 0: estado actual y decisiones D1–D8
├── data-model.md        # Fase 1: estados de una búsqueda (solo en memoria)
├── quickstart.md        # Fase 1: cómo comprobar que funciona
├── contracts/
│   └── buscador-medicamentos.md   # Fase 1: contrato del hook, del componente y textos
└── tasks.md             # Fase 2 (/speckit-tasks; no lo crea este comando)
```

### Source Code (repository root)

```text
apps/web/
├── src/
│   ├── lib/
│   │   ├── api.ts                    # CAMBIA: api()/get() aceptan `signal` opcional
│   │   ├── busqueda.ts               # NUEVO: useBusquedaMedicamentos + estadoBusqueda (pura) + constantes
│   │   └── busqueda.test.ts          # NUEVO: it.each sobre estadoBusqueda
│   ├── componentes/
│   │   └── estado-busqueda.tsx       # NUEVO: EstadoBusqueda (movido de revision.tsx) + ListaResultados atenuada
│   └── paginas/
│       ├── revision.tsx              # CAMBIA: usa el hook; borra su EstadoBusqueda local
│       ├── recepciones.tsx           # CAMBIA: usa el hook y EstadoBusqueda; su aviso «sin resultados» se conserva
│       ├── resultado.tsx             # CAMBIA: borra buscar()/buscando manual; usa el hook
│       └── vademecum.tsx             # CAMBIA: borra buscarA/buscarB; dos llamadas al hook
└── e2e/
    └── busqueda-medicamentos.spec.ts # NUEVO: indicador, respuesta desfasada, nº de peticiones, error
```

**Structure Decision**: aplicación web existente; el cambio vive entero en `apps/web`. No se toca `apps/api` ni
`packages/*` porque `GET /api/medicamentos/buscar` ya devuelve lo necesario.

## Complexity Tracking

Sin violaciones de la constitución; no aplica.
