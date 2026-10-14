import { normalizeText } from '@mmx/shared';
import { streamXmlRecords, xmlChildren, xmlText, xmlTexts, type XmlNode } from '@mmx/shared/node';
import type { EstadoAutorizacion } from '@mmx/domain';
import { normalizarPas, type RegistroCache } from './normalizar';

/**
 * Importador del Nomenclátor Veterinario (`PrescripcionVET.xml`) en streaming (SPEC §5.1.2).
 *
 * El parser se ha escrito a partir de la muestra real (fixtures/nomenclator/): elemento raíz
 * `aemps_prescripcion_vet`, un `<prescription>` por presentación (CN), con medicamento repetido por
 * `nro_definitivo`. Estructura posterior a julio de 2024: los tiempos de espera incluyen
 * `forma_via_admin` y `no_aplica_tejido`. No hay XSD en el repositorio (el XML referencia
 * aemps_prescripcion_vet.xsd, no aportado).
 */

/** Diccionarios del Nomenclátor necesarios para resolver códigos a nombres. */
export interface Diccionarios {
  unidades: Map<number, string>;
  principiosActivos: Map<number, string>;
  laboratorios: Map<number, string>;
  indicaciones: Map<number, string>;
}

export interface InformeCarga {
  leidos: number;
  nuevos: number;
  actualizados: number;
  descartados: number;
  motivosDescarte: Record<string, number>;
  listado: string | null;
}

export interface NomenclatorSink {
  /** CN ya presentes en la caché (para distinguir nuevos de actualizados). */
  existentes(cns: string[]): Promise<Set<string>>;
  upsert(registros: RegistroCache[]): Promise<void>;
}

const SI = (v: string | null) => v !== null && /^s[ií]$/i.test(v.trim());
/** "0,4 " → "0.4"; null si no es un número. */
export const decimalNomenclator = (v: string | null): string | null => {
  const t = v?.trim().replace(',', '.') ?? '';
  return /^\d+(\.\d+)?$/.test(t) ? t : null;
};
const num = (v: string | null): number | null => (v !== null && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : null);

/** cod_estado_registro_* (DICCIONARIO_SITUACION_REGISTRO): 1 Autorizado, 3 Anulado, 4 Suspenso, 5 Suspenso CN. */
export function estadoNomenclator(cod: string | null): EstadoAutorizacion {
  switch (num(cod)) {
    case 1:
      return 'autorizado';
    case 3:
      return 'revocado';
    default:
      // Cualquier otro código (suspenso, suspenso CN, desconocido) se trata como suspendido: conservador.
      return cod === null ? 'autorizado' : 'suspendido';
  }
}

export type ResultadoRegistro = { ok: true; registro: RegistroCache } | { ok: false; motivo: string; cn: string | null };

