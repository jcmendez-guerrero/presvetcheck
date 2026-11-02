import { createHash } from 'node:crypto';
import {
  lineaValidezDe,
  medicamentoGenerico,
  simularSustituibilidad,
  simularValidez,
  type LineaSimuladaValidez,
  type ResultadoSimulacion,
} from '@mmx/domain';
import {
  ArgsSimularSustituibilidad,
  ArgsSimularValidez,
  type FuenteCitada,
  type SimulacionGuardada,
} from '@mmx/shared';
import type { z } from 'zod';
import type { DepsHerramientas } from './contexto';
import type { Herramienta, ResultadoHerramienta } from './registry';

const hash8 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);

/** Convierte el resultado de una simulación en lo que ve el modelo y en lo que se guarda en el intercambio. */
export function resultadoSimulacion(
  herramienta: string,
  args: unknown,
  r: ResultadoSimulacion,
): ResultadoHerramienta {
  const simulacionId = `sim-${hash8(JSON.stringify([herramienta, args]))}`;
  const guardada: SimulacionGuardada = {
    simulacionId,
    herramienta,
    decision: r.decision,
    motivos: r.motivos,
    evidencias: r.evidencias,
    supuestos: r.supuestos,
    ...(r.faltan ? { faltan: r.faltan } : {}),
    reglaVersion: r.reglaVersion,
  };
  const fuente: FuenteCitada = {
    fuenteId: `motor:${simulacionId}`,
    tipo: 'motor',
    titulo: 'Simulación del motor de reglas',
    version: r.reglaVersion,
  };
  return { datos: { fuenteId: fuente.fuenteId, ...guardada }, fuentes: [fuente], simulacion: guardada };
}

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

type ArgsValidez = z.infer<typeof ArgsSimularValidez>;
type ArgsSustituibilidad = z.infer<typeof ArgsSimularSustituibilidad>;

/** Fecha límite de validez de una receta hipotética, con el motor (no la calcula el modelo). */
export function herramientaSimularValidez(d: DepsHerramientas): Herramienta<ArgsValidez> {
  return {
    nombre: 'simular_validez',
    descripcion:
      'Úsala siempre que la pregunta pida hasta cuándo vale una receta o cuántos días le quedan, con una fecha concreta: es la única forma de obtener fechas límite y no debes calcularlas tú. Indica fechaEmision (AAAA-MM-DD) y, si el medicamento es antimicrobiano, lineas con antimicrobiano en true. No guarda nada. Si faltan datos obligatorios devuelve FALTAN_DATOS: pídeselos a la persona.',
    args: ArgsSimularValidez,
    async ejecutar(args) {
      const lineas: LineaSimuladaValidez[] = [];
      for (const l of args.lineas ?? []) {
        if (l.nregistro) {
          const m = await d.cimavet.medicamento(l.nregistro);
          if (!m)
            return faltan(
              'simular_validez',
              args,
              [`medicamento ${l.nregistro} (no está en CIMAVet)`],
              d.rules.version,
            );
          lineas.push(lineaValidezDe(m, d.rules));
        } else {
          lineas.push({
            antimicrobiano: l.antimicrobiano ?? false,
            psicotropo: l.psicotropo ?? false,
            estupefaciente: l.estupefaciente ?? false,
            resuelta: false,
            excluidaAmpliada: false,
          });
        }
      }
      const r = simularValidez({
        fechaEmision: args.fechaEmision ?? null,
        tipoTratamiento: args.tipoTratamiento ?? null,
        especieProduccion: args.especieProduccion ?? null,
        lineas,
        plazoDeclarado: args.plazoDeclarado ?? null,
        fechaConsulta: args.fechaConsulta ?? null,
        rules: d.rules,
        clock: d.clock,
      });
      return resultadoSimulacion('simular_validez', args, r);
    },
  };
}

/** ¿Se puede sustituir? Con el medicamento (nregistro) o con un rasgo genérico (vacuna, biológico). */
export function herramientaSimularSustituibilidad(d: DepsHerramientas): Herramienta<ArgsSustituibilidad> {
  return {
    nombre: 'simular_sustituibilidad',
    descripcion:
      'Úsala siempre que pregunten si se puede sustituir un medicamento o una categoría de medicamentos, aunque creas saber la respuesta: contesta con lo que devuelva. Comprueba con el motor si se puede sustituir. Indica su nregistro, o bien inmunologico/biologico si la pregunta es sobre una categoría (por ejemplo, vacunas). Sin clasePrescripcion se asume que no consta y la sustitución queda bloqueada.',
    args: ArgsSimularSustituibilidad,
    async ejecutar(args) {
      let prescrito;
      if (args.nregistro) {
        prescrito = await d.cimavet.medicamento(args.nregistro);
        if (!prescrito)
          return faltan(
            'simular_sustituibilidad',
            args,
            [`medicamento ${args.nregistro} (no está en CIMAVet)`],
            d.rules.version,
          );
      } else if (args.inmunologico || args.biologico) {
        prescrito = medicamentoGenerico({
          inmunologico: args.inmunologico ?? false,
          biologico: args.biologico ?? false,
        });
      } else {
        return faltan(
          'simular_sustituibilidad',
          args,
          ['qué medicamento (nregistro) o si es inmunológico/biológico'],
          d.rules.version,
        );
      }
      return resultadoSimulacion(
        'simular_sustituibilidad',
        args,
        simularSustituibilidad({
          prescrito,
          clasePrescripcion: args.clasePrescripcion ?? null,
          rules: d.rules,
        }),
      );
    },
  };
}
