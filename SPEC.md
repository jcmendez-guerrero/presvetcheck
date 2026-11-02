# SPEC — Sistema de verificación de recetas, dispensación y registro de entradas/salidas
**Proyecto:** Mundo Mascotix "Medicamentos Veterinarios" (Establecimiento de Comercio Detallista, autorización M.V./I-192/M)
**Versión de la spec:** 0.2 — 14/10/2026 (decisiones D-01 a D-14 resueltas con JC)
**Destinatario:** agente de código (Codex) para generar la configuración inicial (Fase 0) del repositorio.
**Autor funcional:** JC (propietario técnico). **Validación regulatoria:** farmacéutico garante + veterinaria responsable.

> Lee también `AGENTS.md` (convenciones de trabajo). Las decisiones de la sección 13 que siguen pendientes (D-02b, D-04b, D-05c, D-06b, D-10b) no las resuelvas por tu cuenta: implementa el punto de configuración y deja un `TODO(decision)` enlazado a la sección 13.

---

## 0. Objetivo y alcance

### 0.1 Qué hace el sistema
1. **Verificación de recetas veterinarias** a partir de una foto (móvil/tablet) o un escaneo (PDF/JPEG). Las recetas no siguen un formato estándar: el sistema extrae los datos con IA, el empleado los confirma y un **motor de reglas determinista** comprueba los requisitos legales (RD 666/2023; ver Anexo A).
2. **Verificación de cada medicamento contra CIMAVet** (AEMPS): existencia, estado de autorización, comercialización, condiciones de dispensación, composición.
3. **Consulta de stock en Siweb360** y **recomendación por línea**: `DISPENSAR`, `SUSTITUIR`, `PEDIR` o `NO_CONFORME`.
4. **Dispensación guiada** con lote recomendado por **FEFO** (primero el que caduca antes), confirmación por escaneo del código 2D del envase y registro de la salida.
5. **Flujo de sustitución** con aviso visual, consentimientos y autorización del farmacéutico garante.
6. **Registro de salidas** (con y sin receta, presencial y online) con las columnas exactas de la sección 4.8.
7. **Módulo de entradas** (recepción de mercancía) con autocompletado desde CIMAVet, escaneo del envase, datos obligatorios y sincronización de stock con Siweb360.
8. **Caché local de CIMAVet** (carga inicial desde el Nomenclátor XML + sincronización incremental) y **reportes semanales**.
9. **Asistente de consultas** (chat en español) que explica las reglas de prescripción, sustitución y dispensación y el resultado de una receta; solo informa, no decide (especificación en `specs/002-prescription-chat-assistant/`, ADR-17).

### 0.2 Principios no negociables
- **La IA propone, la persona decide.** Ningún dato extraído por IA se usa sin confirmación humana. Ninguna dispensación se completa sin la confirmación explícita del empleado.
- **Las reglas legales son deterministas, versionadas y configurables como datos** (no viven en prompts). Cada evaluación guarda la versión del reglamento de reglas usado.
- **Registros inmutables.** Salidas y entradas son append-only; una corrección es un movimiento de anulación + uno nuevo, nunca un `UPDATE`.
- **Una sola fuente de escritura de stock.** El sistema no escribe stock en Siweb360 hasta que la política de escritura esté decidida (sección 5.2.4).
- **Fuera de alcance v1:** emisión o dispensación en plataformas de receta electrónica (solo se registra plataforma e identificador), estupefacientes (bloqueo; los psicótropos sí entran, con reglas propias en 4.1.5), facturación/TPV (sigue en Siweb360).

### 0.3 Qué se pide en esta primera entrega (Fase 0)
Repositorio funcional en local con: estructura monorepo, base de datos y migraciones, motor de reglas con tests exhaustivos, clientes de CIMAVet y Siweb360 contra mocks, importador del Nomenclátor (esqueleto guiado por el XML real), pipeline de extracción con proveedor falso + implementación Azure,
UI navegable de los flujos principales, IaC Bicep y CI. Criterios de aceptación en la sección 12.

---

## 1. Decisiones de arquitectura (ADR resumidas)

| # | Decisión | Motivo | Alternativa descartada |
| --- | --- | --- | --- |
| ADR-01 | **Azure Container Apps (plan Consumo, entorno *workload profiles*)** para API+SPA y **Container Apps Jobs** para tareas programadas | Volumen muy bajo (decenas de recetas/día, horario comercial). Escala a cero; la suscripción tiene una cuota gratuita mensual de 180.000 vCPU‑s, 360.000 GiB‑s y 2 M de peticiones. Coste esperado de cómputo ≈ 0–5 €/mes | **AKS Free tier**: el plano de control es gratis, pero se pagan los nodos (al menos un *system node pool* siempre encendido), disco, balanceador e IP; Microsoft no lo recomienda para producción y añade operación (upgrades, ingress, certificados). Sin sentido para esta carga. Mantenemos portabilidad: imágenes OCI estándar y configuración 12‑factor, de modo que migrar a AKS sea añadir manifiestos |
| ADR-02 | **Azure Database for PostgreSQL Flexible Server, Burstable B1ms**, PostgreSQL 16, con `pg_trgm` y `unaccent` | Relacional, búsqueda difusa de nombres de medicamento, JSONB para crudos de CIMAVet. B1ms entra en la oferta de cuenta gratuita (12 meses) y después es el SKU más barato | SQLite (no apto para retención legal de 5 años con varios procesos), Cosmos (sin necesidad) |
| ADR-03 | **Azure Blob Storage** para imágenes de recetas y reportes, con **política de inmutabilidad por tiempo** y ciclo de vida Hot→Cool→Cold | Custodia 5 años con integridad demostrable | — |
| ADR-04 | Extracción en dos etapas: **Azure AI Document Intelligence `prebuilt-layout`** (OCR, incluido manuscrito en español, con confianza por palabra) + **modelo multimodal de Azure OpenAI desplegado en *Data Zone* UE** con *structured outputs* | El OCR da texto y confianza auditables; el LLM estructura los campos y detecta firma/sello. Datos personales sin salir de la UE | Solo LLM (sin trazabilidad de confianza), solo OCR (no estructura recetas heterogéneas) |
| ADR-05 | **Interfaz `RecipeExtractor` agnóstica de proveedor** | Poder cambiar de modelo o volver a AWS sin tocar dominio | — |
| ADR-06 | **Microsoft Entra ID** (app registration con *app roles*) mediante la autenticación integrada de Container Apps + validación del token en la API | Gratis, MFA para el garante, sin gestionar contraseñas | Auth propia |
| ADR-07 | **Key Vault + Managed Identity** para secretos (token Siweb360, claves de IA, SMTP) | Sin secretos en variables planas | — |
| ADR-08 | **Patrón outbox** para toda escritura en Siweb360 | La API de Siweb no ofrece claves de idempotencia; hay que evitar dobles ajustes de stock | Llamadas síncronas directas |
| ADR-09 | **Registro de imágenes en GitHub Container Registry** | Gratis; ahorra el coste fijo de ACR Basic | ACR Basic |
| ADR-10 | **IaC en Bicep** (compatible con `azd`) | Nativo Azure, sin estado remoto que gestionar | Terraform (válido si JC lo prefiere; mantener módulos simétricos) |
| ADR-11 | **Región:** `spaincentral` si todos los servicios (Container Apps, PostgreSQL, Document Intelligence, Azure OpenAI Data Zone UE) están disponibles; si alguno no lo está, `westeurope` o `swedencentral` para ese servicio | Residencia de datos en UE; latencia | — |

### 1.1 Diagrama lógico

<!-- editorconfig-checker-disable -->
```text
  Tablet/Móvil (PWA)                       Escáner de impresora (PDF)
         │  cámara + lector USB 2D                 │ subida manual (v1)
         ▼                                         ▼
  ┌──────────────────── Azure Container Apps (Consumo) ─────────────────────┐
  │  app "mmx-api"  (Fastify + SPA estática)                                │
  │   ├─ /api/recetas  ─► Extracción ─► Document Intelligence + Azure OpenAI │
  │   ├─ /api/decision ─► Motor de reglas (packages/domain, puro)            │
  │   ├─ /api/dispensaciones, /api/entradas, /api/reportes                   │
  │   └─ outbox ─► Siweb360 API (stock)                                      │
  │  jobs: cimavet-delta (diario) · cimavet-full (semanal) ·                  │
  │        outbox-dispatcher (entradas) · sales-reconciliation (diario) ·     │
  │        weekly-reports (lunes)                                            │
  └───────┬───────────────────────┬──────────────────────┬───────────────────┘
          ▼                       ▼                      ▼
   PostgreSQL Flexible     Blob Storage (inmutable)   Key Vault
   (caché CIMAVet,         recetas/ reportes/         secretos
    recetas, registros)
          ▲
          └── CIMAVet REST API (cimavet.aemps.es) — lectura
```
<!-- editorconfig-checker-enable -->

---

## 2. Stack técnico

- **Lenguaje:** TypeScript estricto en todo el repositorio. Node.js 22 LTS.
- **Monorepo:** pnpm workspaces + Turborepo.
- **API:** Fastify 5, `zod` para validación (esquemas compartidos), `@fastify/swagger` para OpenAPI generado.
- **ORM/migraciones:** Drizzle ORM + drizzle-kit (SQL de migración versionado en git).
- **Frontend:** React 19 + Vite + Tailwind CSS 4 + TanStack Router/Query. PWA instalable, **tablet-first** (1024×768 apaisado) y usable en móvil.
- **Escaneo 2D:** lector USB/Bluetooth en modo teclado (HID) como vía principal; cámara como respaldo con `zxing-wasm` (soporta DataMatrix y QR).
- **Excel/CSV:** `exceljs`.
- **Tests:** Vitest (unitarios e integración), Testcontainers para PostgreSQL, MSW para mocks HTTP, Playwright (humo de UI).
- **Calidad:** ESLint + Prettier, `tsc --noEmit`, Husky opcional.
- **Local:** Docker Compose con PostgreSQL 16 y Azurite (emulador de Blob).
- **IaC:** Bicep en `infra/`.
- **CI:** GitHub Actions (lint, typecheck, test, build de imagen, publicación a GHCR en `main`).

### 2.1 Identidad visual (UI)
Paleta de marca: primario `#016581`, secundario `#2F8198`, acento claro `#60ABB8`, fondo `#F2F8F9`, texto/oscuro `#002028`, acento dorado `#E3A857`. Tipografías: Bricolage Grotesque (títulos), Inter (cuerpo). Colores semánticos de estado (no de marca): **SUSTITUIR = ámbar** (`#B45309` sobre
`#FEF3C7`), **NO_CONFORME = rojo** (`#B91C1C` sobre `#FEE2E2`), **DISPENSAR = verde** (`#047857` sobre `#D1FAE5`), **PEDIR = azul marca** (`#016581` sobre `#E0F2F7`). El estado nunca se comunica solo por color: siempre icono + texto.

---

## 3. Estructura del repositorio

