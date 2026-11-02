import type { ContextoGuion, Guion } from '../fake';

/**
 * Guiones del modelo falso para las dudas generales (demo y tests). Llaman a las mismas herramientas que el modelo
 * real y construyen la respuesta a partir de lo que devuelven; no llevan reglas escritas.
 */
const salida = (o: Record<string, unknown>) => ({
  fuentes: [],
  simulaciones: [],
  usaContextoLinea: false,
  ...o,
});

type Datos = Record<string, unknown> | null;
const datosDe = (ctx: ContextoGuion, nombre: string): Datos =>
  (ctx.resultados.find((r) => r.nombre === nombre)?.datos ?? null) as Datos;

/** `fuenteId` del primer resultado (reglas/simulaciones) o del primer fragmento (guía/Ayuda). */
export function primeraFuente(d: Datos): string | null {
  if (!d) return null;
  if (typeof d['fuenteId'] === 'string') return d['fuenteId'];
  const rs = d['resultados'];
  if (Array.isArray(rs) && rs.length) return String((rs[0] as { fuenteId: string }).fuenteId);
  return null;
}

const SIN_INFO = (
  texto = 'No tengo información en las fuentes de referencia para responder a esto. Consulta al farmacéutico garante o al veterinario prescriptor.',
) => salida({ tipo: 'sin_informacion', texto });

export function guionesUs1(anio = new Date().getFullYear()): Guion[] {
  return [
    {
      cuando: /^¿?\s*se puede cambiar\s*\??$/i,
      rondas: [],
      final: () =>
        salida({
          tipo: 'aclaracion',
          texto:
            '¿Qué quieres cambiar y por qué? Dime el medicamento y si buscas otro formato, otra concentración u otro medicamento.',
        }),
    },
    {
      cuando: /ignora (las )?reglas|autoriza|dime que s[ií] se puede|saltarme|saltarse/i,
      rondas: [],
      final: () =>
        salida({
          tipo: 'rechazo_reglas',
          texto:
            'No puedo ignorar las reglas ni autorizar nada: solo puedo explicarlas. Si crees que una regla no debería aplicarse, consulta al farmacéutico garante.',
        }),
    },
    {
      cuando:
        /\b(\d{1,2}) de (octubre|noviembre|diciembre|septiembre)\b.*(antibi|antimicro)|(antibi|antimicro).*\b(\d{1,2}) de (octubre|noviembre|diciembre|septiembre)\b/i,
      rondas: [
        [
          {
            nombre: 'simular_validez',
            args: { fechaEmision: `${anio}-10-03`, lineas: [{ antimicrobiano: true }] },
          },
        ],
      ],
      final: (ctx) => {
        const d = datosDe(ctx, 'simular_validez');
        const ev = (d?.['evidencias'] ?? {}) as Record<string, unknown>;
        if (d?.['decision'] === 'FALTAN_DATOS')
          return salida({
            tipo: 'aclaracion',
            texto: 'Necesito la fecha de emisión de la receta para calcularlo.',
          });
        const id = String(d?.['simulacionId']);
        return salida({
          tipo: 'respondida',
          texto: `Simulación: con estos datos la receta es válida hasta el ${String(ev['validezEfectiva']).split('-').reverse().join('/')} (plazo máximo: ${String(ev['plazoMaximo'])} desde la emisión).`,
          fuentes: [String(d?.['fuenteId'])],
          simulaciones: [id],
        });
      },
    },
    {
      cuando: /cu[aá]ntos d[ií]as|cu[aá]nto (tiempo )?(vale|dura)|validez|caduca|how many days/i,
      rondas: [[{ nombre: 'consultar_reglas', args: { tema: 'validez' } }]],
      final: (ctx) => {
        const d = datosDe(ctx, 'consultar_reglas');
        const dias = (d?.['contenido'] as Record<string, { dias?: number }> | undefined)?.['antimicrobiano']
          ?.dias;
        if (!d || dias === undefined) return SIN_INFO();
        return salida({
          tipo: 'respondida',
          texto: `Una receta con un antibiótico (antimicrobiano) vale ${dias} días desde la fecha de emisión, y el tratamiento debe iniciarse dentro de ese plazo.`,
          fuentes: [String(d['fuenteId'])],
        });
      },
    },
    {
      cuando: /vacuna|inmunol[oó]gic/i,
      rondas: [
        [{ nombre: 'simular_sustituibilidad', args: { inmunologico: true, clasePrescripcion: 'ordinaria' } }],
      ],
      final: (ctx) => {
        const d = datosDe(ctx, 'simular_sustituibilidad');
        if (!d) return SIN_INFO();
        const permitida = d['decision'] === 'PERMITIDA';
        return salida({
          tipo: 'respondida',
          texto: permitida
            ? 'Según el motor, sí se puede sustituir.'
            : 'No: un medicamento inmunológico (como una vacuna) no se puede sustituir. En ese caso se pide el medicamento prescrito.',
          fuentes: [String(d['fuenteId'])],
          simulaciones: [String(d['simulacionId'])],
        });
      },
    },
    {
      cuando: /psic[oó]tropo/i,
      rondas: [[{ nombre: 'buscar_guia', args: { consulta: 'psicótropos un envase por receta' } }]],
      final: (ctx) => {
        const d = datosDe(ctx, 'buscar_guia');
        const rs = (d?.['resultados'] ?? []) as { fuenteId: string; texto: string }[];
        const r = rs.find((x) => /un envase por receta/i.test(x.texto));
        if (!r) return SIN_INFO();
        return salida({
          tipo: 'respondida',
          texto:
            'Con una receta de psicótropos solo se puede dispensar un envase, según la guía de la receta veterinaria.',
          fuentes: [r.fuenteId],
        });
      },
    },
    {
      cuando: /principio activo/i,
      rondas: [
        [
          { nombre: 'buscar_ayuda', args: { consulta: 'principio activo' } },
          { nombre: 'consultar_reglas', args: { tema: 'campos_receta' } },
        ],
      ],
      final: (ctx) => {
        const f = primeraFuente(datosDe(ctx, 'buscar_ayuda'));
        const regla = primeraFuente(datosDe(ctx, 'consultar_reglas'));
        if (!f || !regla) return SIN_INFO();
        return salida({
          tipo: 'respondida',
          texto:
            'Si la receta solo indica el principio activo, la aplicación no deja dispensar: hay que pedir al veterinario que la corrija. Los detalles están en la Ayuda.',
          fuentes: [f, regla],
        });
      },
    },
    {
      cuando: /tiempo hace|f[uú]tbol|receta de cocina|chiste|capital de/i,
      rondas: [],
      final: () =>
        salida({
          tipo: 'fuera_de_ambito',
          texto:
            'Solo puedo ayudarte con prescripción, dispensación, sustitución, registros y el uso de la aplicación.',
        }),
    },
  ];
}
