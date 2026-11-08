# Quickstart: Validación de la sincronización de contactos con SiWeb

**Feature**: `006-siweb-vet-clinic-sync` | **Date**: 2026-11-06

---

## 1. Comandos de verificación automática

```bash
# 1. Tests unitarios de parseo y serialización de notas en @mmx/shared
pnpm --filter @mmx/shared test test/contactos-siweb.test.ts

# 2. Tests de integración del cliente SiWeb con MSW
pnpm --filter @mmx/siweb test test/contactos.test.ts

# 3. Tests de rutas de la API
pnpm --filter @mmx/api test test/rutas/contactos-siweb.test.ts

# 4. Verificación global de tipos, lint y suite completa
pnpm lint && pnpm typecheck && pnpm test
```

---

## 2. Escenarios de prueba manual

### Escenario 1: Autocompletado de veterinario existente desde SiWeb

1. Iniciar la aplicación en modo desarrollo (`pnpm dev`).
2. Acceder a **Nueva receta** e introducir una receta o cargar un borrador.
3. En la tarjeta **Veterinario**, empezar a escribir en el campo de texto (o número de colegiado) de un contacto existente en SiWeb (ej. «Carmen» o «28/5432»).
4. Comprobar que aparece la sugerencia emergente con el nombre del profesional, número de colegiado y localidad.
5. Pulsar sobre la sugerencia o el botón de autocompletado:
   - Comprobar que se rellenan automáticamente los campos: Nombre, Nº de colegiado, Colegio oficial, Teléfono, Correo, Clínica y Dirección profesional.
   - Comprobar que no se requiere teclear ningún dato a mano.

### Escenario 2: Creación de veterinario en SiWeb tras el registro de receta

1. En una nueva receta, introducir los datos de un veterinario y clínica que no existan en SiWeb.
2. Observar el indicador contextual: _"No registrado en SiWeb"_.
3. Pulsar el botón **[+ Dar de alta en SiWeb]**:
   - Se abre el diálogo con los datos precargados a partir del formulario de la receta.
   - Confirmar el alta.
4. Verificar que el contacto se crea en SiWeb (o en el mock de SiWeb en entorno local) y que su campo de notas incluye el bloque delimitado `---PRESVET---` con el JSON de colegiado y colegio.
5. Volver a abrir una nueva receta y buscar al veterinario recién creado: comprobar que ahora aparece en las sugerencias y se autocompleta con normalidad.

### Escenario 3: Tolerancia a caídas del ERP

1. Simular la desconexión de SiWeb o configurar una URL no alcanzable temporalmente en `SIWEB_BASE_URL`.
2. Registrar una receta introduciendo los datos manualmente.
3. Comprobar que la aplicación muestra un aviso sutil indicando que el ERP no está disponible, pero permite confirmar, evaluar y dispensar la receta con total normalidad sin errores bloqueantes.