```text
/
├─ AGENTS.md
├─ SPEC.md
├─ docs/
│  ├─ ref/                      # PDFs y normativa de referencia (los aporta JC)
│  │   ├─ cimavet-rest-api-v1.4.pdf
│  │   ├─ siweb360-api-inventario.pdf
│  │   └─ guia-receta-veterinaria.md   # texto del Anexo A
│  └─ adr/                      # una ADR por fichero, a partir de la sección 1
├─ apps/
│  ├─ api/                      # Fastify: rutas, auth, servicios de aplicación, SPA estática
│  ├─ web/                      # React PWA
│  └─ worker/                   # entrypoints de jobs (cimavet-delta, cimavet-full, outbox, reports, nomenclator-import)
├─ packages/
│  ├─ domain/                   # PURO: reglas, motor de decisión, FEFO, equivalencias, validez, precio. Sin I/O.
│  ├─ shared/                   # esquemas zod, tipos, enums, errores
│  ├─ db/                       # esquema Drizzle, migraciones, repositorios
│  ├─ cimavet/                  # cliente REST + importador Nomenclátor + normalizadores
│  ├─ siweb/                    # cliente REST + outbox + mapeo CN↔variante
│  ├─ extraction/               # RecipeExtractor: fake, azure (DI + OpenAI)
│  ├─ gs1/                      # parser de códigos GS1 (DataMatrix/EAN)
│  └─ reports/                  # generación XLSX/CSV
├─ config/
│  └─ rules/
│      ├─ receta-campos.v1.yaml       # severidad por campo y contexto (sección 4.1)
│      ├─ validez.v1.yaml             # plazos de validez (sección 4.1.3)
│      ├─ sustitucion-exclusiones.v1.yaml
│      └─ precios.v1.yaml             # IVA y recargo de equivalencia (sección 4.10)
├─ fixtures/
│  ├─ recetas/                  # imágenes anonimizadas + JSON esperado (los aporta JC)
│  ├─ cimavet/                  # respuestas JSON de ejemplo
│  ├─ siweb/                    # respuestas JSON de ejemplo (de la doc)
│  └─ nomenclator/              # muestra del XML real (la aporta JC)
├─ infra/
│  ├─ main.bicep
│  └─ modules/ (containerapps.bicep, postgres.bicep, storage.bicep, keyvault.bicep, ai.bicep, monitoring.bicep, identity.bicep)
├─ docker-compose.yml
└─ .github/workflows/ci.yml
```

**Regla de dependencias:** `domain` no importa nada de `db`, `cimavet`, `siweb`, `extraction` ni de Node I/O. Las apps orquestan; los paquetes de integración implementan puertos definidos en `domain`.

---

## 4. Dominio y reglas de negocio

### 4.1 Validación de la receta

#### 4.1.1 Flujo
1. **Captura.** Foto (cámara de la PWA, varias páginas permitidas) o subida de PDF/JPEG/PNG/HEIC. Se normaliza a PNG por página, se corrige orientación, se calcula SHA‑256 y un *hash* perceptual (pHash) para detectar resubidas.
2. **Extracción** (sección 5.3). Devuelve cada campo con `valor`, `confianza (0–1)`, `evidencia` (texto OCR y región) y `fuente` (`ocr`, `llm`, `manual`).
3. **Revisión humana obligatoria.** Pantalla dividida: imagen ampliable a la izquierda, campos a la derecha. Los campos con confianza < umbral (`EXTRACTION_CONFIDENCE_THRESHOLD`, por defecto 0,85) o ausentes se marcan y requieren confirmación individual. El empleado debe marcar "He comprobado los
  datos con el original" antes de continuar. Se guardan el valor extraído y el confirmado.
4. **Evaluación de reglas** (motor determinista) → lista de incidencias con severidad `BLOQUEANTE` o `AVISO`.
5. **Resultado por línea** (sección 4.3).

#### 4.1.2 Campos y severidad por defecto
Las severidades viven en `config/rules/receta-campos.v1.yaml` y las aprueba el farmacéutico garante. En esta tabla, `BLOQUEANTE` = `BLOQUEANTE_FORMA` (forzable, ver 4.1.6) salvo que 4.1.6 lo declare `BLOQUEANTE_DURO`. Contexto: `especie_produccion` (animal productor de alimentos) o `especie_compania`. Valores por defecto propuestos:

| Campo (RD 666/2023, Anexo A) | Compañía | Producción | Notas |
| --- | --- | --- | --- |
| Nº identificativo de receta | BLOQUEANTE | BLOQUEANTE | Clave de duplicados junto con nº colegiado |
| Tipo de dispensación | BLOQUEANTE | BLOQUEANTE | Solo se dispensa si es **"de dispensación"**. "De botiquín" o "de no dispensación" → `NO_CONFORME` |
| Titular: nombre completo | BLOQUEANTE | BLOQUEANTE | |
| Titular: teléfono | AVISO | BLOQUEANTE | |
| Código REGA | N/A | BLOQUEANTE | |
| Especie | BLOQUEANTE | BLOQUEANTE | Se normaliza contra la maestra de especies de CIMAVet |
| Identificación del animal | BLOQUEANTE si la especie tiene identificación individual obligatoria (perro, gato, hurón → microchip); AVISO en el resto | BLOQUEANTE (individual o lote) | Lista de especies con ID individual configurable |
| Nº de animales | AVISO | BLOQUEANTE | |
| Fecha de emisión | BLOQUEANTE | BLOQUEANTE | Base del cálculo de validez |
| Veterinario: nombre, teléfono, correo | nombre BLOQUEANTE; resto AVISO | ídem | |
| Nº de colegiado | BLOQUEANTE | BLOQUEANTE | Exento si talonario colegial con numeración que lo incluye (campo `talonario_colegial=true`, confirmado por el empleado) |
| Firma del veterinario | BLOQUEANTE | BLOQUEANTE | Papel: el empleado confirma **firma manuscrita en original** (no copia). Electrónica: registro de emisión en plataforma |
| Nombre del medicamento **y** principio(s) activo(s) | BLOQUEANTE | BLOQUEANTE | Ver 4.1.4 sobre prescripción solo por principio activo |
| Clase de prescripción (ordinaria / excepcional) | AVISO (si falta se asume ordinaria y **se bloquea la sustitución**) | ídem | |
| Indicación | BLOQUEANTE | BLOQUEANTE | Necesaria para comprobar equivalencia en sustitución |
| Declaración art. 107.3 y 4 Reglamento (UE) 2019/6 + fin metafiláctico/profiláctico | BLOQUEANTE **si antimicrobiano** | ídem | Antimicrobiano = `antibiotico=true` en CIMAVet o ATC QJ01/QJ02/QJ04/QJ05/QP51 (lista configurable) |
| Forma farmacéutica y concentración | BLOQUEANTE | BLOQUEANTE | |
| Cantidad / nº de envases y formato | BLOQUEANTE | BLOQUEANTE | Tope de unidades dispensables |
| Posología: vía, dosis, duración, % de envase | AVISO | BLOQUEANTE | La duración alimenta el aviso de caducidad del lote (4.5) |
| Tiempo de espera (aunque sea cero) | AVISO | BLOQUEANTE | |
| Plazo de validez | Opcional | Opcional | Si falta se aplica el máximo legal del caso (4.1.3) |
| Advertencias | Opcional | Opcional | |

#### 4.1.3 Validez temporal (por línea, se aplica la más restrictiva a la receta)
Configurable en `config/rules/validez.v1.yaml`. Valores por defecto según el Anexo A:

| Caso | Plazo máximo desde la fecha de emisión |
| --- | --- |
| General | 1 mes |
| Línea con antimicrobiano | 5 días (dentro de los cuales debe iniciarse el tratamiento) |
| Tratamiento periódico o crónico en especie no productora, **sin** antimicrobianos, estupefacientes, psicótropos, gases medicinales, autovacunas, fórmulas magistrales ni preparados oficinales | 3 meses |
| Tratamiento preventivo en especie no productora | 6 meses |
| Receta de estupefacientes | 10 días (en v1, además, bloqueo y derivación) |

Regla: `validez_efectiva = min(plazo_declarado_en_receta ?? máximo_legal_del_caso, máximo_legal_del_caso)`. Si el plazo declarado supera el máximo legal → AVISO "plazo declarado superior al máximo legal; se aplica X". Fecha de dispensación > validez efectiva → `NO_CONFORME` (receta caducada). "Mes"
= mes natural (`emisión + 1 mes`, ajustando a fin de mes). Toda la aritmética de fechas en zona `Europe/Madrid`.

Los casos crónico/preventivo no se deducen automáticamente: el empleado (o la extracción) indica `tipo_tratamiento ∈ {agudo, cronico, preventivo}` y, si no consta en la receta, se usa `agudo`.

#### 4.1.4 Prescripción solo por principio activo
El texto normativo (Anexo A) exige **nombre del medicamento y principio activo** e indica que **no debe realizarse una prescripción por principio activo**. Es un **defecto de forma** (D-05, resuelta):
- Resultado `NO_CONFORME` con motivo `PRESCRIPCION_SOLO_PA` y el mensaje "No se puede dispensar: la receta indica solo el principio activo, falta el nombre del medicamento".
- El sistema **muestra las opciones disponibles** (medicamentos autorizados y comercializados con ese principio activo, especie y forma, y cuáles hay en stock) para que el empleado pueda llamar al veterinario y que corrija la receta.
- Como todo defecto de forma, admite **forzado** (4.1.6). Si se fuerza, el medicamento elegido debe cumplir las mismas condiciones de equivalencia que una sustitución (4.4.2) respecto a lo que indica la receta (principio activo, cantidad, forma, vía, especie, indicación).
- El flag `ALLOW_ACTIVE_INGREDIENT_ONLY_PRESCRIPTION` se elimina: lo sustituye el mecanismo general de forzado.

#### 4.1.5 Otras comprobaciones
- **Duplicados:** si ya existe una dispensación completada para `(nº receta, nº colegiado)` en receta en papel → `NO_CONFORME` (`RECETA_YA_DISPENSADA`). Mismo pHash que una receta anterior → AVISO con enlace a la anterior.
- **Tipo de receta:** `papel | electronica`. Si es electrónica se registra la plataforma y su identificador/CSV. Plataforma fuera de la lista → AVISO.
  - **Semilla de `plataforma_receta_electronica` (D-14):** `GeneraRecetas`, `recetas.vet`, `Prescrivet` (verificar grafía exacta), `Recevet`, con `reconocida_mapa = null` (sin verificar) hasta que alguien con rol garante o admin lo contraste con el listado del MAPA y lo marque `true`/`false`.
    Plataforma con `reconocida_mapa=false` → AVISO destacado; `null` → AVISO "plataforma pendiente de verificar".
  - La extracción intenta detectar la plataforma por logotipo, cabecera, dominio o formato del CSV/QR; el empleado la confirma.
  - Validación del CSV/QR contra la plataforma: fuera de alcance en v1 (no hay API pública conocida); si la plataforma ofrece una URL de verificación, se guarda en la tabla (`url_verificacion`) y la app ofrece un botón para abrirla.
- **Estupefacientes** (`estupefaciente=true` en CIMAVet) → `NO_CONFORME` no forzable, motivo `ESTUPEFACIENTE_NO_DISPENSABLE` (D-06: el establecimiento no los dispensa).
- **Psicótropos** (`psicotropo=true` en CIMAVet) → **se dispensan** (D-06) con reglas adicionales:
  - **Un único envase por receta** (art. 17 RD 2829/1977, Anexo A): si la receta pide más de uno o se intenta dispensar más de uno → `BLOQUEANTE_DURO`.
  - **Validez de 1 mes**: nunca se aplica el plazo de 3 meses de tratamientos crónicos ni el de 6 de preventivos (ya excluido en 4.1.3).
  - Por defecto, sus defectos de forma **no son forzables** (`PSYCHOTROPIC_ALLOW_FORCE=false`).
  - Banda morada "PSICÓTROPO" en la pantalla de dispensación y receta apartada siempre para revisión del garante.
  - **Registro de psicótropos**: vista y exportación específica de entradas y salidas de psicótropos por medicamento y lote, con saldo resultante, para el control del garante. El formato oficial exigido lo confirma el garante (D-06b); la app genera el listado con todos los datos ya registrados.
- **Medicamento de uso humano** prescrito (no existe en CIMAVet, sí en CIMA humano): v1 → `NO_CONFORME` con motivo `MEDICAMENTO_USO_HUMANO_REVISION_GARANTE` (no se automatiza; requiere prescripción excepcional y revisión).
- **Canal online con receta:** los medicamentos sujetos a prescripción no se venden a distancia. Cualquier línea con `receta=true` en un pedido de canal `online` → bloqueo.

#### 4.1.6 Defectos, corrección manual y forzado (D-05, resuelta)
Principio de JC: **ante cualquier incumplimiento, la app dice "No se puede dispensar" y explica exactamente qué defecto ha encontrado**; el empleado puede corregir los datos o, si asume la responsabilidad, forzar.

