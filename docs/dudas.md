# Dudas, contradicciones y decisiones conservadoras

Registro de ambigüedades encontradas en `SPEC.md` durante la Fase 0. Regla aplicada: ante la
duda, **la opción más conservadora desde el punto de vista regulatorio**, documentada aquí y
configurable cuando es posible. Ninguna de estas entradas resuelve las decisiones pendientes
de §13 (D-02b, D-04b, D-05c, D-06b, D-10b), que siguen como configuración + `TODO(decision)`.

Cada entrada indica: qué dice la spec, qué se ha implementado y quién debería confirmarlo. Las marcadas
**RESUELTA** recogen la respuesta de JC del 15/10/2026.

**Criterio general (JC):** el farmacéutico garante **no usa la app**. Lo que hace (autorizar, firmar, revisar)
ocurre fuera y, cuando hace falta dejar constancia, lo **registra el empleado** como confirmación expresa a su
nombre. Las "confirmaciones expresas" de la app son siempre de la persona que registra.

---

## DUDA-01 · Nomenclátor y XML de CIMAVet — RESUELTA
- **JC:** todos los XML de CIMAVet se ignoran en git; se obtienen de CIMAVet cuando hacen falta.
- **Implementado:** `fixtures/nomenclator/*.xml` en `.gitignore`. `pnpm nomenclator:fetch` descarga el zip oficial
  (`NOMENCLATOR_URL`, enlazado desde `cimavet.aemps.es/cimavet/publico/nomenclator.html`) y genera una muestra
  determinista para los tests (todas las presentaciones de los `nregistro` que usan los tests + ejemplos de cada
  caso especial). La CI lo descarga con caché semanal; `pnpm dev`/`pnpm demo` lo descargan si falta. En producción,
  `nomenclator-import --descargar` (y `cimavet-full --descargar`). La imagen ya no incluye diccionarios.
- **Ojo:** los XML siguen en el **historial** de git (commits anteriores). Purgarlos exige reescribir la historia
  (`git filter-repo`) y forzar el push: no se ha hecho; decide JC.

## DUDA-02 · ¿Se puede forzar dispensar más unidades de las prescritas?
- **Spec:** §4.6 dice "la suma de unidades no supera lo prescrito (bloqueo)". §4.1.6 enumera los
  bloqueos no forzables y dice que "el resto" son `BLOQUEANTE_FORMA`.
- **Ambigüedad:** superar la cantidad prescrita no es un defecto de forma de la receta, sino dispensar
  fuera de la prescripción.
- **Implementado (conservador):** `UNIDADES_SUPERAN_PRESCRITAS = BLOQUEANTE_DURO` en
  `config/rules/receta-campos.v1.yaml` (configurable).
- **Confirmar:** farmacéutico garante.

## DUDA-03 · Medicamento de uso humano / que no está en el sistema — RESUELTA
- **JC:** no se puede en ningún caso; se informa de que no está en el sistema y de que puede ser de uso humano.
- **Implementado:** `MEDICAMENTO_NO_EN_SISTEMA` (línea sin medicamento de CIMAVet veterinario, también al vender sin
  receta) y `MEDICAMENTO_USO_HUMANO`: ambos `BLOQUEANTE_DURO`, sin forzado ni vía de revisión. Texto: "no está en el
  sistema … puede ser de uso humano: no se puede dispensar".

## DUDA-04 · Columnas `anulada_por` y `revisado_garante` en una tabla append-only
- **Spec:** §6 define `dispensacion.anulada_por` y `dispensacion.revisado_garante` en una tabla **sin UPDATE**.
- **Contradicción:** rellenarlas exigiría un `UPDATE`.
- **Implementado:** la anulación es una **fila nueva** (contramovimiento) con `anula_dispensacion_id`
  (único: no se anula dos veces), registrada por el empleado con motivo, y la vista `v_dispensacion` deriva
  `anulada_por`. `revisado_garante` no existe: el garante revisa fuera de la app (reporte semanal); la tabla
  `revision_garante` se eliminó (migración 0003). Las correcciones de entradas tras finalizar van a
  `recepcion_ajuste` (append-only).

