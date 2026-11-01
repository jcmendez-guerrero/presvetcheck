# Feature Specification: Corrección de las vulnerabilidades detectadas en GitHub

**Feature Branch**: `claude/github-code-vulnerabilities-0fb862`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "I need to solve the multiple vulnerabilities tht have been detected in the code in github"

## Contexto

A 2026-11-01 el repositorio `jcmendez-guerrero/presvetcheck` tiene abiertas en GitHub:

- **90 alertas de dependencias** (Dependabot): 2 críticas, 20 altas, 57 medias y 11 bajas, repartidas en 18 librerías (directas y transitivas). Muchas alertas se repiten porque la misma vulnerabilidad aparece en el fichero de bloqueo de versiones y en el manifiesto de cada paquete del monorepo.
- **7 alertas de análisis de código** (CodeQL), todas de gravedad alta y del mismo tipo: expresiones regulares que, ante un texto preparado a propósito, tardan un tiempo desproporcionado (denegación de servicio por expresiones regulares).
- **0 alertas de secretos expuestos**.

Resumen por librería afectada (alertas abiertas, gravedad máxima, versión mínima corregida):

| Librería | Uso en el sistema | Alertas | Máx. | Corrige desde | Origen |
|----------|-------------------|---------|------|---------------|--------|
| nodemailer | Envío de informes por correo | 40 | Alta | 10.1.4 | Directa (`packages/reports`) |
| undici | Cliente HTTP de los contenedores de prueba | 9 | Alta | 7.30.1 | Transitiva (pruebas de integración) |
| drizzle-orm | Acceso a la base de datos | 7 | Alta | 0.45.2 | Directa (api, worker, db, cimavet, siweb, reports) |
| @fastify/static | Servir la aplicación web desde la API | 8 | Alta | 10.1.2 | Directa (`apps/api`) |
| fast-uri | Validación de esquemas de la API | 8 | Media | 3.1.9 / 4.2.3 | Transitiva |
| @azure/msal-node | Autenticación con Azure (identidad gestionada) | 1 | Alta | 7.1.0 | Transitiva (`@azure/identity`) |
| tinypool | Ejecución de pruebas | 2 | **Crítica** | 2.1.2 | Transitiva (herramientas de prueba) |
| vitest / @vitest/mocker | Ejecución de pruebas | 4 | Media | 4.1.12 | Directa (desarrollo) |
| vite | Servidor de desarrollo y compilación web | 1 | Media | 6.4.5 | Directa (desarrollo) |
| esbuild | Compilación | 2 | Media | 0.28.1 | Transitiva |
| seroval | Enrutado de la aplicación web | 2 | Media | 1.6.11 | Transitiva (enrutador web) |
| yauzl | Descompresión del Nomenclátor de CIMAVet | 2 | Media | 3.2.1 | Directa (`packages/cimavet`, versión fijada) |
| uuid | Generación de identificadores | 1 | Media | 11.1.1 | Directa |
| minimatch, glob | Herramientas de compilación | 2 | Media | 11.0.1 / 14.0.2 | Transitivas |
| serialize-javascript | Compilación (minificado) | 1 | Baja | 7.1.3 | Transitiva |
| deepmerge | Compilación (resolución de módulos) | 1 | Baja | **Sin versión corregida** | Transitiva (solo compilación) |

Expresiones regulares señaladas por CodeQL (todas procesan texto que no controla el sistema):

| Ubicación | Qué procesa |
|-----------|-------------|
| `packages/domain/src/formato.ts:18` | Nombre comercial del medicamento (CIMAVet / receta) |
| `packages/domain/src/sku.ts:29` | Texto con el código nacional de un artículo |
| `packages/domain/src/unidades.ts:58` | Cantidad con unidad escrita en texto libre |
| `packages/extraction/src/borrador.ts:43` | Plazo de tratamiento leído de la receta |
| `packages/extraction/src/azure/reglas-layout.ts:201` y `:247` | Texto reconocido de la imagen de la receta (CN, nº de colegiado) |
| `packages/gs1/src/index.ts:116` | Lectura cruda del escáner de códigos GS1 |

