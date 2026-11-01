import type { Guion } from '../fake';

/**
 * Guiones del modelo falso para preguntas sobre una línea de receta: llaman a `contexto_linea` y explican lo que
 * devuelve (estado, motivos, validez y equivalentes), sin añadir nada propio.
 */
interface DatosLinea {
  fuenteId: string;
  resultado: {
    decision: string;
    motivos: { mensaje: string; severidad: string }[];
    forzable: boolean;
    equivalentes: { nombre: string; cn: string | null; stock: boolean }[];
    validez?: { efectiva: string };
  };
}

const ESTADOS: Record<string, string> = {
  DISPENSAR: 'se puede dispensar',
  DISPENSAR_CON_AVISO: 'se puede dispensar, pero con avisos que hay que revisar',
  SUSTITUIR: 'no hay stock del prescrito y se propone sustituirlo',
  PEDIR: 'hay que pedir el medicamento prescrito',
  NO_CONFORME: 'no se puede dispensar',
};

const fechaEs = (iso: string) => iso.split('-').reverse().join('/');

export function guionesUs2(): Guion[] {
  return [
    {
      cuando: /./,
      enLinea: true,
      rondas: [[{ nombre: 'contexto_linea', args: {} }]],
      final: (ctx) => {
        const d = ctx.resultados.find((r) => r.nombre === 'contexto_linea')?.datos as DatosLinea | null;
        if (!d?.resultado) {
          return {
            tipo: 'sin_informacion',
            texto: 'No tengo el resultado de esta línea.',
            fuentes: [],
            simulaciones: [],
            usaContextoLinea: false,
          };
        }
        const r = d.resultado;
        const partes = [`Según la aplicación, ${ESTADOS[r.decision] ?? r.decision}.`];
        for (const m of r.motivos.slice(0, 3))
          partes.push(m.mensaje + (m.severidad === 'BLOQUEANTE_DURO' ? ' (no se puede forzar)' : '.'));
        if (r.validez) partes.push(`La receta es válida hasta el ${fechaEs(r.validez.efectiva)}.`);
        if (/alternativ|sustitu/i.test(ctx.pregunta) && r.equivalentes.length) {
          partes.push(`Alternativas: ${r.equivalentes.map((e) => e.nombre).join('; ')}.`);
        }
        return {
          tipo: 'respondida',
          texto: partes.join(' '),
          fuentes: [d.fuenteId],
          simulaciones: [],
          usaContextoLinea: true,
        };
      },
    },
  ];
}
