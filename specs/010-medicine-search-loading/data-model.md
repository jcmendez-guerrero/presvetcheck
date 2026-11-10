# Data Model: Indicador de carga y búsquedas estables en los buscadores de medicamentos

**Feature**: [spec.md](./spec.md) · **Fecha**: 2026-11-09

No hay datos persistentes nuevos ni cambios en la base de datos ni en la API. Lo único que se modela es el estado
en memoria de **una búsqueda** dentro de un campo.

## Búsqueda de medicamento (en memoria, por campo)

| Campo | Tipo | Origen | Regla |
|-------|------|--------|-------|
| `texto` | string | lo que hay escrito ahora en el campo | nunca se bloquea (aclaración Q1) |
| `textoEstable` | string | `texto` tras 300 ms sin cambios | es lo que se busca |
| `especie` | id \| null | solo en revisión de la receta | forma parte de la búsqueda: si cambia, es búsqueda nueva |
| `resultados` | lista de candidatos \| sin datos | respuesta de `GET /api/medicamentos/buscar` | siempre de la clave (`textoEstable`, `especie`) actual |
| `desfasada` | booleano | `texto ≠ textoEstable`, o la lista mostrada es la de la clave anterior, o hay petición en curso | si es verdadero, la lista no se puede seleccionar |

El tipo del candidato no cambia: cada página sigue usando el que ya declara (`BusquedaItem`, `Candidato`,
`ResultadoBusquedaItem`, el objeto de recepciones).

## Estados visibles (`estadoBusqueda`)

Función pura; entrada: longitud del texto, si hay búsqueda pendiente, si hubo error, número de resultados.

| Estado | Condición (en este orden) | Qué se ve |
|--------|---------------------------|-----------|
| `corto` | `texto.trim().length < 3` | "Escribe al menos 3 letras…"; lista vacía |
| `buscando` | búsqueda pendiente (pausa o petición en curso) | icono giratorio + "Buscando…"; lista anterior atenuada |
| `error` | la última petición falló o pasó de 10 s | mensaje de error + "Volver a intentar" |
| `vacio` | respuesta con 0 resultados | "No se ha encontrado ningún medicamento…" |
| `resultados` | respuesta con ≥ 1 resultado | lista seleccionable; se anuncia "N resultados" |

## Transiciones

```text
corto ──(≥3 letras)──▶ buscando ──(respuesta n>0)──▶ resultados
  ▲                       │  ▲    ──(respuesta n=0)──▶ vacio
  │                       │  │    ──(fallo/10 s)─────▶ error ──(Volver a intentar)──▶ buscando
  └──(borra a <3 letras)──┘  └──(nueva letra desde resultados/vacio/error)
```

Una petición anulada (texto cambiado, pantalla cerrada) no produce ningún estado visible (FR-009).