**1. Mensaje de defecto.** Cada incidencia bloqueante se muestra como una tarjeta roja con: qué falla ("Falta el número de colegiado del veterinario"), dónde mirar en la receta (resaltado sobre la imagen si hay evidencia OCR) y qué hacer ("Pide al veterinario que lo complete" / "Corrige el dato si
la app lo ha leído mal"). Los textos viven en un catálogo `packages/shared/i18n/defectos.es.json` indexado por `code`.

**2. Corrección manual (fallo de lectura del sistema).** Si el defecto se debe a que la extracción leyó mal o no leyó un dato que **sí está** en la receta, el empleado edita el campo en la pantalla de revisión y se reevalúa al instante. Se guarda valor extraído, valor corregido, quién y cuándo. Esto no es un forzado: es una corrección de datos.

**3. Forzado (bypass).** Si el defecto es real y aun así se decide dispensar:
- Botón secundario "Dispensar igualmente" → **ventana modal** que lista los defectos y exige: marcar la casilla **"Entiendo los riesgos de dispensar una receta que no cumple los requisitos y asumo la responsabilidad"**, escribir un **motivo** (mínimo 15 caracteres) y confirmar con su usuario. Por
  defecto el botón de confirmar no es el principal y hay que pulsarlo de forma deliberada.
- La dispensación se registra con `forzado=true`, los códigos de defecto forzados, el motivo y el empleado; aparece en la **bandeja del garante** para revisión y en el reporte semanal "Dispensaciones forzadas". En la exportación de salidas: columna interna `FORZADO (S/N)` y `DEFECTOS FORZADOS`.
- La receta en papel se aparta igual que una sustitución (etiqueta "Receta con defecto forzado — revisión del garante").

**4. Bloqueos que NO se pueden forzar** (`BLOQUEANTE_DURO`; la severidad es configurable en `receta-campos.v1.yaml`, pero estos valores por defecto los aprueba el garante): ver D-05b. Por defecto:
- Receta en papel **ya dispensada** (`RECETA_YA_DISPENSADA`).
- Medicamento **sujeto a prescripción en canal online**.
- **Estupefacientes** (D-06) y, para psicótropos, superar **un envase por receta**.
- Sustitución en los supuestos **prohibidos** de 4.4.1 (prescripción excepcional, inmunológicos/biológicos, estrecho margen, uso humano).
Grupo **"producto no válido"** — **forzable de forma temporal** (decisión de JC) hasta que se complete la normalización de SKU y nombres en Siweb360 (D-04), para no bloquear la operativa por discrepancias de catálogo:
- Medicamento **suspendido o revocado** en CIMAVet.
- Envase **caducado**.
- **CN escaneado distinto** al seleccionado.
Se controla con `PRODUCT_VALIDITY_HARD_BLOCK` (por defecto `false` → `BLOQUEANTE_FORMA`; pasar a `true` → `BLOQUEANTE_DURO`). Mientras esté en `false`, la ventana de forzado de estos casos muestra el defecto en rojo con texto específico ("El envase escaneado está CADUCADO desde el dd/mm/aaaa") y el
reporte semanal los lista aparte para poder decidir cuándo endurecerlo. **TODO(decision D-05c)**.

El resto de incidencias bloqueantes son `BLOQUEANTE_FORMA` (forzables).

Severidades resultantes: `AVISO` (informativo) · `BLOQUEANTE_FORMA` (no se puede dispensar, se puede forzar) · `BLOQUEANTE_DURO` (no se puede dispensar ni forzar).

### 4.2 Resolución del medicamento
1. Texto extraído (nombre, forma, concentración, formato) → búsqueda en la caché local (trigramas sobre nombre normalizado de medicamento y presentación, filtrada por especie si consta) → hasta 10 candidatos con puntuación.
2. El empleado **selecciona** el candidato correcto (o busca manualmente). Nunca se autoselecciona, aunque haya un único candidato con puntuación alta: se preselecciona y se pide confirmación.
3. Con el `nregistro` elegido se resuelven las **presentaciones** (CN) y se elige la que coincide con el formato prescrito.
4. **Verificación en vivo** contra CIMAVet (`GET medicamento?nregistro=` y `GET presentacion/{cn}`) si la caché del registro tiene más de `CIMAVET_LIVE_CHECK_MAX_AGE_H` horas (por defecto 24). Si CIMAVet no responde, se usa la caché y se muestra AVISO con la fecha de la última sincronización.
5. Bloqueos: estado suspendido o revocado → `NO_CONFORME`. `comerc=false` → no dispensable desde stock nuevo (AVISO; el garante decide). `psum=true` → AVISO "problema de suministro" (orienta a sustitución o pedido). Notas de seguridad recientes → AVISO con enlace.

### 4.3 Motor de decisión (por línea)

Salida: `DISPENSAR | DISPENSAR_CON_AVISO | SUSTITUIR | PEDIR | NO_CONFORME`, con motivos y datos de soporte. Orden de evaluación:

<!-- editorconfig-checker-disable -->
```text
 1. ¿Hay incidencias BLOQUEANTE_DURO?                           → NO_CONFORME (no forzable)
    ¿Hay incidencias BLOQUEANTE_FORMA?                          → NO_CONFORME (forzable, 4.1.6);
        si se fuerza, se continúa en el paso 2 con forzado=true
 2. ¿Stock disponible de la presentación prescrita (mismo CN)?  → DISPENSAR (lote FEFO)
 3. ¿Stock de otra presentación que cumpla la REGLA DE FORMATO Y CONCENTRACIÓN (4.3.1)?
                                                                 → DISPENSAR_CON_AVISO
        (cambio de formato o de concentración; requiere confirmación del empleado
         y queda marcado para revisión del garante. Desactivable con ALLOW_PACK_SIZE_CHANGE=false)
 4. ¿Sustitución permitida? (4.4.1) Si NO                        → PEDIR (prescrito)
 5. Equivalentes según CIMAVet (4.4.2) con stock disponible      → SUSTITUIR (propuesta ordenada)
 6. Equivalentes sin stock                                        → PEDIR (prescrito + lista de equivalentes)
 7. Sin equivalentes                                              → PEDIR (prescrito)
```
<!-- editorconfig-checker-enable -->

#### 4.3.1 Regla de formato y concentración (D-09, resuelta)
Criterio de JC: se puede dispensar otra presentación **siempre que la concentración por unidad sea igual o menor y la cantidad total de principio activo nunca sea mayor** que la prescrita. Ejemplo: prescrito amoxicilina 500 mg × 10 comprimidos (5.000 mg) → válido 2 cajas de 250 mg × 10 (5.000 mg) o 1 caja de 250 mg × 10 (2.500 mg); **no** válido 1 caja de 1.000 mg.

Condiciones (todas, calculadas en `packages/domain` con los datos normalizados de CIMAVet):
1. Mismos principios activos (mismo conjunto de `pa_id`) y, si hay varios, **misma proporción** entre ellos.
2. Misma **forma farmacéutica** y misma **vía de administración**; autorizado para la **especie** de la receta.
3. **Concentración por unidad ≤ prescrita** para cada principio activo (mg/comprimido, mg/ml, %…). Mayor → descartado (`CONCENTRACION_SUPERIOR`).
4. **Cantidad total de principio activo dispensada ≤ prescrita** (`unidades_por_envase × concentración × nº envases`). Superior → descartado (`CANTIDAD_SUPERIOR`). La app propone el número de envases que más se acerca sin pasarse.
5. Si la concentración es **menor**, la dosis prescrita debe poder alcanzarse con unidades enteras (500 → 2 × 250 sí; 500 → 200 no): si no es múltiplo exacto → AVISO "La dosis no se puede ajustar con comprimidos enteros" y confirmación expresa. Para formas líquidas o semisólidas se calcula el volumen equivalente.
6. Cantidades no normalizables → no se propone automáticamente.

Tipos resultantes:
- **Cambio de formato** (mismo `nregistro`, misma concentración, otro tamaño de envase): aviso y revisión del garante.
- **Cambio de concentración** (otro `nregistro` o presentación de menor concentración): además de lo anterior, la app genera una **nota de administración para el tutor**, obligatoria de imprimir o entregar ("Este envase es de 250 mg: administre **2 comprimidos** por cada toma de 500 mg indicada por
  su veterinario"), registra que se ha explicado al tutor y deja preparado el texto de aviso al veterinario. Si el medicamento de menor concentración es de **otro laboratorio**, se trata además con las condiciones y el flujo de sustitución (4.4).

`PEDIR` muestra: medicamento prescrito y equivalentes con su CN, laboratorio titular y si constan problemas de suministro, más un botón "Añadir a lista de pedido" (tabla `pedido_pendiente`; la compra se hace fuera del sistema en v1).

La receta en conjunto se resume como el peor estado de sus líneas, pero **cada línea se dispensa por separado**. **Dispensación parcial (D-10, resuelta):**
- Se dispensan las líneas disponibles y la receta en papel **se retiene** en la farmacia desde la primera dispensación (solo admite una dispensación).
- Las líneas no disponibles pasan a `PENDIENTE_ENTREGA`: se crea un `pedido_pendiente` vinculado a la `receta_linea`, con los datos de contacto del tutor (opcionales en presencial; si no los da, se le entrega un resguardo con el nº de receta).
- Cuando el pedido llega (recepción con ese CN), la app avisa en Inicio: "Hay medicamentos pendientes de entrega para recetas retenidas". La entrega posterior es una dispensación más de esa misma línea; la **validez de la receta se evalúa en la fecha de la primera dispensación**, no en la de entrega (la receta ya fue presentada y retenida en plazo). **TODO(decision D-10b)**.
- Resguardo imprimible para el tutor: nº de receta, medicamentos pendientes, fecha y teléfono de la farmacia.
- Flag `ALLOW_PARTIAL_DISPENSATION` (por defecto `true`).

### 4.4 Sustitución

#### 4.4.1 Cuándo NO se puede sustituir (→ `PEDIR`)
- Prescripción **excepcional** (o clase no indicada; ver 4.1.2).
- Medicamento **inmunológico** (`tipoMedicamento` = inmunológico o mixto en CIMAVet) o **biológico**.
- Medicamento incluido en la lista de **no sustituibles por biodisponibilidad o estrecho margen terapéutico** que determine la AEMPS con el MAPA. No está en la API: tabla `sustitucion_exclusion` alimentada desde `config/rules/sustitucion-exclusiones.v1.yaml`, mantenida por el garante, por `nregistro` o por principio activo.
- Sustitución por un medicamento **de uso humano**: nunca.

#### 4.4.2 Equivalencia (todas obligatorias)
Calculada en `packages/domain` sobre los datos normalizados de la caché:
1. **Misma composición cualitativa y cuantitativa** en principios activos: mismo conjunto de `principio_activo_id` y misma cantidad por unidad tras normalizar unidades (`mg`, `g`, `µg`, `UI`, `%`, `mg/ml`…). Las cantidades de CIMAVet llegan como texto: el normalizador produce `{valor: Decimal,
  unidad_canonica}` o `NO_NORMALIZABLE`. Si alguna cantidad no es normalizable → el candidato no se propone automáticamente (se lista como "revisar manualmente").
2. **Misma forma farmacéutica** (`forma.id`).
3. **Misma vía de administración** (la vía prescrita debe estar entre las autorizadas del candidato).
4. **Misma dosificación** (consecuencia de 1 por unidad de forma; se comprueba explícitamente la concentración).
5. **Autorizado para la especie de destino** de la receta.
6. **Autorizado para la misma indicación.** La indicación de la receta es texto libre; se compara con las indicaciones del candidato para esa especie (similitud de texto + sinónimos). El resultado es `COINCIDE | PROBABLE | NO_COINCIDE`; `PROBABLE` exige confirmación expresa del garante en la autorización.
7. **Especies productoras de alimentos:** tiempo de espera del candidato ≤ el del prescrito para cada tejido y especie.
8. Candidato en estado **autorizado** y **comercializado**.

Orden de propuesta: con stock disponible primero; después caducidad FEFO más lejana; después menor precio de coste conocido.

#### 4.4.3 Flujo de sustitución (estado de la línea)
**Instrucción del farmacéutico garante (D-01, resuelta):** el personal puede realizar la sustitución **solo cuando el medicamento prescrito no está disponible en la farmacia** (ni el mismo CN ni, si está permitido, otro formato del mismo medicamento), apartando la receta para que el garante la **firme después**. Modo por defecto: `POST`.

```text
PROPUESTA                     (solo si el motor llegó a SUSTITUIR: prescrito sin stock)
  → CONSENTIMIENTO_TUTOR      (sí/no, medio, fecha-hora, empleado)          obligatorio
  → AVISO_VETERINARIO         (medio, fecha-hora, resultado) | URGENCIA (justificación)   obligatorio
  → DISPENSADA                (escaneo + registro de salida con es_sustitucion=true)
  → RECETA_APARTADA           (el empleado confirma que la receta está en la bandeja física)
  → FIRMADA_GARANTE           (el garante revisa en la app, confirma con MFA y firma la anotación al dorso)
  → VALIDADA
Rechazos: antes de DISPENSADA → PEDIR o NO_CONFORME. Después → el garante marca
"sustitución no conforme" con motivo (queda en registro y reporte; no se borra nada).
```
Salvaguardas que siguen siendo **previas** a la dispensación aunque el modo sea `POST`:
- Equivalencia de indicación `PROBABLE` o cantidades `NO_NORMALIZABLE` → no se ofrece sustituir sin aprobación previa del garante (pasa a `PRE` para esa línea; si no responde → `PEDIR`).
- Consentimiento del tutor y aviso al veterinario (o urgencia justificada) son obligatorios por norma: sin ellos no se habilita el botón de dispensar.
- **Aviso visual:** banda ámbar fija en toda la pantalla de dispensación con el texto "SUSTITUCIÓN — avisar al tutor y al veterinario prescriptor", nombre del prescrito y del sustituto lado a lado, y las diferencias resaltadas (laboratorio, presentación).
- **Plantillas de aviso:** el sistema genera el texto para el veterinario (correo/WhatsApp) con prescrito, sustituto, CN, lote y motivo; el empleado lo envía por el canal habitual (v1 no envía mensajes por sí mismo).
- **Receta física:** al pasar a `DISPENSADA`, la UI indica "Separar la receta en la bandeja de sustituciones" y genera una etiqueta imprimible (formato 62 mm o A6) con el texto de la anotación al dorso: medicamento dispensado, CN, lote, fecha y espacio para la firma del farmacéutico.
- **Modo de autorización** `SUBSTITUTION_APPROVAL_MODE`:
  - `POST` (**por defecto**, instrucción del garante): se dispensa y se aparta la receta para su firma posterior.
  - `PRE`: el garante aprueba desde el móvil antes de dispensar. Se mantiene implementado por si cambia la instrucción o para los casos de las salvaguardas.
  - La instrucción del garante se guarda como **evidencia**: tabla `procedimiento_aprobado` (código, versión, texto, documento firmado en Blob, aprobado_por, fecha). Cada sustitución registra la versión del procedimiento vigente. La app no arranca en `POST` en prod si no hay un procedimiento de sustitución aprobado cargado.
- Bandeja del garante: sustituciones pendientes de firma con antigüedad visible (alerta si superan `SUBSTITUTION_SIGN_MAX_DAYS`, por defecto 7), recetas `NO_CONFORME`, cambios de formato, indicaciones `PROBABLE`.

### 4.5 Selección de lote (FEFO)
> El requisito habla de FIFO pero describe "el más próximo a caducar": es **FEFO** (*first expired, first out*). Se implementa FEFO.

Entrada: variante(s) de Siweb360 mapeadas al CN, con stock por lote (`GET /inventory/variants/:id` → niveles por almacén/ubicación/lote) y fechas de caducidad (`GET /inventory/variants/:id/lots`, que devuelve los lotes **por fecha de creación**, no por caducidad: hay que ordenar en el sistema).

Algoritmo (`packages/domain/fefo.ts`):
1. Considerar solo lotes con disponible > 0 en el almacén "Farmacia".
2. Excluir lotes caducados (caducidad < hoy).
3. Ordenar por caducidad ascendente; empate → lote creado antes.
4. Recomendar el primero. Si `caducidad < fecha_fin_tratamiento` (hoy + duración de la posología) → AVISO "el lote caduca antes de terminar el tratamiento" y proponer el siguiente que lo cubra.
5. Si la cantidad pedida supera el disponible del primer lote, proponer reparto entre lotes en orden FEFO.
6. Lotes sin fecha de caducidad en Siweb → al final, con AVISO "lote sin caducidad registrada".

### 4.6 Confirmación de la dispensación por escaneo
- El código del envase es normalmente un **DataMatrix GS1** (el requisito dice "QR"; el lector debe leer códigos 2D). Paquete `packages/gs1`:
  - Identificadores de aplicación: `(01)` GTIN-14, `(17)` caducidad AAMMDD (día `00` = último día del mes), `(10)` lote (longitud variable, termina en separador GS, ASCII 29), `(21)` número de serie, `(240)`/`(710)` si aparecen.
  - Acepta el prefijo de simbología `]d2`, `]C1`, `]Q3`.
  - **Separador GS:** muchos lectores HID no transmiten el ASCII 29. Configuración `SCANNER_GS_SUBSTITUTE` (p. ej. `~` o `|`) que el lector debe programarse para emitir; documentar en `docs/scanner.md`.
  - Si solo hay EAN-13 lineal (sin lote ni caducidad), esos campos se piden a mano.
- **Sin lector físico al arranque (D-13):** la cámara de la tablet/móvil con `zxing-wasm` es la vía principal hasta que se compre el lector. La pantalla de escaneo abre la cámara trasera con un recuadro guía, enfoque continuo, linterna conmutable y lectura de DataMatrix, QR, EAN-13 y Code 128; tras
  8 s sin lectura ofrece la entrada manual. El modo lector HID se activa solo con poner el foco en el campo y recibir una ráfaga de teclas (< 50 ms entre caracteres), sin configuración adicional.
- `docs/scanner.md` incluye los **requisitos de compra del lector**: imager 2D (lee DataMatrix GS1 y QR en pantalla y papel), conexión USB-HID o Bluetooth-HID compatible con la tablet, distribución de teclado española, posibilidad de programar la sustitución del carácter GS (ASCII 29) y el prefijo
  de simbología, y peana de manos libres opcional. Y la guía de configuración: cómo programar `SCANNER_GS_SUBSTITUTE` y verificarlo en la pantalla "Probar lector" de Administración, que muestra los bytes recibidos y el resultado del parseo GS1.
- **CN desde GTIN:** heurística para GTIN-13 españoles con prefijo `847000` → CN = 6 dígitos siguientes. Marcar como heurística: se valida contra la caché de CIMAVet y se mantiene una tabla aprendida `gtin_cn` con cada asociación confirmada por un humano. Si no hay correspondencia, el empleado elige el medicamento.
- Validaciones al escanear: el CN coincide con la presentación seleccionada (si no → bloqueo), el envase no está caducado (bloqueo), el lote coincide con el recomendado (si no → AVISO "no es el lote FEFO" con motivo obligatorio), la suma de unidades no supera lo prescrito (bloqueo), el número de serie no se ha dispensado antes (AVISO).
- Entrada manual completa disponible como respaldo (lector averiado o código ilegible), registrando `metodo_captura = manual`.
- Al confirmar: transacción que crea el registro de salida inmutable y cambia el estado de la línea. **No se escribe stock** (lo descuenta el ticket del TPV, 5.2.4); se muestra el recordatorio de cobro con el lote a seleccionar en el TPV.

### 4.7 Venta sin receta y pedidos online
- **Presencial sin receta:** escaneo → resolución CN → comprobación en CIMAVet de que **no** está sujeto a prescripción (`receta=false`; si es `true` → bloqueo y redirección al flujo de receta) → lote FEFO → registro de salida con las columnas de la sección 4.8 (bloque sin receta).
- **Online:** solo medicamentos no sujetos a prescripción. Además de las columnas sin receta, **datos del propietario obligatorios**: nombre, móvil, dirección de entrega. **DNI/NIE obligatorio** (D-07, resuelta), validado con letra de control (DNI y NIE) y almacenado cifrado; en pantalla y
  exportaciones internas se muestra enmascarado (`****1234X`) salvo para el rol garante. Campo `referencia_pedido` del canal (web).
- **Presencial con receta:** datos del propietario opcionales (nombre, móvil, DNI, dirección).

### 4.8 Columnas del registro de salidas (exportación exacta)
Tres plantillas de exportación, mismo orden de columnas que el requisito:

**A. Con receta**
`NOMBRE DEL FÁRMACO | PRINCIPIO ACTIVO | FORMA FARMACÉUTICA | ESPECIE | FECHA VENTA | CADUCIDAD | LOTE | CÓDIGO NACIONAL | UNIDADES DISPENSADAS | FECHA RECETA | Nº RECETA | VETERINARIO | Nº COLEGIADO | NOMBRE CLÍNICA | DIRECCIÓN VETERINARIO`
+ opcionales `NOMBRE PROPIETARIO | MÓVIL | DNI | DIRECCIÓN`

**B. Sin receta (presencial)**
`NOMBRE DEL FÁRMACO | PRINCIPIO ACTIVO | FORMA FARMACÉUTICA | ESPECIE | FECHA VENTA | CADUCIDAD | LOTE | CÓDIGO NACIONAL | UNIDADES DISPENSADAS`

**C. Sin receta (online)** = B + `NOMBRE PROPIETARIO | MÓVIL | DNI | DIRECCIÓN` (todos obligatorios, D-07)

Columnas internas añadidas **al final** (o en hoja aparte `trazabilidad`, configurable): `ID DISPENSACIÓN | CANAL | TIPO RECETA | PLATAFORMA | SUSTITUCIÓN (S/N) | FORZADO (S/N) | DEFECTOS FORZADOS | MEDICAMENTO PRESCRITO (si sustitución) | AUTORIZADO POR | EMPLEADO | MÉTODO CAPTURA | ANULADA (S/N)`.

Notas: `PRINCIPIO ACTIVO` concatena todos con cantidad (`amoxicilina 200 mg; ácido clavulánico 50 mg`). `ESPECIE` en ventas sin receta: la que indica el cliente o, si no la indica, las especies de destino autorizadas del medicamento. Fechas `dd/mm/aaaa`.

### 4.9 Módulo de entradas (recepción de mercancía)
**Entidad `recepcion`** (agrupa un albarán/pedido): distribuidor (obligatorio, de maestro), nº de albarán (recomendado), fecha de compra (obligatoria, por defecto hoy), estado `ABIERTA → FINALIZADA → SINCRONIZADA | ERROR_SINCRONIZACION`.

**Línea de entrada — campos obligatorios:** unidades, nombre del fármaco, principio activo, forma farmacéutica, fecha de compra, caducidad, lote, código nacional, distribuidor. Opcionales: precio de compra unitario sin IVA, IVA aplicable, nº de serie (lista).

Flujo de captura (los dos caminos acaban en la misma validación):
- **Camino A (definido por JC):** el empleado escribe el nombre → autocompletado de presentaciones desde la caché CIMAVet (nombre + CN + laboratorio) → selecciona → escanea el envase → se rellenan lote/caducidad/CN desde el código → si el CN escaneado no coincide con el seleccionado → bloqueo con explicación → los campos que falten se piden.
- **Camino B (escaneo primero):** si el código trae un GTIN que resuelve a CN conocido, se preselecciona el medicamento y se pide confirmación.
- Principio activo y forma farmacéutica **siempre** salen de CIMAVet (no se teclean salvo producto no encontrado, que se marca `origen_datos = manual` y queda para revisión).
- Escanear varias veces el mismo lote suma unidades (deduplicando por nº de serie si existe). Caducidad < hoy + `ENTRY_MIN_SHELF_LIFE_DAYS` (por defecto 90) → AVISO.
- Se aceptan productos no medicamento (material de farmacia) con `tipo = producto`, sin validación CIMAVet.

**Finalización:** al pulsar "Finalizar recepción" se valida la completitud, se bloquea la edición y se encolan en el outbox los ajustes de stock en Siweb360 (si la política lo permite): `POST /inventory/stock/adjustments` con `mode=delta`, `quantity=+unidades`, `reason=purchase_receipt`,
`batch_number`, `expiry_date`, `warehouse_id` = almacén "Farmacia", `notes="MMX-REC-{id}-L{n}"`.

**Requisito previo:** el producto/variante debe existir en Siweb360 (la API no permite darlo de alta). Si un CN no tiene variante mapeada → la línea queda en `PENDIENTE_ALTA_SIWEB` y aparece en una lista de tareas "Dar de alta en Siweb360 y mapear", sin bloquear el resto de la recepción.

### 4.10 Precio de compra y precio de coste (opcional)
**D-11, resuelta:** la app **solo calcula el precio de coste**; los márgenes y el PVP los calcula JC en Siweb360. No hay tramos de margen ni PVP sugerido en esta app.
- Dato opcional en cada línea de entrada: **precio neto de compra unitario** (sin IVA, después de descuentos del albarán).
- `precio_coste = precio_neto_compra × (1 + RE%)`, con el RE según el tipo de IVA del producto, configurado en `config/rules/precios.v1.yaml`: IVA 10 % → RE 1,4 % (medicamentos veterinarios: `× 1,014`); IVA 21 % → 5,2 %; IVA 4 % → 0,5 % (editable). Por defecto IVA 10 % para medicamentos.
- Decimal exacto (`decimal.js`), redondeo a 4 decimales en almacenamiento y a 2 en pantalla.
- **La API de inventario de Siweb360 no documenta actualización de precios.** v1 genera el informe **"Precios de coste de la semana"** (producto, SKU, CN, lote, precio neto, RE, precio de coste, y precio de coste anterior si existía) para actualizarlo a mano en Siweb360. Si Siweb360 confirma un
  endpoint de precios, se añade como operación de outbox detrás del flag `SIWEB_PRICE_WRITE`.

### 4.11 Reportes
Job semanal (lunes 07:00 `Europe/Madrid`) y bajo demanda, en XLSX y CSV, guardados en Blob y enviados por correo al garante y a JC:
1. **Entradas de la semana** (por distribuidor, producto, lote, caducidad, unidades, coste si existe).
2. **Salidas de la semana** (plantillas A/B/C de 4.8).
3. **Sustituciones** (estado, tiempos, autorizador).
4. **Recetas no conformes** y motivos, y **dispensaciones forzadas** (defecto, motivo, empleado, estado de revisión del garante).
5. **Caducidades próximas** (≤ 90 días) desde los lotes de Siweb360.
5b. **Registro de psicótropos** (entradas, salidas y saldo por medicamento y lote).
6. **Discrepancias** de sincronización (outbox con error o en reconciliación).
7. **Precios de coste de la semana** (si hay precios de compra registrados), con variación respecto al coste anterior.

---

## 5. Integraciones

### 5.1 CIMAVet

#### 5.1.1 Cliente REST (`packages/cimavet`)
Base `https://cimavet.aemps.es/cimavet/rest/`. Respuestas JSON. Endpoints usados (de la especificación v1.4 aportada):

| Uso | Endpoint | Parámetros clave |
| --- | --- | --- |
| Búsqueda | `GET medicamentos` | `nombre`, `practiv1`, `idpractiv1`, `cn`, `nregistro`, `especie`/`idEspecie`, `comerc`, `sitadm`, `IdForma`, `idVia`, `tipoMed`, `dispensacion`, `pagina` |
| Detalle | `GET medicamento` | `cn` o `nregistro` |
| Presentaciones | `GET presentaciones` | `nregistro`, `cn`, `comerc` |
| Presentación | `GET presentacion/{cn}` | — |
| Notas de seguridad | `GET notas/{nregistro}` | — |
| Maestras | `GET maestras` | `maestra` (1 principios activos, 2 formas, 3 vías, 4 laboratorios, 5 ATC, 6 excipientes, 7 especies, 8 medicamentos, 9 interacciones, 10 contraindicaciones, 11 indicaciones, 12 reacciones adversas) |
| Delta | `GET/POST registroCambios` | `fecha` (dd/mm/yyyy), `nregistro` repetible; `tipoCambio` 1 alta, 2 baja, 3 modificado; `cambios` ⊂ {estado, comerc, prosp, ft, otros} |

Requisitos del cliente: *rate limit* propio (máx. 3 peticiones/s, configurable), reintentos con *backoff* exponencial y *jitter* en 5xx y timeouts, timeout 10 s, `User-Agent` identificable, paginación transparente con `pagina`, validación con zod tolerante a campos nuevos (`passthrough`) y guardado
del JSON crudo. Los nombres de campos de la doc tienen mayúsculas inconsistentes (`Comerc`/`comerc`, `Id`/`id`, `IdForma`): normalizar en el adaptador y cubrirlo con tests.

#### 5.1.2 Caché local
- **Carga inicial:** importador del **Nomenclátor Veterinario** (fichero `PrescripcionVET.xml` y anexos que aporte JC). La estructura cambió en julio de 2024 (los tiempos de espera incluyen `forma_via_admin` y `no_aplica_tejido`). **No inferir el esquema:** generar el parser a partir de la muestra
  real en `fixtures/nomenclator/` (y su XSD si existe), en *streaming* (SAX, p. ej. `saxes`), idempotente (upsert por `nregistro`/`cn`) y con informe de carga (registros nuevos/actualizados/descartados).
- **Sincronización incremental diaria** (job `cimavet-delta`, 06:30): `registroCambios?fecha=<última sincronización − 1 día>` → para cada `nregistro` cambiado, `GET medicamento?nregistro=` y `GET presentaciones?nregistro=` → upsert. Bajas (tipo 2) → marcar `estado` y no borrar.
- **Refresco completo semanal** (job `cimavet-full`, domingo 03:00): la "invalidación semanal" pedida. Recorre los `nregistro` en caché con antigüedad > 7 días y los refresca; reimporta maestras. Si se dispone de un Nomenclátor nuevo, puede usarse en su lugar.
- **Lectura con verificación en vivo** en el momento de dispensar (4.2.4).
- Cada fila guarda `fetched_at`, `source ∈ {nomenclator, api}` y `raw jsonb`.

### 5.2 Siweb360 (inventario)

#### 5.2.1 Cliente (`packages/siweb`)
Base `https://app.siweb360.com/api/public/`, `Authorization: Bearer <token>` (Key Vault). Endpoints:

| Uso | Endpoint |
| --- | --- |
| Productos | `GET inventory/products` (`search`, `brand`, `product_type`, `category_id`, `page`, `limit≤200`), `GET inventory/products/:id` |
| Variantes con stock | `GET inventory/variants` (`search` sobre SKU/nombre, `product_id`, `warehouse_id`, `with_stock`, `out_of_stock`, `low_stock`, `page`, `limit`) |
| Variante con desglose por almacén/ubicación/lote | `GET inventory/variants/:id` |
| Solo stock | `GET inventory/variants/:id/stock` (`total_on_hand`, `total_reserved`, `total_allocated`, `total_available`, `is_infinite_stock`, `levels[]`) |
| Lotes y caducidades | `GET inventory/variants/:id/lots` (`lot_code`, `expiry_date`; orden por creación) |
| Bajo mínimo | `GET inventory/stock/low` |
| Almacenes | `GET inventory/warehouses` |
| Ajuste | `POST inventory/stock/adjustments` (`variant_id`, `warehouse_id`, `quantity`, `mode` delta/set, `location_id`, `reason`, `notes`, `batch_number`, `expiry_date`) — 409 si stock ilimitado |
| Transferencia | `POST inventory/stock/transfers` |

`is_infinite_stock=true` → la variante no participa en FEFO ni recibe ajustes (AVISO de configuración).

**Almacén (D-12, resuelta):** hay un único almacén de medicamentos en Siweb360, llamado **"Farmacia"**, que se usa para entradas y ventas. Al arrancar, la app llama a `GET inventory/warehouses`, localiza el almacén cuyo nombre coincide con `SIWEB_WAREHOUSE_NAME` (por defecto `Farmacia`) y guarda su
id; si no lo encuentra, o encuentra más de uno, no arranca en prod. `SIWEB_WAREHOUSE_ID` permite fijarlo a mano. Se ignoran las ubicaciones (`location_id`) salvo que la API las devuelva, en cuyo caso se muestran como información en la propuesta FEFO.

#### 5.2.2 Mapeo CN ↔ variante
La API no expone un campo CN. Tabla `siweb_variant_map (cn, variant_id, product_id, sku, metodo auto_sku|auto_nombre|manual, verificado_por, verificado_at)`.

**Convención de JC (D-04, resuelta):** los SKU se están migrando progresivamente al formato `LABORATORIO-XXXX-CN{cn}` y el nombre del producto también incluye `CN{cn}`. Mientras dura la migración conviven SKU antiguos personalizados.
- Patrón configurable `SIWEB_SKU_CN_REGEX`, por defecto `CN(\d{6,7})$` (6 dígitos, o 7 con dígito de control; se compara normalizando a 6). Mismo patrón, sin anclar al final, para el nombre.

**Resolución CN → variante (en este orden):**
1. Tabla `siweb_variant_map` ya verificada → usar.
2. `GET inventory/variants?search=CN{cn}` → filtrar resultados cuyo SKU **o** nombre cumplan el patrón con ese CN exacto. Uno → mapeo automático (`auto_sku`) que se guarda sin confirmación. Varios → el empleado elige.
3. Si no hay coincidencia por CN: búsqueda por nombre del medicamento (CIMAVet) y laboratorio → hasta 5 candidatos ordenados por similitud. La UI dice claramente **"No se ha encontrado este medicamento por código nacional en Siweb360"** y ofrece:
    a) **Elegir uno de los candidatos**,
    b) **Introducir el SKU** del producto en Siweb360 (se valida que exista con `search`), o
    c) **Marcar "Hay que crearlo en Siweb360"**.
    En a) y b) se guarda el mapeo (`manual`) y, si el SKU o el nombre no siguen la convención, se pregunta: "¿Actualizar el SKU y el nombre en Siweb360?" mostrando la propuesta.
