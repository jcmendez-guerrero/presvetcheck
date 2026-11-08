# Research: Integración y sincronización de veterinarios y clínicas con SiWeb (ERP)

**Feature**: `006-siweb-vet-clinic-sync` | **Date**: 2026-11-06

---

## 1. Contexto y objetivos

En la atención y registro de recetas veterinarias en mostrador, el personal debe transcribir o confirmar los datos del veterinario prescriptor (nombre, número de colegiado, colegio oficial/provincia, teléfono, correo) y de la clínica (nombre comercial, CIF, dirección completa).

Actualmente:

- SiWeb360 dispone de un catálogo de contactos (`/api/public/contacts`) donde constan clientes y proveedores, pero la aplicación PresVetCheck no consulta este catálogo al registrar recetas.
- El esquema nativo de contactos de SiWeb360 no incluye campos específicos para el número de colegiado (`numColegiado`), colegio oficial ni especialidad facultativa.
- El usuario solicitó explícitamente:
  > _"In the contacts api we can add in the notes a json or something that you can read from the API to identify the Licence of the vet or other data that can't enter in the other fields of the API"_

Objetivo:

1. Conectar la interfaz de revisión y registro de recetas con el catálogo de contactos de SiWeb360 para autocompletar la información con un clic.
2. Definir un formato estructurado en el campo `notas` de SiWeb para almacenar y recuperar de forma fiable los atributos regulatorios veterinarios (licencia/número de colegiado, colegio oficial, clínica vinculada).
3. Permitir dar de alta en SiWeb a un veterinario o clínica cuando no exista previamente, con un solo clic o confirmación durante el flujo de registro.
4. Garantizar tolerancia a fallos: la indisponibilidad de SiWeb nunca debe bloquear la dispensación ni el registro en el mostrador.

---

## 2. Decisiones técnicas

### Decisión 1: Convención de serialización en el campo `notas` de SiWeb360

**Problema**: El campo `notas` en SiWeb puede contener texto libre humano introducido por administración o ventas (ej. _"Contactar en horario de mañana"_ o _"Cliente preferente"_). Si sobreescribimos todo el campo con un JSON ciego, destruiríamos información de negocio previa.

**Solución**:
Utilizar un delimitador estándar que aísle el bloque estructurado de metadatos:

```text
Notas comerciales existentes del contacto...

---PRESVET---
{"version":1,"tipo":"veterinario","numColegiado":"28/1234","colegio":"Madrid","clinica":"Clínica Vet Norte"}
```

**Estrategia de lectura**:

1. Si el texto de `notas` contiene el delimitador `---PRESVET---`, se toma el texto posterior y se procesa con `JSON.parse`.
2. Si no contiene el delimitador pero el texto completo es un JSON válido que incluye campos como `numColegiado`, se procesa directamente.
3. Si no contiene JSON válido ni delimitador, se utiliza el contacto con sus datos estándar (nombre, teléfono, email, dirección) y se permite la introducción manual de `numColegiado` sin error.

**Estrategia de escritura**:

1. Si ya existen notas, se retira cualquier bloque anterior `---PRESVET---` manteniendo el texto libre previo.
2. Se añade el delimitador `---PRESVET---` seguido del JSON serializado con los datos veterinarios normalizados.

### Decisión 2: Endpoints en la API (`apps/api`) y extensión de `packages/siweb`

**Problema**: `packages/siweb` actualmente solo expone el método `proveedores(search)`. Necesitamos buscar tanto clientes como proveedores, obtener el detalle de un contacto específico (con sus notas y dirección completa) y permitir el alta de contactos.

**Solución**:

1. Ampliar `SiwebClient` en `packages/siweb`:
   - `contactos(filtros: { search?: string; tipo?: 'cliente' | 'proveedor'; limit?: number })`: lista contactos coincidentes.
   - `contacto(id: number)`: obtiene el contacto completo (incluyendo `cif`, `direccion`, `notas`, etc.).
   - `crearContacto(body: CreateContactRequest)`: envía `POST /api/public/contacts`.
   - `actualizarContacto(id: number, body: UpdateContactRequest)`: envía `PUT /api/public/contacts/{id}`.
2. Nuevas rutas en `apps/api/src/rutas/contactos-siweb.ts`:
   - `GET /api/contactos-siweb`: búsqueda rápida con debounce para el autocompletado en el frontend. Devuelve la lista de contactos enriquecida con los metadatos de veterinario parseados de las notas.
   - `GET /api/contactos-siweb/:id`: detalle completo de un contacto con sus metadatos veterinarios decodificados.
   - `POST /api/contactos-siweb`: alta de un nuevo contacto en SiWeb con sus metadatos veterinarios en `notas`.
   - `POST /api/recetas/:id/sincronizar-contacto`: acción directa para crear en SiWeb el veterinario o clínica de una receta ya registrada o en curso.

### Decisión 3: Interfaz de usuario y flujo en `apps/web`

**Problema**: El formulario de receta tiene campos de veterinario en dos tarjetas: la comprobación inicial en `Tarjeta "Veterinario"` (con `Nº de colegiado`) y los datos detallados en `DatosRegistro` (nombre, colegio, teléfono, email, clínica, dirección). El usuario necesita una forma fluida de aplicar datos sin fricción.

**Solución**:

1. **Componente de sugerencia y búsqueda contextual (`SelectorContactoSiweb`)**:
   - En la tarjeta de veterinario y en la sección de datos del registro, se añade un selector/buscador asistido.
   - Cuando hay texto en el nombre o en el número de colegiado (ya sea tecleado o extraído por OCR), busca automáticamente coincidencias en SiWeb.
   - Si encuentra coincidencia, muestra un aviso amigable: _"Contacto encontrado en SiWeb: Dr. [Nombre] (Col. [Nº], [Localidad]) [Autocompletar formulario]"_.
2. **Acción de alta con un clic**:
   - Si el veterinario no existe en SiWeb, se muestra una etiqueta informativa _"No registrado en SiWeb"_ con un botón `[+ Dar de alta en SiWeb]`.
   - Al pulsar el botón, se abre una confirmación rápida donde se revisan los datos antes de enviar la creación a SiWeb, o se programa para creación automática tras confirmar la receta.

### Decisión 4: Protección de datos personales (PII)

**Restricción estricta (Constitución, Principio III)**:
Bajo ningún concepto se enviarán a SiWeb datos del tutor/propietario del animal (nombre, teléfono personal, DNI, domicilio del tutor).
El contacto creado en SiWeb corresponde exclusivamente a la persona facultativa (veterinario prescriptor) o al centro de trabajo (clínica veterinaria) con fines profesionales y de facturación/relación comercial.

---

## 3. Riesgos mitigados

| Riesgo                                           | Mitigación                                                                                                                        |
| :----------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| SiWeb no está disponible o responde con lentitud | Búsqueda asíncrona no bloqueante; si falla o no responde, el formulario permite continuar con la entrada manual sin interrupción. |
| Notas con texto humano previo son sobreescritas  | El formateador delimita el bloque `---PRESVET---` y concatena respetando el texto previo.                                         |
| Datos duplicados de contactos en SiWeb           | La búsqueda previa permite desambiguar antes de crear; el usuario ve las coincidencias existentes antes de confirmar un alta.     |
| Caracteres especiales o JSON corrupto en `notas` | Parser seguro con bloque `try/catch` que recurre a valores por defecto y no lanza excepciones a la interfaz.                      |