## DUDA-05 · `recepcion_linea` "append-only tras finalizar" frente a estados de sincronización — ACLARACIÓN
- **Qué se preguntaba:** la spec dice que una línea de entrada no se puede modificar una vez finalizada la
  recepción, pero también que después cambia su estado de sincronización con Siweb360 (pendiente de alta →
  encolada → sincronizada) y que se le asigna la variante de Siweb360 cuando se da de alta allí.
- **Implementado:** una vez finalizada, ningún dato registrado (CN, lote, caducidad, unidades, precio…) se puede
  modificar ni borrar; solo cambian dos campos técnicos: el **estado de sincronización** y el **id de la
  variante de Siweb360**. Si hay que corregir unidades, se registra un **ajuste** (contramovimiento). No requiere
  decisión salvo que se quiera otra cosa.

## DUDA-06 · Fuente de "inmunológico" y "biológico"
- **Spec:** §4.4.1 usa `tipoMedicamento` de CIMAVet (inmunológico/mixto) y "biológico".
- **Hallazgo:** el Nomenclátor (`PrescripcionVET.xml`) no trae `tipoMedicamento`; la API sí. Ninguna fuente
  marca "biológico".
- **Implementado (conservador):** inmunológico si `tipoMedicamento ∈ {2 inmunológico, 3 mixto}` **o** ATCvet
  empieza por `QI`. Biológico: no hay dato; se cubre con `sustitucion-exclusiones.v1.yaml` (por `nregistro`
  o principio activo), que mantiene el garante.
- **Confirmar:** farmacéutico garante (lista de biológicos).

## DUDA-07 · Subcategorías de especie (p. ej. "Perros grandes", "Perras gestantes") — RESUELTA (OK)
- **Implementado:** coincidencia exacta por id, más un mapa configurable `especie_padre`
  (`config/rules/equivalencia.v1.yaml`): una receta para una subcategoría queda cubierta por la autorización de
  la especie base, **nunca al revés**. Solo se han mapeado perros y gatos.

## DUDA-08 · Defectos de forma "forzables" que quizá no deberían serlo
- **Spec:** §4.1.6 declara forzables todos los bloqueos no listados, lo que incluye `RECETA_CADUCADA` y
  "receta de botiquín / de no dispensación" (`TIPO_DISPENSACION_NO_DISPENSABLE`).
- **Implementado:** como dice la spec (`BLOQUEANTE_FORMA`), porque no es ambiguo. Se señala aquí porque
  dispensar con una receta caducada o de botiquín tiene implicaciones regulatorias: basta con cambiar la
  severidad en `receta-campos.v1.yaml` (y aprobar la nueva versión) para hacerlos no forzables.
- **Confirmar:** farmacéutico garante.

## DUDA-09 · Menor concentración — RESUELTA
- **JC:** la sustitución es siempre por la misma composición y principio, nunca por menor concentración. La menor
  concentración solo vale si es el **mismo medicamento** en menor concentración.
- **Implementado:** la sustitución entre medicamentos exige igual composición cualitativa y cuantitativa. La
  regla de formato (§4.3.1) solo propone menor concentración del mismo medicamento (mismo registro, o mismo
  titular y mismo nombre comercial, p. ej. CLAVUBAY 200/50 en vez de 400/100); en otro caso se descarta con
  `CONCENTRACION_OTRO_MEDICAMENTO`. Se eliminó la vía "menor concentración de otro laboratorio".

## DUDA-10 · Unidades y dispensación fraccionada — RESUELTA
- **JC:** la fraccionada se ciñe a lo que permite el laboratorio (1 blíster, 1 comprimido…); en el registro de
  salidas se anota lo entregado, p. ej. "1 caja 20 comprimidos" o "1 frasco 10 ml".
