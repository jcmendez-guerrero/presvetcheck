import { ArgsConsultarReglas, type FuenteCitada } from '@mmx/shared';
import type { DepsHerramientas } from './contexto';
import type { Herramienta } from './registry';

type Tema = 'campos_receta' | 'validez' | 'sustitucion_exclusiones' | 'equivalencia' | 'formato';

const FICHERO: Record<Exclude<Tema, 'formato'>, string> = {
  campos_receta: 'receta-campos.v1',
  validez: 'validez.v1',
  sustitucion_exclusiones: 'sustitucion-exclusiones.v1',
  equivalencia: 'equivalencia.v1',
};

const TITULO: Record<Tema, string> = {
  campos_receta: 'Campos de la receta y su severidad',
  validez: 'Plazos de validez de la receta',
  sustitucion_exclusiones: 'Exclusiones de la sustitución',
  equivalencia: 'Parámetros de la equivalencia de indicaciones',
  formato: 'Cambio de formato o concentración',
};

/** Versión del fichero de reglas dentro de la versión compuesta del conjunto (`fichero@hash8+…`). */
export function versionDeRegla(versionCompuesta: string, fichero: string): string {
  return versionCompuesta.split('+').find((v) => v.startsWith(`${fichero}@`)) ?? `${fichero}@desconocida`;
}

/** Lee las reglas versionadas activas (config/rules): el modelo no lleva ninguna regla en sus instrucciones. */
export function herramientaConsultarReglas(d: DepsHerramientas): Herramienta<{ tema: Tema }> {
  return {
    nombre: 'consultar_reglas',
    descripcion:
      'Devuelve las reglas vigentes de un tema (campos_receta, validez, sustitucion_exclusiones, equivalencia o formato) con su versión. Úsala para cualquier plazo, condición o exclusión: no conoces ninguna regla de memoria.',
    args: ArgsConsultarReglas,
    async ejecutar({ tema }) {
      const bundle = d.rules;
      let contenido: unknown;
      switch (tema) {
        case 'campos_receta':
          contenido = bundle.recetaCampos;
          break;
        case 'validez':
          contenido = bundle.validez;
          break;
        case 'sustitucion_exclusiones':
          contenido = bundle.exclusiones;
          break;
        case 'equivalencia':
          contenido = bundle.equivalencia;
          break;
        case 'formato':
          contenido = { permitirCambioFormato: d.permitirCambioFormato };
          break;
      }
      const version =
        tema === 'formato'
          ? `config:ALLOW_PACK_SIZE_CHANGE=${d.permitirCambioFormato}`
          : versionDeRegla(bundle.version, FICHERO[tema]);
      const fuente: FuenteCitada = {
        fuenteId: `regla:${tema}`,
        tipo: 'regla',
        titulo: TITULO[tema],
        version,
      };
      return {
        datos: { fuenteId: fuente.fuenteId, version, titulo: fuente.titulo, contenido },
        fuentes: [fuente],
      };
    },
  };
}
