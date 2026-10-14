# Dudas, contradicciones y decisiones conservadoras

Registro de ambigüedades encontradas en `SPEC.md` durante la Fase 0. Regla aplicada: ante la
duda, **la opción más conservadora desde el punto de vista regulatorio**, documentada aquí y
configurable cuando es posible. Ninguna de estas entradas resuelve las decisiones pendientes
de §13 (D-02b, D-04b, D-05c, D-06b, D-10b), que siguen como configuración + `TODO(decision)`.

Cada entrada indica: qué dice la spec, qué se ha implementado y quién debería confirmarlo.

---

## DUDA-01 · Ubicación y tamaño de la muestra del Nomenclátor
- **Spec:** §3 y §5.1.2 esperan la muestra en `fixtures/nomenclator/`. Los XML llegaron en `fixtures/`.
- **Implementado:** se han movido a `fixtures/nomenclator/`. `PrescripcionVET.xml` pesa 140 MB (supera el
  límite de GitHub), así que queda **fuera de git** (`.gitignore`) y los tests usan
  `PrescripcionVET.sample.xml`, generado copiando literalmente 34 registros reales con
  `scripts/make-nomenclator-sample.ts` (no se inventa estructura).
- **Confirmar:** JC — si prefiere Git LFS para el fichero completo.

## DUDA-02 · ¿Se puede forzar dispensar más unidades de las prescritas?
- **Spec:** §4.6 dice "la suma de unidades no supera lo prescrito (bloqueo)". §4.1.6 enumera los
  bloqueos no forzables y dice que "el resto" son `BLOQUEANTE_FORMA`.
- **Ambigüedad:** superar la cantidad prescrita no es un defecto de forma de la receta, sino dispensar
  fuera de la prescripción.
- **Implementado (conservador):** `UNIDADES_SUPERAN_PRESCRITAS = BLOQUEANTE_DURO` en
  `config/rules/receta-campos.v1.yaml` (configurable).
- **Confirmar:** farmacéutico garante.