4. Un CN puede tener varias variantes (p. ej. duplicados): se admiten y se agregan para stock.

**Alta y edición de productos — limitación de la API:** la documentación de Inventario indica que *el alta y edición de productos, variantes y almacenes se hace desde la aplicación*; la API pública no lo permite. Por tanto:
- La app **genera la propuesta** (SKU con la convención, nombre con `CN{cn}`, laboratorio, precio sugerido si existe) y crea una **tarea** en la bandeja "Pendiente en Siweb360" (`siweb_tarea`: tipo `crear | renombrar`, CN, propuesta, estado, quién la resuelve), con un botón para copiar cada campo.
- La línea de recepción o el mapeo quedan en `PENDIENTE_ALTA_SIWEB` hasta que alguien marca la tarea como hecha; entonces la app revalida con el paso 2 y continúa (en recepciones, se encola el ajuste de stock pendiente).
- Puerto `SiwebCatalogWriter` con implementación `ManualTaskCatalogWriter` (v1). Si Siweb360 publica endpoints de alta/edición, se añade `ApiCatalogWriter` detrás del flag `SIWEB_CATALOG_WRITE=true` sin tocar el flujo. **TODO(decision D-04b)**.
- El prefijo `LABORATORIO` sale de un mapeo configurable `laboratorio_sku_prefijo (labtitular_cimavet → prefijo)`, que se completa la primera vez que aparece un laboratorio nuevo.
- **Segmento `XXXX` (D-04c, resuelta): correlativo por laboratorio**, 4 dígitos con ceros a la izquierda (`ZOETIS-0007-CN123456`). Cálculo del siguiente número:
  1. `GET inventory/variants?search={PREFIJO}-` (paginando) → extraer con `^{PREFIJO}-(\d{4})-` el máximo usado en Siweb360.
  2. Tomar también el máximo de los números **reservados** en `siweb_tarea` pendientes para ese prefijo.
  3. Siguiente = max(1, 2) + 1. Se **reserva** en una transacción (`laboratorio_sku_prefijo.ultimo_reservado` con bloqueo de fila) para que dos tareas simultáneas no propongan el mismo SKU.
  4. Al marcar la tarea como hecha, se revalida que el SKU existe en Siweb360 con ese valor exacto; si el empleado usó otro, se guarda el real y se avisa.
  - Si el SKU antiguo de un producto ya mapeado se renombra, se conserva el mismo `variant_id`: el mapeo no cambia.

