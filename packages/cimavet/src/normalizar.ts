import { concentracion, type Composicion, type EstadoAutorizacion } from '@mmx/domain';
import { normalizeText } from '@mmx/shared';
import type { cimavetMedicamento, cimavetPresentacion } from '@mmx/db';
import { fechaCimavet, idNum, type MedicamentoApi, type PresentacionApi } from './schemas';

/** Registro normalizado listo para la caché (lo producen el importador del Nomenclátor y la API). */
export interface RegistroCache {
  medicamento: typeof cimavetMedicamento.$inferInsert;
  presentaciones: (typeof cimavetPresentacion.$inferInsert)[];
  /** null = la fuente no trae composición (no se sobrescribe la existente). */
  principiosActivos: PaCache[] | null;
  especies: number[] | null;
  vias: number[] | null;
  atc: string[] | null;
  indicaciones: { indicacionId: number; nombre: string | null; especieId: number | null }[] | null;
  tiemposEspera:
    | {
        especieId: number | null;
        tejido: string | null;
        cantidad: string | null;
        unidad: string | null;
        formaViaAdmin: string | null;
        noAplicaTejido: boolean;
      }[]
    | null;
}

export interface PaCache {
  orden: number;
  paId: number;
  nombre: string | null;
  cantidadRaw: string | null;
  cantidadValor: string | null;
  unidadRaw: string | null;
  unidadCanonica: string | null;
  normalizable: boolean;
}

/** Calcula las columnas normalizadas de los principios activos con el normalizador del dominio. */
export function normalizarPas(
  pas: { paId: number; nombre: string | null; cantidad: string | null; unidad: string | null }[],
  porCantidad: string | null,
  porUnidad: string | null,
): PaCache[] {
  const comp: Composicion = {
    pas: pas.map((p) => ({ paId: p.paId, nombre: p.nombre ?? '', cantidad: p.cantidad, unidad: p.unidad })),
    porCantidad,
    porUnidad,
  };
  return comp.pas.map((pa, i) => {
    const c = concentracion(pa, comp);
    return {
      orden: i + 1,
      paId: pa.paId,
      nombre: pas[i]?.nombre ?? null,
      cantidadRaw: pa.cantidad,
      cantidadValor: c ? c.valor.toString() : null,
      unidadRaw: pa.unidad,
      unidadCanonica: c ? `${c.num}/${c.den}` : null,
      normalizable: c !== null,
    };
  });
}

/** Estado de CIMAVet ({aut, susp, rev}) → autorizado | suspendido | revocado. */
export function estadoDesdeApi(
  e: { aut?: unknown; susp?: unknown; rev?: unknown } | null | undefined,
): EstadoAutorizacion {
  if (e?.rev) return 'revocado';
  if (e?.susp) return 'suspendido';
  return 'autorizado';
}

/** Convierte un tiempo de espera a días (redondeo hacia arriba; grados-día no es convertible). */
export function diasEspera(cantidad: string | number | null, unidad: string | null): number | null {
  if (cantidad === null || cantidad === '' || unidad === null) return null;
  const n = Number(String(cantidad).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const u = normalizeText(unidad);
  if (u.startsWith('dia')) return Math.ceil(n);
  if (u.startsWith('hora')) return Math.ceil(n / 24);
  if (u.startsWith('semana')) return Math.ceil(n * 7);
  // Conservador: un mes = 31 días.
  if (u.startsWith('mes')) return Math.ceil(n * 31);
  return null;
}

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return ((v as { nombre?: string }).nombre ?? null) || null;
  return String(v);
};

/**
 * Armoniza los identificadores de vía de administración (FR-014, FR-019).
 * En Nomenclátor XML, el código oficial de VÍA ORAL es 54 y VÍA RECTAL es 59.
 * En la API REST de CIMAVet, la maestra devuelve id: 48 con codigo: "54" para Vía Oral,
 * e id: 54 con codigo: "59" para Vía Rectal.
 * Si el campo `codigo` no viene informado o coincide con id: 48, se mapea al código canónico oficial.
 */
