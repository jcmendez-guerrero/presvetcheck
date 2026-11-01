import { z } from 'zod';
import type { ContextoConversacion, ContextoLineaDto, FuenteCitada, SimulacionGuardada } from '@mmx/shared';
import type { DefinicionHerramienta } from '../model';

/** Contexto con el que se ejecuta una herramienta (la conversación a la que pertenece el turno). */
export interface ContextoHerramienta {
  contexto: ContextoConversacion;
}

/** Todas las herramientas son de solo lectura (FR-010). */
export interface ResultadoHerramienta {
  /** Lo que ve el modelo. Debe incluir el `fuenteId` y la `version` citables. */
  datos: unknown;
  /** Fuentes que el modelo podrá citar en este turno. */
  fuentes?: FuenteCitada[];
  simulacion?: SimulacionGuardada;
  contextoLinea?: ContextoLineaDto;
}

export interface Herramienta<A = unknown> {
  nombre: string;
  descripcion: string;
  args: z.ZodType<A>;
  /** Por defecto disponible en todas las conversaciones. */
  disponible?: (ctx: ContextoHerramienta) => boolean;
  ejecutar(args: A, ctx: ContextoHerramienta): Promise<ResultadoHerramienta>;
}

export class ToolRegistry {
  private readonly mapa = new Map<string, Herramienta<never>>();
  constructor(herramientas: Herramienta<never>[] = []) {
    for (const h of herramientas) this.mapa.set(h.nombre, h);
  }

  registrar(...herramientas: Herramienta<never>[]): this {
    for (const h of herramientas) this.mapa.set(h.nombre, h);
    return this;
  }

  disponibles(ctx: ContextoHerramienta): Herramienta<never>[] {
    return [...this.mapa.values()].filter((h) => h.disponible?.(ctx) ?? true);
  }

  obtener(nombre: string, ctx: ContextoHerramienta): Herramienta<never> | undefined {
    const h = this.mapa.get(nombre);
    return h && (h.disponible?.(ctx) ?? true) ? h : undefined;
  }

  definiciones(ctx: ContextoHerramienta): DefinicionHerramienta[] {
    return this.disponibles(ctx).map((h) => ({
      nombre: h.nombre,
      descripcion: h.descripcion,
      parametros: jsonSchema(h.args as z.ZodType),
    }));
  }
}

/** JSON Schema de argumentos sin las palabras clave que el modo estricto del proveedor no admite. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return limpiar(z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>);
}

const PROHIBIDAS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'pattern',
  'format',
  'default',
]);
function limpiar(v: unknown): Record<string, unknown> {
  if (Array.isArray(v)) return v.map(limpiar) as unknown as Record<string, unknown>;
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !PROHIBIDAS.has(k))
        .map(([k, x]) => [k, limpiar(x)]),
    );
  }
  return v as Record<string, unknown>;
}