#### 5.2.3 Lectura de stock
Lectura en vivo al evaluar una línea (no se cachea stock más de 60 s). Si Siweb360 no responde → la decisión queda en `PENDIENTE_STOCK` con opción de reintentar; nunca se recomienda dispensar sin confirmar stock.

#### 5.2.4 Política de escritura de stock (D-02 y D-03 resueltas)
- **Salidas (D-02, resuelta):** el TPV de Siweb360 descuenta el stock al confirmar el ticket y el empleado selecciona **manualmente el lote** que dispensa. Por tanto **este sistema nunca escribe salidas en Siweb360**: no hay ajustes `sale_shipment` desde aquí. El registro de salidas de esta app es el registro regulatorio; el movimiento de stock lo hace el ticket.
  - Consecuencia en el flujo: tras confirmar la dispensación, la UI muestra un recordatorio fijo "Cobrar en el TPV seleccionando el lote **{lote}**" con el lote, CN y unidades, y un botón para copiar el lote.
  - **Conciliación ticket ↔ dispensación (job `sales-reconciliation`, diario 21:00):** compara las dispensaciones del día con los movimientos de salida de Siweb360 por variante + lote + unidades. Detecta: dispensación sin ticket, ticket de medicamento sin dispensación registrada (venta fuera de la
    app), y **lote distinto** entre ticket y dispensación. Las discrepancias van a la bandeja del garante y al reporte semanal.
  - **Bloqueado por documentación:** la API de movimientos/tickets de Siweb360 no está en la documentación aportada (solo Inventario). Codex implementa el puerto `SalesMovementsSource`, el algoritmo de conciliación en `domain` con tests, y un adaptador `NotConfiguredSalesMovementsSource` que deja el
    job inactivo con un aviso. Cuando JC aporte la doc en `docs/ref/`, se implementa el adaptador real. **TODO(decision D-02b)**.
