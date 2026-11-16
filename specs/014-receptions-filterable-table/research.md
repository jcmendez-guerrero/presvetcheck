# Research: Tabla filtrable de recepciones

## R1. ¿Filtrar en la API o en el navegador?

- **Decision**: en la API, con paginación.
- **Rationale**: FR-006 exige buscar en todas las recepciones. Hoy `RecepcionesService.listar()` devuelve solo las 50
  más recientes; mandar el histórico completo al navegador crecería sin límite.
- **Alternatives considered**: subir el límite y filtrar en cliente (no escala y sigue cortando); un endpoint nuevo
  (`/api/recepciones/buscar`) — rechazado: el existente solo tiene dos llamadores (la página y una prueba) y se amplía.

## R2. Forma de la respuesta (cambio incompatible)

- **Decision**: `GET /api/recepciones` pasa de devolver un array a `{ filas, total, pagina, porPagina, proveedores }`.
- **Rationale**: la tabla necesita el total (FR-009) y la lista de proveedores para el filtro. Llamadores encontrados:
  `apps/web/src/paginas/recepciones.tsx` (se sustituye) y `apps/api/test/flujos.test.ts` (comprobación de que una
  descartada no aparece; se ajusta a `.filas`). Nadie más (ni el asistente) usa este endpoint.
- **Alternatives considered**: cabecera `X-Total-Count` manteniendo el array — menos explícito y fuera del estilo de la API.

## R3. Proveedores para el filtro

- **Decision**: la respuesta incluye `proveedores: { id, nombre }[]` con los distribuidores que tienen al menos una
  recepción, ordenados por nombre (`localeCompare` en `es`). El filtro envía `distribuidorId`.
- **Rationale**: `GET /api/recepciones/proveedores` ya existe pero mezcla proveedores de Siweb360 sin recepciones y
  solo devuelve nombres; filtrar por id es exacto.
- **Alternatives considered**: filtrar por nombre normalizado — frágil con nombres parecidos.

## R4. Búsqueda por nº de albarán o factura

- **Decision**: `ILIKE '%término%'` sobre `recepcion.albaran`, con el término recortado y los comodines `%`, `_` y `\`
  escapados; 1–60 caracteres.
- **Rationale**: coincidencia parcial sin distinguir mayúsculas (spec). Sin índice: con miles de filas el recorrido es
  de milisegundos.
- **Alternatives considered**: índice trigram (`pg_trgm`) — innecesario a esta escala; se puede añadir si crece.

## R5. Fechas

- **Decision**: `fechaRecepcion` y `fechaCompra` son `date` y se comparan tal cual (`>=` desde, `<=` hasta). La fecha de
  registro es `recepcion.createdAt` (timestamptz) y se filtra con `rangoMadrid(desde, hasta)` de `@mmx/shared`
  (`[desde 00:00, hasta+1 00:00)` en Europe/Madrid). Se devuelve como instante ISO. La web no puede usar `fecha()` tal cual (con un instante muestra «dd/mm/aa hh:mm»):
  se convierte primero al día de Madrid (`Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' })`) y luego se
  pasa a `fecha()`, para mostrar «dd/mm/aaaa» como pide FR-002.
- **Rationale**: FR-013 y el caso límite de las 00:30. `rangoMadrid` ya se usa en Registros.
- **Validación**: cada par desde/hasta se valida en zod con `refine` (desde ≤ hasta) → 400 con el error de validación
  estándar. La web además lo comprueba antes de enviar para mostrar el mensaje junto al campo.

## R6. Orden

- **Decision**: `orden ∈ { albaran, proveedor, recibida, compra, registrada, estado }`, `dir ∈ { asc, desc }`; por
  defecto `registrada desc`. Mapeo cerrado a columnas (nunca SQL con el valor recibido); nulos al final; desempate
  por `createdAt desc, id`.
- **Rationale**: FR-008 y paginación estable.

## R7. Paginación

- **Decision**: `pagina` (≥ 1, por defecto 1) y `porPagina` (1–100, por defecto 25). `total` con `count(*)` sobre el
  mismo filtro. Una página fuera de rango devuelve `filas: []` con el `total` real; la web vuelve a la última página.
- **Alternatives considered**: cursor — innecesario: se navega por páginas numeradas y el volumen es pequeño.

## R8. Estado en la dirección (web)

- **Decision**: `validateSearch` de la ruta `/recepciones` acepta, además del `albaran` actual (id del documento del
  móvil), `numero`, `proveedor`, `estado` (lista separada por comas), `recibidaDesde/Hasta`, `compraDesde/Hasta`,
  `registradaDesde/Hasta`, `orden`, `dir`, `pagina`. Los valores no válidos se descartan en silencio.
- **Rationale**: FR-010 (volver atrás, compartir la dirección). El nombre `numero` evita chocar con `albaran`, que ya
  significa otra cosa en esta ruta.
- La caja de texto espera `PAUSA_BUSQUEDA_MS` (300 ms, `lib/busqueda.ts`) antes de cambiar la dirección; cambiar
  cualquier filtro vuelve a la página 1. TanStack Query con `placeholderData: keepPreviousData` evita parpadeos.

## R9. Texto del estado

- **Decision**: mapa `ESTADO_RECEPCION` en `apps/web/src/lib/recepciones-filtros.ts`: `ABIERTA` → «Abierta», `FINALIZADA` →
  «Finalizada», `SINCRONIZADA` → «Enviada», `ERROR_SINCRONIZACION` → «Error al enviar», `DESCARTADA` → «Descartada».
  Abierta y Error al enviar llevan además un icono y peso de texto (no solo color).
- **Rationale**: la UI traduce códigos (AGENTS.md). No es una regla de negocio.
