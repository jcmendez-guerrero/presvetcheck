# Contract: UI de Revisión de Recetas en Pantalla Completa y Visor OCR

**Feature**: `specs/003-conciliation-prescription-siweb/spec.md`  
**Package**: `apps/web`

---

## 1. Enrutamiento a Ancho Completo

En `apps/web/src/main.tsx`:
```ts
const r2 = createRoute({
  getParentRoute: () => raiz,
  path: '/recetas/$id/revision',
  component: Revision,
  staticData: { anchoCompleto: true },
});
```

El hook `Layout` aplicará automáticamente:
`main className="mx-auto px-4 py-6 max-w-none xl:px-6"`

---

## 2. Distribución de Pantalla en `Revision`

Estructura de dos columnas principales:
```tsx
<div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
  {/* Columna Izquierda: Documental fija/sticky con panel dividido */}
  <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
    <VisorRecetaDividido
      imagenes={q.data.imagenes}
      ocrTexto={q.data.extraccion?.ocrTexto}
    />
  </div>

  {/* Columna Derecha: Formulario de revisión y comprobación */}
  <div className="flex min-w-0 flex-col gap-5">
    <Tarjeta titulo="1 · Para dispensar">...</Tarjeta>
    <Tarjeta titulo="2 · Fármaco y presentación">...</Tarjeta>
    <Tarjeta titulo="3 · Prescriptor y paciente">...</Tarjeta>
  </div>
</div>
```

---

## 3. Componente `VisorRecetaDividido`

Presenta en un contenedor visual con altura máxima acotada:
- **Panel A (Izquierda)**:
  - Selector de páginas y controles de Zoom (+ / -).
  - Visor de imagen (o PDF) con scroll interno si el zoom es mayor al 100%.
  - Altura máxima: `max-h-[75vh]`.
- **Panel B (Derecha)**:
  - Tarjeta de "Texto reconocido por OCR".
  - Scroll vertical interno independiente.
  - Botón para copiar texto completo al portapapeles y facilidades para copiar valores individuales.
  - Altura máxima: `max-h-[75vh]`.
- **Comportamiento Responsive**:
  - En pantallas `>= 1280px` (xl): visualización lado a lado en 2 subcolumnas (`grid-cols-2`).
  - En pantallas `< 1280px` (lg/md/sm): pestañas de alternancia rápida o apilamiento compacto con altura máxima acotada para no empujar el formulario.
