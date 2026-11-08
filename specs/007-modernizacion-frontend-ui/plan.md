# Implementation Plan: Modernización de la Interfaz de Usuario y Sistema de Diseño (UI/UX) de Mundo Mascotix

**Branch**: `007-modernizacion-frontend-ui` | **Date**: 2026-11-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-modernizacion-frontend-ui/spec.md`

---

## Summary

Esta funcionalidad moderniza integralmente la capa de presentación de la aplicación web (`apps/web`) para alinearla con el **Manual de Identidad Visual oficial de Mundo Mascotix**, optimizar la ergonomía de mostrador en la dispensación farmacéutica y cumplir de forma rigurosa los estándares de accesibilidad **WCAG 2.2 AA / AAA**:

1. **Tokens e Identidad de Marca**: Adopción de la paleta oficial de 5 colores institucionales (#016581, #2F8198, #60ABB8, #002028, #F2F8F9), preservando la separación estricta con los colores semánticos de estado regulatorio (verde, ámbar, rojo, púrpura, dorado).
2. **Tipografía Normativa**: Despliegue estructurado de `Bricolage Grotesque Variable` (titulares) e `Inter Variable` (cuerpo y formularios).
3. **Ergonomía de Mostrador (HUD FEFO y TPV)**: Presentación de alto impacto del lote recomendado por fecha de caducidad más próxima (FEFO) y microinteracción de copia instantánea para cobro en el TPV de Siweb360 con feedback visual y auditivo accesible.
4. **Visor de Recetas 2.0**: Controles ágiles de zoom fluido, rotación angular de 90°, selector de miniaturas de página y sincronización con campos OCR dudosos.
5. **Accesibilidad Integral (WCAG 2.2)**: `scroll-padding-top` para evitar solapamiento de foco por barras adhesivas, focus trap en modales/cajones, regiones vivas contextuales en contadores y objetivos táctiles $\ge 44\text{px}$ con separación $\ge 8\text{px}$.

---

## Technical Context

**Language/Version**: TypeScript 5.8+, React 19, CSS3 (Tailwind CSS v4)  
**Primary Dependencies**: `@tailwindcss/vite`, `tailwindcss` ^4.1.0, `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/inter`, `lucide-react`, `@tanstack/react-router`, `@tanstack/react-query`  
**Storage**: N/A (consumo de estado del cliente y API local existente vía TanStack Query)  
**Testing**: Vitest (`pnpm --filter @mmx/web test`), Playwright E2E (`pnpm --filter @mmx/web test:e2e`)  
**Target Platform**: Navegadores modernos en equipos de mostrador táctil, PC de farmacia, tabletas de almacén y dispositivos móviles emparejados  
**Project Type**: Modernización visual y de experiencia de usuario en `apps/web`  
**Performance Goals**: Renderizado inicial con 0ms FOUT; transiciones de microinteracción a 60fps; respuesta de escaneo y copia al portapapeles en `< 50ms`  
**Constraints**:
- Dominio puro: No se modifica `@mmx/domain` ni se añade lógica de negocio en componentes UI.
- Respeto a contratos API existentes: Cero alteraciones en las rutas y esquemas de `apps/api`.
- Principio V de la Constitución: Todos los textos de interfaz redactados en español europeo claro para personal no técnico.  
**Scale/Scope**: Todas las vistas de `apps/web` (Inicio, Nueva Receta, Revisión, Resultado, Dispensación, Sustitución, Recepciones, Vademécum, Registros, Admin).

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status | Justification / Implementation |
| :--- | :--- | :---: | :--- |
| **I. Code Quality** | Dominio puro, TypeScript estricto, sin librerías pesadas | ✅ PASSED | La modernización se circunscribe a `apps/web/src/`. No se añaden frameworks adicionales de UI (se aprovecha Tailwind v4 y Lucide ya existentes). |
| **II. Testing Discipline** | `pnpm lint && pnpm typecheck && pnpm test` green; E2E con fake | ✅ PASSED | Se preservan todos los atributos `data-testid` existentes para que las suites de Vitest y Playwright continúen en verde sin regresiones. |
| **III. Security & Data Protection** | Cero datos personales en UI/logs; bloqueos duros no forzables | ✅ PASSED | Las pantallas de sustitución y forzado mantienen intactas las validaciones de `BLOQUEANTE_DURO` no anulables. |
| **IV. Maintainability** | Variables documentadas; Conventional Commits | ✅ PASSED | Se organizan los tokens de estilos en `@theme` en `estilos.css` de forma centralizada y mantenible. |
| **V. Spanish Product, English Architecture** | Textos de UI en español europeo claro; código en inglés técnico | ✅ PASSED | Denominaciones como «Código nacional» (en vez de «CN») y «Número de registro» consolidadas en toda la UI. |

---

## Project Structure

### Documentation (this feature)

```text
specs/007-modernizacion-frontend-ui/
├── spec.md                         # Especificación funcional validada
├── plan.md                         # Plan de implementación (este documento)
├── research.md                     # Hallazgos técnicos y decisiones de diseño
├── data-model.md                   # Modelos de datos y tipos de componentes UI
├── quickstart.md                   # Guía de verificación visual y escenarios de prueba
├── contracts/
│   └── ui-design-system.md         # Contrato de tokens CSS y accesibilidad ARIA
└── checklists/
    └── requirements.md             # Validación de requisitos completada
```

### Source Code Impact

```text
apps/web/
├── src/
│   ├── estilos.css                 # Configuración de @theme con la paleta de 5 colores y tipografías
│   ├── componentes/
│   │   ├── ui.tsx                  # Componentes atómicos modernizados (Boton, Tarjeta, Campo, Mensaje)
│   │   ├── layout.tsx              # Cabecera unificada y responsiva con clearspace del logotipo
│   │   ├── estado.tsx              # InsigniaEstado y TarjetaDefecto estructuradas
│   │   ├── bandas.tsx              # BandaSustitucion y BandaPsicotropo con backdrop-blur y anclaje
│   │   ├── visor-receta.tsx        # Visor 2.0 con zoom fluido, rotación y miniaturas
│   │   └── asistente.tsx           # Drawer lateral animado y tablas comparativas estilizadas
│   └── paginas/
│       ├── inicio.tsx              # Dashboard operativo con métricas y tarjetas de acción
│       ├── dispensacion.tsx        # HUD de lote FEFO y microinteracción de copia TPV
│       ├── revision.tsx            # Revisión de datos con vinculación visual de campos dudosos
│       └── recepciones.tsx         # Gestión de albaranes optimizada
```

---

## Complexity Tracking

> No se detectan violaciones de complejidad respecto a la constitución. El proyecto no introduce dependencias adicionales ni frameworks secundarios de diseño.
