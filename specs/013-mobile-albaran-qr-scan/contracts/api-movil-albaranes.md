# Contrato: albarán desde el móvil y QR con enlace GS1

Los errores siguen el formato actual de la API: `{ code, mensaje, detalles? }`, con mensajes en español.

## `POST /api/movil/m/albaranes` (nueva; lado del móvil)

- **Autenticación**: cabecera `x-movil-token` (el token del emparejamiento), como `…/m/recetas`. Sin sesión de
  usuario.
- **Cuerpo**: `multipart/form-data` con 1–10 partes de fichero (`pagina`, como en las recetas), `image/png|jpeg|heic|webp` o
  `application/pdf`. Fuera de producción admite el campo `fixture`, como las recetas.
- **Límites**: 10 páginas por envío (constante compartida `MAX_PAGINAS_DOCUMENTO` de `packages/shared`, que también es el límite de ficheros de la subida) y 25 MB entre todas las páginas (`MAX_BYTES_ALBARAN`). Con más de 10 páginas la subida se rechaza con un error 4xx; con más de 25 MB, con 400 `VALIDACION` y el mensaje «El albarán pesa demasiado: 25 MB como máximo entre todas las páginas». En los dos casos no se guarda ni se publica nada. El móvil no deja añadir más de 10 páginas.
- **Efectos**: publica `{ tipo: 'leyendo' }` y llama a `RecepcionesService.leerAlbaran(paginas, ctx)` en nombre de
  quien abrió el emparejamiento (auditoría `albaran_leer` con su id; `userAgent` empieza por `movil`). Después
  publica `{ tipo: 'albaran', documentoId }`. Si la lectura falla, publica `{ tipo: 'albaran', documentoId: null }`
  y devuelve el error.
- **201**: `{ enviado: true }`. No devuelve nada leído (FR-006).
- **Errores**:
  - 401 `NO_AUTORIZADO`: el emparejamiento ha caducado o está cerrado (mensaje actual).
  - 400 `VALIDACION`: sin ficheros, más de 25 MB en total o un tipo no admitido (más de 10 páginas lo rechaza antes el límite de la subida, con otro 4xx).
  - 4xx `EXTRACTOR_NO_CONFIGURADO`: no hay lector de albaranes (mensaje actual).

## `GET /api/movil/m/sesion` (cambio)

- **200**: `{ usuario, expiraAt, albaranes: boolean }`. El campo nuevo `albaranes` vale `true` si hay lector de
  albaranes configurado.

## `GET /api/recepciones/albaranes/:documentoId` (nueva; lado del PC)

- **Autenticación**: sesión de usuario, rol de operativa (el mismo `pre` que `POST /api/recepciones/albaranes`).
- **200**: exactamente la misma forma que devuelve hoy `POST /api/recepciones/albaranes`:
  `{ documentoId, lectura, distribuidorSugerido, duplicados, mismoFichero }`. Los duplicados se calculan en el
  momento de la consulta.
- **Errores**:
  - 404 `NO_ENCONTRADO`: no existe la lectura.
  - 400 `VALIDACION` con `campo: 'documentoId'`: la lectura ya está unida a una recepción (el mismo mensaje que hoy
    al crear con ella).

## `POST /api/recepciones/albaranes` (sin cambio visible)

La ruta del PC sigue aceptando un fichero. Por dentro llama a `leerAlbaran([pagina], ctx)`.

## `GET /api/recepciones/:id/documento` (cambio)

- **Consulta**: `pagina` (entero ≥ 1, por defecto 1).
- **404**: si la página no existe.

## `POST /api/scan/parse` (cambio de comportamiento)

- **Cuerpo**: sin cambio (`{ raw }`).
- Si `raw` es un enlace GS1 (`https://<dominio>/…/01/<GTIN>[/10/<lote>][/21/<serie>][?17=AAMMDD&…]`), la
  respuesta es la misma que con el DataMatrix equivalente, con `simbologia: 'qr'`.
- Una dirección web sin `01/<GTIN>` responde 200 con `{ ok: false, error: 'QR_SIN_PRODUCTO', detalle }`, como los
  demás errores de análisis. El servidor nunca abre ni consulta la dirección.

## Página del móvil (`/movil`)

| Tarjeta | Cambio |
|---|---|
| Receta | sin cambio |
| **Albarán o factura** | nueva: «Añadir página» (cámara trasera) o elegir un fichero (imagen o PDF), lista de páginas, «Enviar al ordenador». Mientras envía: «Enviando y leyendo el albarán…». Al terminar: «Enviado al ordenador». Desactivada si `albaranes === false`. |
| Código del envase | el texto pasa a «Lee el código del envase (DataMatrix, código QR o código de barras)» |

## Ordenador

| Situación | Comportamiento |
|---|---|
| Llega `albaran` con la pantalla de nueva recepción abierta y sin lectura pendiente | carga la lectura en el modo «Leer el albarán» |
| Llega `albaran` con una lectura sin guardar | pregunta «¿Sustituir el albarán leído por el que acaba de llegar del móvil?» |
| Llega `albaran` mientras la persona escribe a mano la cabecera (modo «Registrar a mano» con distribuidor o nº de albarán escritos) | pregunta «¿Sustituir lo que has escrito por el albarán que acaba de llegar del móvil?»; si dice que no, no se toca lo escrito |
| Llega `albaran` en otra pantalla | aviso en el panel del móvil «Ha llegado un albarán desde el móvil» con el botón «Abrir la recepción» → `/recepciones?albaran=<id>`. El id queda pendiente: si la persona abre la pantalla de recepción por el menú en vez de por el botón, se le entrega igual (no se pierde) |
| Llega `albaran` con `documentoId: null` | se quita el «leyendo» y se avisa «No se ha podido leer el documento» (el mismo mensaje que con una subida desde el ordenador) |
| `scan/parse` devuelve `QR_SIN_PRODUCTO` en la recepción | «Este código QR no identifica el medicamento: lee el DataMatrix del envase o escribe los datos» |
