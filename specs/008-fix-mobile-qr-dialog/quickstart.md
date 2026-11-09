# Guía de validación: diálogo «Usar el móvil»

## Requisitos previos

- `pnpm i` hecho; Docker en marcha para `pnpm dev`.
- `AUTH_MODE=dev` en el `.env` local (selector de usuario de desarrollo).

## 1. Reproducir el defecto (antes del cambio)

1. `pnpm dev` y abrir la web en el navegador.
2. Con cualquier tamaño de ventana falla; a unos **430 px de alto** se ve peor (o ampliar la página al 200 %).
3. Pulsar el botón del móvil en la cabecera.
4. **Resultado actual**: el fondo no se oscurece y el título y la mitad superior del QR quedan fuera de la ventana.

## 2. Comprobar la corrección (después del cambio)

Repetir los pasos 1–3 con alturas de 300, 430, 600 y 1080 px:

- El fondo de toda la página se oscurece.
- El título del diálogo está dentro de la ventana; si no cabe todo, el panel se desplaza.
- El QR se ve entero al desplazarse hasta él y un móvil lo lee a la primera (SC-001).
- «Cerrar» y «Desconectar el móvil» se alcanzan con el ratón y con `Tab`; `Escape` cierra y el foco vuelve al botón.
- Con la ventana a 1080 px el diálogo se ve entero, centrado y sin barra de desplazamiento, como los demás diálogos.
- Cambiar el tamaño de la ventana con el diálogo abierto: sigue cabiendo.

Contrato comprobado: [contracts/dialogo-movil.md](./contracts/dialogo-movil.md).

## 3. Pruebas automáticas

```bash
pnpm --filter web exec playwright test e2e/dialogo-movil.spec.ts
```

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Esperado: todo en verde; la prueba e2e falla en `main` antes del cambio y pasa después.
