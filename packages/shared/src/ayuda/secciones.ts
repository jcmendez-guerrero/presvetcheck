/**
 * Contenido de la Ayuda como datos: lo pinta la web (apps/web/src/paginas/ayuda.tsx) y lo indexa el asistente de
 * consultas para citarlo. Describe el comportamiento de la app; las reglas legales están en el motor de reglas,
 * no aquí.
 */
export type Inline = string | { b: string };
export type Bloque = { p: Inline[] } | { lista: Inline[][] };
export interface SeccionAyuda {
  id: string;
  titulo: string;
  bloques: Bloque[];
}

export const SECCIONES_AYUDA: SeccionAyuda[] = [
  {
    id: 'empezar',
    titulo: 'Empezar: sesión, perfiles y móvil',
    bloques: [
      {
        p: [
          'Se entra con la cuenta de Microsoft de la farmacia. Arriba a la derecha está tu nombre y ',
          { b: 'Cerrar sesión' },
          ' (también desconecta el móvil emparejado).',
        ],
      },
      {
        lista: [
          [{ b: 'Empleado/a' }, ': recetas, ventas, recepciones, pendientes y registros.'],
          [{ b: 'Veterinaria responsable' }, ': lo mismo y, además, importar datos anteriores.'],
          [
            { b: 'Administración' },
            ': configuración (distribuidores, mapeo con Siweb360, reglas…). No participa en la operativa.',
          ],
        ],
      },
      {
        p: [
          { b: 'Móvil' },
          ' (barra azul): enseña un código QR. Léelo con la cámara del móvil y desde él podrás fotografiar recetas y leer los códigos de los envases; todo llega a la pantalla del ordenador. El emparejamiento caduca solo y no debe compartirse.',
        ],
      },
    ],
  },
  {
    id: 'inicio',
    titulo: 'Inicio',
    bloques: [
      { p: ['Accesos directos a las tareas del día:'] },
      {
        lista: [
          [{ b: 'Receta' }, ': dispensar con receta veterinaria.'],
          [
            { b: 'Venta sin receta' },
            ' y ',
            { b: 'Pedido online' },
            ': medicamentos que no necesitan receta (se registran como salida sin receta, presencial u online).',
          ],
          [{ b: 'Recepción de mercancía' }, ': dar entrada a lo que llega de los distribuidores.'],
        ],
      },
      {
        p: [
          'Debajo, los contadores: sustituciones pendientes, discrepancias con el TPV, recetas no conformes e incidencias de sincronización. Si hay recetas dispensadas con el registro por completar, sale un aviso con el enlace.',
        ],
      },
    ],
  },
  {
    id: 'receta',
    titulo: 'Receta: foto y lectura automática',
    bloques: [
      {
        p: [
          'Haz una foto de la receta entera (o sube un PDF), sobre fondo liso y con buena luz; si tiene varias páginas, añádelas todas. También puede hacerse desde el móvil emparejado. Mientras se prepara la foto verás «Procesando la foto…»: espera a que termine antes de hacer otra.',
        ],
      },
      {
        p: [
          'La app lee la receta con Document Intelligence y rellena los datos. Los campos marcados ',
          { b: 'Revisar' },
          ' se han leído con poca seguridad o no se han encontrado. Si la lectura falla, se pueden escribir a mano.',
        ],
      },
    ],
  },
  {
    id: 'revision',
    titulo: 'Revisión de la receta',
    bloques: [
      { p: ['Se comprueba cada dato con la receta original, que se ve a la izquierda (con zoom).'] },
      {
        lista: [
          [
            { b: 'Medicamento' },
            ': el buscador de CIMAVet está arriba de cada medicamento. Lo que escribes ahí rellena también el nombre «como pone la receta». Elige siempre la presentación exacta: la app nunca elige sola. Mientras busca verás «Buscando en CIMAVet…». Si el medicamento no aparece en CIMAVet (no figura entre los veterinarios) puede ser de uso humano: la app no deja dispensarlo y hay que revisarlo con el farmacéutico garante.',
          ],
          [
            { b: 'Stock' },
            ': al elegir el medicamento se ve cuánto hay en la farmacia (Siweb360) y el lote a usar. Si no se puede validar el stock (el código nacional no está relacionado con ningún producto de Siweb360), indica el producto: elige uno de los parecidos o escribe su SKU. La relación queda guardada para las próximas veces. Si el SKU o el nombre en Siweb360 no llevan el código nacional, puedes crear una tarea para renombrarlo (Siweb360 no permite cambiarlo desde la app).',
          ],
          [
            { b: 'Veterinario' },
            ': nº de colegiado, nombre, colegio, teléfono, correo, clínica y dirección (la dirección va en el registro de salidas).',
          ],
          [
            { b: 'Especies productoras' },
            ' (bovino, porcino, aves…): los datos del registro (REGA, identificación, nº de animales, tiempo de espera, posología) se piden antes de dispensar.',
          ],
        ],
      },
      {
        p: [
          'Marca ',
          { b: 'He comprobado con la receta original…' },
          ' y pulsa ',
          { b: 'Ver qué dispensar' },
          '. Antes de seguir, la app comprueba los datos obligatorios (firma, fechas, colegiado, validez…). Si falta algo, lo enseña con «Dónde mirar» y «Qué hacer»: corrígelo y vuelve a pulsar. Si de verdad no consta en la receta, puedes «Continuar igualmente» y el resultado lo indicará.',
        ],
      },
    ],
  },
  {
    id: 'resultado',
    titulo: 'Resultado: qué dispensar',
    bloques: [
      { p: ['Para cada medicamento, la app propone qué hacer:'] },
      {
        lista: [
          [
            { b: 'Dispensar' },
            ' (o dispensar con aviso): hay stock y la receta es correcta. Se indica el lote recomendado (el que caduca antes).',
          ],
          [
            { b: 'Sustituir' },
            ': no hay el prescrito, pero sí un equivalente según las reglas (misma composición, forma compatible, vía, especie e indicación, sin exclusiones).',
          ],
          [{ b: 'Pedir' }, ': no hay ni equivalente. Puedes añadirlo a la lista de pedido.'],
          [
            { b: 'Stock sin confirmar' },
            ': Siweb360 no ha respondido o el producto no está relacionado. Puedes relacionarlo con su SKU desde la misma tarjeta.',
          ],
          [
            { b: 'No conforme' },
            ': la receta tiene un defecto. Algunos defectos de forma se pueden forzar («Dispensar igualmente») con justificación; los graves no.',
          ],
        ],
      },
      { p: ['Si CIMAVet indica problemas de suministro, se avisa en el medicamento y en sus equivalentes.'] },
    ],
  },
  {
    id: 'dispensar',
    titulo: 'Dispensación y registro de salidas',
    bloques: [
      {
        lista: [
          [
            { b: 'Escanea el envase' },
            ' (DataMatrix o código de barras), con el lector o con el móvil, o escribe el código a mano. La app comprueba que es el medicamento correcto y toma lote y caducidad.',
          ],
          [
            'Según el caso aparecen: dispensación parcial o fraccionada, cambio de formato, nota de administración para el tutor, identidad de quien retira un psicótropo y la etiqueta para el dorso de la receta.',
          ],
          [
            'Al terminar, rellena los ',
            { b: 'datos del registro' },
            ' (titular, veterinario, indicación, posología…) y pulsa «Guardar el registro», o «Dejar pendiente» para completarlo después desde Pendientes.',
          ],
          ['Recuerda cobrar en el TPV: cada salida se concilia con los tickets de Siweb360.'],
        ],
      },
    ],
  },
  {
    id: 'sustitucion',
    titulo: 'Sustitución de un medicamento',
    bloques: [
      { p: ['Sigue el procedimiento de sustitución cargado en la app:'] },
      {
        lista: [
          [{ b: 'Consentimiento del tutor' }, ' (obligatorio).'],
          [
            { b: 'Aviso al veterinario prescriptor' },
            ' (obligatorio salvo urgencia justificada). La app prepara el texto para correo o WhatsApp.',
          ],
          [
            { b: 'Separa la receta' },
            ' en la bandeja de sustituciones con la etiqueta al dorso (medicamento, código nacional, lote y fecha).',
          ],
          [
            { b: 'Firma del farmacéutico garante' },
            ': firma las recetas apartadas en su visita mensual y el empleado lo registra en la app. Si pasan más de 35 días sin firma, sale como alerta.',
          ],
        ],
      },
    ],
  },
  {
    id: 'pendientes',
    titulo: 'Pendientes',
    bloques: [
      {
        lista: [
          [
            { b: 'Datos del registro por completar' },
            ': recetas dispensadas cuyo registro de salidas quedó pendiente.',
          ],
          [
            { b: 'Salidas pendientes de conciliar con el TPV' },
            ': aún no se ha encontrado su ticket. «Conciliar ahora» lo vuelve a intentar (también se hace cada día).',
          ],
          [
            { b: 'Discrepancias con el TPV' },
            ': la salida y el ticket no cuadran (por ejemplo, otras unidades).',
          ],
          [{ b: 'Sustituciones en curso' }, ': las que esperan algún paso, como la firma del garante.'],
        ],
      },
    ],
  },
  {
    id: 'recepciones',
    titulo: 'Recepción de mercancía',
    bloques: [
      { p: ['Al empezar una recepción hay dos caminos:'] },
      {
        lista: [
          [
            { b: 'Leer el albarán o la factura' },
            ' (foto o PDF): la app lee el número, el proveedor, la fecha y las líneas con su lote y caducidad, y rellena la cabecera. Guarda la foto y lo leído (se pueden ver dentro de la recepción).',
          ],
          [{ b: 'Registrar a mano' }, ': distribuidor, nº de albarán, fecha de compra y fecha de recepción.'],
        ],
      },
      {
        p: [
          { b: 'Duplicados' },
          ': si ya hay una recepción del mismo albarán y distribuidor, o si ese mismo fichero ya se registró, la app lo avisa con el enlace y no deja continuar salvo que confirmes que es otro albarán.',
        ],
      },
      {
        p: [
          'Dentro de la recepción, cada línea leída se revisa con el envase: «Revisar y añadir» la copia al formulario (con lote, caducidad, unidades y precio) y la confirmas escaneando el envase. Reglas:',
        ],
      },
      {
        lista: [
          ['No se puede dar entrada a un producto caducado.'],
          ['El precio neto es sin IVA ni recargo de equivalencia.'],
          ['Principio activo y forma salen siempre de CIMAVet.'],
          [
            { b: 'Otro producto (sin CIMAVet)' },
            ': lo que no es medicamento (collares, piensos…). Queda en la recepción, pero no va al registro de entradas, que solo es obligatorio para medicamentos.',
          ],
          [
            'Para finalizar, ninguna línea puede tener datos obligatorios sin completar (lápiz para modificarla).',
          ],
        ],
      },
      {
        p: [
          { b: 'Como la factura' },
          ': el documento se ve a la izquierda (con zoom) y los datos a la derecha. Cada línea lleva precio, descuento, IVA y recargo de equivalencia, y abajo están la base, el IVA, el recargo y el total, comparados con el total del documento. El ',
          { b: 'régimen' },
          ' de la cabecera indica si el documento lleva recargo de equivalencia (lo normal en farmacia) o solo IVA.',
        ],
      },
      {
        lista: [
          [
            { b: 'SKU de Siweb360' },
            ': en cada medicamento se ve el producto de Siweb360 relacionado; con «Elegir SKU» o «Cambiar» se indica otro, y queda relacionado para las próximas veces.',
          ],
          [
            { b: 'Actualizar stock' },
            ': al finalizar, da entrada de esas unidades (con lote y caducidad) en Siweb360, si la escritura de stock está activada. Desmárcala si la línea no debe sumar stock.',
          ],
          [
            { b: 'Actualizar precio' },
            ': ese precio pasa a ser el precio de coste de referencia en la app (informe de precios de coste). El precio de Siweb360 se cambia allí: su API no lo permite.',
          ],
          [
            { b: 'Modificar o descartar' },
            ': mientras la recepción está abierta se puede cambiar la cabecera o descartarla con un motivo (no se borra). Una recepción finalizada ya no se modifica.',
          ],
        ],
      },
    ],
  },
  {
    id: 'registros',
    titulo: 'Registros y reportes',
    bloques: [
      {
        lista: [
          [
            { b: 'Salidas' },
            ' por plantilla: A con receta, B sin receta presencial, C sin receta online. En Excel o CSV.',
          ],
          [
            { b: 'Entradas y salidas' },
            ': un mismo Excel con las entradas y las salidas en hojas distintas.',
          ],
          [
            { b: 'Todas las salidas' },
            ': con el tipo de salida, el estado del registro y la conciliación con el TPV.',
          ],
        ],
      },
      {
        p: [
          'Los informes se descargan y se envían después (por ahora la app no los manda por correo). Solo incluyen medicamentos. Los datos del propietario (nombre, móvil, DNI enmascarado y dirección) solo salen si marcas «Incluir datos del propietario»; vale para todas las exportaciones de salidas.',
        ],
      },
    ],
  },
  {
    id: 'importar',
    titulo: 'Importar datos anteriores',
    bloques: [
      {
        p: [
          'Para incorporar las entradas y salidas que llevabais antes de la app (perfil veterinaria responsable o administración). Descarga la plantilla de entradas o de salidas y rellénala, o usa un informe exportado por la app: se aceptan las mismas columnas, en cualquier orden. Excel (.xlsx) o CSV separado por punto y coma; fechas como 14/03/2025 e importes como 12,50.',
        ],
      },
      {
        p: [
          { b: 'TIPO DE SALIDA' },
          ' (salidas): «Con receta» o A, «Sin receta presencial» o B, «Sin receta online» o C. Si el fichero no tiene esa columna, elige la plantilla en la pantalla.',
        ],
      },
      { p: ['Primero se analiza el fichero y cada fila se valida contra CIMAVet:'] },
      {
        lista: [
          [
            'Con código nacional: tiene que existir en CIMAVet; el principio activo y la forma vacíos se completan.',
          ],
          ['Sin código nacional: si el nombre es un medicamento de CIMAVet, se importa con aviso.'],
          ['Lo que no es medicamento se omite (se enseña la lista).'],
          ['Solo se importa si no hay errores. El mismo fichero no se importa dos veces.'],
        ],
      },
      {
        p: [
          'Lo importado aparece en los registros marcado como «importado». Una importación se puede ',
          { b: 'anular' },
          ' con un motivo: sus filas dejan de contar, pero no se borran.',
        ],
      },
    ],
  },
  {
    id: 'admin',
    titulo: 'Administración',
    bloques: [
      {
        lista: [
          [
            { b: 'Mapeo código nacional ↔ Siweb360' },
            ' y ',
            { b: 'Pendiente en Siweb360' },
            ': relaciones entre medicamentos y productos de Siweb360, y tareas de alta o renombrado que hay que hacer a mano en Siweb360.',
          ],
          [{ b: 'Distribuidores' }, ' y ', { b: 'plataformas de receta electrónica' }, '.'],
          [
            { b: 'No sustituibles' },
            ', ',
            { b: 'reglas activas' },
            ' (solo lectura) y ',
            { b: 'sincronización con CIMAVet' },
            '.',
          ],
          [
            { b: 'Outbox y reconciliación' },
            ': envíos de entradas de stock a Siweb360 (las salidas nunca se escriben en Siweb360: salen por el TPV).',
          ],
        ],
      },
    ],
  },
  {
    id: 'asistente',
    titulo: 'Asistente de consultas',
    bloques: [
      {
        p: [
          'El botón ',
          { b: 'Preguntar' },
          ' (abajo a la derecha) abre un chat que explica, en lenguaje claro, las reglas de prescripción, validez de la receta, sustitución, cambio de formato y psicótropos. También puedes preguntar por una línea concreta con ',
          { b: 'Preguntar sobre esta línea' },
          ' en Resultado y en Dispensación: te explica lo que la app ya ha calculado y qué hacer.',
        ],
      },
      {
        lista: [
          [
            { b: 'Solo informa' },
            ': no decide, no autoriza, no fuerza nada ni cambia ninguna receta. La decisión sigue siendo de la app y de ti.',
          ],
          [
            { b: 'Cita sus fuentes' },
            ': debajo de cada respuesta salen las reglas, la guía o la Ayuda en las que se apoya, con su versión. Púlsalas para ver el texto.',
          ],
          [
            { b: 'Simulación' },
            ': si preguntas por un caso inventado («receta del 3 de octubre con antibiótico, ¿hasta cuándo vale?»), el cálculo lo hace la app y se marca como «Simulación»; no se guarda ninguna receta.',
          ],
          [
            { b: 'No escribas datos del cliente' },
            ' (nombre, teléfono, DNI ni dirección). Si se cuelan, la app los elimina de tu pregunta y te avisa.',
          ],
          [
            { b: 'Valora las respuestas' },
            ' con «Útil» o «Incorrecta» (y un comentario): ayuda a corregir la documentación. En «Historial» ves tus consultas; la veterinaria responsable y administración ven las de todo el equipo. Se eliminan al año.',
          ],
          [
            { b: 'Si no tiene información' },
            ' lo dice y te remite al farmacéutico garante o al veterinario; no inventa reglas ni datos.',
          ],
          [
            { b: 'Si sale «El asistente no está disponible»' },
            ' o «ha alcanzado el límite de uso de este mes», consulta esta Ayuda: el resto de la app funciona igual. Administración puede ampliar el límite en Administración → Asistente.',
          ],
        ],
      },
    ],
  },
  {
    id: 'datos',
    titulo: 'Datos personales y conservación',
    bloques: [
      {
        lista: [
          [
            'Los datos del titular (nombre, teléfono, DNI, dirección) se guardan cifrados y no aparecen en los registros técnicos.',
          ],
          [
            'Las fotos de las recetas y de los albaranes se guardan en contenedores separados; las de las recetas, protegidas contra cambios durante el plazo de conservación.',
          ],
          [
            'Los registros no se modifican ni se borran: las correcciones quedan como anulaciones o ajustes, con quién y cuándo.',
          ],
        ],
      },
    ],
  },
];

const aTexto = (i: Inline) => (typeof i === 'string' ? i : i.b);

/** Texto plano de una sección (para buscar en ella y para el índice del asistente). */
export function textoPlanoAyuda(s: SeccionAyuda): string {
  return s.bloques
    .map((b) =>
      'p' in b ? b.p.map(aTexto).join('') : b.lista.map((it) => '- ' + it.map(aTexto).join('')).join('\n'),
    )
    .join('\n\n');
}