- **Implementado:** por defecto se dispensan envases completos. Si el Nomenclátor marca la presentación con
  `sw_dispensacion_fraccionada` y `fracciones_autorizadas` (texto libre: "fracción: 1 blister de 10 comprimidos",
  "6 fracciones de 3 comprimidos", "21 fracciones de 1 pipeta"…), se admite fraccionar **solo** la presentación
  prescrita, de un único envase, en múltiplos de la fracción y sin superar las unidades de dosificación que indica
  la receta (nuevo campo de la línea). Si el texto de la fracción no se entiende, solo envases completos.
  `UNIDADES DISPENSADAS` pasa a texto: "1 caja 20 comprimidos", "2 cajas 28 comprimidos", "1 frasco 10 ml" o
  "14 comprimidos (fracción de caja 28 comprimidos)".
- **Pendiente (JC):** cómo se cobra/descuenta una fracción en el TPV de Siweb360. Mientras tanto, las fracciones
  no entran en la conciliación automática con los tickets (se informan aparte) y en el registro de psicótropos el
  saldo se lleva en envases.

## DUDA-11 · Comparación de indicaciones
- **Spec:** "similitud de texto + sinónimos" sin método concreto (§4.4.2.6).
- **Implementado:** proporción de términos de la indicación de la receta presentes en la indicación del
  candidato (tras normalizar, quitar palabras vacías y aplicar sinónimos). Umbrales y sinónimos en
  `config/rules/equivalencia.v1.yaml` (`COINCIDE ≥ 0,8`, `PROBABLE ≥ 0,4`). `PROBABLE` exige autorización previa
  del garante (modo `PRE`), que el empleado registra confirmando expresamente que el garante la ha revisado.
- **Confirmar:** farmacéutico garante (umbrales y lista de sinónimos).

## DUDA-12 · Tiempos de espera sin dato comparable
- **Spec:** §4.4.2.7 exige tiempo de espera del candidato ≤ prescrito por tejido y especie.
- **Implementado (conservador):** si falta el dato de algún tejido/especie en el prescrito o en el candidato, el
  candidato **no** es equivalente (`TIEMPO_ESPERA_DESCONOCIDO`). Lo mismo al forzar una prescripción solo por
  principio activo en especie productora (no hay tiempo de referencia).

## DUDA-13 · Respuestas JSON de CIMAVet — RESUELTA
- **JC:** los JSON de los tests se obtienen a partir de los XML.
- **Implementado:** se eliminaron las fixtures JSON hechas a mano. `packages/cimavet/test/api-desde-xml.ts` genera
  las respuestas a partir del Nomenclátor con la **forma de la API real**, que se comprobó con peticiones manuales
  (no desde los tests) y se documenta en `docs/ref/cimavet-respuestas.md`: listas
  `{ totalFilas, pagina, tamanioPagina, resultados }`, fechas en ms de la medianoche de Madrid,
  `formasFarmaceuticas[]`, `registroCambios.cambio[]`, tiempos de espera con objetos y 404 en `notas` sin notas.
  Se quitó el `it.todo`. Dos fallos encontrados y corregidos: fechas convertidas en UTC (día anterior) y coma
  decimal en `cantidad_concentracion` del Nomenclátor completo.
- **Conservador (se mantiene):** la API no da la base de la concentración; una composición solo de API no es
  normalizable.

## DUDA-14 · Estados del Nomenclátor y unidades de tiempo de espera — RESUELTA (OK)
- **Implementado:** cualquier código distinto de 1 o 3 se trata como suspendido. Conversión a días redondeando
  hacia arriba (horas/24, semanas×7, meses×31); los grados-día no se convierten.

## DUDA-15 · API de Siweb360 — RESUELTA (OpenAPI aportada)
- **JC:** aporta `docs/ref/siweb360-openapi.json`.
- **Implementado:** el desglose por lote está documentado (`stock_levels[]` de la variante y `levels[]` de /stock:
  `batch_number`, `expiry_date`, `available`…); se quitó la hipótesis y su `it.todo`. Paginación con
  `pagination.pages`. Lectura de tickets (`GET tickets`, `GET tickets/{id}`) para la conciliación.
