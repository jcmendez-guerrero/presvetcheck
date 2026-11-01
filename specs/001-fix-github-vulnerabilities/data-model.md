# Data Model: Corrección de las vulnerabilidades detectadas en GitHub

Este trabajo no crea tablas ni cambia el esquema de PostgreSQL (FR-004). Las «entidades» son registros de gestión que viven en GitHub y en la documentación del repositorio.

## Alerta de seguridad

Vive en GitHub (Dependabot o CodeQL). No se almacena en el repositorio; se referencia por su identificador.

| Campo | Tipo | Regla |
|-------|------|-------|
| `numero` | entero | Identificador de la alerta en GitHub (p. ej. Dependabot #85, CodeQL #7). |
| `origen` | `dependabot` \| `codeql` | — |
| `ghsa` / `regla` | texto | GHSA para dependencias (`GHSA-gcqx-w48m-w2h4`); id de regla para código (`js/polynomial-redos`). |
| `gravedad` | `critica` \| `alta` \| `media` \| `baja` | Determina si bloquea en CI (ver [contracts/ci-seguridad.md](./contracts/ci-seguridad.md)). |
| `ambito` | `ejecucion` \| `desarrollo` | Según el manifiesto o la cadena de dependencias. |
| `estado` | `abierta` → `corregida` \| `descartada` | `corregida` la pone GitHub al detectar la versión segura; `descartada` exige un motivo y una fila en la tabla de excepciones. |

**Transiciones**: `abierta → corregida` (automática al fusionar PR 1 o PR 2) · `abierta → descartada` (manual, solo con fila en la ADR 0016) · `descartada → abierta` (si GitHub la reabre o se retira la excepción).

## Dependencia

Vive en `package.json` / `pnpm-lock.yaml`.

| Campo | Tipo | Regla |
|-------|------|-------|
| `nombre` | texto | — |
| `version_actual` / `version_segura` | semver | `version_actual ≥ version_segura` al cerrar PR 1 (FR-001, FR-010). |
| `tipo` | `directa` \| `transitiva` | — |
| `paquetes` | lista | Paquetes del monorepo que la usan. |
| `mecanismo` | `directa` \| `lockfile` \| `padre` \| `override` \| `descarte` | Ver orden de preferencia en [research.md](./research.md). |

## Excepción documentada

Fila de la tabla de excepciones de `docs/adr/0016-dependencias-vulnerables-y-excepciones.md`. Formato exacto en [contracts/adr-excepciones.md](./contracts/adr-excepciones.md).

| Campo | Tipo | Regla |
|-------|------|-------|
| `id` | `EXC-NN` | Único, correlativo, no se reutiliza. |
| `tipo` | `descarte` \| `forzado` | `descarte` = alerta cerrada sin corregir (FR-012); `forzado` = `pnpm.overrides` (FR-013). |
| `paquete` y `rango` | texto | Para `forzado`, la clave exacta del override. |
| `ghsa` | lista | Obligatorio en `descarte`; alimenta `allow-ghsas` de CI. |
| `motivo` | texto (español) | Para `descarte`, debe explicar por qué el código vulnerable no se alcanza con datos externos. |
| `fecha`, `responsable` | fecha, texto | — |
| `revisar_cuando` | texto | Condición verificable para retirar la excepción (p. ej. «exceljs publica una versión con archiver ≥ 7»). |
| `estado` | `vigente` \| `retirada` | Una excepción retirada se mantiene en la tabla con la fecha de retirada (trazabilidad). |

**Relaciones**: una excepción `descarte` cubre 1..n alertas (mismo GHSA en varios manifiestos); una dependencia puede tener 0..n excepciones `forzado` (una por rango).
