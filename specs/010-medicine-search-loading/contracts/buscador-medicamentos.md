# Contrato UI: buscador de medicamentos

**Feature**: [spec.md](../spec.md) · **Plan**: [plan.md](../plan.md)

Contrato interno del frontal entre las cuatro páginas y las piezas compartidas. La API
`GET /api/medicamentos/buscar?q=…[&especie=…]` **no cambia**.

## `get` / `api` (`apps/web/src/lib/api.ts`)

- Aceptan un `signal?: AbortSignal` opcional que se pasa tal cual a `fetch`.
- Sin `signal`, el comportamiento es idéntico al actual (ningún otro llamador cambia).

## `useBusquedaMedicamentos<T>(texto, opciones?)` (`apps/web/src/lib/busqueda.ts`)

Entrada:

| Parámetro | Tipo | Notas |
|-----------|------|-------|
| `texto` | string | valor actual del campo |
| `opciones.especie` | id opcional | solo revisión |
| `opciones.activo` | boolean, por defecto `true` | p. ej. `false` cuando ya hay medicamento elegido |

Salida:

| Campo | Tipo | Significado |
|-------|------|-------------|
| `estado` | `'corto' \| 'buscando' \| 'error' \| 'vacio' \| 'resultados'` | ver [data-model.md](../data-model.md) |
| `resultados` | `T[]` | lista a pintar (puede ser la anterior mientras `desfasada`) |
| `desfasada` | boolean | la lista no corresponde aún al texto actual |
| `reintentar` | `() => void` | vuelve a lanzar la búsqueda actual |

Garantías: espera 300 ms sin cambios; mínimo 3 letras; anula la petición anterior; corta a los 10 s; nunca
devuelve en `resultados` una respuesta de una clave que ya no es la actual salvo marcada con `desfasada: true`.

Constantes exportadas: `PAUSA_BUSQUEDA_MS = 300`, `TIEMPO_MAX_BUSQUEDA_MS = 10_000`, `MIN_LETRAS_BUSQUEDA = 3`.

## `<EstadoBusqueda>` y `<ListaResultados>` (`apps/web/src/componentes/estado-busqueda.tsx`)

- `<EstadoBusqueda estado texto onReintentar />`: un único `role="status"` (`aria-live="polite"`) bajo el campo.
- `<ListaResultados desfasada>{…}</ListaResultados>`: envuelve el `<ul>` de cada página; con `desfasada` aplica
  `opacity-50`, `aria-busy="true"` e `inert`.

## Textos (español, fijos)

| Estado | Texto visible | Anuncio para lector de pantalla |
|--------|---------------|---------------------------------|
| `corto` | Escribe al menos 3 letras del nombre o del principio activo. | — |
| `buscando` | (icono giratorio) Buscando «{texto}»… | Buscando… |
| `error` | No se ha podido consultar el catálogo ahora. [Volver a intentar] | igual |
| `vacio` | No se ha encontrado ningún medicamento con «{texto}». | igual |
| `resultados` | — (se ve la lista) | {n} resultado(s) |

Recepciones conserva su consejo adicional para `vacio` («escanea el envase o regístralo como «Otro producto»»).

## `data-testid` para pruebas

`estado-busqueda` (en el `role="status"`), `lista-resultados` (contenedor), `reintentar-busqueda`.
