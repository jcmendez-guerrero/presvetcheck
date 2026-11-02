import type { ContextoGuion, Guion } from '../fake';

/**
 * Guiones del modelo falso para preguntas sobre un medicamento: buscan en CIMAVet, piden elegir si hay varios
 * candidatos y, con uno, consultan su ficha. Nunca eligen por la persona.
 */
const PATRON =
  /(?:ficha|busca(?:r)?|informaci[oó]n)\s+(?:de(?:l)?\s+|sobre\s+)?([\p{L}\d][\p{L}\d-]{3,})|¿\s*(?:el|la)\s+([\p{L}][\p{L}\d-]{3,})\s+(?:necesita|es|tiene|se puede)|me refiero a\s+([\p{L}\d][\p{L}\d-]{3,})/iu;

const nombreDe = (q: string): string => {
  const m = PATRON.exec(q);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
};

interface Candidatos {
  fuenteId: string;
  candidatos: { nregistro: string; nombre: string; presentaciones: { cn: string }[] }[];
}
interface Ficha {
  encontrado: boolean;
  fuenteId?: string;
  nombre?: string;
  desactualizado?: boolean;
  ultimaSincronizacion?: string;
  sujetoPrescripcion?: boolean;
  antimicrobiano?: boolean;
  psicotropo?: boolean;
  estupefaciente?: boolean;
  inmunologico?: boolean;
  problemaSuministro?: boolean | null;
}
const dato = <T>(ctx: ContextoGuion, nombre: string) =>
  ctx.resultados.find((r) => r.nombre === nombre)?.datos as T | undefined;
const si = (b: boolean | undefined | null) => (b ? 'sí' : 'no');
const fechaEs = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

export function guionesUs3(): Guion[] {
  return [
    {
      cuando: PATRON,
      rondas: [
        (ctx) => [{ nombre: 'buscar_medicamento', args: { nombre: nombreDe(ctx.pregunta) } }],
        (ctx) => {
          const b = dato<Candidatos>(ctx, 'buscar_medicamento');
          if (b?.candidatos.length === 1)
            return [{ nombre: 'ficha_medicamento', args: { nregistro: b.candidatos[0]?.nregistro } }];
          if (b && b.candidatos.length === 0)
            return [
              { nombre: 'buscar_ayuda', args: { consulta: 'medicamento no aparece en CIMAVet uso humano' } },
            ];
          return [];
        },
      ],
      final: (ctx) => {
        const salida = (o: Record<string, unknown>) => ({
          fuentes: [],
          simulaciones: [],
          usaContextoLinea: false,
          ...o,
        });
        const f = dato<Ficha>(ctx, 'ficha_medicamento');
        if (f?.encontrado && f.fuenteId) {
          const avisos = f.desactualizado ? ' Ojo: estos datos están desactualizados.' : '';
          return salida({
            tipo: 'respondida',
            texto:
              `${f.nombre}: necesita receta: ${si(f.sujetoPrescripcion)}; antibiótico: ${si(f.antimicrobiano)}; psicótropo: ${si(f.psicotropo)}; ` +
              `estupefaciente: ${si(f.estupefaciente)}; inmunológico: ${si(f.inmunologico)}; ` +
              `problema de suministro: ${f.problemaSuministro === null || f.problemaSuministro === undefined ? 'no consta' : si(f.problemaSuministro)}. ` +
              `Datos de CIMAVet sincronizados el ${fechaEs(f.ultimaSincronizacion ?? '')}.${avisos}`,
            fuentes: [f.fuenteId],
          });
        }
        const b = dato<Candidatos>(ctx, 'buscar_medicamento');
        if (b && b.candidatos.length > 1) {
          const lista = b.candidatos
            .map((c) => `${c.nombre} (código nacional ${c.presentaciones[0]?.cn ?? '—'})`)
            .join('; ');
          return salida({
            tipo: 'aclaracion',
            texto: `Hay varios medicamentos con ese nombre: ${lista}. ¿A cuál te refieres?`,
            fuentes: [b.fuenteId],
          });
        }
        const a = dato<{ resultados: { fuenteId: string }[] }>(ctx, 'buscar_ayuda');
        if (a?.resultados?.[0]) {
          return salida({
            tipo: 'respondida',
            texto:
              'No lo encuentro en los datos de medicamentos veterinarios de CIMAVet. Si es un medicamento de uso humano, la app no deja dispensarlo y hay que revisarlo con el farmacéutico garante.',
            fuentes: [a.resultados[0].fuenteId],
          });
        }
        return salida({
          tipo: 'sin_informacion',
          texto:
            'No encuentro ese medicamento en las fuentes de referencia. Consulta al farmacéutico garante.',
        });
      },
    },
  ];
}
