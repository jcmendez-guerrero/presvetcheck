# Quickstart: comprobar el albarán y el QR desde el móvil

## Requisitos

- `pnpm i`, Docker en marcha.
- `.env` local con `EXTRACTOR=fake` y `AUTH_MODE=dev`. El lector de albaranes devuelve
  `fixtures/albaranes/sintetico-1.invoice.json` para cualquier documento.
- `pnpm db:migrate` (aplica la columna `albaran_documento.paginas`).

## Pruebas automáticas

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Lo que debe cubrir:

| Paquete | Prueba | Resultado esperado |
|---|---|---|
| `packages/gs1` | tabla `it.each` de enlaces GS1: con o sin lote y serie, `17` con día `00`, dominio propio, valores escapados, sin `01` → `QR_SIN_PRODUCTO`, GTIN con control erróneo, el mismo contenido como DataMatrix | mismo `Gs1Ok` que el DataMatrix equivalente, `simbologia: 'qr'` |
| `packages/extraction` | tabla `it.each` de `unirLecturas`: 1 página, cabecera repartida entre páginas, totales solo en la última, ninguna con totales | ver [data-model.md](data-model.md) |
| `apps/api` (`test/movil.test.ts`) | `POST /api/movil/m/albaranes` con 2 fotos: 201 sin datos leídos; eventos `leyendo` y `albaran`; `GET /api/recepciones/albaranes/:id` devuelve la lectura; auditoría `albaran_leer` con el id de quien emparejó | según [contracts/api-movil-albaranes.md](contracts/api-movil-albaranes.md) |
| `apps/api` | token caducado → 401; 11 ficheros → 400; sin lector → `EXTRACTOR_NO_CONFIGURADO`; mismo envío dos veces → un solo `albaran_documento` | — |
| `apps/api` | `POST /api/scan/parse` con un enlace GS1 | mismo CN, lote y caducidad que el DataMatrix |

## Prueba a mano (sin móvil real)

1. `pnpm dev` y entra como empleado.
2. Abre «Usar el móvil» y abre el enlace de emparejamiento en otra ventana con el tamaño de un móvil.
3. En la ventana del móvil, en «Albarán o factura», añade dos imágenes cualquiera y pulsa «Enviar al ordenador».
   - En el móvil: «Enviado al ordenador», sin datos del documento.
   - En el PC, estando en otra pantalla: aviso «Ha llegado un albarán desde el móvil». «Abrir la recepción» muestra
     la cabecera y las líneas de la fixture.
4. Repite el envío con la nueva recepción abierta: pide confirmación antes de sustituir lo leído.
5. Crea la recepción. En su detalle se ven las dos páginas del documento.
6. En la recepción, pega en el campo de escaneo
   `https://id.gs1.org/01/08470005700168/10/LOTE1?17=280100` (GTIN de prueba de `packages/gs1/test`, código nacional 570016): se rellenan el
   código nacional, el lote `LOTE1` y la caducidad 31/01/2028.
7. Pega `https://www.example.com/producto`: aparece «Este código QR no identifica el medicamento…» y no se rellena
   nada.

## Comprobaciones solo manuales

- SC-001 (menos de 90 s del papel a la revisión): cronométralo en los pasos 3–4.
- SC-005 (ninguna recepción sin revisión): tras el paso 3 no existe ninguna recepción nueva hasta que se pulsa crear en el paso 5.
