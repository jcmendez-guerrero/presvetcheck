# Data Model: Albarán o factura y códigos QR desde el móvil

Solo cambia una tabla; lo demás son tipos de eventos y resultados que ya existen.

## `albaran_documento` (cambio)

| Campo | Tipo | Cambio | Notas |
|---|---|---|---|
| `paginas` | `jsonb null` | **nuevo** | `[{ path: string, mime: string }]`, en orden. Nulo en las filas antiguas, que se leen como una sola página (`documento_path`, `mime`). |
| `documento_path`, `mime` | — | sin cambio | Siguen siendo los de la primera página. |
| `sha256` | — | sin cambio de tipo | Con varias páginas, el hash de todas concatenadas. |
| `lectura` | — | sin cambio de formato | La lectura ya unida (`unirLecturas`). |
| `creado_por` | — | sin cambio | Desde el móvil, quien abrió el emparejamiento. |

Migración: `ALTER TABLE albaran_documento ADD COLUMN paginas jsonb` (sin valor por defecto, sin relleno).
`albaran_documento` no es un registro finalizado: la regla append-only no le afecta.

**Validación**: de 1 a 10 páginas por envío; cada una `image/png|jpeg|heic|webp` o `application/pdf` (los tipos que
ya admite la ruta del PC).

## `EventoMovil` (cambio de tipo, sin migración)

Se guarda en `sesion_movil_evento.datos` (jsonb), que ya existe.

```text
{ tipo: 'leyendo' }                                   // ya existe; también antes de leer un albarán
{ tipo: 'receta', recetaId, aviso }                   // ya existe
{ tipo: 'codigo', raw }                               // ya existe
{ tipo: 'albaran', documentoId: string | null }       // nuevo; null = la lectura falló
```

El evento nunca lleva datos leídos del documento.

## `LecturaAlbaran` (sin cambio de forma)

`unirLecturas(lecturas: LecturaAlbaran[]): LecturaAlbaran`, función pura:

- `proveedor`, `numero`, `fecha`: el primer valor no nulo, en orden de página.
- `lineas`: todas, en orden de página.
- `totales`: los de la última página que tenga algún total no nulo; si ninguna tiene, todo nulo.
- `modelo`: el de la primera lectura.
- Con una sola lectura, la devuelve igual.

## `Gs1Resultado` (cambio)

- `Gs1Error.error` añade `'QR_SIN_PRODUCTO'`: dirección web sin clave `01/<GTIN>`.
- Un `Gs1Ok` obtenido de un enlace GS1 tiene `simbologia: 'qr'`. Lleva los mismos campos (`gtin`, `cn`, `lote`,
  `caducidad`, `serie`, `ais`, `avisos`) y pasa las mismas validaciones que un DataMatrix.

Correspondencia del enlace GS1 con los AI:

| Parte del enlace | AI | Campo |
|---|---|---|
| ruta `/01/{gtin}` (obligatoria) | 01 | `gtin` → `cn` |
| ruta `/10/{lote}` | 10 | `lote` |
| ruta `/21/{serie}` | 21 | `serie` |
| ruta `/22/…`, `/235/…` | 22, 235 | `ais` |
| consulta `17=AAMMDD` | 17 | `caducidad` (día `00` → último día del mes) |
| consulta con otros AI conocidos (`11`, `712`…) | el mismo | `ais` (712 → `cn` por NHRN, como hoy) |
| consulta que no es un AI | — | se ignora |
