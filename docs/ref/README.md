# Documentación de referencia

| Fichero | Origen |
| --- | --- |
| `CIMAVet_REST_API.md` / `.pdf` | Especificación v1.4 de la API REST de CIMAVet |
| `cimavet-respuestas.md` | Forma observada de las respuestas reales de CIMAVet |
| `cimavet-openapi.yaml` | OpenAPI 3.1 (no oficial) de la API REST de CIMAVet: v1.4 corregida con las respuestas reales (25/10/2026), para usarla desde otros sistemas |
| `siweb360-openapi.json` | OpenAPI de la API pública de Siweb360 (aportada por JC) |
| `guia-receta-veterinaria.md` | Guía práctica de medicamentos veterinarios en la oficina de farmacia (Anexo A) |

## Datos de la AEMPS que no se versionan
Igual que los XML del Nomenclátor (`pnpm nomenclator:fetch`), estos ficheros se descargan cuando hacen falta:

- **Árbol de medicamentos veterinarios** (`*_Arbol_Medicamentos_VET.xlsx`, ~40 MB): enlazado desde
  <https://cimavet.aemps.es/cimavet/publico/nomenclator.html>. La app no lo usa.
  ```bash
  curl -A "Mozilla/5.0" -o /tmp/arbol.zip https://listadomedicamentos.aemps.gob.es/Arbol_Medicamentos_VET.zip
  ```
