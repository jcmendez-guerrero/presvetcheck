# Contrato de Endpoints API: Sustitución Manual y Comparador Vademécum

Endpoints REST añadidos en `apps/api` para habilitar la sobreescritura de sustituciones en recetas y la comparación interactiva de medicamentos.

---

## 1. `POST /api/recetas/:id/lineas/:orden/sustituir-manual`

Permite al personal dispensador seleccionar un medicamento sustituto para una línea de receta en estado `PEDIR` o sin stock, registrando la razón/justificación y habilitando la dispensación.

### Headers
- `Authorization: Bearer <token>` o `x-dev-user: <usuario>` (en `AUTH_MODE=dev`).
- Roles permitidos: `empleado`, `veterinaria_responsable`, `admin`.

### Parámetros de Ruta
- `id`: UUID de la receta.
- `orden`: Entero (1-based) con el orden de la línea dentro de la receta.

### Request Body (`PeticionSobreescribirSustitucion`)
```json
{
  "cn": "570001",
  "nregistro": "3313 ESP",
  "motivo": "Falta de stock del prescrito Bioclanic; sustituido por equivalente Clavusan disponible en almacén previa conformidad del tutor."
}
```

### Reglas de Validación
1. El medicamento original y el sustituto no deben incurrir en un `BLOQUEANTE_DURO` (inmunológico/biológico, prescripción en cascada o no autorizado). Si incurren, devuelve `422 Unprocessable Entity` con código `SUSTITUCION_BLOQUEO_DURO`.
2. El campo `motivo` es obligatorio con un mínimo de 5 caracteres.
3. Se actualiza la línea de receta:
   - `medicamentoSustitutoCn = cn`
   - `decision = 'SUSTITUIBLE'` o '`DISPENSABLE`'
   - Se marca sustitución activa.
4. Se emite un evento inmutable en `audit_event`:
   - `tipo: "SUSTITUCION_SOBREESCRITA"`
   - `payload: { recetaId, orden, cnOriginal, cnSustituto, motivo, usuario }`
5. No requiere confirmación en pantalla del garante (`SUBSTITUTION_APPROVAL_MODE=POST`), pero registra que la receta debe permanecer en la bandeja de sustituciones para la firma posterior del garante.

### Responses
- `200 OK`: Devuelve la receta actualizada con la línea modificada.
- `400 Bad Request`: Parámetros o cuerpo no válidos.
- `404 Not Found`: Receta o línea no encontrada.
- `422 Unprocessable Entity`: La sustitución viola un `BLOQUEANTE_DURO`.

---

## 2. `POST /api/medicamentos/comparar`

Evalúa la equivalencia reglamentaria entre un medicamento prescrito (referencia) y un medicamento candidato para una especie e indicación determinadas.

### Request Body (`PeticionCompararMedicamentos`)
```json
{
  "prescritoNregistro": "3738 ESP",
  "candidatoNregistro": "3313 ESP",
  "especie": "perro",
  "indicacion": "proceso inflamatorio"
}
```

### Response (`RespuestaCompararMedicamentos`)
```json
{
  "decision": "EQUIVALENTE",
  "motivos": [],
  "evidencias": {
    "comparativa": [
      {
        "criterio": "Principio activo",
        "prescrito": "Prednisolona",
        "candidato": "Prednisolona",
        "coincide": true
      },
      {
        "criterio": "Concentración",
        "prescrito": "5 mg",
        "candidato": "5 mg",
        "coincide": true
      },
      {
        "criterio": "Forma farmacéutica",
        "prescrito": "Comprimido",
        "candidato": "Comprimido",
        "coincide": true
      },
      {
        "criterio": "Vía de administración",
        "prescrito": "Vía oral",
        "candidato": "Vía oral",
        "coincide": true
      },
      {
        "criterio": "Especie de destino",
        "prescrito": "Perros",
        "candidato": "Perros",
        "coincide": true
      },
      {
        "criterio": "Indicación",
        "prescrito": "proceso inflamatorio",
        "candidato": "Tratamiento sintomático de procesos inflamatorios",
        "coincide": true
      },
      {
        "criterio": "Tiempos de espera",
        "prescrito": "No procede (no animales de abasto)",
        "candidato": "No procede (no animales de abasto)",
        "coincide": true
      }
    ],
    "indicacion": "COINCIDE"
  },
  "reglaVersion": "2026.1",
  "esBloqueanteDuro": false
}
```
