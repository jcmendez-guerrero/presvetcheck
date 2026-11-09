# Implementation Plan: El diálogo «Usar el móvil» siempre cabe en la pantalla

**Branch**: `008-fix-mobile-qr-dialog` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-fix-mobile-qr-dialog/spec.md`

## Summary

El diálogo para emparejar el móvil se corta por arriba y el QR no se puede leer. Causa raíz
([research.md](./research.md) R1): el diálogo se pinta dentro de la cabecera, que tiene `backdrop-filter`; eso
convierte la cabecera (64 px) en el contenedor de su velo `fixed inset-0`, y el panel se centra en esa franja y
sobresale por arriba. Además, el panel no tiene límite de altura. Es una regresión del rediseño de la cabecera (feature 007, 2026-11-08):
falla con cualquier altura de ventana, no solo en pantallas bajas.

Enfoque: en `apps/web/src/componentes/movil-pc.tsx`, (1) renderizar `DialogoMovil` en `document.body` con
`createPortal`, (2) añadir al panel `max-h-[90vh] overflow-auto` como el resto de diálogos, (3) usar el gancho
existente `useFocusTrap` y `aria-modal="true"`. Una prueba Playwright nueva cubre ventanas bajas.

## Technical Context

**Language/Version**: TypeScript estricto, Node.js 22

**Primary Dependencies**: React + `react-dom` (`createPortal`), Tailwind CSS — todo ya instalado; sin dependencias nuevas

**Storage**: N/A

**Testing**: Playwright (`apps/web/e2e/`), Vitest para el resto de la suite

**Target Platform**: navegadores de escritorio del personal (Chrome/Edge), también ventanas estrechas

**Project Type**: aplicación web (monorepo `apps/web` + `apps/api`); solo cambia `apps/web`

**Performance Goals**: N/A (cambio de maquetación)

**Constraints**: sin cambios en el texto visible, en la API ni en el emparejamiento; en ventanas altas, centrado y sin barra como los demás diálogos (FR-005)

**Scale/Scope**: 1 componente (`movil-pc.tsx`, ~5 líneas) + 1 prueba e2e

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Estado | Nota |
|-----------|--------|------|
| I. Calidad de código | ✅ | Sin cambios en `packages/domain`; TypeScript estricto; sin dependencias nuevas. |
| II. Disciplina de pruebas | ✅ | Prueba e2e nueva; `pnpm lint && pnpm typecheck && pnpm test` antes de cerrar. Sin servicios reales. |
| III. Seguridad y protección de datos | ✅ | No se tocan datos personales, sesión del móvil ni reglas legales. |
| IV. Mantenibilidad | ✅ | Sin variables de entorno ni decisiones abiertas. Commit `fix(web): …`. |
| V. Idioma | ⚠️ | Plan, investigación y guía en español. **`spec.md` está en inglés** (hay precedente en la 004); conviene traducirla antes de `/speckit-tasks`. Sin textos de UI nuevos. |
| Cumplimiento y trazabilidad | ✅ | No afecta a dispensación, `reglaVersion`, outbox ni auditoría. |

**Re-check post-design**: sin cambios; el diseño no añade nada que altere la tabla.

## Project Structure

### Documentation (this feature)

```text
specs/008-fix-mobile-qr-dialog/
├── spec.md
├── plan.md                    # este archivo
├── research.md                # causa raíz y decisiones
├── quickstart.md              # cómo reproducir y validar
├── contracts/
│   └── dialogo-movil.md       # contrato visible del diálogo (lo que comprueba la e2e)
└── checklists/requirements.md
```

No hay `data-model.md`: la corrección no crea ni cambia entidades ni datos.

### Source Code (repository root)

```text
apps/web/
├── src/componentes/
│   └── movil-pc.tsx            # MODIFICAR: portal a <body>, max-h + overflow, useFocusTrap, aria-modal
├── src/lib/a11y.ts             # MODIFICAR: useFocusTrap admite [data-autofocus] (research.md R7)
└── e2e/
    └── dialogo-movil.spec.ts   # NUEVO: alturas 300/430/600/1080 px según el contrato
```

**Structure Decision**: cambio limitado a `apps/web`. `topbar.tsx` no se toca: el portal saca el diálogo de la
cabecera sin mover el estado. Otros diálogos ya cumplen (research.md R5).

## Complexity Tracking

Sin infracciones de la constitución que justificar.
