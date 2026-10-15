# AGENTS.md — instrucciones para el agente de código

Este repositorio implementa el sistema de verificación de recetas, dispensación y registro de entradas/salidas de Mundo Mascotix "Medicamentos Veterinarios". La especificación funcional y técnica está en `SPEC.md`; este fichero dice **cómo** trabajar en él.

## Prioridades
1. Corrección regulatoria y trazabilidad por encima de velocidad o estética.
2. El dominio (`packages/domain`) es puro y es lo más importante del repositorio. Sin I/O, sin fechas del sistema implícitas (inyecta un `Clock`), sin dependencias de infraestructura.
3. Todo lo que dependa de una decisión abierta (`SPEC.md` §13) se implementa como configuración con el valor por defecto indicado y un `TODO(decision D-xx)`.

## Lo que no debes hacer
- **No inventes** estructuras de datos externas. El esquema del Nomenclátor XML sale de `fixtures/nomenclator/`; las respuestas de CIMAVet y Siweb360 salen de `docs/ref/` y `fixtures/`. Si falta una muestra, deja el esqueleto y un `it.todo` explicando qué fichero hace falta.
- El forzado (bypass) de defectos se valida en la API, no solo en la UI: un `BLOQUEANTE_DURO` nunca se puede forzar.
- No pongas reglas legales en prompts de IA ni en componentes de UI. Viven en `packages/domain` y en `config/rules/*.yaml`.
- No escribas stock en Siweb360 salvo entradas a través del outbox y respetando `SIWEB_STOCK_WRITE_MODE` (por defecto `off`). **Nunca** escribas salidas: las descuenta el ticket del TPV.
- No hagas `UPDATE`/`DELETE` sobre `dispensacion`, `recepcion_linea` (finalizada) ni `audit_event`. Correcciones = contramovimiento.
- No registres datos personales (nombre o teléfono del propietario, DNI, dirección) en logs, errores ni telemetría.
- No llames a servicios reales (CIMAVet, Siweb360, Azure) desde los tests. Usa MSW y fixtures.
- No añadas dependencias pesadas sin justificarlo en el PR. Nada de ORMs alternativos ni frameworks de UI adicionales.

## Stack y comandos
- Node.js 22, pnpm 9, TypeScript estricto (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- `pnpm i` — instalar
- `pnpm dev` — Docker Compose (PostgreSQL 16 + Azurite) + API + web en modo desarrollo
- `pnpm db:migrate` / `pnpm db:seed`
- `pnpm test` — Vitest en todos los paquetes; `pnpm test:int` — integración con Testcontainers
- `pnpm lint` / `pnpm typecheck` / `pnpm build`
- `pnpm eval:extraction` — banco de evaluación de extracción sobre `fixtures/recetas/`
- `pnpm worker <job>` — ejecuta un job en local (`cimavet-delta`, `cimavet-full`, `outbox-dispatcher`, `sales-reconciliation`, `weekly-reports`, `nomenclator-import`, `retention-sweep`)

Antes de dar una tarea por terminada: `pnpm lint && pnpm typecheck && pnpm test` en verde.

## Convenciones
- Código e identificadores en inglés técnico cuando sean genéricos (`OutboxDispatcher`, `parseGs1`); términos del dominio regulatorio en español cuando no tienen traducción exacta (`receta`, `nregistro`, `cn`, `garante`, `dispensacion`). Mantén un glosario en `docs/glosario.md`.
- Textos de la UI en español de España, claros para personal no técnico. Sin jerga ("CN" se muestra como "Código nacional").
- Dinero con `decimal.js` (nunca `number`); fechas con `Temporal` polyfill o `date-fns-tz`, siempre en `Europe/Madrid` para reglas de negocio.
- Validación de entrada/salida con zod en `packages/shared`; los tipos se infieren de los esquemas.
- Errores de dominio tipados (`DomainError` con `code` estable, p. ej. `RECETA_CADUCADA`, `PRESCRIPCION_SOLO_PA`); la UI traduce el `code` a un mensaje.
- Cada decisión del motor devuelve `{ decision, motivos[], evidencias, reglaVersion }`, nunca un booleano suelto.
- Commits convencionales (`feat:`, `fix:`, `chore:`…). Un PR por bloque de la sección 12.1 de la spec.

## Configuración (variables de entorno)
Documenta todas en `.env.example` con descripción y valor por defecto. Mínimo:
`DATABASE_URL`, `BLOB_CONNECTION_STRING` (local) / `BLOB_ACCOUNT_URL` (Azure), `KEY_VAULT_URL`, `CIMAVET_BASE_URL`, `CIMAVET_RPS`, `CIMAVET_LIVE_CHECK_MAX_AGE_H`, `SIWEB_BASE_URL`, `SIWEB_TOKEN` (solo local), `SIWEB_STOCK_WRITE_MODE`, `SIWEB_SKU_CN_REGEX`, `SIWEB_CATALOG_WRITE`, `SIWEB_WAREHOUSE_NAME` (por defecto `Farmacia`), `SIWEB_WAREHOUSE_ID` (opcional), `EXTRACTOR` (`fake|azure`), `DOCINTEL_ENDPOINT`, `DOCINTEL_MODEL_ID`, `EXTRACTION_CONFIDENCE_THRESHOLD`, `SUBSTITUTION_APPROVAL_MODE`, `SUBSTITUTION_SIGN_MAX_DAYS`, `ALLOW_PACK_SIZE_CHANGE`, `ALLOW_PARTIAL_DISPENSATION`, `ENTRY_MIN_SHELF_LIFE_DAYS`, `SCANNER_GS_SUBSTITUTE`, `PRODUCT_VALIDITY_HARD_BLOCK`, `PSYCHOTROPIC_ALLOW_FORCE`, `AUTH_MODE` (`entra|dev`), `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `MAILER` (`smtp|acs|console`), `COLUMN_ENCRYPTION_KEY` (solo local).
En producción la app no arranca si falta una variable obligatoria (validación zod al inicio).

## Autenticación en local
`AUTH_MODE=dev` habilita un selector de usuario/rol en la UI y la cabecera `x-dev-user`. Debe ser imposible activarlo cuando `NODE_ENV=production`.

## Pruebas
- Dominio: tablas de casos (`it.each`) con los casos de `SPEC.md` §12.2 como mínimo, más los límites (fin de mes, cambio de hora, día `00` en caducidad GS1).
- Integraciones: MSW con las respuestas de `fixtures/`. Incluye casos de error: 5xx, timeout, campos con mayúsculas distintas, campos nuevos desconocidos, 409 de stock ilimitado.
- Outbox: simula timeout tras enviar → la operación debe acabar en `needs_reconciliation`, nunca reenviarse sola.
- UI: humo con Playwright del flujo receta → dispensación con `EXTRACTOR=fake`.

## Infraestructura
Bicep en `infra/`. Objetivo: Azure Container Apps (Consumo) + PostgreSQL Flexible B1ms + Blob + Key Vault + Document Intelligence (modelo personalizado; sin Azure OpenAI, DUDA-27), región `spaincentral` salvo indisponibilidad del servicio. Identidad gestionada para todo; sin claves de acceso en la configuración de la app. Ver `SPEC.md` §10.
