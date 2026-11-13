# Research: Albarán o factura y códigos QR desde el móvil

Todas las decisiones se apoyan en el código actual; no queda ningún NEEDS CLARIFICATION.

## R1. Cómo llega el albarán del móvil al ordenador

- **Decision**: nueva ruta del móvil `POST /api/movil/m/albaranes` (token del QR, como `…/m/recetas`) que llama al
  mismo `RecepcionesService.leerAlbaran` que la ruta del PC y publica un evento en la sesión de emparejamiento. El
  evento solo lleva el id de la lectura (`{ tipo: 'albaran', documentoId }`); el PC pide lo leído con una ruta nueva
  `GET /api/recepciones/albaranes/:documentoId`, con sesión y rol de operativa.
- **Rationale**: reutiliza la lectura, el guardado del fichero, la auditoría (`albaran_leer`) y el aviso de
  duplicados sin copiarlos (FR-003, FR-007, FR-008). El móvil ya actúa en nombre de quien abrió el emparejamiento.
  Los eventos guardan solo un id, así que la tabla de eventos no acumula datos del documento y el móvil no recibe
  nada leído (FR-006).
- **Alternatives considered**: meter la lectura entera en el evento (duplica datos en `sesion_movil_evento` y obliga
  a validar el formato dos veces); hacer que el móvil suba el fichero a la ruta del PC (necesita sesión de usuario en
  el móvil, fuera de alcance).

## R2. Albarán de varias páginas

- **Decision**: `leerAlbaran` pasa a recibir una lista de páginas. Cada página se lee por separado con el lector
  actual y las lecturas se unen con una función pura nueva `unirLecturas` en `packages/extraction`:
  cabecera (proveedor, número, fecha) = el primer valor no nulo; líneas = todas, en orden de página; totales = los de
  la última página que los traiga; `modelo` igual. Un PDF de varias páginas sigue entrando como una sola «página»
  (Document Intelligence ya lee todas sus hojas).
- **Rationale**: no hace falta ninguna dependencia nueva (no hay librería de PDF ni de imagen en el repo) y la
  unión es determinista y fácil de probar con tablas de casos. Cada hoja se factura igual en Document Intelligence,
  así que el coste no cambia.
- **Alternatives considered**: juntar las fotos en un PDF en el móvil o en la API (añade `pdf-lib` o similar solo
  para esto); limitar el móvil a una foto (incumple el escenario 2 de la US1).

## R3. Guardar todas las páginas

- **Decision**: columna nueva `albaran_documento.paginas jsonb null` con `[{ path, mime }]` de todas las páginas.
  `documento_path` y `mime` siguen siendo los de la primera página, así que lo que ya existe no cambia.
  `GET /api/recepciones/:id/documento` acepta `?pagina=n` (por defecto 1). El `sha256` de la lectura es el de todas
  las páginas concatenadas, como en las recetas.
- **Rationale**: una migración pequeña y compatible hacia atrás; las filas antiguas (`paginas` nulo) se leen como una
  sola página.
- **Alternatives considered**: una fila por página (la recepción solo enlaza un `documentoId`); guardar solo la
  primera página (incumple FR-007).

## R4. Doble envío

- **Decision**: el móvil desactiva «Enviar al ordenador» mientras envía. Además, si ya hay una lectura **sin
  recepción** del mismo `sha256` y de la misma persona, `leerAlbaran` la devuelve en lugar de volver a leer.
- **Rationale**: cubre la doble pulsación y los reintentos de red sin pagar otra lectura, y no cambia el aviso
  actual de «este fichero ya se registró» (lecturas con recepción).
- **Alternatives considered**: una clave de idempotencia en la petición (más código para el mismo efecto).

## R5. Qué hace el ordenador al recibirlo

- **Decision**: `MovilProvider` (`apps/web/src/lib/movil.tsx`) trata dos eventos nuevos:
  - `{ tipo: 'albaran', documentoId: string }`: si la pantalla de nueva recepción está montada (se suscribe igual
    que `useCodigosMovil`), carga la lectura. Si ya tiene una lectura sin guardar, pregunta antes de sustituirla. Si
    no está montada, guarda el id en `albaranSinDestino` y el panel del móvil (`movil-pc.tsx`, donde ya sale el código sin destino) enseña «Ha llegado un albarán desde el móvil»
    con un botón que abre `/recepciones?albaran=<id>`.
  - `{ tipo: 'albaran', documentoId: null }`: la lectura falló; se quita el «leyendo» y se avisa en el PC.
  Antes de leer se publica el `{ tipo: 'leyendo' }` que ya existe.
- **Rationale**: es el mismo patrón que `codigoSinDestino`. No se navega solo, para no sacar a nadie de una
  dispensación a medias (FR-005).
- **Alternatives considered**: navegar siempre a la recepción, como hacen las recetas (interrumpe otras pantallas).

## R6. Página del móvil

- **Decision**: en `apps/web/src/paginas/movil.tsx`, la captura de varias páginas de la receta se convierte en un
  componente con parámetros (título, textos y ruta) y se usa también en la tarjeta «Albarán o factura», que acepta
  `image/*` y `application/pdf`. `GET /api/movil/m/sesion` añade `albaranes: boolean` (si hay lector de albaranes);
  si es `false`, la tarjeta se muestra desactivada con «La lectura de albaranes no está configurada: regístralo en
  el ordenador» (FR-009).
- **Rationale**: reutiliza la captura y el preparado de imágenes (`prepararPagina`) que ya existen.

## R7. QR con enlace GS1 (GS1 Digital Link)

- **Decision**: `parseGs1` reconoce una entrada que empieza por `http://` o `https://`, del dominio que sea. Busca en
  la ruta la clave `01/<GTIN>` y sus calificadores (`10` lote, `21` serie, `22`, `235`) y en la consulta los
  atributos (`17` caducidad y los demás AI conocidos). Desescapa los valores (`%2F`…) y monta la cadena GS1 con
  separadores GS, que pasa por el **mismo** análisis que un DataMatrix (longitudes, control del GTIN, día `00` de la
  caducidad). La simbología resultante es `qr`. Si la dirección no tiene `01/<GTIN>`, devuelve el error nuevo
  `QR_SIN_PRODUCTO`. El enlace nunca se abre ni se consulta: solo se analiza el texto (FR-013).
- **Rationale**: un único punto de interpretación para el móvil, la cámara del PC y el lector USB (FR-014), en el
  paquete de dominio puro que ya existe. Se aplica la norma pública GS1 Digital Link 1.x (sintaxis sin comprimir).
- **Alternatives considered**: interpretar el QR en el navegador (dos implementaciones); aceptar la forma comprimida
  de Digital Link (no se ha visto en envases veterinarios; queda como `QR_SIN_PRODUCTO` hasta que aparezca un caso).

## R8. Mensajes al personal

- **Decision**: la pantalla de recepción traduce `QR_SIN_PRODUCTO` a «Este código QR no identifica el medicamento:
  lee el DataMatrix del envase o escribe los datos». Los demás errores de lectura siguen como hoy. La tarjeta del
  móvil pasa a decir «Lee el código del envase (DataMatrix, código QR o código de barras)» (FR-015).

## R9. Pruebas sin servicios reales

- **Decision**: con `EXTRACTOR=fake`, el lector de albaranes devuelve la fixture sintética
  `fixtures/albaranes/sintetico-1.invoice.json` para cualquier página, así que basta para la ruta del móvil, la unión
  de páginas y el evento. Las pruebas de Digital Link usan direcciones construidas por el equipo a partir de los
  GTIN de prueba que ya usa `packages/gs1/test` (no envases reales).
