# Lectura de códigos de los envases

Los envases llevan normalmente un **DataMatrix GS1** (el requisito hablaba de "QR": la app lee códigos 2D en
general). La app interpreta los identificadores de aplicación (01) GTIN, (17) caducidad (día `00` = último día
del mes), (10) lote, (21) nº de serie y, si aparecen, (240), (710)–(715) — el (712) es el número nacional de
España — con o sin el prefijo de simbología `]d2`, `]C1`, `]Q3`. Si solo hay un EAN-13 lineal, lote y caducidad
se piden a mano. El código nacional sale del GTIN español (`847000` + 6 dígitos, heurística validada contra
CIMAVet) o de la tabla aprendida GTIN → código nacional que se rellena al confirmar cada dispensación.

## Mientras no haya lector físico (D-13)
La cámara trasera de la tableta o el móvil (zxing-wasm) es la vía principal: recuadro guía, enfoque continuo,
linterna y lectura de DataMatrix, QR, EAN-13 y Code 128. A los 8 s sin lectura se ofrece la entrada manual.

## Requisitos de compra del lector
- **Imager 2D** (no láser): lee DataMatrix GS1 y QR en papel, cartón brillante y **pantalla**.
- Conexión **USB-HID** o **Bluetooth-HID** (modo teclado) compatible con la tableta (Android/iPadOS/Windows).
- Admite **distribución de teclado española**.
- Permite **programar la sustitución del carácter GS (ASCII 29)** por un carácter imprimible y el **prefijo de
  simbología** (AIM ID: `]d2`, `]C1`, `]Q3`).
- Envía **Intro** como sufijo.
- Opcional: peana de manos libres (modo presentación).

## Configuración
1. Programa el lector (con los códigos de configuración del fabricante) para:
   - sustituir GS (ASCII 29) por `~` (o `|`);
   - enviar el prefijo AIM y el sufijo Intro;
   - teclado en español.
2. Pon el mismo carácter en la variable `SCANNER_GS_SUBSTITUTE` (p. ej. `SCANNER_GS_SUBSTITUTE=~`) y
   reinicia la app. Los lectores HID normalmente **no** transmiten el ASCII 29; sin el sustituto, un lote que no
   va al final del código "se comería" los datos siguientes y la app avisará de que falta el separador.
3. Verifícalo en **Administración → Probar lector**: escanea un DataMatrix GS1 con el foco en el campo. Se
   muestran los bytes recibidos (`<GS>`, `<CR>`…) y el resultado del parseo (GTIN, código nacional, lote,
   caducidad, nº de serie).

## Cómo distingue la app el lector del teclado
Basta con poner el foco en el campo de escaneo: una ráfaga de teclas con menos de 50 ms entre caracteres
terminada en Intro se trata como lectura del lector (`metodo_captura = scanner`); si se escribe a mano se
registra `manual`, y la cámara registra `camara`.
