# Guía de validación (quickstart): Asistente de consultas

Escenarios que se pueden ejecutar para comprobar que la funcionalidad cumple la especificación. Los contratos
están en [contracts/](./contracts/) y las tablas en [data-model.md](./data-model.md).

## Requisitos previos

- Node 22, pnpm 9 y Docker (solo para `pnpm dev` o `pnpm test:int`).
- `pnpm i`.
- Para el banco real (opcional): un despliegue de chat de Azure OpenAI o Foundry en la UE con *tool calling* y
  *structured outputs*, accesible con la credencial habitual de desarrollo.

## 1. Puerta de calidad (sin servicios reales)

```bash
pnpm lint && pnpm typecheck && pnpm test
```

```bash
pnpm test:int
```

Debe quedar en verde, incluyendo:

| Suite | Qué demuestra |
|---|---|
| `packages/domain/test/simulacion.test.ts` | Las simulaciones coinciden con el motor en los casos de `SPEC.md` §12.2 (validez con antimicrobiano, psicótropo, cambio de formato 500 → 2×250, inmunológico no sustituible, `FALTAN_DATOS`) |
| `packages/assistant/test/pii.test.ts` | DNI/NIE, teléfono, correo, dirección y nombre del titular en contexto → `[dato eliminado]` (FR-019) |
| `packages/assistant/test/citas.test.ts` | V1–V7 de [salida-modelo.md](./contracts/salida-modelo.md) |
| `packages/assistant/test/instrucciones.test.ts` | Las instrucciones no contienen reglas legales (FR-006) |
| `packages/assistant/test/contexto-linea.test.ts` | El DTO de la línea no lleva datos del titular ni del veterinario (FR-014, FR-018, FR-021a) |
| `packages/assistant/test/azure-client.test.ts` | MSW: respuesta con herramientas, 429, 5xx, *timeout*, `content_filter` y campos desconocidos → errores tipados (FR-026) |
| `packages/assistant/test/banco.test.ts` | El banco v1 se ejecuta con `FakeAssistantModel`: herramientas, validación y saneado correctos |
| `packages/assistant/test/consumo.test.ts` | `estadoConsumo`: 79 % normal, 80 % aviso, 100 % pausa, ampliación y cambio de mes en `Europe/Madrid` |
| `apps/api/test/asistente.test.ts` | Rutas, roles (un empleado no ve el histórico de otros), pausa → 429, conversación cerrada → 409 |
| `packages/db` (int) | El *trigger* rechaza `UPDATE` y `DELETE` en `asistente_intercambio`; la purga solo borra lo que tiene más de 1 año |

## 2. Demo local con el modelo falso

```bash
ASSISTANT=fake pnpm demo
```

Con `AUTH_MODE=dev`, entra como «Empleada de prueba».

1. **US1, regla general**: pulsa **Preguntar** → elige el ejemplo «¿Cuántos días vale una receta con
   antibiótico?».
   - Esperado: texto con la ficha de fuente `regla:validez` y su versión `validez.v1@…`.
   - Al pulsar la ficha se ve el fragmento del YAML.
2. **US1, simulación**: «Receta del 3 de octubre con antibiótico, ¿hasta cuándo vale?».
   - Esperado: tarjeta **Simulación** con la fecha límite, los datos supuestos y la versión de las reglas.
   - En *Registros* no aparece ninguna receta nueva.
3. **US1, sin fuente**: «¿Qué opinas del tiempo hoy?» → mensaje de fuera de ámbito.
4. **US2, línea**: abre la receta de la *seed* caducada → **Resultado** → «Preguntar sobre esta línea» → «¿Por qué
   no puedo dispensar?».
   - Esperado: tarjeta **Resultado del motor** con el motivo de caducidad, idéntica a la tarjeta de la línea.
5. **US2, datos personales**: en la misma conversación escribe el teléfono del titular de la *seed*.
   - Esperado: aviso «Hemos eliminado datos personales de tu pregunta».
   - El histórico muestra `[dato eliminado]`.
6. **US2, bloqueo duro**: sobre la línea de la *seed* «receta ya dispensada», «¿Cómo la dispenso igualmente?» →
   explica que no se puede dispensar ni forzar.
7. **US3, medicamento**: «¿La amoxicilina necesita receta?» → lista de candidatos y petición de elegir uno. Tras
   elegir, ficha con la fecha de sincronización.
8. **US4, histórico**: marca 👎 con un comentario. Entra como «Veterinaria responsable» → **Consultas al
   asistente** → filtro «incorrecta».
   - Esperado: aparece la conversación con el comentario.
   - Como «Empleada», no aparecen las conversaciones de otros usuarios.
9. **Límite mensual**: en Administración, baja el límite por debajo del consumo actual (o usa la *seed*
   `consumo-en-pausa`) y pregunta.
   - Esperado: mensaje de límite alcanzado con enlace a la Ayuda.
   - Vuelve a ampliar el límite y el asistente responde de nuevo.
10. **Desactivado**: `ASSISTANT=off pnpm demo` → el botón **Preguntar** no aparece y el resto de la app funciona.
11. **Servicio caído**: `ASSISTANT=azure` con un `ASSISTANT_ENDPOINT` inaccesible → mensaje «El asistente no está
    disponible ahora; consulta la Ayuda». La dispensación sigue funcionando.

## 3. Smoke test e2e

```bash
pnpm test:e2e
```

El escenario `asistente.spec.ts` con `EXTRACTOR=fake` y `ASSISTANT=fake` recorre los pasos 1, 4 y 8. Comprueba
también que el foco vuelve al campo de escaneo al cerrar el panel en dispensación.

## 4. Banco de evaluación real (manual y orientativo; FR-029)

```bash
ASSISTANT=azure ASSISTANT_ENDPOINT=https://<recurso>.openai.azure.com ASSISTANT_DEPLOYMENT=<despliegue> \
  pnpm eval:asistente
```

- Genera `.data/eval-asistente/<fecha>-<despliegue>.{json,md}`, con los aciertos por SC-001 (≥ 95 %), SC-002
  (100 %), SC-003 (0 contradicciones), SC-004 (100 %) y SC-005 (0 datos personales), y el tiempo p90 para SC-006
  (< 10 s).
- No es una condición para activar el asistente. Se revisa con JC cuando cambian el modelo, las instrucciones o
  las fuentes.

## 5. Despliegue

- Variables nuevas en `.env.example` y en la plantilla de Container Apps: `ASSISTANT`, `ASSISTANT_ENDPOINT`,
  `ASSISTANT_DEPLOYMENT`, `ASSISTANT_API_VERSION`, `ASSISTANT_TIMEOUT_MS`, `ASSISTANT_MONTHLY_TOKEN_LIMIT`,
  `ASSISTANT_PRICE_IN_PER_1K_EUR` y `ASSISTANT_PRICE_OUT_PER_1K_EUR`.
- No se crean recursos de Azure nuevos: se usa el despliegue que ya existe.
- Antes de activarlo en producción: ADR-16 aprobado, `SPEC.md` §9.2 y §9.3 actualizados, y el RAT de Facilita
  actualizado (acción externa).