## DUDA-03 · Medicamento de uso humano prescrito
- **Spec:** §4.1.5 → `NO_CONFORME` con `MEDICAMENTO_USO_HUMANO_REVISION_GARANTE` ("no se automatiza; requiere
  prescripción excepcional y revisión"). No aparece en la lista de no forzables de §4.1.6.
- **Implementado (conservador):** `BLOQUEANTE_DURO` para el empleado: lo gestiona el garante fuera del flujo
  automático. Configurable.
- **Confirmar:** farmacéutico garante.

## DUDA-04 · Columnas `anulada_por` y `revisado_garante` en una tabla append-only
- **Spec:** §6 define `dispensacion.anulada_por` y `dispensacion.revisado_garante` en una tabla **sin UPDATE**.
- **Contradicción:** rellenarlas exigiría un `UPDATE`.
- **Implementado:** la anulación es una **fila nueva** (contramovimiento) con `anula_dispensacion_id`
  (único: no se anula dos veces) y la vista `v_dispensacion` deriva `anulada_por`. Las revisiones del garante
  van a la tabla append-only `revision_garante`. Las correcciones de entradas tras finalizar van a
  `recepcion_ajuste` (append-only).

## DUDA-05 · `recepcion_linea` "append-only tras finalizar" frente a estados de sincronización
- **Spec:** §6 la declara append-only tras finalizar, pero §5.2.2 y §4.9 cambian su estado
  (`PENDIENTE_ALTA_SIWEB` → encolada → sincronizada) después de finalizar.
- **Implementado:** trigger que, con la recepción finalizada, impide borrar y modificar cualquier dato
  registrado; solo permite cambiar `estado` y `siweb_variant_id`. Tampoco admite líneas nuevas ni reabrir.

## DUDA-06 · Fuente de "inmunológico" y "biológico"
- **Spec:** §4.4.1 usa `tipoMedicamento` de CIMAVet (inmunológico/mixto) y "biológico".
- **Hallazgo:** el Nomenclátor (`PrescripcionVET.xml`) no trae `tipoMedicamento`; la API sí. Ninguna fuente
  marca "biológico".
- **Implementado (conservador):** inmunológico si `tipoMedicamento ∈ {2 inmunológico, 3 mixto}` **o** ATCvet
  empieza por `QI`. Biológico: no hay dato; se cubre con `sustitucion-exclusiones.v1.yaml` (por `nregistro`
  o principio activo), que mantiene el garante.
- **Confirmar:** farmacéutico garante (lista de biológicos).

## DUDA-07 · Subcategorías de especie (p. ej. "Perros grandes", "Perras gestantes")
- **Spec:** "autorizado para la especie de destino" (§4.4.2.5) sin jerarquía.
- **Hallazgo:** el diccionario de especies tiene 371 entradas con subcategorías.
- **Implementado (conservador):** coincidencia exacta por id, más un mapa configurable
  `especie_padre` (`config/rules/equivalencia.v1.yaml`): una receta para una subcategoría queda cubierta por
  la autorización de la especie base, **nunca al revés**. Solo se han mapeado perros y gatos.
- **Confirmar:** farmacéutico garante / veterinaria responsable.

## DUDA-08 · Defectos de forma "forzables" que quizá no deberían serlo
- **Spec:** §4.1.6 declara forzables todos los bloqueos no listados, lo que incluye `RECETA_CADUCADA` y
  "receta de botiquín / de no dispensación" (`TIPO_DISPENSACION_NO_DISPENSABLE`).
- **Implementado:** como dice la spec (`BLOQUEANTE_FORMA`), porque no es ambiguo. Se señala aquí porque
  dispensar con una receta caducada o de botiquín tiene implicaciones regulatorias: basta con cambiar la
  severidad en `receta-campos.v1.yaml` (y aprobar la nueva versión) para hacerlos no forzables.
- **Confirmar:** farmacéutico garante.

## DUDA-09 · Menor concentración de **otro laboratorio** (§4.3.1 frente a §4.4.2)
- **Spec:** §4.3.1 dice que una presentación de menor concentración de otro laboratorio "se trata además con
  las condiciones y el flujo de sustitución". Pero §4.4.2.1 exige **misma** composición cuantitativa.
- **Contradicción:** aplicadas literalmente, ninguna presentación de menor concentración de otro laboratorio
  podría cumplir §4.4.2.
- **Implementado (conservador):** se propone como `SUSTITUIR` solo si cumple la regla de formato (§4.3.1) **y**
  todas las condiciones de §4.4.2 salvo la igualdad de concentración, la sustitución está permitida (§4.4.1) y,
  además, **siempre en modo `PRE`** (aprobación previa del garante), con nota de administración.
- **Confirmar:** farmacéutico garante.

## DUDA-10 · "Unidades" en dispensación y en el tope de lo prescrito
- **Spec:** §4.6 "la suma de unidades no supera lo prescrito" y §4.8 "UNIDADES DISPENSADAS"; la receta
  prescribe "cantidad / nº de envases".
- **Implementado:** la unidad de dispensación es el **envase**. El tope es el nº de envases prescrito (o el
  que resulte de la regla de formato). En psicótropos, 1 envase por receta.
- **Confirmar:** farmacéutico garante (si alguna vez se dispensa fraccionado — `sw_dispensacion_fraccionada`
  del Nomenclátor — habría que contar unidades de forma).

## DUDA-11 · Comparación de indicaciones
- **Spec:** "similitud de texto + sinónimos" sin método concreto (§4.4.2.6).
- **Implementado:** proporción de términos de la indicación de la receta presentes en la indicación del
  candidato (tras normalizar, quitar palabras vacías y aplicar sinónimos). Umbrales y sinónimos en
  `config/rules/equivalencia.v1.yaml` (`COINCIDE ≥ 0,8`, `PROBABLE ≥ 0,4`). `PROBABLE` exige confirmación expresa
  del garante (modo `PRE`).
- **Confirmar:** farmacéutico garante (umbrales y lista de sinónimos).

## DUDA-12 · Tiempos de espera sin dato comparable
- **Spec:** §4.4.2.7 exige tiempo de espera del candidato ≤ prescrito por tejido y especie.
- **Implementado (conservador):** si falta el dato de algún tejido/especie en el prescrito o en el candidato, el
  candidato **no** es equivalente (`TIEMPO_ESPERA_DESCONOCIDO`). Lo mismo al forzar una prescripción solo por
  principio activo en especie productora (no hay tiempo de referencia).

## DUDA-13 · Respuestas JSON de CIMAVet no documentadas
- **Spec/ref:** `docs/ref/CIMAVet_REST_API.md` solo describe campos y tipos; no hay ejemplos JSON ni el
  envoltorio de las listas paginadas; la tabla de "Tiempo de espera" no incluye el tejido; las fechas se
  describen como "Fecha" o "Unix timestamp" sin más detalle.
- **Implementado:** cliente tolerante: claves normalizadas a minúsculas, listas como array directo o primer
  campo array de un objeto, paginación hasta página vacía o repetida, fechas en timestamp (s o ms),
  `dd/mm/aaaa` o ISO. Fixtures construidas con los nombres de campo de la doc y valores reales del
  Nomenclátor (`fixtures/cimavet/README.md`). Queda un `it.todo` hasta tener respuestas reales.
- **Conservador:** la API no da la base de la concentración (`cantidad_concentracion`): un refresco por API
  **no** sustituye una composición normalizable del Nomenclátor, y una composición solo de API se marca no
  normalizable (no se proponen formatos ni sustitutos automáticamente).
- **Pendiente:** JC — guardar respuestas reales en `fixtures/cimavet/`.

## DUDA-14 · Estados del Nomenclátor y unidades de tiempo de espera
- **Hallazgo:** `cod_estado_registro_*` usa el diccionario de situación de registro (1 Autorizado, 3 Anulado,
  4 Suspenso, 5 Suspenso CN). Los tiempos de espera vienen en Días, Horas, Semanas, Meses y Grados-día.
- **Implementado (conservador):** cualquier código distinto de 1 o 3 se trata como suspendido. Conversión a
  días redondeando hacia arriba (horas/24, semanas×7, meses×31); los grados-día no se convierten (el
  candidato no se considera equivalente en especies productoras).

## DUDA-15 · Desglose de stock por lote en Siweb360
- **Ref:** la doc de Inventario muestra `levels[]` truncado tras `warehouse_id`; no se ve cómo vienen el lote
  y el disponible por lote, imprescindibles para FEFO (§4.5).
- **Implementado:** lectura tolerante (`lot_code`/`batch_number`/`lot`; `available`/`quantity_available`),
  documentada como **hipótesis** en `fixtures/siweb/README.md`, con `it.todo`. **Conservador:** si alguna
  variante no trae lote y disponible interpretables, el stock queda `NO_DISPONIBLE` → `PENDIENTE_STOCK`
  (nunca se recomienda dispensar sin confirmar stock).
- **Pendiente:** JC — guardar una respuesta real de `GET inventory/variants/:id` de un medicamento con lotes.

## DUDA-16 · `SIWEB_STOCK_WRITE_MODE=off` y el outbox
- **Spec:** "no escribas stock salvo entradas a través del outbox y respetando `SIWEB_STOCK_WRITE_MODE`".
- **Ambigüedad:** en `off`, ¿se encolan las entradas para enviarlas cuando se active?
- **Implementado (conservador):** en `off` **no se encola nada** (la recepción queda con
  `sync_estado = ESCRITURA_DESACTIVADA`) y el dispatcher no envía. Encolar para más tarde provocaría
  entradas duplicadas al activar `entries_only`, porque hasta el corte operativo el personal sigue dando
  las entradas a mano en Siweb360 (D-03).

## DUDA-17 · Qué es una "respuesta ambigua" en el outbox
- **Spec:** timeout o respuesta ambigua → `needs_reconciliation`; 4xx deterministas → `failed`.
- **Implementado (conservador):** `needs_reconciliation` para timeout, error de red, **cualquier 5xx** y
  respuesta 2xx no interpretable (no se sabe si el ajuste se aplicó). `failed` para 4xx (409 = stock ilimitado).
  Nunca se reintenta sola: una persona resuelve desde Administración (`confirmar_aplicada`, `reenviar`,
  `descartar`), todo auditado.

## DUDA-18 · Reversión del spike (§12.3)
- **Spec:** "revierte con −1".
- **Implementado:** `+1` con `reason=purchase_receipt` (el mismo camino que usará el outbox) y `−1` con
  `reason=adjustment_negative` sobre el mismo lote (la doc exige que el motivo cuadre con el sentido del ajuste).

## DUDA-19 · Combinación de confianzas en la extracción
- **Spec:** "confianza final = combinación de la confianza OCR de las palabras de la evidencia y la
  autoevaluación del modelo; si la evidencia citada no aparece en el OCR → máximo 0,5" (§5.3).
- **Implementado (conservador):** el **mínimo** de ambas. Si no hay evidencia, o no aparece en el OCR, o
  ninguna palabra OCR coincide → máximo 0,5. La firma manuscrita y la casilla "He comprobado los datos con el
  original" **nunca** se rellenan desde la IA, aunque el modelo detecte una firma.

## DUDA-20 · Recetas de ejemplo para la extracción
- **Spec:** `fixtures/recetas/` con imágenes anonimizadas y JSON esperado "los aporta JC".
- **Implementado:** sin recetas reales todavía; `pnpm eval:extraction` lo indica y termina sin error. Para que
  la UI sea navegable con `EXTRACTOR=fake` se han añadido 3 fixtures `demo-*.expected.json` **sintéticas**
  (sin imagen ni datos reales), marcadas como tales en `fixtures/recetas/README.md`.

## DUDA-21 · Autenticación de la PWA con Entra sin MSAL
- **Spec:** ADR-06 usa la autenticación integrada de Container Apps + validación del token en la API.
- **Implementado:** la PWA no incluye MSAL: en modo `entra` obtiene el `id_token` de `/.auth/me` (token store de la
  autenticación integrada) y lo envía como `Bearer`; la API lo valida contra el JWKS de Entra (audiencia = client id,
  `roles` = app roles, `amr` = MFA). Requiere activar el token store en la app de Container Apps (infra/).
- **Confirmar:** JC (alternativa: MSAL en la PWA si se quiere renovación de tokens en el cliente).

## DUDA-22 · Normalización de páginas y PDF
- **Spec:** normalizar a PNG por página, corregir orientación, SHA-256 y pHash (§4.1.1).
- **Implementado:** en el navegador (canvas): orientación EXIF, PNG, dHash de 64 bits y aviso de calidad; el
  servidor calcula los SHA-256. Los **PDF y HEIC** se guardan tal cual (una "página") sin pHash: rasterizar PDF
  exigiría una dependencia pesada (pdf.js o binarios nativos). Queda pendiente decidir si se añade.
