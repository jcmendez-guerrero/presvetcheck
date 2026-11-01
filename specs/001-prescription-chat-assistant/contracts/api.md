# Contrato HTTP del asistente

Rutas Fastify en `apps/api/src/rutas/asistente.ts`. Los schemas zod están en
`packages/shared/src/schemas/asistente.ts` y se publican en `openapi.json`. Todas exigen usuario identificado con
el mecanismo existente de la app, que no cambia. Los errores siguen el formato actual (`{ code, mensaje }`) y los
`code` se traducen en `errores.es.json`.

Roles:

- **E** = `empleado`
- **V** = `veterinaria_responsable`
- **A** = `admin`

## Estado

### `GET /api/asistente/estado` (E, V, A)

Lo usa la web para mostrar u ocultar el botón y para el aviso de pausa.

```ts
{ activo: boolean;                       // false si ASSISTANT=off (FR-027)
  estadoConsumo: 'normal' | 'aviso' | 'en_pausa';
  preguntasEjemplo: string[] }           // FR-004
```

## Conversaciones

### `POST /api/asistente/conversaciones` (E, V, A)

```ts
// body
{ contexto:
    | { tipo: 'general' }
    | { tipo: 'linea'; recetaLineaId: string /* uuid */ }
    | { tipo: 'medicamento'; nregistro?: string } }
// 201
{ id: string; contexto: ContextoConversacion; createdAt: string }
```

- `linea`: la línea tiene que existir y estar evaluada (si no, `404 RECETA_LINEA_NO_ENCONTRADA`). El contexto se
  construye con el DTO de lista blanca (ver `contexto_linea` en [herramientas.md](./herramientas.md)).
- Con `ASSISTANT=off` → `409 ASISTENTE_DESACTIVADO`.

### `POST /api/asistente/conversaciones/:id/mensajes` (dueño de la conversación)

```ts
// body
{ pregunta: string /* 1–2.000 caracteres */ }
// 200
{ intercambio: {
    id: string; orden: number;
    pregunta: string;                    // ya saneada
    piiEliminada: boolean;               // la web muestra el aviso FR-019
    tipo: 'respondida' | 'sin_informacion' | 'fuera_de_ambito' | 'aclaracion' | 'rechazo_reglas';
    texto: string;
    fuentes: FuenteCitada[];             // ver data-model.md
    simulaciones: SimulacionGuardada[];  // la web las pinta como tarjeta «Simulación»
    resultadoMotor: ResultadoLineaDto | null;  // si la respuesta se apoya en la línea: tarjeta «Resultado del motor»
    reglaVersion: string; createdAt: string } }
```

Errores:

| HTTP | `code` | Cuándo | Qué hace la web |
|---|---|---|---|
| 403 | `ASISTENTE_CONVERSACION_AJENA` | la conversación es de otro usuario | — |
| 409 | `ASISTENTE_CONVERSACION_CERRADA` | la conversación está cerrada | ofrece abrir una nueva |
| 429 | `ASISTENTE_LIMITE_MENSUAL` | se ha alcanzado el límite del mes; no se llama al modelo | mensaje de FR-027a con enlace a la Ayuda |
| 503 | `ASISTENTE_NO_DISPONIBLE` | *timeout*, 5xx o fallo de configuración | mensaje de FR-026 con enlace a la Ayuda |

Para trazabilidad, los errores también dejan un intercambio con `estado='error'` o `estado='limite'`.

### `POST /api/asistente/conversaciones/:id/cerrar` (dueño)

`204`. Es idempotente.

### `GET /api/asistente/conversaciones` (E: solo las suyas; V, A: todas)

```ts
// querystring
{ desde?: 'YYYY-MM-DD'; hasta?: 'YYYY-MM-DD'; usuario?: string /* solo V, A */;
  valoracion?: 'util' | 'incorrecta' | 'sin_valorar'; conReceta?: boolean;
  pagina?: number; tamano?: number /* ≤ 100 */ }
// 200
{ total: number;
  items: { id: string; usuario: { id: string; nombre: string }; contexto: ContextoConversacion;
           primeraPregunta: string; intercambios: number; incorrectas: number; createdAt: string }[] }
```

Si un `empleado` pasa `usuario` con un valor distinto del suyo → `403` (FR-025).

### `GET /api/asistente/conversaciones/:id` (dueño, V, A)

Devuelve la conversación con todos sus intercambios: fuentes con la **versión vigente al responder**,
simulaciones, valoración y `contexto_motor` (US4-AS2).

## Valoraciones

### `PUT /api/asistente/intercambios/:id/valoracion` (dueño de la conversación)

```ts
{ valor: 'util' | 'incorrecta'; comentario?: string /* ≤ 500, saneado */ }
// 200 { valor, comentario, createdAt }
```

## Fuentes citadas

### `GET /api/asistente/fuentes/:fuenteId` (E, V, A)

Abre la fuente citada desde la respuesta (FR-007).

```ts
// querystring { version?: string }
// 200
{ fuenteId: string; tipo: 'regla' | 'guia' | 'ayuda' | 'cimavet' | 'motor'; titulo: string;
  version: string; versionVigente: boolean; contenido: string /* fragmento en texto */ }
```

Si se pide una `version` que ya no está vigente, se devuelve el contenido actual con `versionVigente=false`, y la
web avisa de que la regla ha cambiado desde la respuesta. Las fuentes `cimavet:` y `motor:` nunca incluyen datos
personales.

## Administración del consumo (FR-027b)

### `GET /api/admin/asistente/consumo` (A)

```ts
// querystring { meses?: number /* por defecto 6 */ }
// 200
{ actual: ConsumoMesDto; historico: ConsumoMesDto[] }
// ConsumoMesDto
{ mes: string; tokensEntrada: number; tokensSalida: number; preguntas: number;
  limiteEfectivo: number; porcentaje: number; estado: 'normal' | 'aviso' | 'en_pausa';
  costeEstimadoEur: string /* decimal.js → cadena con 2 decimales */;
  ampliadoPor: string | null; ampliadoAt: string | null }
```

### `PUT /api/admin/asistente/consumo/limite` (A, con MFA, como el resto de acciones de administración)

```ts
{ limiteTokens: number /* > tokens usados del mes en curso */ }
// 200 ConsumoMesDto
```

Genera un `audit_event` con el valor anterior y el nuevo.
