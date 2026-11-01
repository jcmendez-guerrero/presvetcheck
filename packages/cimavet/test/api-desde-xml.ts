/**
 * Respuestas de la API REST de CIMAVet DERIVADAS del Nomenclátor XML (fixtures/nomenclator/, descargado
 * de CIMAVet con `pnpm nomenclator:fetch`). No hay JSON hecho a mano: los valores salen del XML real y la
 * forma (nombres de campo, envoltorio de listas, fechas en ms epoch de la medianoche de Madrid) es la
 * observada en la API real y documentada en docs/ref/cimavet-respuestas.md.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DICCIONARIOS, MAESTRA } from '@mmx/db';
import { streamXmlRecords, xmlText } from '@mmx/shared/node';
import { agruparPorNregistro, registroDesdeNomenclator, type Diccionarios } from '../src/nomenclator';
import type { RegistroCache } from '../src/normalizar';

export const DIR_NOMENCLATOR = resolve(__dirname, '../../../fixtures/nomenclator');
export const MUESTRA = resolve(DIR_NOMENCLATOR, 'PrescripcionVET.sample.xml');

if (!existsSync(MUESTRA)) {
  throw new Error(
    'Faltan los XML del Nomenclátor (no se versionan). Ejecuta `pnpm nomenclator:fetch` para descargarlos de CIMAVet.',
  );
}

type Mapa = Map<number, string>;

async function diccionario(tipo: number): Promise<Mapa> {
  const d = DICCIONARIOS.find((x) => x.tipo === tipo);
  const out: Mapa = new Map();
  if (!d || !('id' in d)) return out;
  for await (const r of streamXmlRecords(resolve(DIR_NOMENCLATOR, d.fichero), d.registro)) {
    const id = Number(xmlText(r, d.id));
    const nombre = xmlText(r, d.nombre)?.trim();
    if (Number.isFinite(id) && nombre) out.set(id, nombre);
  }
  return out;
}

export interface Muestra {
  registros: Map<string, RegistroCache>;
  formas: Mapa;
  vias: Mapa;
  especies: Mapa;
}

let cache: Promise<Muestra> | null = null;

/** Registros de la muestra del Nomenclátor agrupados por nregistro, con los diccionarios necesarios. */
export function muestra(): Promise<Muestra> {
  cache ??= (async () => {
    const dic: Diccionarios = {
      unidades: await diccionario(MAESTRA.UNIDADES),
      principiosActivos: await diccionario(MAESTRA.PRINCIPIOS_ACTIVOS),
      laboratorios: await diccionario(MAESTRA.LABORATORIOS),
      indicaciones: await diccionario(MAESTRA.INDICACIONES),
    };
    const regs: RegistroCache[] = [];
    for await (const n of streamXmlRecords(MUESTRA, 'prescription')) {
      const r = registroDesdeNomenclator(n, dic, new Date(0));
      if (r.ok) regs.push(r.registro);
    }
    return {
      registros: new Map(agruparPorNregistro(regs).map((r) => [r.medicamento.nregistro, r])),
      formas: await diccionario(MAESTRA.FORMAS),
      vias: await diccionario(MAESTRA.VIAS),
      especies: await diccionario(MAESTRA.ESPECIES),
    };
  })();
  return cache;
}