## Clarifications

### Session 2026-11-01

- Q: ¿Las correcciones se entregan en un único PR o en varios PR separados por tipo? → A: 3 PR: (1) actualización de dependencias, (2) corrección de expresiones regulares, (3) prevención (configuración de Dependabot y comprobación en la integración continua).
- Q: ¿Qué vulnerabilidades deben hacer fallar la comprobación de la integración continua e impedir fusionar? → A: Altas y críticas en dependencias de ejecución, más críticas en dependencias de desarrollo y compilación; el resto solo avisa.
- Q: ¿Dónde se registran las excepciones (alertas descartadas sin corrección y versiones forzadas de dependencias transitivas)? → A: En una nueva ADR en `docs/adr/` con la política y la tabla de excepciones.
- Q: ¿Se corrigen solo las 7 expresiones regulares señaladas por CodeQL o se revisan todas las que procesan texto externo? → A: Las 7 señaladas más una revisión de todas las expresiones regulares de los paquetes que procesan texto externo (`domain`, `gs1`, `extraction`, `cimavet`, `siweb`), corrigiendo solo las que resulten vulnerables.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Eliminar las vulnerabilidades críticas y altas que afectan al sistema en producción (Priority: P1)

Como responsable del sistema, quiero que ninguna librería que se ejecuta en producción (API, *worker*, informes por correo, acceso a base de datos, autenticación con Azure, servido de la web) tenga vulnerabilidades conocidas de gravedad alta o crítica, para que un atacante no pueda leer ficheros del servidor, saltarse rutas protegidas, inyectar SQL, interceptar credenciales o desviar correos con datos de propietarios.

**Why this priority**: son las vulnerabilidades explotables en el entorno real. Algunas afectan directamente al principio III de la constitución (protección de datos personales): desvío de correos con informes a dominios no previstos, fuga de credenciales SMTP o de Azure, o lectura de ficheros del servidor.

**Independent Test**: tras aplicar solo esta historia, GitHub no muestra ninguna alerta de gravedad alta o crítica en dependencias de ejecución, y el envío de informes por correo, el inicio de sesión, la consulta y escritura en base de datos y la carga de la aplicación web siguen funcionando igual.

**Acceptance Scenarios**:

1. **Given** las alertas abiertas de nodemailer, drizzle-orm, @fastify/static y @azure/msal-node, **When** se actualizan a versiones corregidas, **Then** esas alertas se cierran automáticamente en GitHub.
2. **Given** un informe programado que se envía por correo, **When** se ejecuta tras la actualización, **Then** llega a los mismos destinatarios con el mismo contenido y adjuntos que antes.
3. **Given** una petición a la API con una ruta codificada o con `..` para salir de la carpeta pública, **When** se sirve la aplicación web, **Then** el servidor no entrega ningún fichero fuera de la carpeta pública ni se salta la protección de rutas.
4. **Given** el conjunto de pruebas del proyecto, **When** se ejecuta después de la actualización, **Then** lint, comprobación de tipos y pruebas pasan sin cambios en el comportamiento del dominio.

---

### User Story 2 - Corregir las expresiones regulares vulnerables a denegación de servicio (Priority: P1)

Como empleado que escanea códigos y procesa recetas, quiero que un texto anómalo (un código de barras corrupto, una imagen de receta mal reconocida o un nombre de medicamento muy largo) no bloquee la aplicación, para poder seguir atendiendo sin que el servidor deje de responder.

**Why this priority**: las 7 alertas son de gravedad alta, están en código propio (no se cierran actualizando librerías) y afectan a funciones del flujo principal receta → dispensación. Una sola entrada maliciosa puede dejar el servidor sin responder para todos los usuarios.

