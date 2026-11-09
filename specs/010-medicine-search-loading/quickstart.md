# Quickstart: comprobar los buscadores de medicamentos

**Feature**: [spec.md](./spec.md) · Contrato: [contracts/buscador-medicamentos.md](./contracts/buscador-medicamentos.md)

## Requisitos

- `pnpm i` hecho; Node 22.
- Nada externo: las pruebas interceptan `/api/medicamentos/buscar` y nunca llaman a CIMAVet.

## Pruebas automáticas

```bash
pnpm --filter @mmx/web test -- busqueda
```

Esperado: la tabla `it.each` de `estadoBusqueda` en verde (los cinco estados y su orden de prioridad).

```bash
pnpm --filter @mmx/web test:e2e -- busqueda-medicamentos
```

Esperado, en `/vademecum` (y la misma batería en los otros buscadores):

| Escenario | Cómo lo provoca la prueba | Resultado esperado |
|-----------|---------------------------|--------------------|
| Indicador (historia 1) | `page.route` retrasa la respuesta 1 s | `estado-busqueda` contiene "Buscando" durante la espera y desaparece al llegar |
| Respuesta desfasada (historia 2) | la respuesta de "amoxi" tarda más que la de "amoxicilina" | la lista final es la de "amoxicilina" |
| Lista no seleccionable (FR-007) | escribir con una lista ya visible | `lista-resultados` tiene `inert` y `aria-busy="true"` hasta la respuesta |
| Pocas peticiones (SC-003) | teclear 10 letras seguidas | ≤ 2 peticiones a `/api/medicamentos/buscar` |
| Sin resultados | la ruta devuelve `[]` | "No se ha encontrado ningún medicamento" |
| Error y reintento | la ruta devuelve 503 y luego 200 | mensaje de error; `reintentar-busqueda` vuelve a buscar y muestra la lista |

## Comprobación manual

1. `pnpm dev` y abrir `/vademecum`.
2. En DevTools → Network, poner "Slow 3G".
3. Escribir "amoxicilina" en "Medicamento A": se ve el icono y "Buscando «amoxicilina»…"; en Network aparece
   una sola petición.
4. Con resultados en pantalla, añadir una letra: la lista se atenúa y no responde a clics hasta la respuesta.
5. Repetir en revisión de una receta, en "Buscar sustituto" del resultado y en una nueva línea de recepción.

## Cierre

```bash
pnpm lint && pnpm typecheck && pnpm test
```
