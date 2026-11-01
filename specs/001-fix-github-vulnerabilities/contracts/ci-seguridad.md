# Contrato: comprobación de seguridad en CI y Dependabot

## Job `dependencias` en `.github/workflows/ci.yml`

- **Disparo**: `pull_request` (la comprobación compara la rama base con la del PR).
- **Permisos**: `contents: read`, `pull-requests: write` (solo para el comentario de resumen).
- **No** llama a CIMAVet, Siweb360 ni Azure; solo a la base de avisos de GitHub.

| Caso introducido por el PR | Resultado |
|----------------------------|-----------|
| Vulnerabilidad crítica o alta en dependencia de **ejecución** | ❌ falla, bloquea la fusión |
| Vulnerabilidad crítica en dependencia de **desarrollo/compilación** | ❌ falla, bloquea la fusión |
| Vulnerabilidad alta en dependencia de desarrollo | ⚠️ aviso en el resumen, permite fusionar |
| Vulnerabilidad media o baja (cualquier ámbito) | ⚠️ aviso en el resumen, permite fusionar |
| GHSA presente en una excepción `descarte` vigente de la ADR 0016 | ✅ se ignora |
| Vulnerabilidad ya existente en la rama base | ✅ no bloquea (no la introduce el PR) |

Implementación prevista: dos pasos de `actions/dependency-review-action@v4` con `fail-on-severity`/`fail-on-scopes` distintos y el mismo `allow-ghsas` (ver [research.md](../research.md)). El job se marca como comprobación obligatoria en la protección de `main` (ajuste manual en GitHub, fuera del código).

## `.github/dependabot.yml`

| Ecosistema | Directorio | Frecuencia | Agrupación |
|------------|-----------|------------|------------|
| `npm` (pnpm por lockfile) | `/` | semanal | `produccion` (dependencias) y `desarrollo` (devDependencies); actualizaciones de seguridad agrupadas aparte |
| `github-actions` | `/` | semanal | un grupo |

Mensajes de commit con prefijo Conventional Commits: `fix(deps)` para producción, `chore(deps)` para desarrollo, `ci` para Actions.
