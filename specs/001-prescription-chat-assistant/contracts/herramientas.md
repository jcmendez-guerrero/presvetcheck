# Contrato de herramientas (modelo ↔ API)

Herramientas que el modelo puede llamar (*tool calling*). Las ejecuta `ChatOrchestrator` en la API y **todas son
de solo lectura**: ninguna crea, modifica ni autoriza nada (FR-010). Los argumentos se validan con zod en
`packages/shared/src/schemas/asistente.ts`; a partir de esos mismos schemas se genera el JSON Schema que se envía
al modelo. Si los argumentos no son válidos, la herramienta devuelve `{ error: 'ARGUMENTOS_NO_VALIDOS', detalle }`
y el modelo puede corregirlos.

Cada resultado incluye `fuenteId` y `version`. Son los **únicos** identificadores que el modelo puede citar
(ver [salida-modelo.md](./salida-modelo.md)).

Límites por turno:

- como mucho 4 rondas de herramientas y 8 llamadas en total;
- como mucho 6.000 caracteres de resultado por llamada (se recorta por secciones).

## Fuentes de referencia

### `consultar_reglas`

```ts
args { tema: 'campos_receta' | 'validez' | 'sustitucion_exclusiones' | 'equivalencia' | 'formato' }
→ { fuenteId: `regla:${tema}`; version: string /* fichero@hash8 */; titulo: string;
    contenido: unknown /* fragmento del YAML activo ya validado por zod */ }
```

Lee el `RulesBundle` cargado (`deps.rules`). `formato` devuelve la configuración `ALLOW_PACK_SIZE_CHANGE` y los
parámetros del cambio de formato. Ni las reglas ni sus valores se copian nunca a las instrucciones.

### `buscar_guia` / `buscar_ayuda`

```ts
args { consulta: string /* 3–200 caracteres */; max?: number /* 1–5, por defecto 3 */ }
→ { resultados: { fuenteId: `guia:${ancla}` | `ayuda:${id}`; version: string; titulo: string;
                  texto: string; puntuacion: number }[] }
```

Búsqueda léxica en memoria sobre las secciones de `docs/ref/guia-receta-veterinaria.md` y de
`packages/shared/src/ayuda`. Una lista vacía significa que no hay fuente, y el modelo debe responder
`sin_informacion`.

## CIMAVet (caché local)

### `buscar_medicamento`

```ts
args { nombre: string; especie?: string }
→ { candidatos: { nregistro: string; nombre: string; presentaciones: { cn: string; nombre: string }[];
                  puntuacion: number }[] /* ≤ 10 */;
    fuenteId: 'cimavet:busqueda'; version: string /* última sincronización correcta (ISO) */ }
```

Usa `CimavetRepository.buscar`. Si hay más de un candidato, el modelo debe responder `aclaracion` con la lista;
nunca elige (FR-017).

### `ficha_medicamento`

```ts
args { nregistro: string }
→ { fuenteId: `cimavet:${nregistro}`; version: string /* fetchedAt */;
    desactualizado: boolean /* fetchedAt > CIMAVET_LIVE_CHECK_MAX_AGE_H */;
    nombre; laboratorio; estado; comercializado; sujetoPrescripcion; antimicrobiano; psicotropo;
    estupefaciente; inmunologico; problemaSuministro;
    excluidoSustitucion: { excluido: boolean; motivo?: string; fuenteId?: 'regla:sustitucion_exclusiones' };
    principiosActivos: { nombre; cantidad; unidad }[]; formas; vias; especies;
    presentaciones: { cn; nombre; comercializada }[] }
```

`desactualizado=true` obliga a que la respuesta lo advierta (caso límite «Datos de CIMAVet desactualizados»). Si
el medicamento no existe, devuelve `{ encontrado: false }`, y el modelo recuerda que los medicamentos de uso
humano se revisan con el garante (US3-AS3); ese texto sale de la Ayuda o de la guía, no de las instrucciones.

## Línea de receta

### `contexto_linea`

Solo está disponible si la conversación es de tipo `linea`; lleva implícito el `recetaLineaId` de la
conversación.

```ts
args {}
→ { fuenteId: `motor:linea/${id}`; version: string /* reglaVersion de la evaluación */;
    resultado: { decision; motivos: { code; severidad; mensaje }[]; forzable: boolean;
                 equivalentes: { nregistro; cn; nombre; laboratorio; stock: boolean }[];
                 alternativaFormato?: { tipo; envases; notaAdministracion? };
                 validez?: { efectiva; caso; maximoLegal } };
    receta: { especie; numeroAnimales; fechaEmision; tipoReceta; clasePrescripcion;
              tipoTratamiento; indicacion; posologia; forma; concentracion; cantidad };
    medicamento: { nregistro; nombre; cn? } }
```

- El DTO es `.strict()`. **No contiene** datos del titular (nombre, teléfono, DNI, dirección) ni del veterinario
  (nombre, nº de colegiado, teléfono, correo), ni la imagen (FR-014, FR-018, FR-021a). Un test comprueba que el
  JSON resultante no incluye ninguna de esas claves ni sus valores de *seed*.
- El resultado es el de la **última evaluación guardada**; no se reevalúa. Se guarda como `contexto_motor` en el
  intercambio.

## Simulaciones (FR-009a)

Todas llaman a funciones puras de `packages/domain/src/simulacion.ts` con el `RulesBundle` vigente y `Clock`.
Devuelven:

```ts
→ { fuenteId: `motor:simulacion/${n}`; version: reglaVersion; simulacionId: string;
    decision: DecisionSimulacion; motivos: { code; mensaje }[]; evidencias: unknown;
    supuestos: Record<string, unknown>; faltan?: string[] /* si decision = FALTAN_DATOS */ }
```

| Herramienta | Argumentos | Motor |
|---|---|---|
| `simular_validez` | `fechaEmision`, `tipoTratamiento?`, `especieProduccion`, `lineas: { antimicrobiano?, psicotropo?, estupefaciente?, nregistro? }[]`, `plazoDeclarado?`, `fechaConsulta?` | `casoLinea` + `calcularValidez` + `recetaCaducada` |
| `simular_cambio_formato` | `prescrito: { nregistro, cn, envases }`, `candidato: { nregistro, cn }`, `especie` | `evaluarAlternativaFormato` + `validarEnvasesFormato` + `notaAdministracion` |
| `simular_sustituibilidad` | `nregistro`, `clasePrescripcion?` | `sustitucionPermitida` con las exclusiones |
| `simular_equivalencia` | `prescrito: { nregistro }`, `candidato: { nregistro }`, `especie`, `indicacion?`, `especieProduccion` | `evaluarEquivalencia` |

- Si en `simular_validez` falta `nregistro`, los flags se toman tal cual de la pregunta y aparecen en `supuestos`.
  Si se da `nregistro`, se leen de la caché y **prevalecen** sobre lo que diga la pregunta.
- Si falta un dato obligatorio, se devuelve `decision: 'FALTAN_DATOS'` y `faltan: [...]`, y el modelo responde
  `aclaracion`.
- Los medicamentos se resuelven siempre desde la caché por `nregistro` y `cn`; si no se encuentran → `FALTAN_DATOS`
  con `faltan: ['nregistro']`.
