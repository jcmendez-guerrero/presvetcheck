import { sql } from 'drizzle-orm';
import type { RulesBundle } from '@mmx/shared';
import type { LoadedRuleFile } from '@mmx/shared/node';
import type { Db } from '../client';
import {
  distribuidor,
  especieIdIndividual,
  plataformaRecetaElectronica,
  procedimientoAprobado,
  reglaVersion,
  sustitucionExclusion,
  usuario,
} from '../schema';
import { importarMaestras } from './maestras';

export { importarMaestras, DICCIONARIOS } from './maestras';

/**
 * Plataformas de receta electrónica (D-14). `reconocida_mapa = null` (sin verificar) hasta que
 * administración lo contraste con el listado del MAPA. "Prescrivet": verificar grafía exacta.
 */
export const PLATAFORMAS_SEMILLA = [
  { id: 'generarecetas', nombre: 'GeneraRecetas', patrones: ['generarecetas'] },
  { id: 'recetas-vet', nombre: 'recetas.vet', patrones: ['recetas.vet'] },
  { id: 'prescrivet', nombre: 'Prescrivet', patrones: ['prescrivet', 'prescrivet.es'] },
  { id: 'recevet', nombre: 'Recevet', patrones: ['recevet'] },
];

export interface SeedOptions {
  fixturesDir: string;
  rules: { bundle: RulesBundle; files: LoadedRuleFile[] };
  /** Datos de demostración (distribuidores, usuarios dev, procedimiento de prueba). Nunca en producción. */
  demo: boolean;
}

export async function seed(db: Db, opts: SeedOptions) {
  const maestras = await importarMaestras(db, opts.fixturesDir);

  await db
    .insert(especieIdIndividual)
    .values(
      opts.rules.bundle.recetaCampos.especies_id_individual.map((especieId) => ({
        especieId,
        obligatorio: true,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(plataformaRecetaElectronica)
    .values(
      PLATAFORMAS_SEMILLA.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        reconocidaMapa: null,
        patronesDeteccion: p.patrones,
      })),
    )
    .onConflictDoNothing();

  for (const f of opts.rules.files) {
    await db
      .insert(reglaVersion)
      .values({ nombreFichero: f.fichero, hash: f.hash, contenido: f.contenido as never, activa: true })
      .onConflictDoNothing();
    // Solo una versión activa por fichero.
    await db.execute(
      sql`update regla_version set activa = (hash = ${f.hash}) where nombre_fichero = ${f.fichero}`,
    );
  }

  const yaExistentes = await db.select().from(sustitucionExclusion);
  for (const e of opts.rules.bundle.exclusiones.exclusiones) {
    if (yaExistentes.some((x) => x.nregistro === e.nregistro && x.paId === e.pa_id)) continue;
    await db.insert(sustitucionExclusion).values({
      nregistro: e.nregistro,
      paId: e.pa_id,
      motivo: e.motivo,
      fuente: e.fuente,
      altaPor: 'seed',
    });
  }

  if (opts.demo) {
    const existentes = await db.select().from(distribuidor).limit(1);
    if (!existentes.length) {
      await db.insert(distribuidor).values([
        { nombre: 'Distribuidor de ejemplo A', cif: 'B00000000' },
        { nombre: 'Distribuidor de ejemplo B', cif: null },
      ]);
    }
    await db
      .insert(usuario)
      .values([
        { entraOid: 'dev-empleado', nombre: 'Empleada de prueba', rolCache: 'empleado' },
        {
          entraOid: 'dev-veterinaria',
          nombre: 'Veterinaria responsable de prueba',
          rolCache: 'veterinaria_responsable',
        },
        { entraOid: 'dev-admin', nombre: 'Administración de prueba', rolCache: 'admin' },
      ])
      .onConflictDoNothing();
    await db
      .insert(procedimientoAprobado)
      .values({
        codigo: 'SUSTITUCION',
        version: '0-dev',
        texto:
          'PROCEDIMIENTO DE PRUEBA (solo desarrollo). La instrucción real del farmacéutico garante (D-01), firmada por él fuera de la app, la carga administración antes de producción.',
        aprobadoPor: 'Farmacéutico garante (firma en papel; cargado por dev-admin)',
        aprobadoAt: new Date('2026-01-01T00:00:00Z'),
        vigente: true,
        soloDesarrollo: true,
      })
      .onConflictDoNothing();
  }
  return { maestras };
}