/** Convierte un `<prescription>` a registro de caché. Puro (salvo diccionarios). */
export function registroDesdeNomenclator(node: XmlNode, dic: Diccionarios, fetchedAt: Date): ResultadoRegistro {
  const cn = xmlText(node, 'cod_nacion');
  const nregistro = xmlText(node, 'nro_definitivo');
  const nombre = xmlText(node, 'nombre_med');
  if (!cn || !/^\d{6}$/.test(cn)) return { ok: false, motivo: 'CN_AUSENTE_O_INVALIDO', cn };
  if (!nregistro) return { ok: false, motivo: 'NREGISTRO_AUSENTE', cn };
  if (!nombre) return { ok: false, motivo: 'NOMBRE_AUSENTE', cn };

  const formas = xmlChildren(node, 'formafarmaceutica');
  const forma = formas[0];
  const unidad = (cod: string | null) => {
    const n = num(cod);
    return n === null ? null : (dic.unidades.get(n) ?? null);
  };
  const pas = formas.flatMap((f) =>
    xmlChildren(f, 'principiosactivos').map((pa) => {
      const paId = num(xmlText(pa, 'cod_principio_activo')) ?? 0;
      return {
        paId,
        nombre: dic.principiosActivos.get(paId) ?? null,
        cantidad: xmlText(pa, 'cantidad'),
        unidad: unidad(xmlText(pa, 'cod_unidad_cantidad')),
      };
    }),
  );
  // Con varias formas (kits) la composición no se puede expresar por una única unidad: no normalizable.
  const porCantidad = formas.length === 1 && forma ? xmlText(forma, 'cantidad_concentracion') : null;
  const porUnidad = formas.length === 1 && forma ? unidad(xmlText(forma, 'unidad_cantidad_concentracion')) : null;
  const titular = num(xmlText(node, 'titular'));

  const especieDe = (v: string | null) => (v === null || /^todas$/i.test(v.trim()) ? null : num(v));
  const formatoNombre = xmlText(node, 'formato') ?? nombre;

  return {
    ok: true,
    registro: {
      medicamento: {
        nregistro,
        nombre,
        nombreNorm: normalizeText(nombre),
        labtitular: titular !== null ? (dic.laboratorios.get(titular) ?? null) : null,
        labtitularId: titular,
        receta: SI(xmlText(node, 'prescripcion')),
        antibiotico: SI(xmlText(node, 'sw_antibiotico')),
        estupefaciente: SI(xmlText(node, 'estupefaciente')),
        psicotropo: SI(xmlText(node, 'psicotropo')),
        tipoMedicamentoId: null,
        formaId: forma ? num(xmlText(forma, 'cod_forma_farmaceutica')) : null,
        administracionId: null,
        dispensacionId: null,
        estado: {
          cod_estado_registro_medicamento: xmlText(node, 'cod_estado_registro_medicamento'),
          cod_situacion_administrativa_medicamento: xmlText(node, 'cod_situacion_administrativa_medicamento'),
        } as never,
        estadoCodigo: estadoNomenclator(xmlText(node, 'cod_estado_registro_medicamento')),
        // La comercialización del Nomenclátor es por formato: la del medicamento se deriva de sus presentaciones.
        comerc: null,
        psum: null,
        ema: null,
        notas: null,
        primeraAutorizacion: xmlText(node, 'fec_primera_aut'),
        // El Nomenclátor usa coma decimal ("0,4"): la columna es numérica.
        cantidadConcentracion: decimalNomenclator(porCantidad),
        unidadConcentracion: porUnidad,
        raw: node as never,
        source: 'nomenclator',
        fetchedAt,
      },
      presentaciones: [
        {
          cn,
          nregistro,
          nombre: formatoNombre,
          nombreNorm: normalizeText(formatoNombre),
          comerc: SI(xmlText(node, 'comercializado')),
          estado: { cod_estado_registro_formato: xmlText(node, 'cod_estado_registro_formato') } as never,
          estadoCodigo: estadoNomenclator(xmlText(node, 'cod_estado_registro_formato')),
          contenido: xmlText(node, 'contenido_total_envase'),
          unidadContenido: unidad(xmlText(node, 'unidad_contenido_total_envase')),
          raw: null,
          source: 'nomenclator',
          fetchedAt,
        },
      ],
      principiosActivos: normalizarPas(pas, porCantidad, porUnidad),
      especies: xmlChildren(node, 'especiesdestino')
        .map((e) => num(xmlText(e, 'cod_espdes')))
        .filter((x): x is number => x !== null),
      vias: [
        ...new Set(
          formas.flatMap((f) => xmlChildren(f, 'viasadministracion').flatMap((v) => xmlTexts(v, 'cod_via_admin').map(Number))),
        ),
      ],
      atc: xmlChildren(node, 'atcvet')
        .map((a) => xmlText(a, 'cod_atcvet'))
        .filter((x): x is string => !!x),
      indicaciones: xmlChildren(node, 'indicacionesespecie')
        .map((i) => {
          const id = num(xmlText(i, 'id_indicacion'));
          return id === null ? null : { indicacionId: id, nombre: dic.indicaciones.get(id) ?? null, especieId: especieDe(xmlText(i, 'especie')) };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
      tiemposEspera: xmlChildren(node, 'tiemposesperaespecie').map((t) => ({
        especieId: especieDe(xmlText(t, 'especie')),
        tejido: xmlText(t, 'tipo_tejido'),
        // En el Nomenclátor el número va en <unidad> y la unidad de tiempo en <unidad_tiempo>.
        cantidad: xmlText(t, 'unidad'),
        unidad: xmlText(t, 'unidad_tiempo'),
        formaViaAdmin: xmlText(t, 'forma_via_admin'),
        noAplicaTejido: SI(xmlText(t, 'no_aplica_tejido')),
      })),
    },
  };
}

/** Agrupa los registros de un lote por nregistro (varios CN comparten medicamento). */
export function agruparPorNregistro(regs: RegistroCache[]): RegistroCache[] {
  const map = new Map<string, RegistroCache>();
  for (const r of regs) {
    const prev = map.get(r.medicamento.nregistro);
    if (!prev) map.set(r.medicamento.nregistro, { ...r, presentaciones: [...r.presentaciones] });
    else prev.presentaciones.push(...r.presentaciones);
  }
  return [...map.values()];
}

/**
 * Importa el Nomenclátor en streaming, por lotes, de forma idempotente (upsert por nregistro/cn)
 * y devuelve el informe de carga (nuevos / actualizados / descartados).
 */
export async function importarNomenclator(
  path: string,
  sink: NomenclatorSink,
  dic: Diccionarios,
  opts: { lote?: number; fetchedAt?: Date } = {},
): Promise<InformeCarga> {
  const tam = opts.lote ?? 200;
  const fetchedAt = opts.fetchedAt ?? new Date();
  const informe: InformeCarga = { leidos: 0, nuevos: 0, actualizados: 0, descartados: 0, motivosDescarte: {}, listado: null };
  let lote: RegistroCache[] = [];
  const vaciar = async () => {
    if (!lote.length) return;
    const cns = lote.flatMap((r) => r.presentaciones.map((p) => p.cn));
    const existentes = await sink.existentes(cns);
    for (const cn of cns) {
      if (existentes.has(cn)) informe.actualizados++;
      else informe.nuevos++;
    }
    await sink.upsert(agruparPorNregistro(lote));
    lote = [];
  };
  for await (const node of streamXmlRecords(path, 'prescription')) {
    informe.leidos++;
    const r = registroDesdeNomenclator(node, dic, fetchedAt);
    if (!r.ok) {
      informe.descartados++;
      informe.motivosDescarte[r.motivo] = (informe.motivosDescarte[r.motivo] ?? 0) + 1;
      continue;
    }
    lote.push(r.registro);
    if (lote.length >= tam) await vaciar();
  }
  await vaciar();
  return informe;
}

/** Fecha del listado (`<header><listprescriptiondate>`), leída en streaming. */
export async function fechaListado(path: string): Promise<string | null> {
  for await (const h of streamXmlRecords(path, 'header')) return xmlText(h, 'listprescriptiondate');
  return null;
}
