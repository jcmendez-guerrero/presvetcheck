# Specification Quality Checklist: El diálogo «Usar el móvil» siempre cabe en la pantalla

**Purpose**: Validar que la especificación está completa y tiene calidad antes de pasar a la planificación
**Created**: 2026-11-09
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] Sin detalles de implementación (lenguajes, frameworks, API)
- [x] Centrada en el valor para las personas usuarias y en las necesidades del negocio
- [x] Escrita para personas no técnicas
- [x] Todas las secciones obligatorias completas

## Requirement Completeness

- [x] No quedan marcas [NEEDS CLARIFICATION]
- [x] Los requisitos se pueden probar y no son ambiguos
- [x] Los criterios de éxito son medibles
- [x] Los criterios de éxito no dependen de la tecnología (sin detalles de implementación)
- [x] Todos los escenarios de aceptación están definidos
- [x] Los casos límite están identificados
- [x] El alcance está bien delimitado
- [x] Las dependencias y supuestos están identificados

## Feature Readiness

- [x] Todos los requisitos funcionales tienen criterios de aceptación claros
- [x] Los escenarios de usuario cubren los flujos principales
- [x] La funcionalidad cumple los resultados medibles de los criterios de éxito
- [x] No se filtran detalles de implementación en la especificación

## Notes

- La validación pasó en la primera iteración.
- Las alturas de ventana en píxeles (SC-002) son una medida de pantalla, no una elección tecnológica.
- FR-008 pide una comprobación automática sin nombrar la herramienta; la elige el plan.
- Causa conocida, para `/speckit-plan`: el diálogo se centra sin límite de altura ni desplazamiento, así que en
  ventanas bajas sobresale por el borde superior y no se puede llegar a él.
- 2026-11-09, revisión frente al informe original: la spec suponía que el defecto solo afectaba a ventanas bajas y
  pedía dejar las ventanas altas «como ahora». La causa encontrada al planificar (el diálogo queda atrapado en la
  cabecera de 64 px desde la feature 007) lo rompe con cualquier altura. Se corrigieron el contexto, el escenario 3 de
  la User Story 1, FR-005 y los supuestos, y se añadió FR-009 (toda la página oscurecida). Sin conflictos con
  `SPEC.md` ni con la spec 009. Todos los puntos siguen cumpliéndose.
- 2026-11-09, convergencia (T016): spec y checklist traducidas al español europeo según el principio V de la
  constitución; los identificadores (FR, SC, US) no cambian.
