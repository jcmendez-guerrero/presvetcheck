import { ArgsConsultarStock, type FuenteCitada } from '@mmx/shared';
import type { z } from 'zod';
import type { DepsHerramientas } from './contexto';
import type { Herramienta, ResultadoHerramienta } from './registry';

type ArgsStock = z.infer<typeof ArgsConsultarStock>;

export function herramientaConsultarStock(d: DepsHerramientas): Herramienta<ArgsStock> {
  return {
    nombre: 'consultar_stock',
    descripcion:
      'Consulta las existencias en vivo de uno o varios Códigos nacionales (CN) en el almacén de la farmacia. Devuelve las unidades disponibles y si hay stock físico para cada código.',
    args: ArgsConsultarStock,
    async ejecutar({ cns }): Promise<ResultadoHerramienta> {
      const ahora = d.clock.now().toString();
      const fuente: FuenteCitada = {
        fuenteId: 'siweb:stock',
        tipo: 'cimavet', // citable as external registry/inventory
        titulo: 'Consulta de existencias en almacén',
        version: ahora,
      };

      if (!d.stock) {
        return {
          datos: {
            fuenteId: fuente.fuenteId,
            version: fuente.version,
            items: cns.map((cn) => ({
              cn,
              stockDisponible: null,
              tieneStock: false,
              estado: 'NO_DISPONIBLE' as const,
            })),
            aviso:
              'El servicio de inventario no está disponible. Comprueba las existencias físicas en la balda.',
          },
          fuentes: [fuente],
        };
      }

      const items = await Promise.all(
        cns.map(async (cn) => {
          try {
            const res = await d.stock!.lotes(cn, null);
            const unidadesDisponibles =
              res.estado === 'OK' ? res.lotes.reduce((acc, l) => acc + (l.disponible ?? 0), 0) : 0;
            return {
              cn,
              stockDisponible: unidadesDisponibles,
              tieneStock: unidadesDisponibles > 0,
              estado: res.estado,
            };
          } catch {
            return {
              cn,
              stockDisponible: 0,
              tieneStock: false,
              estado: 'NO_DISPONIBLE' as const,
            };
          }
        }),
      );

      return {
        datos: {
          fuenteId: fuente.fuenteId,
          version: fuente.version,
          items,
        },
        fuentes: [fuente],
      };
    },
  };
}
