# Research: código del envase leído con el móvil que no llega al ordenador

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Fecha**: 2026-11-17

No quedan `NEEDS CLARIFICATION` en el contexto técnico. Lo que sigue es lo que se ha comprobado leyendo el código y lo que
**no** se ha podido comprobar sin reproducir en el entorno desplegado.

## Recorrido actual de un código

1. Móvil (`apps/web/src/paginas/movil.tsx`): `EscanerCamara` lee con `zxing-wasm` (o `leerCodigoDeFoto`), cierra la cámara
   y llama a `enviar(raw)` → `POST /api/movil/m/codigos` con cabecera `x-movil-token`.
2. API (`apps/api/src/rutas/movil.ts`): valida `raw` (1–512), autentica el token y guarda un evento `codigo` en
   `sesion_movil_evento`.
3. PC (`apps/web/src/lib/movil.tsx`): consulta `GET /api/movil/sesiones/:id/eventos` cada 1,5 s. Si hay un campo de
   escaneo suscrito (`useCodigosMovil`), se lo entrega como lectura de cámara; si no, lo deja en `codigoSinDestino`
   (aviso de una línea en `movil-pc.tsx`) y **no se vuelve a entregar**.

## Hallazgos

### H1 — El móvil no conserva ni distingue los envíos fallidos (confirmado en el código)

- `enviar()` muestra el error como un texto en la tarjeta, pero la cámara ya se ha cerrado y la persona mira el PC.
- No hay «Reintentar»: el código leído se pierde y hay que volver a escanear el envase.
- Solo se confirma con una marca verde en una lista de 5 elementos; sin sonido.
- `llamar()` traduce solo el 401 como «emparejamiento caducado»; cualquier otro fallo que no sea JSON (p. ej. una respuesta
  de la plataforma) cae en el texto genérico de error interno.
- **Decisión**: máquina de estados por lectura (`enviando` → `enviada` | `por-reintentar` | `sin-emparejamiento` | `rechazada`), aviso
  destacado con vibración de error, «Reintentar» solo cuando tiene sentido, estado guardado en `sessionStorage` para
  sobrevivir a bloquear la pantalla.
- **Alternativas**: cola con reintento automático (rechazada: reenviar sin que la persona lo sepa puede entregar un
  código tarde, cuando ya cambió de envase; el reintento es explícito); toast efímero (rechazado: es lo que ya falla).

### H2 — La plataforma puede rechazar la petición del móvil antes de llegar a la API (NO confirmado)

- El móvil no inicia sesión: depende de que `/movil` y `/api/movil/m/*` queden fuera de la autenticación de la plataforma
  (en el entorno desplegado hay inicio de sesión de Entra delante de la API; ver specs 009 y 015).
- La API ya trata `/api/movil/m` como ruta pública (`plugins/auth.ts`), pero eso no demuestra que la plataforma deje
  pasar la petición. Un rechazo de plataforma (403/redirección) no es JSON y hoy se muestra como error genérico.
- La lectura (QR del emparejamiento, foto de receta) llegó a funcionar en el entorno no productivo, así que no es el
  caso más probable, pero sí el que explicaría «el móvil lee y nada llega».
- **Decisión**: la tarea de diagnóstico (T001) lo descarta o lo confirma mirando la petición real desde el móvil; con
  independencia del resultado, el móvil traduce las respuestas que no son de la API a «No se ha podido enviar al
  sistema: comprueba la conexión del móvil» (reintentable) en lugar de un error interno.
- **Alternativa**: no tocar el móvil y arreglar solo la configuración de la plataforma (rechazada como única medida: el
  fallo seguiría siendo silencioso).

### H3 — El ordenador solo entrega si hay un campo abierto y no avisa bien (confirmado en el código)

- Con la pantalla de inicio abierta el código acaba en una línea pequeña («Código recibido del móvil (…): abre una
  dispensación…») y se pierde en cuanto llega otro. Al abrir un campo después, `suscribir()` borra `codigoSinDestino`
  sin entregar nada.
- **Decisión (clarificada por la persona usuaria; cola de hasta 5 para no perder lecturas, FR-009)**: guardar el código como **pendiente 5 minutos**, avisar de forma
  visible y ofrecer **«Usar el código recibido»** en el campo; nunca aplicarlo solo (un código viejo aplicado a otra
  dispensación podría dar un medicamento equivocado).
- **Alternativas**: aplicar automáticamente al abrir el campo (rechazada: riesgo regulatorio); descartar (rechazada: es
  justo la queja).

### H4 — Texto del código y límites (comprobado, sin defecto)

- `zxing-wasm` 2.2.4 usa por defecto `textMode: "HRI"`: un DataMatrix GS1 se lee como `(01)…(17)…(10)…` y el PC ya lo
  interpreta (`parseGs1` acepta el formato legible). Es el mismo texto que ya produce la cámara del PC. No se cambia.
- JSON y `jsonb` aceptan el separador de grupo (U+001D). El límite de 512 caracteres cubre DataMatrix GS1; un QR con
  enlace GS1 largo podría superarlo: hoy el móvil mostraría un error genérico.
- **Decisión**: mantener 512; si se supera, el móvil lo explica («El código es demasiado largo para enviarlo»).

### H5 — Entrega duplicada o perdida (diseño)

- Un reintento sin identificador podría crear dos eventos (la primera petición llegó pero la respuesta se perdió).
- **Decisión**: el móvil genera un identificador (UUID) por lectura y lo envía; el servicio no vuelve a publicar un
  identificador ya publicado en la misma sesión y responde igual (204). Sin migración: el identificador va dentro de
  `datos` (jsonb) y se comprueba antes de insertar.
- **Alternativa**: restricción única en la tabla (rechazada: exige migración y la carrera es irrelevante con un móvil por
  sesión).

### H6 — Orden y segundo plano (comprobado)

- Los eventos se leen por `seq` creciente con `limit(50)`; el cursor avanza con cada evento. En segundo plano el
  navegador frena los temporizadores pero no pierde eventos: al volver se leen todos. No requiere cambios; se cubre con
  una prueba (T015: cursor sin saltos ni repeticiones entre consultas).

### H7 — Fin del emparejamiento (confirmado)

- Cuando la API responde `activa: false` o 401/403/404, el PC borra la sesión sin avisar: el diálogo «Usar el móvil»
  vuelve al estado «sin emparejar» sin explicar por qué.
- **Decisión**: guardar un motivo breve («El emparejamiento ha caducado») que el diálogo muestra hasta que se vuelva a
  emparejar.

## Qué debe hacer T001 (diagnóstico previo a los cambios)

1. Emparejar un móvil real con el entorno no productivo y leer un DataMatrix; inspeccionar la petición
   `POST /api/movil/m/codigos` (estado HTTP, cuerpo, cabeceras) con la consola remota del móvil.
2. Si la respuesta no viene de la API (redirección, 401/403 de plataforma): H2 es la causa; anotar la regla de exclusión
   que falta y abrir tarea de infraestructura (la configuración real vive en Confluence, no en este repositorio público).
3. Si la API responde 204 pero el PC no lo muestra: mirar si había campo abierto (H3) y la consulta de eventos.
4. Registrar el resultado en este documento antes de dar por cerradas las tareas de implementación.
