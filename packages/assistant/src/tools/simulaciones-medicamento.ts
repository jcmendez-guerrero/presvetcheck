import { simularCambioFormato, simularEquivalencia } from '@mmx/domain';
import { ArgsSimularCambioFormato, ArgsSimularEquivalencia } from '@mmx/shared';
import type { z } from 'zod';
import type { DepsHerramientas } from './contexto';
import type { Herramienta, ResultadoHerramienta } from './registry';
import { resultadoSimulacion } from './simulaciones';

type ArgsFormato = z.infer<typeof ArgsSimularCambioFormato>;
type ArgsEquivalencia = z.infer<typeof ArgsSimularEquivalencia>;

const faltan = (
  herramienta: string,
  args: unknown,
  faltantes: string[],
  version: string,
): ResultadoHerramienta =>
  resultadoSimulacion(herramienta, args, {
    decision: 'FALTAN_DATOS',
    motivos: faltantes.map((f) => ({ code: 'FALTA_DATO', mensaje: `Falta el dato: ${f}` })),
    evidencias: {},
    reglaVersion: version,
    supuestos: {},
    faltan: faltantes,
  });

/** ¿Se puede dar otra presentación del mismo medicamento (cambio de formato o de concentración)? */
export function herramientaSimularCambioFormato(d: DepsHerramientas): Herramienta<ArgsFormato> {
  return {
    nombre: 'simular_cambio_formato',
    descripcion:
      'Comprueba con el motor si otra presentación (otro formato o concentración) puede dispensarse en lugar de la prescrita, y cuántos envases. Indica nregistro y código nacional (cn) de ambas presentaciones y la especie. No guarda nada.',
    args: ArgsSimularCambioFormato,
    async ejecutar(args) {
      const v = d.rules.version;
      const [p, c] = await Promise.all([
        d.cimavet.medicamento(args.prescrito.nregistro),
        d.cimavet.medicamento(args.candidato.nregistro),
      ]);
      const [pp, cp] = await Promise.all([
        d.cimavet.presentacion(args.prescrito.cn),
        d.cimavet.presentacion(args.candidato.cn),
      ]);
      const faltantes: string[] = [];
      if (!p || !pp || pp.nregistro !== args.prescrito.nregistro)
        faltantes.push('el medicamento prescrito (nregistro y código nacional que existan en CIMAVet)');
      if (!c || !cp || cp.nregistro !== args.candidato.nregistro)
        faltantes.push('el medicamento alternativo (nregistro y código nacional que existan en CIMAVet)');
      const especieId = await d.cimavet.especiePorTexto(args.especie ?? null);
      if (especieId === null) faltantes.push('la especie del animal (por ejemplo, perro o gato)');
      if (faltantes.length || !p || !pp || !c || !cp)
        return faltan('simular_cambio_formato', args, faltantes, v);
      return resultadoSimulacion(
        'simular_cambio_formato',
        args,
        simularCambioFormato({
          prescrito: { medicamento: p, presentacion: pp, envases: args.prescrito.envases },
          candidato: { medicamento: c, presentacion: cp },
          envasesCandidato: args.envasesCandidato ?? null,
          contexto: {
            especieId,
            especieProduccion: false,
            clase: 'ordinaria',
            indicacion: null,
            viaPrescritaId: null,
            duracionDias: null,
          },
          permitirCambioFormato: d.permitirCambioFormato,
          rules: d.rules,
        }),
      );
    },
  };
}

/** ¿Es un medicamento equivalente al prescrito a efectos de sustitución? */
export function herramientaSimularEquivalencia(d: DepsHerramientas): Herramienta<ArgsEquivalencia> {
  return {
    nombre: 'simular_equivalencia',
    descripcion:
      'Comprueba con el motor si un medicamento candidato es equivalente al prescrito para sustituirlo (composición, forma, vía, especie, indicación, tiempos de espera). Indica el nregistro de ambos y la especie. No guarda nada.',
    args: ArgsSimularEquivalencia,
    async ejecutar(args) {
      const v = d.rules.version;
      const [p, c] = await Promise.all([
        d.cimavet.medicamento(args.prescrito.nregistro),
        d.cimavet.medicamento(args.candidato.nregistro),
      ]);
      const faltantes: string[] = [];
      if (!p) faltantes.push(`el medicamento prescrito ${args.prescrito.nregistro} (no está en CIMAVet)`);
      if (!c) faltantes.push(`el medicamento candidato ${args.candidato.nregistro} (no está en CIMAVet)`);
      const especieId = await d.cimavet.especiePorTexto(args.especie ?? null);
      if (especieId === null) faltantes.push('la especie del animal (por ejemplo, perro o gato)');
      if (faltantes.length || !p || !c) return faltan('simular_equivalencia', args, faltantes, v);
      return resultadoSimulacion(
        'simular_equivalencia',
        args,
        simularEquivalencia({
          prescrito: p,
          candidato: c,
          contexto: {
            especieId,
            especieProduccion: args.especieProduccion ?? false,
            clase: 'ordinaria',
            indicacion: args.indicacion ?? null,
            viaPrescritaId: null,
            duracionDias: null,
          },
          rules: d.rules,
        }),
      );
    },
  };
}
