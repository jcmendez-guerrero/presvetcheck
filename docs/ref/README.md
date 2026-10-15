# Documentación de referencia

| Fichero | Origen |
|---|---|
| `CIMAVet_REST_API.md` / `.pdf` | Especificación v1.4 de la API REST de CIMAVet |
| `cimavet-respuestas.md` | Forma observada de las respuestas reales de CIMAVet |
| `siweb360-openapi.json` | OpenAPI de la API pública de Siweb360 (aportada por JC) |
| `Siweb360 _ El mejor software de gestión para empresas.pdf` | Página de desarrolladores de Siweb360 |
| `guia-receta-veterinaria.md` | Guía práctica de medicamentos veterinarios en la oficina de farmacia (Anexo A) |

## Datos de la AEMPS que no se versionan
Igual que los XML del Nomenclátor (`pnpm nomenclator:fetch`), estos ficheros se descargan cuando hacen falta:

- **Árbol de medicamentos veterinarios** (`*_Arbol_Medicamentos_VET.xlsx`, ~40 MB): enlazado desde
  <https://cimavet.aemps.es/cimavet/publico/nomenclator.html>. La app no lo usa.
  ```bash
  curl -A "Mozilla/5.0" -o /tmp/arbol.zip https://listadomedicamentos.aemps.gob.es/Arbol_Medicamentos_VET.zip
  ```
