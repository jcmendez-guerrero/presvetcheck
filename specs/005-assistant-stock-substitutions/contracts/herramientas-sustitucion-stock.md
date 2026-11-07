# Contrato de Herramientas: Sustitución y Consulta de Stock

Herramientas añadidas a `ToolRegistry` ejecutadas por `ChatOrchestrator` (`packages/assistant/src/tools/`). Ambas son de **solo lectura**.

---

## 1. `buscar_sustitutos`

Permite al asistente buscar automáticamente los medicamentos veterinarios autorizados equivalentes a un fármaco prescrito y verificar sus existencias en el inventario de la farmacia.

### Argumentos (`ArgsBuscarSustitutos`)

```typescript
{
  nombre?: string;        // Nombre comercial o aproximado del medicamento prescrito
  nregistro?: string;     // Número de registro de CIMAVet si se conoce
  especie: string;        // Especie animal de destino (obligatoria, ej. "perro", "gato")
  indicacion?: string;    // Indicación clínica de la receta si se conoce
}
```

### Respuesta (`ResultadoHerramienta['datos']`)

```typescript
{
  fuenteId: string;       // Identificador citable de la fuente (ej. "cimavet:sustitucion:3313ESP")
  version: string;        // Versión / timestamp de los datos de CIMAVet y reglas
  prescrito: {
    nregistro: string;
    nombre: string;
    principiosActivos: string[];
    forma: string | null;
    concentracion: string | null;
    stockDisponible: number | null;
    tieneStock: boolean;
  };
  sustitucionPermitida: boolean;
  motivosBloqueo?: string[]; // Si sustitucionPermitida es false (ej. "INMUNOLOGICO", "BIOLOGICO")
  requiereAclaracionIndicacion?: boolean; // true si no se indicó la patología de la receta y debe preguntarse al dispensador
  candidatosConStock: Array<{
    cn: string;
    nregistro: string;
    nombre: string;
    laboratorio: string | null;
    stockDisponible: number;
    tieneStock: true;
  }>;
  candidatosSinStock: Array<{
    cn: string;
    nregistro: string;
    nombre: string;
    laboratorio: string | null;
    stockDisponible: 0 | null;
    tieneStock: false;
  }>;
  obligacionesDispensador: string[]; // ["Conformidad del tutor", "Notificación al prescriptor o urgencia", "Receta apartada en bandeja física para firma del garante (modo POST)"]
  aviso?: string;
}
```

---

## 2. `consultar_stock`

Permite al asistente consultar de forma puntual el stock en vivo de uno o varios Códigos nacionales (CN).

### Argumentos (`ArgsConsultarStock`)

```typescript
{
  cns: string[]; // Códigos nacionales de 6 dígitos
}
```

### Respuesta (`ResultadoHerramienta['datos']`)

```typescript
{
  fuenteId: "siweb:stock";
  version: string; // Timestamp ISO de la lectura
  items: Array<{
    cn: string;
    stockDisponible: number;
    tieneStock: boolean;
    estado: 'OK' | 'NO_DISPONIBLE' | 'SIN_MAPEO';
  }>;
}
```