export function canonicaVia(
  id: number | null,
  codigo?: string | number | null,
  nombre?: string | null,
): number | null {
  const c = codigo ? idNum(codigo) : null;
  if (c !== null && c > 0) return c;
  if (id === 48) return 54;
  if (id === 54 && (!nombre || /rectal/i.test(nombre))) return 59;
  return id;
}

/** Respuesta de `GET medicamento` → registro de caché (SPEC §5.1.2, source=api). */
export function registroDesdeApi(
  m: MedicamentoApi,
  raw: unknown,
  fetchedAt: Date,
  presentacionesApi?: PresentacionApi[],
): RegistroCache {
  const pres = presentacionesApi ?? m.presentaciones ?? [];
  const pas = m.principiosactivos?.length
    ? normalizarPas(
        [...m.principiosactivos]
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
          .map((p) => ({
            paId: idNum(p.id) ?? 0,
            nombre: p.nombre ?? null,
            cantidad: p.cantidad === null || p.cantidad === undefined ? null : String(p.cantidad),
            unidad: p.unidad ?? null,
          })),
        null,
        null,
      )
    : null;
  return {
    medicamento: {
      nregistro: m.nregistro,
      nombre: m.nombre,
      nombreNorm: normalizeText(m.nombre),
      labtitular: m.labtitular ?? null,
      receta: m.receta ?? null,
      antibiotico: m.antibiotico ?? null,
      estupefaciente: m.estupefaciente ?? null,
      psicotropo: m.psicotropo ?? null,
      tipoMedicamentoId: idNum(m.tipomedicamento?.id),
      formaId: idNum(m.forma?.id ?? m.formasfarmaceuticas?.[0]?.id),
      administracionId: idNum(m.administracion?.id),
      dispensacionId: idNum(m.dispensacion?.id),
      estado: (m.estado ?? null) as never,
      estadoCodigo: estadoDesdeApi(m.estado),
      comerc: m.comerc ?? null,
      psum: m.psum ?? null,
      ema: m.ema ?? null,
      notas: m.notas ?? null,
      primeraAutorizacion: fechaCimavet(m.primeraautorizacion),
      raw: raw as never,
      source: 'api',
      fetchedAt,
    },
    presentaciones: pres.map((p) => ({
      cn: p.cn,
      nregistro: p.nregistro ?? m.nregistro,
      nombre: p.nombre ?? m.nombre,
      nombreNorm: normalizeText(p.nombre ?? m.nombre),
      comerc: p.comerc ?? null,
      estado: (p.estado ?? null) as never,
      estadoCodigo: estadoDesdeApi(p.estado),
      raw: p as never,
      source: 'api',
      fetchedAt,
    })),
    principiosActivos: pas,
    especies: m.especies
      ? m.especies
          .map((e) => idNum(e.id))
          .filter((x): x is number => x !== null && x > 0)
      : null,
    vias: m.viasadministracion
      ? m.viasadministracion
          .map((e) => canonicaVia(idNum(e.id), e.codigo, e.nombre))
          .filter((x): x is number => x !== null)
      : null,
    atc: m.atcs ? m.atcs.map((a) => a.codigo).filter((x): x is string => !!x) : null,
    indicaciones: m.indicaciones
      ? m.indicaciones.map((i) => ({
          indicacionId: idNum(i.id) ?? 0,
          nombre: i.nombre ?? null,
          especieId: idNum(i.especie?.id),
        }))
      : null,
    tiemposEspera: m.tiemposespera
      ? m.tiemposespera.map((t) => ({
          especieId: idNum(t.especie?.id),
          tejido: texto(t.tejido),
          cantidad: t.cantidad === null || t.cantidad === undefined ? null : String(t.cantidad),
          unidad: texto(t.unidadtiempo),
          formaViaAdmin:
            [texto(t.formafarmaceutica), texto(t.viaadministracion)].filter(Boolean).join(' / ') || null,
          noAplicaTejido: false,
        }))
      : null,
  };
}
