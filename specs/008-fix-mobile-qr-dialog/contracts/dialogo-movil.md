# Contrato de interfaz: diálogo «Usar el móvil»

Contrato visible que la prueba e2e comprueba. No cambia ninguna API ni dato.

| Elemento | Selector estable | Garantía |
|----------|------------------|----------|
| Botón de la cabecera | botón que abre el diálogo (existente, en `BotonMovil`) | Abre el diálogo. |
| Diálogo | `role="dialog"`, `aria-label="Usar el móvil"`, `aria-modal="true"` | Hijo directo de `<body>` (no dentro de `<header>`). Su velo ocupa toda la ventana. |
| Panel | primer hijo del diálogo | `top ≥ 0` y `bottom ≤ altura de la ventana`; desplazable si el contenido no cabe. |
| Código QR | `data-testid="qr-movil"` (existente) | Al desplazarlo a la vista, se ve entero dentro de la ventana. Tamaño igual al actual. |
| Botón «Cerrar» | `getByRole('button', { name: 'Cerrar' })` | Siempre alcanzable con ratón y teclado; cierra el diálogo. |
| Botón «Desconectar el móvil» | `getByRole('button', { name: 'Desconectar el móvil' })` | Igual que «Cerrar», cuando hay sesión. |
| Teclado | `Tab` / `Shift+Tab` / `Escape` | El foco no sale del diálogo; `Escape` lo cierra y el foco vuelve al botón de la cabecera. |

Sin cambios de texto visible: no hay nuevas cadenas en español que revisar.