- **Limitaciones de la API (documentadas en `fixtures/siweb/README.md`):** las líneas de ticket no traen variante
  ni lote: el CN se saca del nombre de la línea (`SIWEB_TICKET_CN_REGEX`) y se concilia por CN + unidades con el
  lote sin verificar (TODO(decision D-02b): confirmar con tickets reales). No hay alta de productos (D-04b sigue en
  tareas manuales) ni consulta de movimientos de inventario (el control de entradas manuales sin `MMX-REC-` no se
  puede automatizar). La app nunca crea, cambia ni borra tickets.

## DUDA-16 · `SIWEB_STOCK_WRITE_MODE=off` y el outbox — RESUELTA (OK)
- **Implementado:** en `off` **no se encola nada** (la recepción queda con `sync_estado = ESCRITURA_DESACTIVADA`) y
  el dispatcher no envía.

## DUDA-17 · Respuestas ambiguas en el outbox — RESUELTA (manual)
- **JC:** mejor manual.
- **Implementado:** el outbox **nunca reintenta solo**. Timeout, error de red, 5xx o 2xx no interpretable →
  `needs_reconciliation`; 4xx (409 = stock ilimitado) → `failed`. En ambos casos una persona lo resuelve desde
  Administración (`confirmar_aplicada`, `reenviar`, `descartar`), con nota y auditoría.

## DUDA-18 · Reversión del spike (§12.3) — RESUELTA (OK)
- **Implementado:** `+1` con `reason=purchase_receipt` y `−1` con `reason=adjustment_negative` sobre el mismo lote.

## DUDA-19 · Combinación de confianzas en la extracción
- **Spec:** "confianza final = combinación de la confianza OCR … y la autoevaluación del modelo" (§5.3).
- **Implementado (ADR-12, sin LLM):** el **mínimo** entre la confianza del campo del modelo personalizado y la
  media de la confianza OCR de sus palabras; un campo con valor pero sin región en la página queda en 0,5 como
  máximo. La firma manuscrita y la casilla "He comprobado los datos con el original" **nunca** se rellenan
  desde la extracción.

## DUDA-20 · Recetas de ejemplo para la extracción
- **JC:** aporta `fixtures/recetas/Recetas_2026_08.pdf` (29 páginas) y `Recetas_2026_09.pdf` (57 páginas).
- **Estado:** son escaneos de recetas **reales** con NIF, teléfono y dirección de propietarios: quedan **fuera de
  git** (`.gitignore`) y solo en local. Para usarlas en `pnpm eval:extraction` hay que etiquetarlas (JSON esperado
  por página) y guardarlas también fuera de git (`fixtures/recetas/reales/`). Ver DUDA-27 sobre el modelo.

## DUDA-21 · Autenticación de la PWA con Entra sin MSAL
- **Spec:** ADR-06 usa la autenticación integrada de Container Apps + validación del token en la API.
- **Implementado:** la PWA no incluye MSAL: en modo `entra` obtiene el `id_token` de `/.auth/me` (token store de la
  autenticación integrada) y lo envía como `Bearer`; la API lo valida contra el JWKS de Entra (audiencia = client id,
  `roles` = app roles, `amr` = MFA). Requiere activar el token store en la app de Container Apps (infra/).
- **Confirmar:** JC (alternativa: MSAL en la PWA si se quiere renovación de tokens en el cliente).

## DUDA-22 · Normalización de páginas y PDF — RESUELTA (OK)
- **Implementado:** en el navegador: orientación EXIF, PNG, dHash y aviso de calidad; el servidor calcula los
  SHA-256. PDF y HEIC se guardan tal cual sin pHash.

## DUDA-23 · Reportes bajo demanda
- **Implementado:** el job `weekly-reports` guarda XLSX + CSV en Blob y envía el XLSX por correo (al garante entre
  otros: así revisa las dispensaciones forzadas y las sustituciones fuera de la app). La generación bajo demanda la
  puede pedir quien consulta registros (empleado, veterinaria, administración); se guarda en Blob y se descarga, sin
  correo. Las exportaciones nunca incluyen datos del propietario salvo que se pidan, y el DNI completo solo lo
  exporta administración con MFA (auditado).