- **Entradas (D-03, resuelta):** hoy el stock entra **a mano** en Inventario de Siweb360, añadiendo lote y caducidad al producto; no se usa el módulo de Compras. Por tanto **esta app pasa a ser la única vía de entrada de stock de medicamentos**: al finalizar una recepción, el outbox crea un ajuste `purchase_receipt` por línea con `batch_number` y `expiry_date`.
  - **Corte operativo:** desde la fecha de puesta en marcha, el personal deja de dar entradas manuales de medicamentos en Siweb360 (si no, se duplican). La app muestra la fecha de corte en la pantalla de recepción y el reporte semanal incluye un control: movimientos de entrada en Siweb360 que no llevan la marca `MMX-REC-` en `notes` (requiere la API de movimientos, D-02b).
  - Productos que no son medicamento (accesorios, alimentación) siguen entrando como hasta ahora en Siweb360, salvo que se registren en la app como `tipo = producto`.

`SIWEB_STOCK_WRITE_MODE ∈ { off, entries_only }`: `off` en local y `dev`; `entries_only` en `prod` **solo tras pasar el *spike*** de la sección 12.3. El valor `entries_and_sales` se elimina.

#### 5.2.5 Outbox e idempotencia
- Tabla `outbox` con `operation`, `payload`, `idempotency_key` (`MMX-{entidad}-{id}-{n}`), `status ∈ {pending, sent, failed, needs_reconciliation}`, intentos y último error.
- La clave de idempotencia viaja en `notes` del ajuste. Como la API no permite consultar movimientos, ante un **timeout o respuesta ambigua** la operación pasa a `needs_reconciliation` (no se reintenta a ciegas) y aparece en la bandeja de administración con el stock actual de la variante para que una persona decida. Errores 4xx deterministas → `failed` con motivo.
- Dispatcher: job cada 5 minutos en horario comercial y disparo inmediato tras finalizar una recepción.

### 5.3 Extracción de recetas (`packages/extraction`)
Puerto en `domain`:
```ts
interface RecipeExtractor {
  extract(input: { pages: Buffer[]; mime: string; hints?: { channel?: string } }):
    Promise<ExtractionResult>; // campos con valor, confianza, evidencia, fuente; modelo y versión usados
}
```
Implementaciones:
1. `FakeRecipeExtractor`: devuelve el JSON esperado de `fixtures/recetas/*.expected.json` (tests y desarrollo sin coste).
2. `AzureRecipeExtractor`:
    - **Etapa 1:** Document Intelligence `prebuilt-layout` (texto impreso y manuscrito en español, palabras con confianza y polígonos, marcas de estilo manuscrito).
    - **Etapa 2:** Azure OpenAI (modelo multimodal desplegado en *Data Zone* UE; nombre de despliegue por configuración) con imagen + texto OCR y **structured outputs** contra el esquema JSON de receta (generado desde zod). Instrucciones: no inventar valores; `null` si no consta; devolver la cita
      literal de evidencia por campo; detectar presencia de firma manuscrita, sello, código QR/CSV de receta electrónica; separar líneas de medicamento.
    - Confianza final por campo = combinación de la confianza OCR de las palabras de la evidencia y la autoevaluación del modelo; si la evidencia citada no aparece en el OCR → confianza máxima 0,5.
    - Prompt versionado en `packages/extraction/prompts/receta.v1.md`; el `prompt_version` y el `model_deployment` se guardan con cada extracción.
3. **Banco de evaluación:** `pnpm eval:extraction` recorre `fixtures/recetas/` y calcula exactitud por campo (exacta y normalizada), tasa de campos bajo umbral y coste estimado. JC aporta 15–20 recetas reales anonimizadas de formatos distintos (manuscritas, impresas, talonario colegial, electrónicas impresas).

---

## 6. Modelo de datos (PostgreSQL)

Convenciones: `snake_case`, PK `uuid` (v7), `created_at/updated_at timestamptz`, `created_by` (id de usuario de Entra). Tablas de registro **sin UPDATE ni DELETE** para el rol de la aplicación (permisos a nivel de BD + trigger que lo impide).

**Caché CIMAVet**
- `cimavet_medicamento` (nregistro PK, nombre, nombre_norm, labtitular, receta bool, antibiotico, estupefaciente, psicotropo, tipo_medicamento_id, forma_id, administracion_id, dispensacion_id, estado jsonb, comerc, psum, ema, notas bool, primera_autorizacion date, raw jsonb, source, fetched_at)
- `cimavet_presentacion` (cn PK, nregistro FK, nombre, nombre_norm, comerc, estado jsonb, raw, fetched_at)
- `cimavet_med_principio_activo` (nregistro, pa_id, nombre, cantidad_raw, cantidad_valor numeric, unidad_raw, unidad_canonica, normalizable bool, orden)
- `cimavet_med_especie`, `cimavet_med_via`, `cimavet_med_atc`
- `cimavet_med_indicacion` (nregistro, indicacion_id, nombre, especie_id)
- `cimavet_med_tiempo_espera` (nregistro, especie_id, tejido, cantidad, unidad, forma_via_admin, no_aplica_tejido)
- `cimavet_nota` (nregistro, num, ref, asunto, fecha, url)
- `cimavet_maestra` (tipo, id, codigo, nombre) — PK (tipo, id)
- `cimavet_sync_run` (id, tipo nomenclator|delta|full|live, inicio, fin, contadores jsonb, error)
- Índices GIN trigram en `nombre_norm` de medicamento y presentación.

**Configuración y maestros**
- `regla_version` (id, nombre_fichero, hash, contenido jsonb, aprobada_por, aprobada_at, activa)
- `procedimiento_aprobado` (id, codigo p. ej. `SUSTITUCION`, version, texto, blob_path del documento firmado, aprobado_por, aprobado_at, vigente)
- `sustitucion_exclusion` (id, nregistro null, pa_id null, motivo, fuente, alta_por)
- `especie_id_individual` (especie_id, obligatorio bool)
- `plataforma_receta_electronica` (id, nombre, reconocida_mapa bool null, url_verificacion null, patrones_deteccion jsonb)
- `distribuidor` (id, nombre, cif, activo)
- `siweb_variant_map` (ver 5.2.2), `gtin_cn` (gtin, cn, confirmado_por, confirmado_at)
- `siweb_tarea` (id, tipo crear|renombrar, cn, nregistro, propuesta jsonb, origen recepcion_linea|mapeo|dispensacion, estado pendiente|hecha|descartada, creada_por, resuelta_por, resuelta_at)
- `laboratorio_sku_prefijo` (labtitular_cimavet PK, prefijo único, ultimo_reservado int)
- `usuario` (entra_oid PK, nombre, rol cache)

**Recetas y dispensación**
- `veterinario` (id, nombre, num_colegiado, colegio, telefono, email, clinica, direccion) — único (num_colegiado, colegio)
- `propietario` (id, nombre, movil, dni, direccion) — columnas personales **cifradas a nivel de aplicación** (AES-256-GCM, clave en Key Vault) + `dni_hash` para búsqueda
- `receta` (id, tipo papel|electronica, plataforma_id, id_plataforma, numero, fecha_emision, tipo_dispensacion, clase_prescripcion, tipo_tratamiento, veterinario_id, especie_id, especie_produccion bool, animal_identificacion, num_animales, rega, indicacion, decl_antimicrobianos jsonb,
  plazo_validez_declarado, validez_efectiva date, propietario_id null, firma_confirmada bool, talonario_colegial bool, estado, sha256, phash, extraccion jsonb, confirmacion jsonb, evaluacion jsonb, regla_version_id, creada_por)
- `receta_imagen` (receta_id, pagina, blob_path, mime, sha256)
- `receta_linea` (id, receta_id, orden, texto_medicamento, texto_principio_activo, forma_texto, concentracion_texto, cantidad_envases, formato_texto, unidades_max, posologia jsonb, duracion_dias, tiempo_espera_texto, nregistro null, cn_prescrito null, decision, motivos jsonb, estado)
- `dispensacion` (id, receta_linea_id null, canal presencial|online, con_receta bool, cn, nregistro, nombre_farmaco, principio_activo_txt, forma_txt, especie_txt, lote, caducidad, unidades, gtin, serial, metodo_captura scanner|camara|manual, lote_fefo_recomendado, motivo_lote_distinto,
  es_sustitucion bool, cn_prescrito, sustitucion_id null, cambio_formato bool, forzado bool, defectos_forzados text[], motivo_forzado, revisado_garante jsonb null, propietario_id null, referencia_pedido null, empleado, fecha_venta timestamptz, anulada_por null) — **append-only**
- `sustitucion` (id, receta_linea_id, cn_propuesto, equivalencia jsonb, consentimiento_tutor jsonb, aviso_veterinario jsonb, urgencia jsonb null, autorizacion jsonb, anotacion jsonb, estado, modo PRE|POST)
- `pedido_pendiente` (id, cn, nregistro, unidades, motivo, receta_linea_id null, contacto_tutor cifrado null, estado pendiente|recibido|entregado|cancelado)

**Entradas**
- `recepcion` (id, distribuidor_id, albaran, fecha_compra, estado, empleado, finalizada_at, sync_estado)
- `recepcion_linea` (id, recepcion_id, cn, nregistro, nombre_farmaco, principio_activo_txt, forma_txt, lote, caducidad, unidades, seriales text[], precio_neto_compra numeric null, iva_pct null, re_pct null, precio_coste numeric null, origen_datos cimavet|manual, siweb_variant_id null, estado) — **append-only tras finalizar**

**Infraestructura**
- `outbox` (ver 5.2.5)
- `audit_event` (id, at, actor, accion, entidad, entidad_id, antes jsonb, despues jsonb, ip, user_agent) — append-only, con `hash_prev` y `hash` encadenados para evidenciar manipulación
- `report_run` (id, tipo, periodo, blob_path, generado_at, enviado_a)

