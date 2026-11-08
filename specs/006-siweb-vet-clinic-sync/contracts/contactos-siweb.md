# Contrato de API: Búsqueda y sincronización de contactos con SiWeb

**Feature**: `006-siweb-vet-clinic-sync` | **Date**: 2026-11-06

---

## 1. Endpoints de la API (`apps/api`)

### `GET /api/contactos-siweb`

Busca contactos en SiWeb (clientes o proveedores) por término de texto (nombre, colegiado, CIF, clínica) y devuelve los resultados enriquecidos con los metadatos de veterinario extraídos del campo de notas.

#### Parámetros de consulta (Query)

| Parámetro | Tipo     | Requerido | Descripción                                                                 |
| :-------- | :------- | :-------: | :-------------------------------------------------------------------------- |
| `search`  | `string` |    No     | Término de búsqueda (mínimo 2 caracteres recomendado).                      |
| `tipo`    | `string` |    No     | Filtro de relación: `cliente`, `proveedor` o `todos` (por defecto `todos`). |
| `limit`   | `number` |    No     | Número máximo de resultados (por defecto 20, máx 100).                      |

#### Respuesta 200 OK

```json
{
  "success": true,
  "contactos": [
    {
      "id": 1052,
      "nombre": "Dra. Carmen Soto Gómez",
      "cif": "50123456Z",
      "email": "carmen.soto@vetmadrid.example.com",
      "telefono": "+34 912 345 678",
      "tipoRelacion": "Cliente",
      "direccion": "Calle Alcalá 45",
      "ciudad": "Madrid",
      "provincia": "Madrid",
      "codigoPostal": "28014",
      "metadatos": {
        "version": 1,
        "tipo": "veterinario",
        "numColegiado": "28/5432",
        "colegio": "Madrid",
        "clinica": "Clínica Veterinaria Central",
        "cifClinica": "B87654321"
      }
    }
  ]
}
```

---

### `GET /api/contactos-siweb/:id`

Recupera el detalle completo de un contacto de SiWeb por su ID numérico, decodificando sus notas estructuradas.

#### Parámetros de ruta

| Parámetro | Tipo              | Descripción                                |
| :-------- | :---------------- | :----------------------------------------- |
| `id`      | `number` (entero) | Identificador único del contacto en SiWeb. |

#### Respuesta 200 OK

```json
{
  "success": true,
  "contacto": {
    "id": 1052,
    "nombre": "Dra. Carmen Soto Gómez",
    "cif": "50123456Z",
    "email": "carmen.soto@vetmadrid.example.com",
    "telefono": "+34 912 345 678",
    "tipoRelacion": "Cliente",
    "direccion": "Calle Alcalá 45",
    "ciudad": "Madrid",
    "provincia": "Madrid",
    "codigoPostal": "28014",
    "metadatos": {
      "version": 1,
      "tipo": "veterinario",
      "numColegiado": "28/5432",
      "colegio": "Madrid",
      "clinica": "Clínica Veterinaria Central",
      "cifClinica": "B87654321"
    }
  }
}
```

---

### `POST /api/contactos-siweb`

Crea un nuevo contacto en SiWeb con sus metadatos profesionales veterinarios empaquetados en el campo `notas`.

#### Cuerpo de la petición (JSON)

```json
{
  "nombre": "Dr. Fernando Ruiz Beltrán",
  "cif": "48123456Y",
  "email": "fruiz@clinicavetguadarrama.example.es",
  "telefono": "+34 918 500 111",
  "direccion": "Avenida de la Sierra 12",
  "ciudad": "Guadarrama",
  "provincia": "Madrid",
  "codigoPostal": "28440",
  "tipo": "cliente",
  "notasLibres": "Alta efectuada desde verificación de recetas",
  "metadatos": {
    "version": 1,
    "tipo": "veterinario",
    "numColegiado": "28/9988",
    "colegio": "Madrid",
    "clinica": "Hospital Veterinario Sierra",
    "cifClinica": "B12345678"
  }
}
```

#### Respuesta 201 Created

```json
{
  "success": true,
  "contacto": {
    "id": 1089,
    "nombre": "Dr. Fernando Ruiz Beltrán",
    "cif": "48123456Y",
    "email": "fruiz@clinicavetguadarrama.example.es",
    "telefono": "+34 918 500 111",
    "tipoRelacion": "Cliente",
    "direccion": "Avenida de la Sierra 12",
    "ciudad": "Guadarrama",
    "provincia": "Madrid",
    "codigoPostal": "28440",
    "metadatos": {
      "version": 1,
      "tipo": "veterinario",
      "numColegiado": "28/9988",
      "colegio": "Madrid",
      "clinica": "Hospital Veterinario Sierra",
      "cifClinica": "B12345678"
    }
  },
  "creadoEnSiweb": true
}
```

---

## 2. Utilidades de codificación / decodificación en `@mmx/shared`

```typescript
export const DELIMITADOR_NOTAS_PRESVET = '---PRESVET---';

export function parsearNotasSiweb(notas: string | null | undefined): {
  notasLibres: string;
  metadatos: MetadatosVeterinarioNotas | null;
};

export function formatearNotasSiweb(
  notasLibres: string | null | undefined,
  metadatos: MetadatosVeterinarioNotas,
): string;
```
