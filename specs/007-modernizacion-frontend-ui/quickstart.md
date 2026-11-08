# Quickstart & Verification Guide: Modernización de la Interfaz de Usuario (UI/UX)

**Feature Branch**: `007-modernizacion-frontend-ui` | **Date**: 2026-11-08  
**Spec Reference**: [spec.md](./spec.md)

---

## 1. Puesta en Marcha en Desarrollo

Para levantar la aplicación web con soporte de recarga rápida (HMR):

```bash
# 1. Instalar dependencias (si no se ha hecho previamente)
pnpm i

# 2. Levantar el entorno de desarrollo web
pnpm --filter @mmx/web dev
```

La aplicación estará accesible en `http://localhost:5173`.

---

## 2. Verificación de Tokens de Marca y Tipografía

1. Abrir la página principal en `http://localhost:5173`.
2. Inspeccionar la cabecera:
   - Verificar que el logotipo horizontal dispone de un margen libre equivalente o superior a la altura de la «M» del logotipo.
   - Verificar que el fondo del lienzo principal corresponde a Blanco hielo (`#F2F8F9`).
   - Comprobar que los títulos principales H1 se renderizan con la tipografía **Bricolage Grotesque Variable Bold** en **Azul petróleo (`#016581`)**.
   - Comprobar que los textos de cuerpo y formularios se renderizan con **Inter Variable** en **Azul noche (`#002028`)**.

---

## 3. Escenarios de Prueba de Mostrador y Flujos Críticos

### Escenario 1: Panel HUD de Dispensación y Copia de Lote para TPV
1. Iniciar sesión como `emp-1` (Empleado).
2. Acceder a una receta pendiente o navegar a `/recetas/demo-compania-papel/dispensar/1`.
3. Comprobar que el lote recomendado por FEFO se muestra en un bloque HUD monoespaciado de gran tamaño con semáforo de caducidad.
4. Hacer clic en el botón `Copiar lote`:
   - El botón debe mutar inmediatamente a fondo verde suave, icono de check y texto «¡Lote copiado!».
   - Pegar en un bloc de notas o terminal para confirmar que el portapapeles contiene el número exacto de lote.

### Escenario 2: Visor de Recetas 2.0 y Revisión OCR
1. Navegar a `/recetas/nueva` y seleccionar la muestra `demo-compania-papel` (`EXTRACTOR=fake`).
2. En la pantalla `/recetas/:id/revision`:
   - Probar los controles de zoom (+, -, 100%, ajustar al ancho).
   - Probar el botón de rotación de 90°.
   - Verificar que los campos con advertencia o dudosos muestran el borde y badge en Dorado `#E3A857`.

### Escenario 3: Responsividad y Menú Móvil
1. Reducir la ventana del navegador a un ancho de 375px (iPhone) o 768px (iPad).
2. Comprobar que la cabecera oculta la barra de navegación horizontal y muestra el **isotipo de la huella** junto al botón de menú táctil.
3. Verificar que los objetivos táctiles respetan la restricción de $\ge 44\text{px}$ y separación $\ge 8\text{px}$.

---

## 4. Ejecución de Pruebas Automatizadas

```bash
# 1. Typecheck estricto
pnpm typecheck

# 2. Pruebas unitarias y de componentes web (Vitest)
pnpm --filter @mmx/web test

# 3. Pruebas E2E de humo en Playwright
pnpm --filter @mmx/web test:e2e
```
