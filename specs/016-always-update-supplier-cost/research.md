# Research: coste de proveedor en Siweb360

Fuente: `docs/ref/siweb360-openapi.json` v1.3.0 y código actual (`packages/siweb`, `packages/db`).

## D1. Qué endpoint actualiza «el coste del proveedor»
- **Decisión**: `PUT /api/public/inventory/products/{id}/suppliers/{contact_id}` con `purchase_cost_cents`.
- **Razón**: es el único que guarda un coste **por proveedor**; vincula el proveedor al producto si no lo estaba.
  El coste general (`PUT …/variants/{id}/pricing`, `cost_cents`) se mantiene como está, gobernado por la casilla.
- **Alternativas**: usar solo `pricing` (descartada: es el coste de la variante, no del proveedor; ya se descartó en
  la aclaración del 2026-11-18).
- **Matiz**: el proveedor es del **producto**, común a sus variantes: varias variantes del mismo producto en una
  recepción actualizan el mismo coste (gana la última línea, por orden de línea) — ver D6.

## D2. De dónde sale el `product_id`
- **Decisión**: `siweb_variant_map.productId` si existe; si es nulo, `GET inventory/variants/{id}` (`product_id`) y se
  guarda en el mapa.
- **Razón**: el mapa ya lo guarda (`mapeo.ts`); evita llamadas repetidas. **Alternativa**: consultar siempre la
  variante (más llamadas, sin ventaja).

## D3. Cómo se identifica el `contact_id` del proveedor
Hechos de la API: `GET contacts` **no devuelve CIF** ni filtra por CIF (solo `search` por nombre/email, `tipo`);
`GET contacts/{id}` sí devuelve `cif`; `GET products/{id}/suppliers` devuelve `supplier_cif` y `contact_id` de los
proveedores ya vinculados a ese producto.

- **Decisión (orden)**:
  1. `distribuidor.siweb_contact_id` si existe y el contacto sigue existiendo (si el `PUT` da 404 → `needs_supplier`).
  2. Entre los proveedores ya vinculados al producto (`GET products/{id}/suppliers`), el que tenga `supplier_cif`
     igual (normalizado) al CIF del distribuidor. Una llamada, sin ambigüedad.
  3. `GET contacts?tipo=Proveedor&activo=true&search=<nombre del distribuidor>` (máx. 10 candidatos) y se compara el
     `cif` del detalle de cada candidato (`GET contacts/{id}`).
  4. Exactamente una coincidencia → se recuerda en `distribuidor.siweb_contact_id`. 0 o >1, o sin CIF → `needs_supplier`.
- **Razón**: respeta el contrato real (no se inventa un filtro por CIF), minimiza llamadas y no adivina.
- **Alternativas**: solo por nombre (descartada: ambigua y legalmente débil); solo `contact_id` manual (descartada:
  la aclaración pide búsqueda automática **y** recordarlo); filtrar por CIF en `contacts` (no existe en 1.3.0).
- **Normalización de CIF**: mayúsculas, sin espacios, guiones ni puntos, sin prefijo `ES`. Función pura con `it.each`.

## D4. Cuándo se resuelve: al encolar o al enviar
- **Decisión**: al **enviar** (en el dispatcher). El encolado solo guarda `{ variant_id, distribuidor_id, cost_cents }`.
- **Razón**: no hacer red dentro de la transacción de finalización; si Siweb360 está caído la recepción no se
  bloquea; el reintento tras vincular el proveedor no necesita reabrir nada.
- **Alternativa**: resolver al finalizar (descartada: acopla la finalización a Siweb360).

## D5. Estado «proveedor sin resolver»
- **Decisión**: nuevo valor `needs_supplier` en `outbox.status` (columna `text`, sin migración de esquema). El
  dispatcher no lo toma; se reactiva (`pending`) cuando se vincula el proveedor (acción de administración) o por un
  barrido diario que reintenta la resolución. Visible en `/api/admin/outbox` (ya admite filtro por estado).
- **Razón**: no es un envío dudoso (`needs_reconciliation`: sí se envió) ni un fallo definitivo (`failed`): no se
  envió nada y puede resolverse. Mantiene la regla «timeout → `needs_reconciliation`, sin reintento automático».
- **Alternativas**: dejarlo `pending` (reintenta y busca en cada ejecución: ruido); `failed` (pierde la reanudación).

## D6. Varias líneas del mismo producto en una recepción
- **Decisión**: una operación por línea (clave `MMX-PRV-{recepcionId}-L{n}`, idempotente). Se envían en orden de
  línea; gana la última. No se agrupa en v1.
- **Razón**: simple, auditable por línea, coherente con las claves existentes. **Alternativa**: agrupar por producto
  (más lógica; el resultado es el mismo salvo el orden).

## D7. Valor enviado como coste del proveedor
- **Decisión**: por defecto el mismo que la variante hoy: `precio_coste ?? precio_neto_compra`, en céntimos. Se
  expone como configuración `coste_proveedor_base` en `config/rules/precios.v1.yaml` (`precio_coste` | `precio_neto`)
  con `TODO(decision D-15)`, porque el coste de compra de un proveedor suele ser el neto (sin RE).
- **Razón**: la spec lo deja abierto (Assumptions); cambiarlo no requiere código. **Pendiente de decisión del dueño (D-15, a registrar en `SPEC.md` §13).**

## D8. Idempotencia y reintentos
- 4xx → `failed` (p. ej. 404 de contacto/producto, 400); timeout, red, 5xx o respuesta no interpretable →
  `needs_reconciliation`, sin reintento automático (regla existente). La verificación automática de dudosos usa el
  historial de movimientos de stock y **no** aplica a costes: queda para una persona (como `siweb_actualizar_precio`).
- Reglas iguales a las del precio de variante: `off` no encola; sin prueba de escritura vigente no se envía.

## D9. Ayuda y UI
- La casilla se mantiene. Texto nuevo (propuesta): «Marcada: el precio pasa a ser el coste de la variante en Siweb360
  y el coste de referencia en la app. El coste del proveedor en Siweb360 se actualiza siempre, esté marcada o no.»
- Administración del outbox: etiqueta «Falta vincular el proveedor» y acción «Vincular proveedor de Siweb360» (elige
  entre los proveedores de `GET contacts?tipo=Proveedor`, ya usado hoy), que guarda `siweb_contact_id` y reactiva.

## Sin NEEDS CLARIFICATION pendientes
D7 es una decisión de negocio abierta, pero tiene valor por defecto y no bloquea el diseño.
