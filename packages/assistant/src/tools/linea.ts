import { ArgsContextoLinea, type FuenteCitada } from '@mmx/shared';
import type { z } from 'zod';
import type { DepsHerramientas } from './contexto';
import type { Herramienta } from './registry';

/**
 * Resultado que ya ha calculado la aplicación para la línea de la conversación, con los campos no personales de la
 * receta. Solo existe en conversaciones de tipo `linea`. El DTO es una lista blanca: nunca incluye datos del titular
 * ni del veterinario (FR-014, FR-018, FR-021a).
 */
export function herramientaContextoLinea(
  d: DepsHerramientas,
): Herramienta<z.infer<typeof ArgsContextoLinea>> {
  return {
    nombre: 'contexto_linea',
    descripcion:
      'Devuelve el resultado que la aplicación ya ha calculado para la línea de receta de esta conversación (estado, motivos, equivalentes, validez) y los datos no personales de la receta. Explica ese resultado sin contradecirlo.',
    args: ArgsContextoLinea,
    disponible: (ctx) => ctx.contexto.tipo === 'linea' && !!d.cargarContextoLinea,
    async ejecutar(_args, ctx) {
      if (ctx.contexto.tipo !== 'linea' || !d.cargarContextoLinea) return { datos: { error: 'SIN_LINEA' } };
      const dto = await d.cargarContextoLinea(ctx.contexto.recetaLineaId);
      if (!dto) return { datos: { error: 'LINEA_NO_ENCONTRADA' } };
      const fuente: FuenteCitada = {
        fuenteId: dto.fuenteId,
        tipo: 'motor',
        titulo: 'Resultado de la aplicación para esta línea',
        version: dto.version,
      };
      return { datos: dto, fuentes: [fuente], contextoLinea: dto };
    },
  };
}
