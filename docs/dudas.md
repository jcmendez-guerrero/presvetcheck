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