---

## 7. API del backend (resumen; OpenAPI generado)

Todas bajo `/api`, JSON, autenticación Entra, autorización por rol (sección 9.1).

| Método y ruta | Rol mínimo | Descripción |
| --- | --- | --- |
| `POST /recetas` (multipart) | empleado | Crea receta y sube imágenes; lanza extracción |
| `GET /recetas/:id` | empleado | Receta, extracción, confirmación, evaluación |
| `PUT /recetas/:id/confirmacion` | empleado | Guarda los campos confirmados por la persona |
| `POST /recetas/:id/evaluar` | empleado | Ejecuta reglas + resolución + stock → decisión por línea |
| `GET /medicamentos/buscar?q=&especie=&forma=` | empleado | Candidatos desde la caché |
| `GET /medicamentos/:nregistro` | empleado | Detalle (con verificación en vivo opcional) |
| `GET /medicamentos/:nregistro/equivalentes?especie=&indicacion=` | empleado | Equivalentes con estado de equivalencia y stock |
| `GET /stock/:cn/fefo?unidades=&duracionDias=` | empleado | Propuesta de lote(s) |
| `POST /scan/parse` | empleado | Parsea un código GS1 → GTIN, CN, lote, caducidad, serie |
| `POST /dispensaciones` | empleado | Confirma una dispensación (con o sin receta) |
| `POST /dispensaciones/:id/anular` | garante | Anulación con motivo (crea contramovimiento) |
| `POST /sustituciones/:id/{consentimiento,aviso-veterinario,autorizar,rechazar,anotacion,validar}` | empleado / garante según paso | Transiciones de estado |
| `POST /recepciones`, `POST /recepciones/:id/lineas`, `POST /recepciones/:id/finalizar` | empleado | Entradas |
| `GET /registros/salidas?desde=&hasta=&plantilla=A \| B \| C&formato=xlsx \| csv` | garante | Exportación |
| `GET /registros/entradas?...` | garante | Exportación |
| `GET /reportes`, `POST /reportes/:tipo/generar` | garante | Reportes |
| `GET/PUT /admin/mapeo-siweb`, `/admin/distribuidores`, `/admin/reglas`, `/admin/outbox` | admin / garante | Administración |
| `GET /health`, `GET /ready` | público | Sondas |

---

## 8. Frontend (pantallas)

1. **Inicio:** botones grandes "Receta", "Venta sin receta", "Pedido online", "Recepción de mercancía"; contador de pendientes (sustituciones, no conformes, outbox).
2. **Nueva receta:** cámara multipágina o subida; guía de encuadre; indicador de calidad (desenfoque/brillo) antes de enviar.
3. **Revisión de datos:** imagen ampliable + formulario por bloques (receta, veterinario, titular/animal, líneas). Campos dudosos resaltados; casilla de comprobación final.
4. **Resultado:** tarjeta por línea con estado (color + icono + texto), motivos legibles ("La receta caducó el 12/10/2026"), y la acción principal según el estado.
5. **Dispensación:** lote recomendado grande (lote, caducidad, ubicación), campo de escaneo con foco permanente, validación inmediata, botón "Confirmar dispensación". En sustitución, banda ámbar fija (4.4.3).
6. **Asistente de sustitución:** pasos con registro de consentimiento, aviso al veterinario (con texto generado para copiar), estado de la autorización del garante en tiempo real, etiqueta de anotación imprimible.
7. **Venta sin receta / Online:** escaneo → comprobación de no sujeto a prescripción → lote FEFO → datos de propietario si es online → confirmar.
8. **Recepción:** cabecera (distribuidor, albarán, fecha) + lista de líneas; buscador con autocompletado; escaneo; panel de datos faltantes; resumen y "Finalizar".
9. **Bandeja del garante:** pendientes por tipo, con aprobación/rechazo y comentario; MFA obligatorio.
10. **Registros y reportes:** filtros por fechas, plantilla, exportación.
11. **Administración:** mapeo CN↔Siweb360, distribuidores, reglas (solo lectura del YAML activo y su aprobación), exclusiones de sustitución, outbox y reconciliación, estado de sincronización CIMAVet y consumo mensual del asistente.
12. **Asistente de consultas:** botón «Preguntar» y panel lateral en cualquier pantalla (y «Preguntar sobre esta línea» en Resultado y Dispensación, sin quitar el foco del campo de escaneo al cerrarse); respuestas con fuentes citadas y su versión, tarjetas «Simulación» y «Resultado de la aplicación»
  pintadas desde el motor, valoración útil/incorrecta y página «Consultas al asistente» (cada persona ve las suyas; veterinaria responsable y administración, las de todos).

Requisitos transversales: textos en español y comprensibles para personal no técnico; objetivos táctiles ≥ 44 px; foco de teclado en el campo de escaneo; sonido distinto para escaneo correcto/incorrecto; sin pérdida de datos si se recarga (borrador en servidor); accesibilidad AA.

---

## 9. Seguridad, protección de datos y cumplimiento

### 9.1 Roles (app roles de Entra)
- `empleado`: captura, revisión, dispensación, recepciones.
- `farmaceutico_garante`: autorizaciones de sustitución, bandeja de no conformes, anulaciones, exportaciones, aprobación de versiones de reglas.
- `veterinaria_responsable`: lo mismo que empleado + lectura de registros e informes.
- `admin`: configuración técnica, mapeos, outbox. No puede autorizar sustituciones.
MFA obligatorio para `farmaceutico_garante` y `admin` (acceso condicional o, si no hay licencia, *security defaults*).

### 9.2 Datos personales (RGPD/LOPDGDD)
- Datos personales tratados: titular del animal (nombre, teléfono, DNI opcional, dirección) y veterinario prescriptor (datos profesionales). Las imágenes de recetas contienen ambos.
- Base jurídica principal: cumplimiento de obligación legal (custodia de recetas y registros). Minimización: DNI opcional en venta presencial y obligatorio en pedidos online (D-07; documentar la finalidad en el RAT); las exportaciones por defecto **excluyen** los datos del propietario salvo que se pidan expresamente.
- Cifrado en tránsito (TLS 1.2+) y en reposo (servicio) + cifrado de columnas del propietario a nivel de aplicación.
- **Retención:** recetas (imagen y datos) y registros de entradas/salidas **5 años**; después, job de purga/anonimización (`retention-sweep`, mensual). Inmutabilidad de Blob con retención temporal acorde.
- Encargados: Microsoft (Azure, incluidos Document Intelligence y el despliegue de chat de Azure OpenAI / Foundry del asistente de consultas, en la UE y sin uso de los datos para entrenamiento). Actualizar el Registro de Actividades de Tratamiento (RAT) con este tratamiento.
- No enviar datos personales a ningún servicio fuera de los declarados; no registrar datos personales en logs (redacción automática en el logger: DNI, teléfono, nombre de propietario).

### 9.3 Uso de IA
- La IA extrae datos de las recetas y, en el asistente de consultas, **explica** las reglas y el resultado que ya ha calculado el motor; las decisiones legales son siempre del motor determinista y de la persona. Se registra modelo, versión de prompt y resultado de cada extracción, y modelo, versión de instrucciones, fuentes y versión de reglas de cada respuesta del asistente.
- **Asistente de consultas** (ADR-17, `specs/002-prescription-chat-assistant/`): las reglas no están en el prompt (las lee de `config/rules`, la guía y la Ayuda mediante herramientas de solo lectura); los cálculos los hace `packages/domain`; al modelo no llega ningún dato del titular ni la identidad
  del veterinario (la pregunta se sanea antes de enviarla y de guardarla); las conversaciones se conservan **1 año** y se eliminan con `retention-sweep`; hay un límite mensual de tokens (aviso al 80 %, pausa al 100 %). Actualizar el RAT con esta finalidad.
- El personal ya dispone de la formación interna sobre uso de IA; añadir a la política interna un apartado para este sistema (fuera del código).

### 9.4 Auditoría
Todo cambio de estado relevante genera `audit_event` (quién, cuándo, antes/después). La cadena de hashes se verifica en el job semanal y cualquier ruptura genera alerta.

---

## 10. Infraestructura Azure

### 10.1 Recursos (Bicep, `infra/`)
- Grupo de recursos `rg-mmx-recetas-{env}` (`dev`, `prod`).
- **Log Analytics** con límite diario de ingesta (p. ej. 0,15 GB/día) + **Application Insights** (muestreo).
- **Container Apps Environment** (*workload profiles*, solo perfil Consumo) integrado en una **VNet** propia.
  - App `mmx-api`: 0,5 vCPU / 1 GiB, `minReplicas=0`, `maxReplicas=2`, escalado HTTP; autenticación integrada con Entra.
  - Jobs programados (cron en UTC, documentar equivalencia con hora de Madrid): `cimavet-delta`, `cimavet-full`, `outbox-dispatcher`, `weekly-reports`, `retention-sweep`; job manual `nomenclator-import`.
  - **Réplica caliente en horario comercial (D-08, resuelta):** regla de escalado `cron` (KEDA) que fija `minReplicas=1` de lunes a viernes de 10:15 a 20:15 y los sábados de 10:15 a 14:15, hora de Madrid (zona `Europe/Madrid` en la regla). Fuera de ese horario, `minReplicas=0`. En reposo la réplica se factura a tarifa reducida.
- **PostgreSQL Flexible Server** B1ms, PostgreSQL 16, 32 GB, acceso privado (subred delegada en la VNet), copias de seguridad 7–14 días, extensiones `pg_trgm`, `unaccent`, `pgcrypto`. Alerta de créditos de CPU bajos.
- **Storage Account** (StorageV2, LRS): contenedores `recetas` (inmutabilidad temporal 5 años + ciclo de vida Hot→Cool a 30 días→Cold a 180 días) y `reportes`.
- **Key Vault** (RBAC) con: token Siweb360, clave de cifrado de columnas, credenciales SMTP.
- **Managed Identity** de usuario asignada a la app y los jobs (acceso a Key Vault, Blob, Document Intelligence y Azure OpenAI con Entra, sin claves).
- **Document Intelligence** (nivel F0 para dev; S0 en prod si se supera el gratuito).
- **Azure OpenAI** con despliegue en *Data Zone* UE.
- **Correo:** SMTP de Google Workspace (cuenta de servicio) o Azure Communication Services Email; interfaz `Mailer` intercambiable.
- **Presupuesto y alertas de coste** en la suscripción (aviso al 50/80/100 % de un tope mensual configurable, p. ej. 40 €).

### 10.2 Coste orientativo (validar con la calculadora de Azure antes de desplegar)

| Recurso | €/mes aprox. |
| --- | --- |
| Container Apps (app + jobs) | 0–5 (dentro de la cuota gratuita en uso normal) |
| PostgreSQL B1ms + 32 GB | 0 los 12 primeros meses con cuenta gratuita elegible; después ≈ 15–20 |
| Blob Storage | < 1 |
| Document Intelligence | 0–3 |
| Azure OpenAI | 1–5 (céntimos por receta) |
| Key Vault, identidad, VNet | < 1 |
| Log Analytics / App Insights (con límite) | 0–3 |
| **Total** | **≈ 5–10 el primer año; ≈ 20–35 después** |

Comparativa: AKS Free tier no cobra el plano de control, pero el *system node pool* mínimo, sus discos, el balanceador y la IP pública ya superan este total antes de añadir la base de datos, y exige operar el clúster.

### 10.3 CI/CD
- `ci.yml`: en PR → lint, typecheck, tests (Testcontainers), build. En `main` → imagen a GHCR con tag `sha` + `azd deploy`/`az containerapp update` a `dev` con OIDC federado (sin secretos de larga duración). Promoción a `prod` manual con aprobación.
- Migraciones: job `db-migrate` ejecutado antes de activar la nueva revisión.

---