**Independent Test**: se puede probar por separado alimentando cada función afectada con textos patológicos largos (repeticiones de espacios, dígitos o separadores) y comprobando que responde en tiempo acotado, y que todos los casos de prueba existentes del dominio, GS1 y extracción dan el mismo resultado que antes.

**Acceptance Scenarios**:

1. **Given** un texto de 100 000 caracteres construido para provocar el peor caso de cada expresión, **When** se procesa con la función afectada, **Then** termina en menos de 1 segundo.
2. **Given** las tablas de casos existentes (incluidos los de `SPEC.md` §12.2 y los de GS1: GTIN-14 con y sin GS, caducidad con día `00`, lote al final y en medio), **When** se ejecutan tras el cambio, **Then** todas dan exactamente el mismo resultado.
3. **Given** la corrección aplicada, **When** CodeQL vuelve a analizar la rama principal, **Then** las 7 alertas quedan cerradas.
4. **Given** una expresión regular no señalada por CodeQL que la revisión identifica como vulnerable, **When** se corrige, **Then** cumple los mismos criterios de tiempo acotado y resultado idéntico que las 7 señaladas.

---

### User Story 3 - Eliminar las vulnerabilidades del entorno de desarrollo y compilación (Priority: P2)

Como desarrollador, quiero que las herramientas de prueba, compilación y servidor de desarrollo no tengan vulnerabilidades conocidas (incluidas las 2 críticas de ejecución remota de código en el ejecutor de pruebas), para que trabajar en el proyecto o ejecutar la integración continua no exponga mi equipo ni las credenciales del repositorio.

**Why this priority**: no afectan al sistema en producción, pero sí a la cadena de desarrollo e integración continua; las dos críticas permiten ejecución remota de código.

**Independent Test**: tras aplicar solo esta historia, GitHub no muestra alertas abiertas en dependencias de desarrollo, y `pnpm lint && pnpm typecheck && pnpm test`, la compilación de la web y las pruebas de extremo a extremo siguen pasando.

**Acceptance Scenarios**:

1. **Given** las alertas de tinypool, vitest, @vitest/mocker, vite, esbuild, undici, minimatch, glob y serialize-javascript, **When** se actualizan las herramientas, **Then** esas alertas se cierran en GitHub.
2. **Given** la suite completa de pruebas y la compilación de la web, **When** se ejecutan con las herramientas actualizadas, **Then** pasan con la misma cobertura que antes (dominio ≥ 90 % de líneas y ramas).

---

### User Story 4 - Resolver las vulnerabilidades medias y bajas restantes y documentar las no corregibles (Priority: P2)

Como responsable del sistema, quiero que no quede ninguna alerta abierta sin decisión: o se corrige, o se descarta en GitHub con una justificación escrita y revisable.

**Why this priority**: deja el panel de seguridad limpio, de modo que una alerta nueva sea visible al instante en lugar de perderse entre 90 antiguas.

**Independent Test**: el panel de seguridad de GitHub muestra 0 alertas abiertas; cada alerta descartada tiene un motivo registrado.

**Acceptance Scenarios**:

1. **Given** las alertas medias y bajas de fast-uri, seroval, yauzl y uuid, **When** se actualizan, **Then** se cierran en GitHub.
2. **Given** la alerta de deepmerge, que no tiene versión corregida y solo se usa al compilar, **When** se revisa, **Then** se descarta en GitHub con el motivo "riesgo tolerable: solo en compilación, no procesa datos externos" y queda registrada en la tabla de excepciones de la ADR de seguridad de dependencias para revisarla cuando haya versión corregida.
3. **Given** la descompresión del Nomenclátor de CIMAVet con yauzl actualizado, **When** se importa el fichero de muestra, **Then** el resultado de la importación es idéntico al anterior.

---

### User Story 5 - Evitar que las vulnerabilidades se vuelvan a acumular (Priority: P3)

Como responsable del sistema, quiero que las nuevas vulnerabilidades se detecten y propongan para corrección de forma automática y temprana, para no volver a encontrarme con decenas de alertas acumuladas.