/** AAAA-MM-DD → ms epoch de la medianoche en Madrid (como los devuelve la API real). */
export function msMadrid(fecha: string): number {
  const utc = Date.parse(`${fecha}T00:00:00Z`);
  const desfase = new Date(utc)
    .toLocaleString('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'shortOffset' })
    .match(/GMT([+-]\d+)/);
  return utc - Number(desfase?.[1] ?? 0) * 3_600_000;
}

const estadoApi = (codigo: string | null | undefined, desde: number) =>
  codigo === 'revocado'
    ? { aut: desde, rev: desde }
    : codigo === 'suspendido'
      ? { aut: desde, susp: desde }
      : { aut: desde };

const item = (id: number | null | undefined, m: Mapa) =>
  id === null || id === undefined ? null : { id, nombre: m.get(id) ?? null };

/** `GET medicamento?nregistro=` construido a partir del registro del Nomenclátor. */
export async function medicamentoApi(nregistro: string): Promise<Record<string, unknown>> {
  const { registros, formas, vias, especies } = await muestra();
  const r = registros.get(nregistro);
  if (!r) throw new Error(`${nregistro} no está en la muestra del Nomenclátor`);
  const m = r.medicamento;
  const aut = msMadrid(m.primeraAutorizacion ?? '2000-01-01');
  return {
    nregistro: m.nregistro,
    nombre: m.nombre,
    pactivos: (r.principiosActivos ?? []).map((p) => p.nombre).join(';'),
    labtitular: m.labtitular,
    primeraAutorizacion: aut,
    estado: estadoApi(m.estadoCodigo, aut),
    comerc: m.comerc ?? r.presentaciones.some((p) => p.comerc === true),
    receta: m.receta,
    estupefaciente: m.estupefaciente,
    psicotropo: m.psicotropo,
    antibiotico: m.antibiotico,
    notas: false,
    ema: false,
    atcs: (r.atc ?? []).map((codigo) => ({ codigo, nivel: 5 })),
    formasFarmaceuticas: [item(m.formaId, formas)].filter(Boolean),
    principiosActivos: (r.principiosActivos ?? []).map((p) => ({
      id: p.paId,
      nombre: p.nombre,
      cantidad: p.cantidadRaw,
      unidad: p.unidadRaw,
      orden: p.orden,
    })),
    viasAdministracion: (r.vias ?? []).map((id) => item(id, vias)),
    especies: (r.especies ?? []).map((id) => item(id, especies)),
    indicaciones: (r.indicaciones ?? []).map((i) => ({
      especie: item(i.especieId, especies),
      id: i.indicacionId,
      nombre: i.nombre,
    })),
    tiemposEspera: (r.tiemposEspera ?? []).map((t) => ({
      especie: item(t.especieId, especies),
      ...(t.tejido ? { tejido: { nombre: t.tejido } } : {}),
      ...(t.cantidad ? { cantidad: t.cantidad } : {}),
      ...(t.unidad ? { unidadTiempo: { nombre: t.unidad } } : {}),
    })),
    presentaciones: r.presentaciones.map((p) => ({
      cn: p.cn,
      nombre: p.nombre,
      estado: estadoApi(p.estadoCodigo, aut),
      comerc: p.comerc,
      psum: false,
    })),
  };
}

/** Envoltorio real de las listas paginadas. */
export const listaApi = (resultados: unknown[], pagina = 1, tamanioPagina = 25) => ({
  totalFilas: resultados.length,
  pagina,
  tamanioPagina,
  resultados,
});

/** `GET registroCambios`: tipoCambio 1 alta, 2 baja, 3 modificación (doc v1.4). */
export const registroCambiosApi = (
  cambios: { nregistro: string; fecha: string; tipoCambio: 1 | 2 | 3; cambio?: string[] }[],
) =>
  listaApi(
    cambios.map((c) => ({
      nregistro: c.nregistro,
      fecha: msMadrid(c.fecha),
      tipoCambio: c.tipoCambio,
      cambio: c.cambio ?? [],
    })),
  );

/** `GET maestras?maestra=7` (especies) desde DICCIONARIO_ESPECIES_DESTINO.xml. */
export async function maestraEspeciesApi(ids: number[]) {
  const { especies } = await muestra();
  return listaApi(ids.map((id) => ({ id, nombre: especies.get(id) ?? null })));
}

/** Cambia la capitalización de las claves (Comerc, Id…) para probar la normalización del cliente. */
export function capitalizarClaves(v: unknown, claves: string[]): unknown {
  if (Array.isArray(v)) return v.map((x) => capitalizarClaves(x, claves));
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        claves.includes(k) ? k[0]!.toUpperCase() + k.slice(1) : k,
        capitalizarClaves(x, claves),
      ]),
    );
  }
  return v;
}
