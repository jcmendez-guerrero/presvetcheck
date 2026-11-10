# Dudas, contradicciones y decisiones conservadoras

El registro completo (qué dice la spec, qué se ha implementado y quién debe confirmarlo) está en **Jira**, épica
[KAN-1](https://mundomascotix.atlassian.net/browse/KAN-1). Este índice se mantiene para que las referencias
`DUDA-xx` del código, las reglas y las ADR sigan siendo trazables.

**Regla aplicada:** ante la duda, la opción más conservadora desde el punto de vista regulatorio, documentada y
configurable cuando es posible. Las decisiones pendientes de `SPEC.md` §13 (D-02b, D-04b, D-05c, D-06b, D-10b)
siguen como configuración + `TODO(decision)`.

**Criterio general:** el farmacéutico garante no usa la app; las confirmaciones expresas son siempre de la persona
que registra.

Para una duda nueva: crear la tarea en Jira (hija de KAN-1, etiqueta `dudas`) y añadir aquí su fila.

| Duda | Jira | Estado | Tema |
| --- | --- | --- | --- |
| DUDA-01 | [KAN-3](https://mundomascotix.atlassian.net/browse/KAN-3) | Resuelta | Nomenclátor y XML de CIMAVet |
| DUDA-02 | [KAN-4](https://mundomascotix.atlassian.net/browse/KAN-4) | Pendiente | ¿Se puede forzar dispensar más unidades de las prescritas? |
| DUDA-03 | [KAN-5](https://mundomascotix.atlassian.net/browse/KAN-5) | Resuelta | Medicamento de uso humano / que no está en el sistema |
| DUDA-04 | [KAN-6](https://mundomascotix.atlassian.net/browse/KAN-6) | Pendiente | Columnas `anulada_por` y `revisado_garante` en una tabla append-only |
| DUDA-05 | [KAN-7](https://mundomascotix.atlassian.net/browse/KAN-7) | Resuelta | `recepcion_linea` "append-only tras finalizar" frente a estados de sincronización |
| DUDA-06 | [KAN-8](https://mundomascotix.atlassian.net/browse/KAN-8) | Pendiente | Fuente de "inmunológico" y "biológico" |
| DUDA-07 | [KAN-9](https://mundomascotix.atlassian.net/browse/KAN-9) | Resuelta | Subcategorías de especie (p. ej. "Perros grandes", "Perras gestantes") |
| DUDA-08 | [KAN-10](https://mundomascotix.atlassian.net/browse/KAN-10) | Pendiente | Defectos de forma "forzables" que quizá no deberían serlo |
| DUDA-09 | [KAN-11](https://mundomascotix.atlassian.net/browse/KAN-11) | Resuelta | Menor concentración |
| DUDA-10 | [KAN-12](https://mundomascotix.atlassian.net/browse/KAN-12) | Resuelta | Unidades y dispensación fraccionada |
| DUDA-11 | [KAN-13](https://mundomascotix.atlassian.net/browse/KAN-13) | Pendiente | Comparación de indicaciones |
| DUDA-12 | [KAN-14](https://mundomascotix.atlassian.net/browse/KAN-14) | Pendiente | Tiempos de espera sin dato comparable |
| DUDA-13 | [KAN-15](https://mundomascotix.atlassian.net/browse/KAN-15) | Resuelta | Respuestas JSON de CIMAVet |
| DUDA-14 | [KAN-16](https://mundomascotix.atlassian.net/browse/KAN-16) | Resuelta | Estados del Nomenclátor y unidades de tiempo de espera |
| DUDA-15 | [KAN-17](https://mundomascotix.atlassian.net/browse/KAN-17) | Resuelta | API de Siweb360 |
| DUDA-16 | [KAN-18](https://mundomascotix.atlassian.net/browse/KAN-18) | Resuelta | `SIWEB_STOCK_WRITE_MODE=off` y el outbox |
| DUDA-17 | [KAN-19](https://mundomascotix.atlassian.net/browse/KAN-19) | Resuelta | Respuestas ambiguas en el outbox |
| DUDA-18 | [KAN-20](https://mundomascotix.atlassian.net/browse/KAN-20) | Resuelta | Reversión del spike (§12.3) |
| DUDA-19 | [KAN-21](https://mundomascotix.atlassian.net/browse/KAN-21) | Pendiente | Combinación de confianzas en la extracción |
| DUDA-20 | [KAN-22](https://mundomascotix.atlassian.net/browse/KAN-22) | Pendiente | Recetas de ejemplo para la extracción |
| DUDA-21 | [KAN-23](https://mundomascotix.atlassian.net/browse/KAN-23) | Pendiente | Autenticación de la PWA con Entra sin MSAL |
| DUDA-22 | [KAN-24](https://mundomascotix.atlassian.net/browse/KAN-24) | Resuelta | Normalización de páginas y PDF |
| DUDA-23 | [KAN-25](https://mundomascotix.atlassian.net/browse/KAN-25) | Pendiente | Reportes bajo demanda |
| DUDA-24 | [KAN-26](https://mundomascotix.atlassian.net/browse/KAN-26) | Resuelta | Retención de 5 años |
| DUDA-25 | [KAN-27](https://mundomascotix.atlassian.net/browse/KAN-27) | Resuelta | Autenticación de PostgreSQL |
| DUDA-26 | [KAN-28](https://mundomascotix.atlassian.net/browse/KAN-28) | Resuelta | Guía de la receta veterinaria (Anexo A) |
| DUDA-27 | [KAN-29](https://mundomascotix.atlassian.net/browse/KAN-29) | Resuelta | OCR: modelo para leer las recetas |
| DUDA-28 | [KAN-30](https://mundomascotix.atlassian.net/browse/KAN-30) | Resuelta | El garante no usa la app |
| DUDA-29 | [KAN-31](https://mundomascotix.atlassian.net/browse/KAN-31) | Parcial | Asistente de consultas: modelo, precios y banco de evaluación |
| DUDA-30 | Pendiente de crear en Jira | Resuelta 2026-11-10: solo psicótropos, como ALTA (specs/011 FR-009e) | ¿Las justificaciones de entradas (devolución de cliente, recuento al alza) van al registro de movimientos? (specs/011) |
