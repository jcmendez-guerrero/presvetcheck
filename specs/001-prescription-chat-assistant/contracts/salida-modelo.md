# Contrato de salida del modelo y validación

Salida estructurada obligatoria (`response_format: { type: 'json_schema', strict: true }`). El JSON Schema se
genera desde el zod `SalidaModelo` de `packages/shared/src/schemas/asistente.ts`.

```ts
SalidaModelo = {
  tipo: 'respondida' | 'sin_informacion' | 'fuera_de_ambito' | 'aclaracion' | 'rechazo_reglas';
  texto: string;                 // 1–1.500 caracteres, español
  fuentes: string[];             // fuenteId devueltos por herramientas EN ESTE TURNO
  simulaciones: string[];        // simulacionId devueltos en este turno
  usaContextoLinea: boolean;     // la respuesta se apoya en contexto_linea → la web pinta «Resultado del motor»
}
```

## Validación en la API (`citas.ts`, determinista y probada con `it.each`)

| # | Comprobación | Si falla |
|---|---|---|
| V1 | El JSON cumple `SalidaModelo` | reintento (1) → `sin_informacion` |
| V2 | Todo `fuenteId` de `fuentes` fue devuelto por alguna herramienta del turno | reintento (1) indicando qué id no es válido → `sin_informacion` |
| V3 | `tipo='respondida'` ⇒ `fuentes.length ≥ 1` (FR-007, SC-002) | reintento (1) → `sin_informacion` |
| V4 | Todo `simulacionId` existe en el turno | reintento (1) → se descartan los no válidos |
| V5 | Si alguna herramienta de simulación devolvió un resultado, `simulaciones` lo incluye | se añade automáticamente |
| V6 | `usaContextoLinea=true` solo si se llamó a `contexto_linea` | se fuerza a `false` |
| V7 | El `texto` no contiene datos personales (pasa otra vez por `PiiScrubber`) | se sustituyen por `[dato eliminado]` |

La respuesta de **sustitución** «sin información» es un texto fijo del catálogo i18n, no del modelo: «No tengo
información en las fuentes de referencia para responder a esto. Consulta al farmacéutico garante o al veterinario
prescriptor».

## Presentación en la web

- `texto` se pinta como texto plano (sin HTML), con las **fichas de fuente** debajo: título, versión, y al
  pulsarlas → `GET /api/asistente/fuentes/:id`.
- Las simulaciones se pintan desde `SimulacionGuardada`, **nunca desde `texto`**: tarjeta «Simulación» con los
  datos supuestos, el resultado del motor y la versión de las reglas.
- Si `usaContextoLinea`, se pinta la tarjeta «Resultado del motor» desde `contexto_motor`: estado, motivos y
  equivalentes en el mismo orden que el motor (FR-015).
- Los tipos `fuera_de_ambito` y `rechazo_reglas` se pintan con estilo informativo, sin fuentes obligatorias.
