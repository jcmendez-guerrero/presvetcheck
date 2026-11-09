# Contracts & Design System API: Modernización de la Interfaz de Usuario

**Feature Branch**: `007-modernizacion-frontend-ui` | **Date**: 2026-11-08  
**Spec Reference**: [spec.md](../spec.md)

---

## 1. Contrato de Tokens de Estilos (Tailwind CSS v4 `@theme`)

El archivo `apps/web/src/estilos.css` expone el siguiente contrato normativo para toda la aplicación web:

```css
@theme {
  /* 1. Colores Oficiales de Marca (Manual de Identidad Visual Mundo Mascotix) */
  --color-marca: #016581;         /* Azul petróleo: Primario, titulares H1/H2, botones principales */
  --color-marca-apoyo: #2f8198;   /* Azul medio: Apoyo, subtítulos H3, iconos, enlaces */
  --color-acento: #60abb8;        /* Turquesa: Acento, huella del isotipo, detalles, bordes activos */
  --color-texto: #002028;         /* Azul noche: Texto de lectura principal, contraste 16.5:1 */
  --color-fondo: #f2f8f9;         /* Blanco hielo: Fondo general del lienzo y contenedores de apoyo */

  /* 2. Colores Semánticos Regulatorios (SPEC §2.1) */
  --color-dispensar: #047857;
  --color-dispensar-bg: #d1fae5;
  --color-sustituir: #b45309;
  --color-sustituir-bg: #fef3c7;
  --color-noconforme: #b91c1c;
  --color-noconforme-bg: #fee2e2;
  --color-pedir: #016581;
  --color-pedir-bg: #e0f2f7;
  --color-psicotropo: #6b21a8;
  --color-psicotropo-bg: #f3e8ff;
  --color-dorado: #e3a857;
  --color-dorado-bg: #fef9c3;

  /* 3. Tipografía Oficial */
  --font-titulo: 'Bricolage Grotesque Variable', 'Inter Variable', system-ui, sans-serif;
  --font-sans: 'Inter Variable', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
}

/* Modo Oscuro (activado mediante clase .dark en <html>) */
.dark {
  --color-fondo: #002028;         /* Fondo base en Azul noche */
  --color-texto: #f2f8f9;         /* Texto principal en Blanco hielo */
  --color-superficie: #002c36;    /* Tarjetas y paneles elevados */
  --color-borde: rgba(96, 171, 184, 0.25); /* Bordes suaves en Turquesa */
  --color-marca: #2f8198;         /* Azul medio para contraste sobre fondo oscuro */
  --color-acento: #60abb8;        /* Turquesa para destacados y focos */
}
```

---

## 2. Contratos de Accesibilidad (WAI-ARIA & WCAG 2.2)

### 2.1 Anuncio de Estados de Copia al Portapapeles
```html
<!-- Contenedor invisible para tecnología asistencial -->
<div 
  role="status" 
  aria-live="polite" 
  aria-atomic="true" 
  class="sr-only"
>
  Lote L-89421A copiado al portapapeles para el TPV
</div>
```

### 2.2 Resumen Superior de Errores de Validación (Focusable Error Summary)
```html
<div
  id="resumen-errores"
  role="alert"
  tabindex="-1"
  aria-labelledby="titulo-resumen-errores"
  class="rounded-xl border-2 border-noconforme bg-noconforme-bg p-4 focus:outline-none focus:ring-2 focus:ring-dorado"
>
  <h2 id="titulo-resumen-errores" class="text-base font-bold text-noconforme flex items-center gap-2">
    <XCircle class="h-5 w-5" /> Existen datos pendientes o incorrectos en la receta:
  </h2>
  <ul class="mt-2 list-disc pl-5 text-sm text-texto space-y-1">
    <li><a href="#campo-colegiado" class="underline font-semibold hover:text-marca">Falta el número de colegiado del veterinario</a></li>
    <li><a href="#campo-posologia" class="underline font-semibold hover:text-marca">La posología no especifica duración de tratamiento</a></li>
  </ul>
</div>
```

### 2.3 Atrapamiento de Foco en Modales (WAI-ARIA Dialog)
Todos los componentes modales (`ModalForzado`, `TicketMultiRxModal`) deben implementar los atributos:
```html
<div 
  role="dialog" 
  aria-modal="true" 
  aria-labelledby="titulo-dialogo"
  class="fixed inset-0 z-50 flex items-center justify-center ..."
>
  ...
</div>
```
- Evento de teclado `KeyDown`: Captura tecla `Escape` y llama a `onCancelar()`.
- Captura de `Tab`: Cicla entre el primer y último elemento interactivo del diálogo.
- Desmontaje: Restaura el foco en el elemento que invocó la apertura (`triggerElement.focus()`).

---

## 3. Contratos de Interfaz de Mostrador (Hardware & Escaneo)

1. **Campo de Escaneo de Códigos de Barras / DataMatrix**:
   - `input[data-testid="campo-escaneo"]`:
     - Dispone de autofocus por defecto.
     - Detección de ráfaga HID (< 50 ms entre pulsaciones con terminación Intro) clasificada como `metodoCaptura = 'scanner'`.
     - Introducción manual o teclado clasificada como `metodoCaptura = 'manual'`.
2. **Botones de Acción en Mostrador**:
   - Altura mínima computada: $\ge 44\text{px}$.
   - Separación mínima entre botones contiguos: $\ge 8\text{px}$.
