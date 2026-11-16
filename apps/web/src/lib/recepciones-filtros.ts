/**
 * Filtros de la tabla de recepciones (specs/014): se guardan en la dirección de la página para conservarlos al
 * volver del detalle y poder compartirlos. Funciones puras, sin E/S.
 */

export const ESTADO_RECEPCION = {
  ABIERTA: { texto: 'Abierta', atencion: true },
  FINALIZADA: { texto: 'Finalizada', atencion: false },
  SINCRONIZADA: { texto: 'Enviada', atencion: false },
  ERROR_SINCRONIZACION: { texto: 'Error al enviar', atencion: true },
  DESCARTADA: { texto: 'Descartada', atencion: false },
} as const;
export type EstadoRecepcion = keyof typeof ESTADO_RECEPCION;

export const ORDENES = ['albaran', 'proveedor', 'recibida', 'compra', 'registrada', 'estado'] as const;
export type Orden = (typeof ORDENES)[number];

export const RANGOS = [
  ['recibidaDesde', 'recibidaHasta'],
  ['compraDesde', 'compraHasta'],
  ['registradaDesde', 'registradaHasta'],
] as const;
export type CampoFecha = (typeof RANGOS)[number][number];

export type FiltrosRecepciones = {
  numero?: string;
  /** Id del distribuidor (`distribuidorId` en la API). */
  proveedor?: string;
  /** Códigos de estado separados por comas. */
  estado?: string;
  orden?: Orden;
  dir?: 'asc' | 'desc';
  pagina?: number;
} & { [K in CampoFecha]?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esDia = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(v);
};

/** Lee los filtros de la dirección; lo que no es válido se ignora sin avisar. */
export function leerFiltros(s: Record<string, unknown>): FiltrosRecepciones {
  const f: FiltrosRecepciones = {};
  const numero = typeof s.numero === 'string' ? s.numero.trim().slice(0, 60) : '';
  if (numero) f.numero = numero;
  if (typeof s.proveedor === 'string' && UUID.test(s.proveedor)) f.proveedor = s.proveedor;
  if (typeof s.estado === 'string') {
    const estados = s.estado.split(',').filter((e) => e in ESTADO_RECEPCION);
    if (estados.length) f.estado = estados.join(',');
  }
  for (const par of RANGOS) {
    for (const c of par) {
      const v = s[c];
      if (esDia(v)) f[c] = v;
    }
  }
  if ((ORDENES as readonly unknown[]).includes(s.orden)) f.orden = s.orden as Orden;
  if (s.dir === 'asc' || s.dir === 'desc') f.dir = s.dir;
  const pagina = Number(s.pagina);
  if (Number.isInteger(pagina) && pagina >= 1) f.pagina = pagina;
  return f;
}

/** Parámetros de `GET /api/recepciones`. */
export function aConsulta(f: FiltrosRecepciones): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === '') continue;
    q.set(k === 'proveedor' ? 'distribuidorId' : k, String(v));
  }
  return q;
}

/** Campos «hasta» anteriores a su «desde». */
export function rangoInvalido(f: FiltrosRecepciones): CampoFecha[] {
  return RANGOS.filter(([d, h]) => {
    const desde = f[d];
    const hasta = f[h];
    // Un campo vacío ('' en el formulario) no cuenta: solo se compara si están los dos.
    return Boolean(desde && hasta && desde > hasta);
  }).map(([, h]) => h);
}

/** ¿Hay algún filtro (no cuentan el orden ni la página)? */
export function hayFiltros(f: FiltrosRecepciones): boolean {
  return Boolean(f.numero || f.proveedor || f.estado || RANGOS.some(([d, h]) => f[d] || f[h]));
}

const DIA_MADRID = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Día (`AAAA-MM-DD`) en Europe/Madrid de un instante ISO. */
export function diaMadrid(iso: string): string {
  return DIA_MADRID.format(new Date(iso));
}
