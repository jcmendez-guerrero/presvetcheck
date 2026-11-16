# Quickstart: validar la tabla filtrable de recepciones

## Requisitos

```bash
pnpm i && pnpm dev          # PostgreSQL + API + web, AUTH_MODE=dev
pnpm db:migrate && pnpm db:seed
```

Crea (o usa del seed) al menos 3 proveedores y 60 recepciones con estados distintos, alguna sin albarán ni fecha de
recepción, una descartada y una registrada a las 00:30 hora de Madrid.

## Pruebas automáticas

```bash
pnpm --filter api test -- recepciones-lista flujos
pnpm --filter web test -- recepciones-tabla
pnpm --filter api openapi    # regenera openapi.json; el diff solo debe tocar GET /api/recepciones
pnpm lint && pnpm typecheck && pnpm test
```

## Recorrido en el navegador (`/recepciones`, usuario de almacén)

| # | Acción | Resultado esperado | Spec |
|---|---|---|---|
| 1 | Abrir Recepciones | Tabla con 6 columnas, 25 filas, total visible, más recientes primero; sin descartadas | US1, FR-001/008/009 |
| 2 | Mirar una fila sin albarán | «Sin albarán» y «—» en recepción | FR-002 |
| 3 | Mirar estados | Textos claros; Abierta y Error al enviar con icono | FR-003 |
| 4 | Escribir parte del albarán de una recepción antigua (> 50) | Aparece | US2-1, FR-006 |
| 5 | Proveedor + estados Abierta y Error al enviar | Solo las que cumplen ambos | US2-2/3/5 |
| 6 | Rango de fecha de recepción 01/11–15/11 | Ambos días incluidos | US2-4 |
| 7 | «Desde» posterior a «hasta» | Mensaje junto al campo, no filtra | FR-012 |
| 8 | Filtros sin resultados → «Quitar filtros» | Mensaje claro; vuelve a la tabla por defecto | FR-011 |
| 9 | Estado «Descartada» | Se ven las descartadas | FR-007 |
| 10 | Ordenar por fecha de compra dos veces | Asc y luego desc | US3-2 |
| 11 | Filtrar, abrir una recepción, volver atrás | Mismos filtros, orden y página | US3-3, FR-010 |
| 12 | Copiar la dirección a otra pestaña | Mismo resultado | FR-010 |
| 13 | Recorrer con teclado y lector de pantalla | Filas activables, cabeceras y orden anunciados | FR-014 |
| 14 | Ventana estrecha (375 px) | Tabla legible con desplazamiento horizontal | Edge case |
| 15 | Crear recepción nueva / abrir desde el móvil | Igual que antes | FR-016 |
| 16 | Con 5.000 recepciones de prueba (test de volumen o script local no versionado), cambiar un filtro y medir en las herramientas del navegador la respuesta de `GET /api/recepciones` | < 1 s; anotar el tiempo | SC-003 |
