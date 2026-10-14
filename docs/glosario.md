# Glosario

Términos del dominio regulatorio que se mantienen en español en el código y su equivalente técnico.

| Término | Significado | En el código |
|---|---|---|
| Receta | Prescripción veterinaria (papel o electrónica, RD 666/2023) | `receta`, `RecetaConfirmada` |
| Nº de registro (`nregistro`) | Identificador del medicamento en CIMAVet (p. ej. `1868 ESP`) | `nregistro` |
| Código nacional (CN) | Identificador de 6 dígitos de la presentación (7 con dígito de control). En la UI: "Código nacional" | `cn` |
| Presentación | Formato concreto de un medicamento (envase, contenido) | `PresentacionInfo` |
| Principio activo (PA) | Sustancia activa; `pa_id` de la maestra de CIMAVet | `paId` |
| Garante | Farmacéutico garante del establecimiento | rol `farmaceutico_garante` |
| Dispensación | Entrega de un medicamento; registro de salida append-only | `dispensacion` |
| Entrada / recepción | Recepción de mercancía de un distribuidor | `recepcion`, `recepcion_linea` |
| Forzado | Dispensar pese a un defecto de forma, asumiendo la responsabilidad (SPEC §4.1.6) | `forzado`, `validarForzado` |
| Defecto de forma | Incidencia `BLOQUEANTE_FORMA`: no se puede dispensar, pero se puede forzar | `BLOQUEANTE_FORMA` |
| Bloqueo duro | Incidencia `BLOQUEANTE_DURO`: no se puede dispensar ni forzar | `BLOQUEANTE_DURO` |
| Aviso | Incidencia informativa | `AVISO` |
| Sustitución | Dispensar un medicamento equivalente al prescrito (SPEC §4.4) | `sustitucion` |
| Cambio de formato / concentración | Otra presentación del mismo principio activo (SPEC §4.3.1) | `DISPENSAR_CON_AVISO` |
| FEFO | *First expired, first out*: primero el lote que caduca antes | `proponerLotes` |
| Tiempo de espera | Plazo hasta que la carne, leche, huevos… de un animal tratado pueden consumirse | `tiemposEspera` |
| Especie productora | Animal productor de alimentos | `especieProduccion` |
| REGA | Registro General de Explotaciones Ganaderas | `rega` |
| Talonario colegial | Recetario del colegio con numeración que incluye el nº de colegiado | `talonarioColegial` |
| Psicótropo / estupefaciente | Medicamentos sujetos a control especial (CIMAVet) | `psicotropo`, `estupefaciente` |
| Antimicrobiano | Antibiótico o ATC QJ01/QJ02/QJ04/QJ05/QP51 | `esAntimicrobiano` |
| Recargo de equivalencia (RE) | Recargo de IVA del comercio minorista | `calcularPrecioCoste` |
| Nomenclátor | Fichero XML de la AEMPS con todos los medicamentos veterinarios | `importarNomenclator` |
| CIMAVet | Centro de Información de Medicamentos Veterinarios (AEMPS) | `packages/cimavet` |
| Siweb360 | ERP/TPV con el inventario de la tienda | `packages/siweb` |
| TPV | Terminal punto de venta (ticket); descuenta el stock al cobrar | — |
| Outbox | Cola de escrituras en Siweb360 con reconciliación manual | `OutboxService` |
| Contramovimiento | Corrección por fila nueva (nunca `UPDATE`) | `anula_dispensacion_id` |
| D-xx | Decisión de SPEC §13; las pendientes llevan `TODO(decision D-xx)` | — |