**Why this priority**: es preventiva; aporta valor a medio plazo, pero no corrige nada de lo que hay hoy.

**Independent Test**: al introducir en una rama de prueba una versión conocida como vulnerable de una dependencia de ejecución, la integración continua lo señala antes de fusionar.

**Acceptance Scenarios**:

1. **Given** una dependencia con actualización de seguridad disponible, **When** GitHub la detecta, **Then** se abre automáticamente una propuesta de actualización agrupada para el monorepo.
2. **Given** un cambio que introduce una vulnerabilidad alta o crítica en una dependencia de ejecución, **When** se ejecuta la integración continua, **Then** la comprobación falla e impide fusionar hasta que se corrija o se justifique.
3. **Given** un cambio que introduce una vulnerabilidad crítica en una herramienta de desarrollo o prueba, **When** se ejecuta la integración continua, **Then** la comprobación también falla.
4. **Given** un cambio que introduce una vulnerabilidad media o baja, o alta en una herramienta de desarrollo, **When** se ejecuta la integración continua, **Then** la comprobación muestra un aviso pero permite fusionar.

---

### Edge Cases

- **Saltos de versión mayor** (nodemailer 7 → 10, @fastify/static 8 → 10, vitest 3 → 4): pueden cambiar la forma de configurar o usar la librería. El comportamiento visible (correos, ficheros servidos, pruebas) debe mantenerse; cualquier ajuste de configuración se recoge en `.env.example` si afecta a variables de entorno.
- **Dependencias transitivas sin actualización del paquete padre** (p. ej. undici a través de los contenedores de prueba, msal-node a través de `@azure/identity`, fast-uri a través de fastify): si el paquete padre no publica una versión que incluya la corrección, se fuerza la versión corregida desde la raíz del monorepo y se documenta el motivo.
- **Dependencias sin corrección publicada o alcanzable** (deepmerge; glob 7 y minimatch 5 vía exceljs → archiver 5, cuya API es incompatible con las versiones corregidas): se descarta la alerta con justificación y se deja anotada para revisar; no se sustituye la librería salvo que el código vulnerable se alcance con datos externos.
- **Cambio en la detección de dominios de correo de nodemailer**: las correcciones hacen más estricta la interpretación de direcciones; una dirección de destinatario mal formada que antes "funcionaba" podría ser rechazada. Se debe comprobar que las direcciones configuradas para informes siguen siendo válidas.
- **Expresiones regulares con resultados ligeramente distintos**: si la reescritura de una expresión cambia el resultado para alguna entrada válida conocida, se trata como regresión, no como mejora.
- **Versión de Node.js**: el repositorio exige Node 22; las actualizaciones no deben exigir una versión distinta de la declarada.
- **Migraciones de base de datos**: la actualización de drizzle-orm no debe generar migraciones nuevas ni alterar el esquema existente.
- **Alertas que reaparecen**: si al actualizar se introduce otra versión vulnerable de una dependencia transitiva, se trata dentro de este mismo trabajo.

## Requirements *(mandatory)*

### Functional Requirements

**Dependencias de ejecución (producción)**

- **FR-001**: El sistema MUST usar versiones de nodemailer, drizzle-orm, @fastify/static, @azure/msal-node, fast-uri, seroval, yauzl y uuid iguales o posteriores a la primera versión corregida indicada en el Contexto.
- **FR-002**: El envío de informes por correo MUST mantener los mismos destinatarios, asunto, cuerpo y adjuntos que antes de la actualización, y MUST seguir negándose a leer ficheros locales o URL arbitrarias al construir el mensaje.
- **FR-003**: El servido de la aplicación web desde la API MUST rechazar cualquier ruta que intente salir de la carpeta pública (rutas con `..`, separadores codificados o rutas no canónicas) y MUST NOT ofrecer listados de directorios.
- **FR-004**: El acceso a datos MUST seguir funcionando sin cambios en el esquema ni nuevas migraciones tras actualizar drizzle-orm.
- **FR-005**: La autenticación con Azure MUST seguir usando identidad gestionada, sin introducir claves de acceso estáticas (principio III).

