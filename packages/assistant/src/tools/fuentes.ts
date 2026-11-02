import { ArgsBuscarFuente } from '@mmx/shared';
import type { DepsHerramientas } from './contexto';
import type { Herramienta } from './registry';

function buscador(
  d: DepsHerramientas,
  tipo: 'guia' | 'ayuda',
): Herramienta<{ consulta: string; max?: number | undefined }>['ejecutar'] {
  return async ({ consulta, max }) => {
    const resultados = d.indice ? d.indice.buscar(consulta, tipo, max ?? 3) : [];
    const fuentes = resultados.flatMap((r) => d.indice?.fuenteCitable(r) ?? []);
    return {
      datos: {
        resultados: resultados.map((r) => ({
          fuenteId: r.fuenteId,
          version: r.version,
          titulo: r.titulo,
          texto: r.texto,
          puntuacion: r.puntuacion,
        })),
        ...(resultados.length
          ? {}
          : {
              aviso:
                'Sin resultados: si ninguna fuente cubre la pregunta, responde con el tipo sin_informacion.',
            }),
      },
      fuentes,
    };
  };
}

/** Búsqueda en la guía práctica de la receta veterinaria. */
export function herramientaBuscarGuia(
  d: DepsHerramientas,
): Herramienta<{ consulta: string; max?: number | undefined }> {
  return {
    nombre: 'buscar_guia',
    descripcion:
      'Busca en la guía práctica de medicamentos veterinarios en la oficina de farmacia (normativa explicada). Devuelve fragmentos con su fuenteId.',
    args: ArgsBuscarFuente,
    ejecutar: buscador(d, 'guia'),
  };
}

/** Búsqueda en la Ayuda de la aplicación. */
export function herramientaBuscarAyuda(
  d: DepsHerramientas,
): Herramienta<{ consulta: string; max?: number | undefined }> {
  return {
    nombre: 'buscar_ayuda',
    descripcion:
      'Busca en la Ayuda de la aplicación (cómo se usa cada función). Devuelve fragmentos con su fuenteId.',
    args: ArgsBuscarFuente,
    ejecutar: buscador(d, 'ayuda'),
  };
}
