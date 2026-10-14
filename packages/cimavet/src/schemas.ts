import { z } from 'zod';

/**
 * Esquemas de las respuestas de CIMAVet a partir de la especificación v1.4 (docs/ref/CIMAVet_REST_API.md).
 * La doc usa mayúsculas inconsistentes (`Comerc`/`comerc`, `Id`/`id`, `IdForma`): antes de validar se
 * pasan todas las claves a minúsculas (`lowerKeys`). Los esquemas son tolerantes a campos nuevos
 * (`loose`) y el JSON crudo se guarda aparte.
 */

/** Claves en minúsculas, recursivamente. */
export function lowerKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(lowerKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.toLowerCase(), lowerKeys(x)]));
  }
  return v;
}

/**
 * Envoltorio de las listas paginadas observado en la API real (docs/ref/cimavet-respuestas.md):
 * `{ totalFilas, pagina, tamanioPagina, resultados: [] }`. Por tolerancia se acepta también un array
 * directo o el primer campo array de un objeto.
 */
export function extraerLista(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    const res = Object.entries(o).find(([k]) => k.toLowerCase() === 'resultados')?.[1];
    if (Array.isArray(res)) return res;
    for (const v of Object.values(o)) if (Array.isArray(v)) return v;
  }
  return [];
}

/** Tamaño de página declarado en el envoltorio (`tamanioPagina`), si lo hay. */
export function tamanioPagina(json: unknown): number | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const v = Object.entries(json as Record<string, unknown>).find(([k]) => k.toLowerCase() === 'tamaniopagina')?.[1];
  return typeof v === 'number' && v > 0 ? v : null;
}

const bool = z.preprocess((v) => {
  if (typeof v === 'string') return ['true', 's', 'si', 'sí', '1'].includes(v.trim().toLowerCase());
  if (typeof v === 'number') return v === 1;
  return v;
}, z.boolean());
const optBool = bool.nullish();
const fecha = z.union([z.number(), z.string()]).nullish();
const idLike = z.union([z.number(), z.string()]).nullish();

export const ItemSchema = z.looseObject({ id: idLike, codigo: z.string().nullish(), nombre: z.string().nullish() });
export const EstadoSchema = z.looseObject({ aut: fecha, susp: fecha, rev: fecha });
export const PrincipioActivoSchema = z.looseObject({
  id: idLike,
  codigo: z.string().nullish(),
  nombre: z.string().nullish(),
  cantidad: z.union([z.string(), z.number()]).nullish(),
  unidad: z.string().nullish(),
  orden: z.number().nullish(),
});
export const PresentacionSchema = z.looseObject({
  cn: z.union([z.string(), z.number()]).transform(String),
  nregistro: z.string().nullish(),
  nombre: z.string().nullish(),
  estado: EstadoSchema.nullish(),
  comerc: optBool,
});
export const MedicamentoSchema = z.looseObject({
  nregistro: z.string(),
  nombre: z.string(),
  pactivos: z.string().nullish(),
  labtitular: z.string().nullish(),
  dispensacion: ItemSchema.nullish(),
  tipomedicamento: ItemSchema.nullish(),
  administracion: ItemSchema.nullish(),
  /** La doc v1.4 habla de `forma`; la API real devuelve `formasFarmaceuticas[]`. Se aceptan ambas. */
  forma: ItemSchema.nullish(),
  formasfarmaceuticas: z.array(ItemSchema).nullish(),
  primeraautorizacion: fecha,
  estado: EstadoSchema.nullish(),
  comerc: optBool,
  psum: optBool,
  receta: optBool,
  estupefaciente: optBool,
  psicotropo: optBool,
  antibiotico: optBool,
  notas: optBool,
  ema: optBool,
  atcs: z.array(z.looseObject({ codigo: z.string().nullish(), nombre: z.string().nullish(), nivel: z.number().nullish() })).nullish(),
  principiosactivos: z.array(PrincipioActivoSchema).nullish(),
  viasadministracion: z.array(ItemSchema).nullish(),
  especies: z.array(ItemSchema).nullish(),
  indicaciones: z.array(z.looseObject({ id: idLike, nombre: z.string().nullish(), especie: ItemSchema.nullish() })).nullish(),
  tiemposespera: z
    .array(
      z.looseObject({
        cantidad: z.union([z.number(), z.string()]).nullish(),
        unidadtiempo: z.union([z.string(), ItemSchema]).nullish(),
        especie: ItemSchema.nullish(),
        tejido: z.union([z.string(), ItemSchema]).nullish(),
        formafarmaceutica: ItemSchema.nullish(),
        viaadministracion: ItemSchema.nullish(),
      }),
    )
    .nullish(),
  presentaciones: z.array(PresentacionSchema).nullish(),
});
export const NotaSchema = z.looseObject({
  tipo: z.number().nullish(),
  num: z.union([z.number(), z.string()]).transform(String),
  ref: z.string().nullish(),
  asunto: z.string().nullish(),
  fecha: fecha,
  url: z.string().nullish(),
});
export const RegistroCambioSchema = z.looseObject({
  nregistro: z.string(),
  fecha: fecha,
  tipocambio: z.coerce.number(),
  /** La API real devuelve `cambio` (la doc dice `cambios`). */
  cambio: z.array(z.string()).nullish(),
  cambios: z.array(z.string()).nullish(),
});

export type ItemApi = z.infer<typeof ItemSchema>;
export type MedicamentoApi = z.infer<typeof MedicamentoSchema>;
export type PresentacionApi = z.infer<typeof PresentacionSchema>;
export type NotaApi = z.infer<typeof NotaSchema>;
export type RegistroCambioApi = z.infer<typeof RegistroCambioSchema>;

const FECHA_MADRID = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Fecha de CIMAVet → AAAA-MM-DD. La API real devuelve milisegundos epoch de la medianoche de Madrid
 * (p. ej. 1207778400000 = 2008-04-10 00:00 CEST), así que el día se toma en Europe/Madrid, no en UTC.
 * También acepta segundos, texto dd/mm/aaaa o ISO.
 */
export function fechaCimavet(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(v)) {
    const n = Number(v);
    const ms = n > 1e11 ? n : n * 1000;
    return FECHA_MADRID.format(new Date(ms));
  }
  const es = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
  if (es) return `${es[3]}-${es[2]}-${es[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return iso ? (iso[1] as string) : null;
}

export function idNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
