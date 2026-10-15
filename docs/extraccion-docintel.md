# Extracción de recetas con Document Intelligence (ADR-12)

La app lee las recetas con un **modelo personalizado neuronal** de Azure AI Document Intelligence. No hay LLM:
cada campo sale de una zona de la imagen, con su confianza. La persona revisa siempre los datos y nunca se marcan
solos la firma ni "comprobado con el original".

## 0. Sin entrenar: modelo genérico + reglas (`DOCINTEL_MODEL_ID=prebuilt-layout`)
Mientras no haya modelo personalizado, la app usa `prebuilt-layout` con pares clave-valor y unas reglas que
llevan cada etiqueta impresa ("Nº Colegiado", "Fármaco", "Cód.nac."…) a su campo
(`packages/extraction/src/azure/reglas-layout.ts`). Nunca toma datos del propietario y rebaja la confianza para
que la persona confirme más. Después, el medicamento se identifica contra CIMAVet
(`apps/api/src/servicios/identificacion.ts`): por código nacional si la receta lo trae (no es obligatorio), si no
por nombre y, si no hay línea, buscando nombres de medicamento en el texto; siempre exigiendo que la marca del
candidato aparezca en lo leído. Todo queda como propuesta que la persona confirma.

Medido con las 86 páginas aportadas (15/10/2026, Nomenclátor completo): medicamento identificado en 59, otras 9
solo con principio activo (elige la persona), colegiado en 68, fecha en 58, especie en 54, indicación en 52 y
número en 39. Las que fallan son sobre todo manuscritas o no son recetas (resguardos, dorsos).

En local:
```bash
EXTRACTOR=azure
DOCINTEL_ENDPOINT=https://<recurso>.cognitiveservices.azure.com/
DOCINTEL_MODEL_ID=prebuilt-layout
```
con `az login` y el rol *Cognitive Services User* sobre el recurso (sin claves).

## 1. Preparar las recetas de entrenamiento
- Usa recetas reales escaneadas (p. ej. los PDF aportados por JC). **Tienen datos personales**: nunca se suben
  a git; solo al contenedor privado `docintel-entrenamiento` de la cuenta de almacenamiento (UE).
- Una página por receta (PNG/JPG/PDF). Endereza las páginas giradas.
- Mínimo 5 recetas por plantilla para empezar; mejor 10–15 por clínica y alguna manuscrita.

## 2. Proyecto en Document Intelligence Studio
1. Studio → *Custom extraction model* → nuevo proyecto con el recurso `di-mmx-recetas-{env}` y el contenedor
   `docintel-entrenamiento` (acceso con la identidad del recurso).
2. Genera los campos desde el código y súbelos como `fields.json` del proyecto:
   ```bash
   pnpm docintel:campos
   ```
   (escribe `packages/extraction/docintel/fields.json`). Los nombres deben coincidir exactamente con los de la
   app; la tabla dinámica `lineas` tiene una fila por medicamento.
3. Etiqueta cada receta. Fecha de emisión como fecha; firma como *signature*; sello y QR como marca de
   selección. Deja vacío lo que no aparezca: el modelo no debe aprender a "rellenar".
4. *Train* → modelo **neural** con un id versionado, p. ej. `recetas-v1`.

## 3. Activarlo
- `DOCINTEL_MODEL_ID=recetas-v1` (en Azure: parámetro `modeloDocIntel` de `infra/main.*.bicepparam`) y
  `EXTRACTOR=azure`.
- Sin `DOCINTEL_MODEL_ID` la extracción queda desactivada y la receta se introduce a mano.

## 4. Medir antes de usarlo
1. Guarda en local (fuera de git) imágenes de recetas **no usadas en el entrenamiento** con su JSON esperado.
2. `pnpm eval:extraction` → exactitud por campo, campos bajo el umbral y coste estimado (≈ 0,03 € por página).
3. Si un campo falla mucho, etiqueta más ejemplos de esa clínica y entrena `recetas-v2`. Con plantillas muy
   distintas se puede componer un modelo por clínica (*composed model*) sin cambiar la app.

## Si cambian los campos
Cambiar `CAMPOS_EXTRAIDOS_*` en `packages/shared` obliga a subir la versión `ESQUEMA_CAMPOS_VERSION`, regenerar
`fields.json`, reetiquetar y reentrenar.
