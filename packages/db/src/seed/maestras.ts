import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { streamXmlRecords, xmlText } from '@mmx/shared/node';
import type { DbOrTx } from '../client';
import { cimavetMaestra, MAESTRA } from '../schema';

/**
 * Diccionarios del Nomenclátor (fixtures/nomenclator/DICCIONARIO_*.xml) → cimavet_maestra.
 * Etiquetas tomadas de los ficheros reales; no se infiere nada que no esté en ellos.
 */
export const DICCIONARIOS = [
  {
    fichero: 'DICCIONARIO_PRINCIPIOS_ACTIVOS.xml',
    registro: 'principiosactivos',
    id: 'nroprincipioactivo',
    codigo: 'codigoprincipioactivo',
    nombre: 'principioactivo',
    tipo: MAESTRA.PRINCIPIOS_ACTIVOS,
  },
  {
    fichero: 'DICCIONARIO_FORMA_FARMACEUTICA.xml',
    registro: 'formasfarmaceuticas',
    id: 'codigoformafarmaceutica',
    nombre: 'formafarmaceutica',
    tipo: MAESTRA.FORMAS,
  },
  {
    fichero: 'DICCIONARIO_VIAS_ADMINISTRACION.xml',
    registro: 'viasadministracion',
    id: 'codigoviaadministracion',
    nombre: 'viaadministracion',
    tipo: MAESTRA.VIAS,
  },
  {
    fichero: 'DICCIONARIO_LABORATORIOS.xml',
    registro: 'laboratorios',
    id: 'nro_labor',
    nombre: 'des_labor',
    tipo: MAESTRA.LABORATORIOS,
  },
  {
    fichero: 'DICCIONARIO_ATC.xml',
    registro: 'atc',
    codigo: 'codigoatc',
    nombre: 'descatc',
    tipo: MAESTRA.ATC,
  },
  {
    fichero: 'DICCIONARIO_ESPECIES_DESTINO.xml',
    registro: 'especiesdestino',
    id: 'cod_espdes',
    nombre: 'des_espdes',
    tipo: MAESTRA.ESPECIES,
  },
  {
    fichero: 'DICCIONARIO_INTERACCIONES.xml',
    registro: 'interacciones',
    id: 'id_interaccion',
    nombre: 'ds_interaccion',
    tipo: MAESTRA.INTERACCIONES,
  },
  {
    fichero: 'DICCIONARIO_CONTRAINDICICACIONES.xml',
    registro: 'contraindicaciones',
    id: 'id_contraindicacion',
    nombre: 'ds_contraindicacion',
    tipo: MAESTRA.CONTRAINDICACIONES,
  },
  {
    fichero: 'DICCIONARIO_INDICACIONES.xml',
    registro: 'indicaciones',
    id: 'id_indicacion',
    nombre: 'ds_indicacion',
    tipo: MAESTRA.INDICACIONES,
  },
  {
    fichero: 'DICCIONARIO_REACCIONES_ADVERSAS.xml',
    registro: 'reacciones_adversas',
    id: 'id_signo',
    nombre: 'ds_signo',
    tipo: MAESTRA.REACCIONES_ADVERSAS,
  },
  {
    fichero: 'DICCIONARIO_UNIDAD_COMPOSICION.xml',
    registro: 'unidadescomposicion',
    id: 'codigounidadcomposicion',
    nombre: 'unidadcomposicion',
    tipo: MAESTRA.UNIDADES,
  },
  {
    fichero: 'DICCIONARIO_SITUACION_REGISTRO.xml',
    registro: 'situacionesregistro',
    id: 'codigosituacionregistro',
    nombre: 'situacionregistro',
    tipo: MAESTRA.SITUACION_REGISTRO,
  },
  {
    fichero: 'DICCIONARIO_DISPOSITIVOS.xml',
    registro: 'dispositivos',
    id: 'codigodispositivo',
    nombre: 'dispositivo',
    tipo: MAESTRA.DISPOSITIVOS,
  },
] as const satisfies ReadonlyArray<{
  fichero: string;
  registro: string;
  id?: string;
  codigo?: string;
  nombre: string;
  tipo: number;
}>;

export interface InformeMaestras {
  [fichero: string]: { leidos: number; descartados: number };
}

type Row = typeof cimavetMaestra.$inferInsert;

export async function importarMaestras(
  db: DbOrTx,
  dir: string,
  opts: { solo?: number[] } = {},
): Promise<InformeMaestras> {
  const informe: InformeMaestras = {};
  for (const d of DICCIONARIOS) {
    if (opts.solo && !opts.solo.includes(d.tipo)) continue;
    const path = resolve(dir, d.fichero);
    if (!existsSync(path)) {
      informe[d.fichero] = { leidos: 0, descartados: 0 };
      continue;
    }
    let leidos = 0;
    let descartados = 0;
    let batch: Row[] = [];
    const flush = async () => {
      if (!batch.length) return;
      // Deduplica dentro del lote (clave repetida en el diccionario → gana la última).
      const unique = [...new Map(batch.map((r) => [r.clave, r])).values()];
      await db
        .insert(cimavetMaestra)
        .values(unique)
        .onConflictDoUpdate({
          target: [cimavetMaestra.tipo, cimavetMaestra.clave],
          set: { id: sql`excluded.id`, codigo: sql`excluded.codigo`, nombre: sql`excluded.nombre` },
        });
      batch = [];
    };
    for await (const rec of streamXmlRecords(path, d.registro)) {
      leidos++;
      const idTxt = 'id' in d ? xmlText(rec, d.id) : null;
      const codigo = 'codigo' in d ? xmlText(rec, d.codigo) : null;
      const nombre = xmlText(rec, d.nombre)?.trim() ?? null;
      const id = idTxt !== null && /^\d+$/.test(idTxt.trim()) ? Number(idTxt.trim()) : null;
      const clave = id !== null ? String(id) : codigo;
      if (!clave || !nombre) {
        descartados++;
        continue;
      }
      batch.push({ tipo: d.tipo, clave, id, codigo: codigo?.trim() ?? null, nombre });
      if (batch.length >= 500) await flush();
    }
    await flush();
    informe[d.fichero] = { leidos, descartados };
  }
  return informe;
}