**Código propio (expresiones regulares)**

- **FR-006**: Las funciones de `formato.ts`, `sku.ts`, `unidades.ts`, `borrador.ts`, `reglas-layout.ts` y `gs1/index.ts` señaladas por CodeQL MUST procesar cualquier texto de entrada en un tiempo que crece de forma lineal con su longitud.
- **FR-006a**: Todas las demás expresiones regulares de `packages/domain`, `packages/gs1`, `packages/extraction`, `packages/cimavet` y `packages/siweb` que se apliquen a texto externo (escáner, reconocimiento de imagen, CIMAVet, Siweb360, entrada del usuario) MUST revisarse; las que resulten vulnerables a tiempo desproporcionado MUST corregirse con los mismos requisitos FR-006 a FR-008. El resultado de la revisión (expresiones revisadas y cuáles se corrigieron) MUST constar en la descripción del PR de expresiones regulares.
- **FR-007**: Esas funciones MUST devolver exactamente el mismo resultado que hoy para todas las entradas válidas cubiertas por las pruebas existentes.
- **FR-008**: Cada función corregida MUST tener al menos un caso de prueba nuevo con una entrada patológica larga que verifique el tiempo acotado.
- **FR-009**: Las correcciones del dominio MUST mantener la pureza de `packages/domain` (sin I/O ni reloj del sistema) y la cobertura ≥ 90 % de líneas y ramas.

**Dependencias de desarrollo y compilación**

- **FR-010**: Las herramientas de prueba, compilación y desarrollo (tinypool, vitest, @vitest/mocker, vite, esbuild, undici, minimatch, glob, serialize-javascript) MUST estar en versiones iguales o posteriores a la primera versión corregida.
- **FR-011**: `pnpm lint && pnpm typecheck && pnpm test` MUST pasar; `pnpm test:int` MUST pasar porque se tocan dependencias usadas por las pruebas de integración.

**Gestión de alertas**

- **FR-012**: Toda alerta sin versión corregida alcanzable sin sustituir una librería (hoy deepmerge; posiblemente las copias antiguas de glob y minimatch que arrastra exceljs) y cuyo código vulnerable no se alcance con datos externos MUST descartarse en GitHub con un motivo escrito y registrarse en la tabla de excepciones de la ADR de seguridad de dependencias (`docs/adr/0016-…`), con fecha, responsable y condición de revisión.
- **FR-013**: Cuando una dependencia transitiva se fuerce a una versión concreta desde la raíz del monorepo, MUST registrarse en la misma tabla de excepciones de esa ADR, con el motivo y la condición para retirar ese forzado.
- **FR-013a**: Esa ADR MUST recoger también la política de bloqueo de la integración continua (FR-016) y MUST actualizarse en el mismo PR que añada, cambie o retire una excepción.
- **FR-014**: Al terminar, el panel de seguridad de GitHub MUST mostrar 0 alertas abiertas de dependencias y 0 de análisis de código en la rama principal.

**Prevención**

- **FR-015**: El repositorio MUST tener configuradas propuestas automáticas de actualización de seguridad, agrupadas para el monorepo, para las dependencias de npm y de los *workflows* de GitHub Actions.
- **FR-016**: La integración continua MUST fallar cuando un cambio introduzca una vulnerabilidad conocida de gravedad alta o crítica en una dependencia de ejecución, o de gravedad crítica en una dependencia de desarrollo o compilación. Las vulnerabilidades altas de desarrollo y todas las medias y bajas MUST mostrarse como aviso sin bloquear. La comprobación no llama a servicios reales (CIMAVet, Siweb360, Azure).

**Trazabilidad y forma de entrega**

