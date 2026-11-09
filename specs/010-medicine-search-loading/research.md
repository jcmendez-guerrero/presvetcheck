# Research: Indicador de carga y búsquedas estables en los buscadores de medicamentos

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Fecha**: 2026-11-09

## Estado actual (código leído)

| Buscador | Fichero | Cómo busca hoy | Indicador | Respuestas desfasadas | Mínimo |
|----------|---------|----------------|-----------|-----------------------|--------|
| Revisión de la receta | `apps/web/src/paginas/revision.tsx` (`cand`, `EstadoBusqueda`) | `useQuery` por cada letra | Sí, texto "Buscando «…» en CIMAVet…" sin icono | No (la clave de la consulta es el texto) | 3 |
| Recepciones (nueva línea) | `apps/web/src/paginas/recepciones.tsx` (`cand`) | `useQuery` por cada letra | No | No | 3 |
| Sustituto (resultado) | `apps/web/src/paginas/resultado.tsx` (`buscar`) | `get` manual por cada letra | Variable `buscando` | **Sí**: la última respuesta en llegar gana | 2 |
| Vademécum A y B | `apps/web/src/paginas/vademecum.tsx` (`buscarA`, `buscarB`) | `get` manual por cada letra | No | **Sí** | 2 |

Ninguno espera a que la persona deje de escribir y ninguno anula la petición anterior. `api()` en
`apps/web/src/lib/api.ts` no acepta señal de cancelación.

## Decisiones

### D1. Un único hook compartido sobre React Query

- **Decision**: crear `useBusquedaMedicamentos(texto, opciones)` en `apps/web/src/lib/busqueda.ts`, basado en
  `useQuery` de `@tanstack/react-query` (ya instalado, v5) con clave `['buscar', textoEstable, especie]`.
- **Rationale**: React Query ya garantiza que los datos mostrados son los de la clave actual (FR-004): una
  respuesta de una clave anterior nunca se escribe en la clave nueva. Dos de los cuatro buscadores ya lo usan; los
  otros dos se pasan al mismo hook y se borra su código manual.
- **Alternatives considered**: contador de petición (`idPeticion`) a mano en cada página — duplica lógica y es lo
  que ya falla hoy; una librería de autocompletado — dependencia nueva sin necesidad (constitución, principio I).

### D2. Esperar una pausa de 300 ms antes de buscar

- **Decision**: el hook guarda un `textoEstable` que se actualiza 300 ms después de la última letra
  (`setTimeout` en un `useEffect`). Constante `PAUSA_BUSQUEDA_MS = 300` junto al hook.
- **Rationale**: cumple FR-005 y SC-003 (10 letras seguidas → 1 búsqueda). Un texto escaneado o pegado llega de
  golpe y produce una sola búsqueda.
- **Alternatives considered**: `useDeferredValue` de React — no espera a una pausa, solo baja la prioridad del
  render; seguiría lanzando una petición por letra. Librería de debounce — 5 líneas no la justifican.

### D3. Anular la petición anterior de verdad

- **Decision**: `api()` y `get()` aceptan un `signal` opcional que se pasa a `fetch`. El hook pasa el `signal`
  que React Query da a `queryFn`; React Query anula la petición cuando la clave cambia o el componente se
  desmonta. Se combina con `AbortSignal.timeout(10_000)` mediante `AbortSignal.any` para el tiempo máximo.
- **Rationale**: no carga al servidor con búsquedas que ya no interesan; cumple el caso borde "sale de la
  pantalla" sin errores visibles (React Query no marca como error una consulta anulada por él). El tiempo máximo
  de 10 s convierte una espera infinita en el estado de error con reintento (FR-003).
- **Alternatives considered**: solo descartar la respuesta sin anular — correcto pero desperdicia peticiones.

### D4. Lista anterior atenuada y no seleccionable mientras se busca

- **Decision**: `placeholderData: keepPreviousData`. Mientras haya búsqueda pendiente (`texto !== textoEstable` o
  `isPlaceholderData` o `isFetching`), la lista se pinta con `opacity-50`, `aria-busy="true"` e `inert`.
  Al llegar la respuesta nueva, se sustituye.
- **Rationale**: es la opción A de la aclaración: el campo nunca se bloquea y nada desfasado se puede elegir
  (FR-007). `inert` (soportado por React 19 y los navegadores del mostrador) impide clic, foco y teclado sin
  tocar cada botón.
- **Alternatives considered**: vaciar la lista mientras se busca — más simple pero la lista "salta" con cada
  pausa; `disabled` en cada botón — más código en cada página.

### D5. Un solo componente de estado, sacado de revisión

- **Decision**: mover `EstadoBusqueda` de `revision.tsx` a `apps/web/src/componentes/estado-busqueda.tsx`,
  añadir el icono giratorio que ya usa `Cargando` (`Loader2` + `animate-spin`), un botón "Volver a intentar"
  en el error y el anuncio del número de resultados. Textos fijos en
  [contracts/buscador-medicamentos.md](./contracts/buscador-medicamentos.md).
- **Rationale**: reutiliza lo que existe; mismo aspecto en los cuatro sitios (historia 3).
- **Alternatives considered**: usar `Cargando` tal cual — es un bloque de página, demasiado grande junto a un campo.

### D6. Longitud mínima común: 3 caracteres

- **Decision**: `MIN_LETRAS_BUSQUEDA = 3` en el hook; vademécum y sustituto pasan de 2 a 3.
- **Rationale**: FR-006; 3 es lo que ya usan revisión y recepciones y evita búsquedas de dos letras con cientos
  de resultados.

### D7. Sin umbral anti-parpadeo

- **Decision**: no se añade retraso para mostrar el indicador.
- **Rationale**: la pausa de 300 ms ya evita el parpadeo letra a letra; el caso borde de la especificación lo
  permite ("se admite"). Se revisa si el personal se queja.

### D8. Pruebas

- **Decision**: (a) la elección del estado visible (`corto | buscando | error | vacio | resultados`) es una
  función pura `estadoBusqueda(...)` probada con `it.each` en Vitest; (b) prueba Playwright
  `apps/web/e2e/busqueda-medicamentos.spec.ts` que intercepta `/api/medicamentos/buscar` con `page.route` para
  controlar la demora y el orden de las respuestas.
- **Rationale**: las pruebas unitarias de `apps/web` no tienen DOM (usan `renderToString`), así que el
  comportamiento con tiempo (pausa, anulación, orden) se prueba en el navegador. `page.route` no llama a CIMAVet
  (constitución, principio II).
- **Alternatives considered**: añadir jsdom + Testing Library — dependencias nuevas solo para esta pieza.

## Sin aclaraciones pendientes

Todas las incógnitas del contexto técnico quedan resueltas arriba.