## 11. Observabilidad y operación
- Logs JSON estructurados (pino) con `request_id`, sin datos personales.
- Métricas: recetas procesadas, tiempo de extracción, % de campos bajo umbral, decisiones por tipo, sustituciones pendientes > 30 min, outbox en error/reconciliación, antigüedad de la última sincronización CIMAVet.
- Alertas: job de CIMAVet fallido 2 días seguidos; outbox `needs_reconciliation` > 0; sustitución `PRE` sin respuesta > 15 min; créditos de CPU de PostgreSQL bajos; ruptura de la cadena de auditoría.

---

## 12. Fase 0: entregables y criterios de aceptación

### 12.1 Entregables
1. Monorepo con la estructura de la sección 3, `pnpm i && pnpm dev` levanta API + web + PostgreSQL + Azurite con datos de ejemplo.
2. Esquema y migraciones de la sección 6, con *seed* de maestros (especies, formas, vías) desde fixtures.
3. `packages/domain` completo y **sin I/O**: validación de campos según YAML, validez temporal, motor de decisión, equivalencia, FEFO, cálculo del precio de coste con RE. Cobertura ≥ 90 % de líneas y ramas.
4. `packages/gs1` con tests de: GTIN-14 con y sin GS, caducidad con día `00`, lote al final y en medio, prefijos de simbología, sustituto de GS configurable, EAN-13 sin IA.
5. `packages/cimavet`: cliente con normalización de mayúsculas, paginación, reintentos y *rate limit*; tests contra fixtures. Importador del Nomenclátor generado **a partir de la muestra real** (si la muestra no está, dejar el esqueleto en *streaming* y un test pendiente `it.todo`).
6. `packages/siweb`: cliente completo de la sección 5.2.1 contra mocks MSW construidos con los ejemplos de la documentación; outbox con estados y política `SIWEB_STOCK_WRITE_MODE`.
7. `packages/extraction`: puerto, `FakeRecipeExtractor`, `AzureRecipeExtractor` (configurable por variables de entorno, desactivado si faltan) y `pnpm eval:extraction`.
8. UI navegable con datos falsos de los flujos: receta → revisión → resultado → dispensación; sustitución; venta sin receta; recepción; bandeja del garante; exportación de salidas A/B/C.
9. Bicep desplegable en `dev` (`az deployment group what-if` sin errores) y workflow de CI.
10. `docs/adr/` con las ADR de la sección 1 y `docs/scanner.md`.

### 12.2 Casos de prueba mínimos del dominio (deben existir y pasar)
- Receta de compañía completa, stock del CN → `DISPENSAR` con lote de caducidad más próxima no caducado.
- Mismo caso con el lote más próximo caducado → recomienda el siguiente.
- Lote que caduca antes del fin del tratamiento → AVISO y propuesta alternativa.
- Antimicrobiano emitido hace 6 días → `NO_CONFORME` (caducada).
- Antimicrobiano sin declaración art. 107 → `NO_CONFORME`.
- Receta "de botiquín" → `NO_CONFORME`.
- Solo principio activo → `NO_CONFORME` forzable + lista de opciones; forzado con medicamento no equivalente → rechazado.
- Defecto de forma forzado → dispensación con `forzado=true`, motivo obligatorio y entrada en la bandeja del garante.
- Intento de forzar un `BLOQUEANTE_DURO` (receta ya dispensada, online con receta) → rechazado por la API aunque la UI lo envíe.
- Envase caducado con `PRODUCT_VALIDITY_HARD_BLOCK=false` → forzable; con `true` → rechazado.
- Campo mal leído corregido a mano → reevaluación sin forzado y con traza valor extraído/corregido.
- Sin stock, excepcional → `PEDIR` (sin equivalentes evaluados).
- Sin stock, inmunológico → `PEDIR`.
- Sin stock, equivalente con misma composición, forma, vía, especie e indicación con stock → `SUSTITUIR`.
- Equivalente con distinta concentración / forma / especie → descartado con motivo.
- Prescrito amoxicilina 500 mg × 10; stock 250 mg × 10 → propone 2 envases (5.000 mg) con nota de administración; stock 1.000 mg → descartado (`CONCENTRACION_SUPERIOR`); 3 envases de 250 × 10 → descartado (`CANTIDAD_SUPERIOR`).
- Prescrito 500 mg; stock 200 mg → AVISO de dosis no ajustable con unidades enteras.
- Especie productora: equivalente con tiempo de espera mayor → descartado.
- Plazo declarado de 6 meses en tratamiento agudo → validez de 1 mes + AVISO.
- Duplicado (mismo nº receta y colegiado ya dispensado, papel) → `NO_CONFORME`.
- Pedido online con medicamento sujeto a receta → bloqueo.
- Pedido online sin DNI o con letra de control incorrecta → no se puede confirmar.
- Psicótropo con 2 envases prescritos → `BLOQUEANTE_DURO`; con 1 envase y receta de 20 días en tratamiento crónico → válida; de 35 días → caducada.
- Estupefaciente → `NO_CONFORME` no forzable.
- Escaneo con CN distinto al seleccionado → bloqueo; lote distinto al FEFO → AVISO con motivo.
- Unidades escaneadas > prescritas → bloqueo.
- Precio de coste: 10,00 € neto, IVA 10 % → RE 1,4 % → **10,14 €**; 10,00 € neto, IVA 21 % → **10,52 €**.

### 12.3 *Spike* previo a escribir stock en real (no lo ejecuta Codex; deja el script)
Script `apps/worker/src/spikes/siweb-write-check.ts`. Como solo existe el almacén "Farmacia" (D-12), se ejecuta sobre una **variante de prueba** creada a mano en Siweb360 (p. ej. SKU `TEST-0000-CN000000`, sin publicar en TPV ni web): lee el stock por lote, aplica un ajuste `+1` con lote
`TEST-AAAAMMDD` y caducidad, vuelve a leer, revierte con `-1` y muestra los resultados y el `movement` devuelto. Pide confirmación interactiva antes de escribir y se niega a ejecutarse si el SKU no empieza por `TEST-`. Valida que la escritura de entradas por lote funciona antes de pasar a
`entries_only`.

---

## 13. Decisiones (resueltas y pendientes)

| ID | Pregunta | Por defecto en el código | Quién decide |
| --- | --- | --- | --- |
| D-01 | ~~PRE o POST~~ **RESUELTA:** instrucción del garante → `POST` (solo sin alternativa en farmacia; receta apartada y firmada después). Guardar la instrucción firmada como evidencia | — | Farmacéutico garante |
| D-02 | ~~¿El TPV de Siweb360 descuenta stock al vender? ¿Por lote?~~ **RESUELTA:** sí, al confirmar el ticket, con lote seleccionado a mano por el empleado → la app no escribe salidas; concilia | — | JC |
| D-02b | Documentación de la API de movimientos/tickets de Siweb360 para la conciliación | Job de conciliación inactivo | JC (aportar doc) |
| D-03 | ~~¿Se registran las compras en el módulo de Compras de Siweb360?~~ **RESUELTA:** no; hoy entran a mano con lote y caducidad → la app es la única vía de entrada de medicamentos (`entries_only` en prod tras el *spike*), con fecha de corte | — | JC |
| D-04 | ~~Convención SKU~~ **RESUELTA:** `LABORATORIO-XXXX-CN{cn}` (migración progresiva) + `CN{cn}` en el nombre; búsqueda por CN, si no candidatos por nombre y el empleado elige, introduce SKU o pide alta | — | JC |
| D-04b | ¿Ofrece Siweb360 (u otra API suya) alta/edición de productos? | Tareas manuales en bandeja | JC (consultar a Siweb360) |
| D-04c | ~~Segmento `XXXX` del SKU~~ **RESUELTA:** correlativo de 4 dígitos por laboratorio, calculado sobre Siweb360 + reservas | — | JC |
| D-05 | ~~Recetas solo con principio activo~~ **RESUELTA:** cualquier defecto de forma → "No se puede dispensar" + defecto explicado; corrección manual si fue un fallo de lectura; forzado con aceptación de riesgos, motivo y revisión del garante (4.1.6) | — | JC |
| D-05b | ~~Bloqueos no forzables~~ **RESUELTA:** no forzables: receta ya dispensada, online con receta, estupefacientes, psicótropo con más de un envase, sustitución prohibida. "Producto no válido" forzable de momento | — | JC |
| D-05c | Cuándo pasar "producto no válido" a no forzable (`PRODUCT_VALIDITY_HARD_BLOCK=true`) | `false` | JC, al cerrar la normalización de SKU |
| D-06 | ~~Estupefacientes y psicótropos~~ **RESUELTA:** estupefacientes no (bloqueo duro); psicótropos sí, con 1 envase por receta, validez 1 mes, sin forzado y registro específico | — | JC |
| D-06b | Formato oficial del registro de psicótropos que debe llevar el establecimiento | Listado de entradas/salidas/saldo | Farmacéutico garante |
| D-07 | ~~DNI en pedidos online~~ **RESUELTA:** obligatorio, validado, cifrado y enmascarado; finalidad a documentar en el RAT | — | JC |
| D-08 | ~~Réplica caliente~~ **RESUELTA:** 1 réplica en horario comercial (L–V 10:15–20:15, S 10:15–14:15), cero el resto | — | JC |
| D-09 | ~~Cambio de formato~~ **RESUELTA:** otra presentación si concentración ≤ y cantidad total de principio activo ≤ la prescrita (4.3.1); nota de administración al tutor si cambia la concentración | — | JC |
| D-10 | ~~Dispensación parcial~~ **RESUELTA:** sí; receta retenida, líneas pendientes con pedido vinculado y resguardo al tutor | — | JC |
| D-10b | Confirmar con el garante que la entrega diferida de una receta retenida no requiere nueva validación de plazo | Se valida en la 1.ª dispensación | Farmacéutico garante |
| D-11 | ~~Fórmula de PVP~~ **RESUELTA:** la app solo calcula `precio de coste = precio neto × 1,014` (RE según IVA); márgenes y PVP se gestionan en Siweb360 | — | JC |
| D-12 | ~~Almacenes~~ **RESUELTA:** un único almacén "Farmacia" para entradas y ventas; su id se resuelve por nombre al arrancar | — | JC |
| D-13 | ~~Lector~~ **RESUELTA:** aún no hay lector → cámara de la tablet como vía principal en el arranque; requisitos de compra en `docs/scanner.md`. Pendiente: configurar `SCANNER_GS_SUBSTITUTE` cuando se compre | — | JC |
| D-14 | ~~Plataformas de receta electrónica~~ **RESUELTA:** semilla con GeneraRecetas, recetas.vet, Prescrivet y Recevet; marcar `reconocida_mapa` tras contrastar con el listado publicado por el MAPA | — | JC |

---

## Anexo A — Requisitos de la receta veterinaria (referencia normativa resumida)
Fuente: guía práctica de medicamentos veterinarios (texto aportado por JC), basada en el Reglamento (UE) 2019/6, el RD 666/2023 y el RD 1157/2021. El texto completo debe guardarse en `docs/ref/guia-receta-veterinaria.md`.

- La AEMPS fija si un medicamento requiere receta; se consulta en CIMAVet ("Sujeto/No sujeto a prescripción veterinaria").
- Receta válida en todo el territorio; en papel (original para el establecimiento dispensador, copia para el titular, copia para el veterinario; firma manuscrita si es impresa) o electrónica (plataformas reconocidas por el MAPA, sin homologación formal).
- Datos básicos: los de la tabla 4.1.2.
- Una receta puede incluir un animal o un grupo (misma especie y explotación o mismo propietario) y uno o varios medicamentos como único tratamiento.
- Cantidad: la mínima necesaria según el veterinario; sin máximo de envases salvo psicótropos (un envase por receta).
- Validez: tabla 4.1.3. La receta en papel permite **una única dispensación**; se retiene y custodia.
- Conservación de recetas (papel o archivo electrónico): **5 años**.
- Sustitución: solo por el farmacéutico, con conocimiento y conformidad del interesado y, salvo urgencia, del veterinario; condiciones de equivalencia de 4.4.2; prohibida en prescripción excepcional, por medicamento de uso humano, en inmunológicos/biológicos y en los de estrecho margen terapéutico
  determinados por la AEMPS con el MAPA; anotación al dorso (papel) o en el campo habilitado (electrónica).
