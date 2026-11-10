import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ColumnCipher, createDb, runMigrations, type DbHandle } from '@mmx/db';
import { RegistrosService } from '../src';

/**
 * Integración contra PostgreSQL 16 real (Testcontainers): `pnpm test:int`.
 * PGlite (el resto de tests) acepta `Date` donde postgres-js, el driver de Azure, no: este fichero es el que
 * detecta ese tipo de fallo en los filtros por fecha de los registros (specs/012).
 */
let container: StartedPostgreSqlContainer;
let h: DbHandle;
let reg: RegistrosService;

const OPCS = { incluirPropietario: false, dniCompleto: false };

/** Inserta una salida; `lote` identifica la fila en las aserciones. Devuelve su id. */
async function salida(o: {
  lote: string;
  venta: string;
  original?: string;
  anula?: string;
  nregistro?: string;
}): Promise<string> {
  const res = await h.db.execute(sql`
    insert into dispensacion (id, canal, con_receta, cn, nregistro, nombre_farmaco, lote, unidades,
      metodo_captura, empleado, fecha_venta, fecha_original, anula_dispensacion_id)
    values (gen_random_uuid(), 'presencial', false, '570016', ${o.nregistro ?? null}, 'X', ${o.lote}, 1,
      'manual', 'e', ${o.venta}::timestamptz, ${o.original ?? null}::date, ${o.anula ?? null}::uuid)
    returning id`);
  return (res as unknown as Array<{ id: string }>)[0]!.id;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  h = await createDb(container.getConnectionUri(), { max: 2 });
  await runMigrations(h);
  reg = new RegistrosService({ db: h.db, cipher: new ColumnCipher(randomBytes(32).toString('base64')) });

  // Salidas normales y de alta manual (fecha_original en el pasado).
  await salida({ lote: 'NORMAL', venta: '2026-11-05T10:00:00Z' });
  await salida({ lote: 'MANUAL', venta: '2026-11-06T10:00:00Z', original: '2026-10-20' });
  await salida({ lote: 'MANUAL-DESDE', venta: '2026-11-08T10:00:00Z', original: '2026-11-01' });
  await salida({ lote: 'MANUAL-HASTA', venta: '2026-11-08T10:00:00Z', original: '2026-11-10' });
  // Borde del periodo en hora de Madrid (CET, UTC+1 en noviembre).
  await salida({ lote: 'ULTIMA-HORA', venta: '2026-11-10T22:30:00Z' });
  await salida({ lote: 'DIA-SIGUIENTE', venta: '2026-11-10T23:30:00Z' });
  // Cambio a hora de invierno (domingo 25/10/2026): el día tiene 25 horas.
  await salida({ lote: 'CAMBIO-ANTES', venta: '2026-10-24T21:30:00Z' }); // 23:30 CEST del 24
  await salida({ lote: 'CAMBIO-DENTRO', venta: '2026-10-24T22:30:00Z' }); // 00:30 CEST del 25
  await salida({ lote: 'CAMBIO-DESPUES', venta: '2026-10-25T23:30:00Z' }); // 00:30 CET del 26

  // Psicótropo: salida, anulación otro día y salida de alta manual.
  await h.db.execute(sql`insert into cimavet_medicamento (nregistro, nombre, nombre_norm, psicotropo, source, fetched_at)
    values ('PSI1', 'PSICO', 'psico', true, 'test', now())`);
  const psi = await salida({ lote: 'PSI', venta: '2026-11-03T10:00:00Z', nregistro: 'PSI1' });
  await salida({ lote: 'PSI-ANULA', venta: '2026-11-12T10:00:00Z', nregistro: 'PSI1', anula: psi });
  await salida({ lote: 'PSI-MANUAL', venta: '2026-11-04T10:00:00Z', original: '2026-10-20', nregistro: 'PSI1' });
});
afterAll(async () => {
  await h?.close();
  await container?.stop();
});

const lotes = (xs: Array<{ lote: string }>) => xs.map((x) => x.lote).sort();
// Las filas de psicótropo también son salidas: se descartan por prefijo para comparar solo las normales.
const sinPsi = (xs: string[]) => xs.filter((l) => !l.startsWith('PSI'));

describe('RegistrosService.salidas en PostgreSQL 16', () => {
  it.each([
    ['periodo de noviembre', '2026-11-01', '2026-11-10', ['MANUAL-DESDE', 'MANUAL-HASTA', 'NORMAL', 'ULTIMA-HORA']],
    ['la fecha original manda en el alta manual', '2026-10-20', '2026-10-20', ['MANUAL']],
    ['cambio de hora de invierno', '2026-10-25', '2026-10-25', ['CAMBIO-DENTRO']],
    ['periodo sin salidas', '2026-01-01', '2026-01-31', []],
  ])('%s', async (_n, desde, hasta, esperado) => {
    const res = await reg.salidas(desde, hasta, OPCS);
    expect(sinPsi(lotes(res))).toEqual([...esperado].sort());
  });
});

describe('RegistrosService.psicotropos en PostgreSQL 16', () => {
  const tipos = async (desde: string, hasta: string) =>
    (await reg.psicotropos(desde, hasta)).map((m) => `${m.tipo}:${m.lote}`).sort();

  it('la salida y la de alta manual cuentan en su fecha', async () => {
    expect(await tipos('2026-11-01', '2026-11-10')).toEqual(['SALIDA:PSI']);
    expect(await tipos('2026-10-20', '2026-10-20')).toEqual(['SALIDA:PSI-MANUAL']);
  });

  it('la anulación cuenta el día en que se anula', async () => {
    expect(await tipos('2026-11-12', '2026-11-12')).toEqual(['ANULACIÓN SALIDA:PSI-ANULA']);
  });
});
