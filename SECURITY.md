# Política de seguridad

## Cómo informar de una vulnerabilidad

No abras una *issue* pública. Usa **Security → Report a vulnerability** en este repositorio (aviso privado de
GitHub). Indica el componente afectado, cómo reproducirlo y su impacto. Respondemos en un plazo de 7 días.

## Alcance

- Código de este repositorio (`apps/`, `packages/`, `infra/`, `.github/workflows/`).
- Fuera de alcance: los servicios de terceros que integra (CIMAVet, Siweb360, Azure, proveedores de IA).

## Qué no contiene este repositorio

Es público. No contiene secretos, datos personales, recetas reales ni la topología interna de Azure: los valores
de despliegue reales están en ficheros locales ignorados por git y en la documentación interna. Si encuentras
alguno de estos datos, infórmalo por la vía anterior.