- **FR-017**: Los cambios MUST entregarse en 3 PR independientes, cada uno revisable y revertible por separado: (1) actualización de dependencias (User Stories 1, 3 y 4, incluido el descarte documentado de deepmerge), (2) corrección de expresiones regulares (User Story 2) y (3) prevención (User Story 5). Los commits siguen Conventional Commits (`fix(deps): …`, `fix(seguridad): …`, `ci: …`).
- **FR-018**: Ninguna prueba ni comprobación nueva MUST registrar datos personales del propietario en logs ni mensajes de error (principio III).

### Key Entities

- **Alerta de seguridad**: aviso de GitHub sobre una vulnerabilidad. Atributos: número, origen (dependencias o análisis de código), gravedad, librería o fichero afectado, versión corregida, estado (abierta, corregida, descartada) y motivo de descarte.
- **Dependencia**: librería usada por el sistema. Atributos: nombre, versión actual, versión mínima segura, tipo (directa o transitiva), ámbito (ejecución o desarrollo) y paquetes del monorepo que la usan.
- **Excepción documentada**: decisión de no corregir o de forzar una versión. Atributos: alerta o dependencia, motivo, fecha, responsable y condición de revisión.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El número de alertas de seguridad abiertas en GitHub pasa de 97 (90 de dependencias + 7 de código) a 0. Solo se descartan con justificación las alertas que cumplen FR-012: sin versión corregida alcanzable sin sustituir una librería, y con el código vulnerable no alcanzable con datos externos. Se prevé deepmerge y, si los forzados de versión no son compatibles, las copias antiguas de glob y minimatch que arrastra exceljs.
- **SC-002**: 0 alertas críticas o altas abiertas en cualquier ámbito al terminar la User Story 1, la 2 y la 3.
- **SC-003**: El 100 % de los casos de prueba existentes (dominio, GS1, extracción, CIMAVet, Siweb360, informes, API y extremo a extremo) pasan sin modificar sus resultados esperados.
- **SC-004**: Cada función con expresiones corregidas (las 7 señaladas y las que añada la revisión de FR-006a) procesa una entrada patológica de 100 000 caracteres en menos de 1 segundo.
- **SC-005**: Los empleados no perciben ningún cambio en los flujos de receta → dispensación, recepción, informes por correo y exportaciones.
- **SC-006**: En los 3 meses siguientes, cualquier vulnerabilidad nueva alta o crítica en una dependencia de ejecución genera una propuesta de corrección en menos de 1 semana desde que GitHub la publica.

## Assumptions

- Las alertas consultadas el 2026-11-01 son el alcance de este trabajo; si aparecen nuevas mientras se implementa, se incluyen si afectan a las mismas librerías.
- Se acepta subir de versión mayor nodemailer, @fastify/static y vitest, siempre que el comportamiento visible se mantenga; no se busca sustituir ninguna de estas librerías por otra (principio I: no añadir dependencias pesadas sin justificación).
- deepmerge solo se usa durante la compilación (lo trae el plugin de resolución de módulos del empaquetador) y no procesa datos externos, por lo que descartar su alerta con justificación es un riesgo tolerable.
- undici solo llega al sistema a través de la librería de contenedores para pruebas de integración; @azure/msal-node llega a través de `@azure/identity`; seroval a través del enrutador web; tinypool a través del ejecutor de pruebas.
- Para la prevención (User Story 5) se usan las funciones de seguridad que ya ofrece GitHub (Dependabot y CodeQL, ya activos en el repositorio), sin servicios de terceros de pago.
- La comprobación de la integración continua bloquea las vulnerabilidades altas y críticas de ejecución y las críticas de desarrollo (FR-016); el resto se avisa sin bloquear, para no frenar el trabajo diario.
- El entorno de desarrollo usado para implementar dispone de Node 22, como exige el repositorio (el equipo local tiene hoy Node 20 y debe actualizarse antes de implementar).
- Este trabajo es de mantenimiento transversal y no corresponde a un bloque concreto de `SPEC.md` §12.1; se entrega en los 3 PR de FR-017, sin mezclar funcionalidades.