## DUDA-24 · Retención de 5 años — RESUELTA (eliminar)
- **JC:** deben eliminarse.
- **Implementado:** `retention-sweep` (mensual) **borra** lo de más de 5 años: salidas, recetas con líneas,
  imágenes y sustituciones, propietarios, entradas, pedidos, outbox cerrado, discrepancias y reportes, y después los
  ficheros de Blob (el ciclo de vida de Blob también los borra a los 1827 días). Las tablas de registro siguen siendo
  de solo inserción: la base de datos solo admite ese borrado con la marca de purga de la sesión **y** para filas de
  más de 5 años según su propio reloj; salidas y ajustes se purgan con una función `SECURITY DEFINER` (el rol de la
  app no tiene `DELETE`). No se borra un original con anulación reciente.
- **Se conserva:** el rastro de auditoría (sin datos personales) para que la cadena de hashes siga verificable.

## DUDA-25 · Autenticación de PostgreSQL — RESUELTA (se queda así)
- **Implementado:** usuario/contraseña en Key Vault (`database-url`, secreto de Container Apps), nunca en claro.

## DUDA-26 · Guía de la receta veterinaria (Anexo A) — RESUELTA
- **JC:** aporta `docs/ref/guia-receta-veterinaria.md` ("puede que haya información de más").
- **Incorporado a las reglas:**
  - Crónicos de **producción**: validez de 3 meses si están en el plan sanitario de la explotación o los pauta el
    veterinario de la ADS. Lo confirma expresamente quien registra (`cronicoPlanSanitario`); nunca para
    antimicrobianos, psicótropos, estupefacientes ni gases medicinales; preventivos de producción siguen en 1 mes.
  - Psicótropos: se comprueba la identidad de quien retira y se anota su **DNI/NIE** (validado y cifrado).
  - Fraccionada (§5.9): ver DUDA-10.
- **No incorporado (fuera del alcance de la app):** venta a distancia, estupefacientes de la lista I (siguen
  bloqueados), autovacunas, fórmulas magistrales, farmacovigilancia.

## DUDA-27 · OCR: modelo para leer las recetas — RESUELTA (Document Intelligence)
- **JC:** sustitución a Document Intelligence.
- **Implementado (ADR-12):** un **modelo personalizado neuronal de Document Intelligence**, entrenado en Studio
  con las recetas reales etiquetadas, sustituye al par `prebuilt-layout` + Azure OpenAI. Devuelve cada campo con
  confianza y región; la confianza final es el mínimo con la del OCR de sus palabras, y un campo sin región queda
  en 0,5 como máximo. Azure OpenAI desaparece del código, la configuración (`AOAI_*` → `DOCINTEL_MODEL_ID`) y la
  infraestructura. Guía de entrenamiento: `docs/extraccion-docintel.md`.
- **Pendiente:** etiquetar y entrenar el primer modelo con las recetas aportadas (en el contenedor privado
  `docintel-entrenamiento`, nunca en git) y medirlo con `pnpm eval:extraction`. Hasta entonces la extracción
  queda desactivada en Azure (entrada manual).

## DUDA-28 · El garante no usa la app — RESUELTA
- **JC:** el garante nunca interactúa con el sistema; las confirmaciones expresas son del empleado que registra.
- **Implementado:** se eliminó el rol `farmaceutico_garante`. Sustitución en modo `PRE`: el empleado registra la
  autorización del garante (nombre, medio, fecha) y, si la indicación es probable, confirma que el garante la ha
  revisado. Modo `POST`: tras apartar la receta, el empleado registra que el garante ha firmado la anotación (ya no
  hay "validar"). Las dispensaciones forzadas y las recetas no conformes le llegan en el reporte semanal. Nueva
  pantalla **Pendientes** (sustituciones en curso con alerta de plazo y discrepancias con el TPV). Reglas y
  exclusiones las registra administración (MFA para aprobar reglas).

