import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Pagina } from '../componentes/layout';

/**
 * Documentación para quien usa la app: qué hace cada función y cómo usarla. Describe el comportamiento de la
 * app; las reglas legales están en el motor de reglas, no aquí.
 */
interface Seccion {
  id: string;
  titulo: string;
  contenido: ReactNode;
}

const P = ({ children }: { children: ReactNode }) => <p className="mt-2 text-slate-800">{children}</p>;
const L = ({ items }: { items: ReactNode[] }) => (
  <ul className="mt-2 list-disc space-y-1 pl-6 text-slate-800">
    {items.map((x, i) => (
      <li key={i}>{x}</li>
    ))}
  </ul>
);
const B = ({ children }: { children: ReactNode }) => <strong>{children}</strong>;

const SECCIONES: Seccion[] = [
  {
    id: 'empezar',
    titulo: 'Empezar: sesión, perfiles y móvil',
    contenido: (
      <>
        <P>
          Se entra con la cuenta de Microsoft de la farmacia. Arriba a la derecha está tu nombre y{' '}
          <B>Cerrar sesión</B> (también desconecta el móvil emparejado).
        </P>
        <L
          items={[
            <>
              <B>Empleado/a</B>: recetas, ventas, recepciones, pendientes y registros.
            </>,
            <>
              <B>Veterinaria responsable</B>: lo mismo y, además, importar datos anteriores.
            </>,
            <>
              <B>Administración</B>: configuración (distribuidores, mapeo con Siweb360, reglas…). No participa
              en la operativa.
            </>,
          ]}
        />
        <P>
          <B>Móvil</B> (barra azul): enseña un código QR. Léelo con la cámara del móvil y desde él podrás
          fotografiar recetas y leer los códigos de los envases; todo llega a la pantalla del ordenador. El
          emparejamiento caduca solo y no debe compartirse.
        </P>
      </>
    ),
  },
  {
    id: 'inicio',
    titulo: 'Inicio',
    contenido: (
      <>
        <P>Accesos directos a las tareas del día:</P>
        <L
          items={[
            <>
              <B>Receta</B>: dispensar con receta veterinaria.
            </>,
            <>
              <B>Venta sin receta</B> y <B>Pedido online</B>: medicamentos que no necesitan receta (se
              registran como salida sin receta, presencial u online).
            </>,
            <>
              <B>Recepción de mercancía</B>: dar entrada a lo que llega de los distribuidores.
            </>,
          ]}
        />
        <P>
          Debajo, los contadores: sustituciones pendientes, discrepancias con el TPV, recetas no conformes e
          incidencias de sincronización. Si hay recetas dispensadas con el registro por completar, sale un
          aviso con el enlace.
        </P>
      </>
    ),
  },
  {
    id: 'receta',
    titulo: 'Receta: foto y lectura automática',
    contenido: (
      <>
        <P>
          Haz una foto de la receta entera (o sube un PDF), sobre fondo liso y con buena luz; si tiene varias
          páginas, añádelas todas. También puede hacerse desde el móvil emparejado. Mientras se prepara la
          foto verás «Procesando la foto…»: espera a que termine antes de hacer otra.
        </P>
        <P>
          La app lee la receta con Document Intelligence y rellena los datos. Los campos marcados{' '}
          <B>Revisar</B> se han leído con poca seguridad o no se han encontrado. Si la lectura falla, se
          pueden escribir a mano.
        </P>
      </>
    ),
  },
  {
    id: 'revision',
    titulo: 'Revisión de la receta',
    contenido: (
      <>
        <P>Se comprueba cada dato con la receta original, que se ve a la izquierda (con zoom).</P>
        <L
          items={[
            <>
              <B>Medicamento</B>: el buscador de CIMAVet está arriba de cada medicamento. Lo que escribes ahí
              rellena también el nombre «como pone la receta». Elige siempre la presentación exacta: la app
              nunca elige sola. Mientras busca verás «Buscando en CIMAVet…».
            </>,
            <>
              <B>Stock</B>: al elegir el medicamento se ve cuánto hay en la farmacia (Siweb360) y el lote a
              usar. Si no se puede validar el stock (el código nacional no está relacionado con ningún
              producto de Siweb360), indica el producto: elige uno de los parecidos o escribe su SKU. La
              relación queda guardada para las próximas veces. Si el SKU o el nombre en Siweb360 no llevan el
              código nacional, puedes crear una tarea para renombrarlo (Siweb360 no permite cambiarlo desde la
              app).
            </>,
            <>
              <B>Veterinario</B>: nº de colegiado, nombre, colegio, teléfono, correo, clínica y dirección (la
              dirección va en el registro de salidas).
            </>,
            <>
              <B>Especies productoras</B> (bovino, porcino, aves…): los datos del registro (REGA,
              identificación, nº de animales, tiempo de espera, posología) se piden antes de dispensar.
            </>,
          ]}
        />
        <P>
          Marca <B>He comprobado con la receta original…</B> y pulsa <B>Ver qué dispensar</B>. Antes de
          seguir, la app comprueba los datos obligatorios (firma, fechas, colegiado, validez…). Si falta algo,
          lo enseña con «Dónde mirar» y «Qué hacer»: corrígelo y vuelve a pulsar. Si de verdad no consta en la
          receta, puedes «Continuar igualmente» y el resultado lo indicará.
        </P>
      </>
    ),
  },
  {
    id: 'resultado',
    titulo: 'Resultado: qué dispensar',
    contenido: (
      <>
        <P>Para cada medicamento, la app propone qué hacer:</P>
        <L
          items={[
            <>
              <B>Dispensar</B> (o dispensar con aviso): hay stock y la receta es correcta. Se indica el lote
              recomendado (el que caduca antes).
            </>,
            <>
              <B>Sustituir</B>: no hay el prescrito, pero sí un equivalente según las reglas (misma
              composición, forma compatible, vía, especie e indicación, sin exclusiones).
            </>,
            <>
              <B>Pedir</B>: no hay ni equivalente. Puedes añadirlo a la lista de pedido.
            </>,
            <>
              <B>Stock sin confirmar</B>: Siweb360 no ha respondido o el producto no está relacionado. Puedes
              relacionarlo con su SKU desde la misma tarjeta.
            </>,
            <>
              <B>No conforme</B>: la receta tiene un defecto. Algunos defectos de forma se pueden forzar
              («Dispensar igualmente») con justificación; los graves no.
            </>,
          ]}
        />
        <P>Si CIMAVet indica problemas de suministro, se avisa en el medicamento y en sus equivalentes.</P>
      </>
    ),
  },
  {
    id: 'dispensar',
    titulo: 'Dispensación y registro de salidas',
    contenido: (
      <>
        <L
          items={[
            <>
              <B>Escanea el envase</B> (DataMatrix o código de barras), con el lector o con el móvil, o
              escribe el código a mano. La app comprueba que es el medicamento correcto y toma lote y
              caducidad.
            </>,
            <>
              Según el caso aparecen: dispensación parcial o fraccionada, cambio de formato, nota de
              administración para el tutor, identidad de quien retira un psicótropo y la etiqueta para el
              dorso de la receta.
            </>,
            <>
              Al terminar, rellena los <B>datos del registro</B> (titular, veterinario, indicación,
              posología…) y pulsa «Guardar el registro», o «Dejar pendiente» para completarlo después desde
              Pendientes.
            </>,
            <>Recuerda cobrar en el TPV: cada salida se concilia con los tickets de Siweb360.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'sustitucion',
    titulo: 'Sustitución de un medicamento',
    contenido: (
      <>
        <P>Sigue el procedimiento de sustitución cargado en la app:</P>
        <L
          items={[
            <>
              <B>Consentimiento del tutor</B> (obligatorio).
            </>,
            <>
              <B>Aviso al veterinario prescriptor</B> (obligatorio salvo urgencia justificada). La app prepara
              el texto para correo o WhatsApp.
            </>,
            <>
              <B>Separa la receta</B> en la bandeja de sustituciones con la etiqueta al dorso (medicamento,
              código nacional, lote y fecha).
            </>,
            <>
              <B>Firma del farmacéutico garante</B>: firma las recetas apartadas en su visita mensual y el
              empleado lo registra en la app. Si pasan más de 35 días sin firma, sale como alerta.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'pendientes',
    titulo: 'Pendientes',
    contenido: (
      <L
        items={[
          <>
            <B>Datos del registro por completar</B>: recetas dispensadas cuyo registro de salidas quedó
            pendiente.
          </>,
          <>
            <B>Salidas pendientes de conciliar con el TPV</B>: aún no se ha encontrado su ticket. «Conciliar
            ahora» lo vuelve a intentar (también se hace cada día).
          </>,
          <>
            <B>Discrepancias con el TPV</B>: la salida y el ticket no cuadran (por ejemplo, otras unidades).
          </>,
          <>
            <B>Sustituciones en curso</B>: las que esperan algún paso, como la firma del garante.
          </>,
        ]}
      />
    ),
  },
  {
    id: 'recepciones',
    titulo: 'Recepción de mercancía',
    contenido: (
      <>
        <P>Al empezar una recepción hay dos caminos:</P>
        <L
          items={[
            <>
              <B>Leer el albarán o la factura</B> (foto o PDF): la app lee el número, el proveedor, la fecha y
              las líneas con su lote y caducidad, y rellena la cabecera. Guarda la foto y lo leído (se pueden
              ver dentro de la recepción).
            </>,
            <>
              <B>Registrar a mano</B>: distribuidor, nº de albarán, fecha de compra y fecha de recepción.
            </>,
          ]}
        />
        <P>
          <B>Duplicados</B>: si ya hay una recepción del mismo albarán y distribuidor, o si ese mismo fichero
          ya se registró, la app lo avisa con el enlace y no deja continuar salvo que confirmes que es otro
          albarán.
        </P>
        <P>
          Dentro de la recepción, cada línea leída se revisa con el envase: «Revisar y añadir» la copia al
          formulario (con lote, caducidad, unidades y precio) y la confirmas escaneando el envase. Reglas:
        </P>
        <L
          items={[
            'No se puede dar entrada a un producto caducado.',
            'El precio neto es sin IVA ni recargo de equivalencia.',
            'Principio activo y forma salen siempre de CIMAVet.',
            <>
              <B>Otro producto (sin CIMAVet)</B>: lo que no es medicamento (collares, piensos…). Queda en la
              recepción, pero no va al registro de entradas, que solo es obligatorio para medicamentos.
            </>,
            'Para finalizar, ninguna línea puede tener datos obligatorios sin completar (lápiz para modificarla).',
          ]}
        />
        <P>
          <B>Como la factura</B>: el documento se ve a la izquierda (con zoom) y los datos a la derecha. Cada
          línea lleva precio, descuento, IVA y recargo de equivalencia, y abajo están la base, el IVA, el
          recargo y el total, comparados con el total del documento. El <B>régimen</B> de la cabecera indica
          si el documento lleva recargo de equivalencia (lo normal en farmacia) o solo IVA.
        </P>
        <L
          items={[
            <>
              <B>SKU de Siweb360</B>: en cada medicamento se ve el producto de Siweb360 relacionado; con
              «Elegir SKU» o «Cambiar» se indica otro, y queda relacionado para las próximas veces.
            </>,
            <>
              <B>Actualizar stock</B>: al finalizar, da entrada de esas unidades (con lote y caducidad) en
              Siweb360, si la escritura de stock está activada. Desmárcala si la línea no debe sumar stock.
            </>,
            <>
              <B>Actualizar precio</B>: ese precio pasa a ser el precio de coste de referencia en la app
              (informe de precios de coste). El precio de Siweb360 se cambia allí: su API no lo permite.
            </>,
            <>
              <B>Modificar o descartar</B>: mientras la recepción está abierta se puede cambiar la cabecera o
              descartarla con un motivo (no se borra). Una recepción finalizada ya no se modifica.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'registros',
    titulo: 'Registros y reportes',
    contenido: (
      <>
        <L
          items={[
            <>
              <B>Salidas</B> por plantilla: A con receta, B sin receta presencial, C sin receta online. En
              Excel o CSV.
            </>,
            <>
              <B>Entradas y salidas</B>: un mismo Excel con las entradas y las salidas en hojas distintas.
            </>,
            <>
              <B>Todas las salidas</B>: con el tipo de salida, el estado del registro y la conciliación con el
              TPV.
            </>,
          ]}
        />
        <P>
          Los informes se descargan y se envían después (por ahora la app no los manda por correo). Solo
          incluyen medicamentos. Los datos del propietario (nombre, móvil, DNI enmascarado y dirección) solo
          salen si marcas «Incluir datos del propietario»; vale para todas las exportaciones de salidas.
        </P>
      </>
    ),
  },
  {
    id: 'importar',
    titulo: 'Importar datos anteriores',
    contenido: (
      <>
        <P>
          Para incorporar las entradas y salidas que llevabais antes de la app (perfil veterinaria responsable
          o administración). Descarga la plantilla de entradas o de salidas y rellénala, o usa un informe
          exportado por la app: se aceptan las mismas columnas, en cualquier orden. Excel (.xlsx) o CSV
          separado por punto y coma; fechas como 14/03/2025 e importes como 12,50.
        </P>
        <P>
          <B>TIPO DE SALIDA</B> (salidas): «Con receta» o A, «Sin receta presencial» o B, «Sin receta online»
          o C. Si el fichero no tiene esa columna, elige la plantilla en la pantalla.
        </P>
        <P>Primero se analiza el fichero y cada fila se valida contra CIMAVet:</P>
        <L
          items={[
            'Con código nacional: tiene que existir en CIMAVet; el principio activo y la forma vacíos se completan.',
            'Sin código nacional: si el nombre es un medicamento de CIMAVet, se importa con aviso.',
            'Lo que no es medicamento se omite (se enseña la lista).',
            'Solo se importa si no hay errores. El mismo fichero no se importa dos veces.',
          ]}
        />
        <P>
          Lo importado aparece en los registros marcado como «importado». Una importación se puede{' '}
          <B>anular</B> con un motivo: sus filas dejan de contar, pero no se borran.
        </P>
      </>
    ),
  },
  {
    id: 'admin',
    titulo: 'Administración',
    contenido: (
      <L
        items={[
          <>
            <B>Mapeo código nacional ↔ Siweb360</B> y <B>Pendiente en Siweb360</B>: relaciones entre
            medicamentos y productos de Siweb360, y tareas de alta o renombrado que hay que hacer a mano en
            Siweb360.
          </>,
          <>
            <B>Distribuidores</B> y <B>plataformas de receta electrónica</B>.
          </>,
          <>
            <B>No sustituibles</B>, <B>reglas activas</B> (solo lectura) y <B>sincronización con CIMAVet</B>.
          </>,
          <>
            <B>Outbox y reconciliación</B>: envíos de entradas de stock a Siweb360 (las salidas nunca se
            escriben en Siweb360: salen por el TPV).
          </>,
        ]}
      />
    ),
  },
  {
    id: 'datos',
    titulo: 'Datos personales y conservación',
    contenido: (
      <L
        items={[
          'Los datos del titular (nombre, teléfono, DNI, dirección) se guardan cifrados y no aparecen en los registros técnicos.',
          'Las fotos de las recetas y de los albaranes se guardan en contenedores separados; las de las recetas, protegidas contra cambios durante el plazo de conservación.',
          'Los registros no se modifican ni se borran: las correcciones quedan como anulaciones o ajustes, con quién y cuándo.',
        ]}
      />
    ),
  },
];

export function Ayuda() {
  const [q, setQ] = useState('');
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const visibles = SECCIONES.filter(
    (s) =>
      !q.trim() ||
      norm(s.titulo).includes(norm(q)) ||
      norm(document.getElementById(s.id)?.textContent ?? '').includes(norm(q)),
  );
  return (
    <Pagina titulo="Ayuda">
      <p className="text-slate-700">
        Cómo funciona cada parte de la app. Pulsa una sección o busca una palabra.
      </p>
      <label className="flex max-w-md items-center gap-2 rounded-lg border bg-white px-3">
        <Search aria-hidden className="h-5 w-5 text-marca" />
        <input
          aria-label="Buscar en la ayuda"
          className="min-h-11 flex-1 outline-none"
          placeholder="Por ejemplo: albarán, sustitución, importar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <nav aria-label="Índice de la ayuda" className="flex flex-wrap gap-2">
        {SECCIONES.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full bg-white px-3 py-1 text-sm text-marca ring-1 ring-marca/30 hover:bg-fondo"
          >
            {s.titulo}
          </a>
        ))}
      </nav>
      <div className="flex flex-col gap-4">
        {SECCIONES.map((s) => (
          <section
            key={s.id}
            id={s.id}
            hidden={!visibles.includes(s)}
            className="scroll-mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
          >
            <h2 className="text-xl font-bold text-marca-2">{s.titulo}</h2>
            {s.contenido}
          </section>
        ))}
        {!visibles.length && <p className="text-slate-600">No hay ninguna sección con «{q}».</p>}
      </div>
    </Pagina>
  );
}
