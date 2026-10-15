# ADR-12 · Extracción con un modelo personalizado de Document Intelligence (sustituye a ADR-04)

- **Estado:** aceptada (JC, 15/10/2026; DUDA-27)

## Contexto
Las recetas reales son formularios **impresos** de unas pocas clínicas (cada una con su plantilla), con
páginas giradas, sellos y firmas encima del texto. ADR-04 usaba `prebuilt-layout` + un LLM de Azure OpenAI para
estructurar los campos: más coste por receta, un segundo servicio y el riesgo de que el modelo "complete" datos.

## Decisión
Un **modelo personalizado neuronal de Azure AI Document Intelligence**, entrenado en Document Intelligence
Studio con recetas reales etiquetadas, devuelve directamente cada campo (`numero`, `fechaEmision`,
`veterinarioNumColegiado`… y la tabla `lineas`) con su confianza y su región en la página. No interviene ningún
LLM: cada valor sale de una zona del documento y la UI puede enseñarla. La confianza final es el mínimo entre la
del campo y la del OCR de sus palabras; un campo sin región queda en 0,5 como máximo. La firma y la casilla
"comprobado con el original" siguen sin rellenarse nunca desde la extracción.

- Los nombres de campo salen del código (`pnpm docintel:campos` → `fields.json` del proyecto de Studio).
- `DOCINTEL_MODEL_ID` elige el modelo; sin él, la extracción queda desactivada y se introduce a mano.
- Datos de entrenamiento en el contenedor privado `docintel-entrenamiento` (UE), leídos por la identidad del
  recurso de Document Intelligence. Se elimina Azure OpenAI de la infraestructura.

## Alternativas descartadas
- Donut / LayoutLMv3 propios: cientos de recetas etiquetadas, GPU, mantenimiento y (LayoutLMv3) licencia no comercial.
- `prebuilt-layout` + LLM (ADR-04): coste por tokens, dos servicios y texto no anclado al documento.
