import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { CimavetClient, CimavetRepository } from '@mmx/cimavet';
import { ColumnCipher, discrepancia, dispensacion, propietario, receta, reportRun, auditEvent, type DbHandle } from '@mmx/db';
import { createTestDb } from '@mmx/db/testing';
import { fixedClock } from '@mmx/domain';
import { ConsoleMailer, MemoryBlobStore, semanaAnterior } from '@mmx/reports';
import { loadConfig } from '@mmx/shared';
import { loadRules } from '@mmx/shared/node';
import { NotConfiguredSalesMovementsSource } from '@mmx/siweb';
import type { Contexto } from '../src/contexto';
import { JOBS, parsearArgs } from '../src/main';

const ROOT = resolve(__dirname, '../../..');
const REGISTROS_MUESTRA = readFileSync(resolve(ROOT, 'fixtures/nomenclator/PrescripcionVET.sample.xml'), 'utf8').split('<prescription>').length - 1;
let h: DbHandle;
let ctx: Contexto;
let mailer: ConsoleMailer;
let blob: MemoryBlobStore;

beforeAll(async () => {
  h = await createTestDb({ seed: true });
  mailer = new ConsoleMailer();
  blob = new MemoryBlobStore();
  const cipher = new ColumnCipher(Buffer.alloc(32, 9).toString('base64'));
  ctx = {
    config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'x', BLOB_CONNECTION_STRING: 'memory', AUTH_MODE: 'dev', REPORT_RECIPIENTS: 'garante@example.org, jc@example.org' }),
    db: h.db,
    clock: fixedClock('2026-10-19T05:00:00Z'), // lunes 07:00 en Madrid
    rules: loadRules(resolve(ROOT, 'config/rules')).bundle,
    cipher,
    cimavet: { client: new CimavetClient({ baseUrl: 'https://cimavet.test/' }), repo: new CimavetRepository(h.db) },
    siweb: null,
    ventas: new NotConfiguredSalesMovementsSource(),
    blob,
    mailer,
    log: () => {},
  };
  const base = { canal: 'presencial', conReceta: false, cn: '570025', nombreFarmaco: 'ADOEQMINA', lote: 'L1', unidades: 1, metodoCaptura: 'manual', empleado: 'dev-empleado' };
  await h.db.insert(dispensacion).values([
    { ...base, fechaVenta: new Date('2026-10-14T10:00:00Z') },
    { ...base, forzado: true, defectosForzados: ['ENVASE_CADUCADO'], motivoForzado: 'Normalización pendiente', fechaVenta: new Date('2026-10-15T10:00:00Z') },
    { ...base, forzado: true, defectosForzados: ['FIRMA_FALTA'], motivoForzado: 'Llamado al veterinario', fechaVenta: new Date('2026-10-16T10:00:00Z') },
  ]);
}, 120_000);
afterAll(async () => {
  await h.close();
});

describe('worker', () => {
  it('parsea argumentos y expone todos los jobs de AGENTS.md', () => {
    expect(Object.keys(JOBS).sort()).toEqual(['cimavet-delta', 'cimavet-full', 'db-migrate', 'nomenclator-import', 'outbox-dispatcher', 'retention-sweep', 'sales-reconciliation', 'weekly-reports']);
    expect(parsearArgs(['weekly-reports', '--', '--desde', '2026-10-01', '--muestra'])).toEqual({ job: 'weekly-reports', args: { desde: '2026-10-01', muestra: '' } });
  });

  it('weekly-reports: semana anterior, XLSX y CSV en Blob, correo y verificación de la auditoría', async () => {
    expect(semanaAnterior('2026-10-19')).toMatchObject({ desde: '2026-10-12', hasta: '2026-10-18' });
    const r = (await JOBS['weekly-reports']!(ctx, {})) as { hojas: { nombre: string; filas: number }[]; blob: string; auditoria: { ok: boolean } };
    expect(r.hojas.map((x) => x.nombre)).toEqual([
      '1 Entradas',
      '2A Salidas A',
      '2B Salidas B',
      '2C Salidas C',
      '3 Sustituciones',
      '4a Recetas no conformes',
      '4b Dispensaciones forzadas',
      '4c Producto no valido forzado',
      '5 Caducidades proximas',
      '5b Psicotropos',
      '6 Discrepancias',
      '7 Precios de coste',
    ]);
    expect(r.hojas.find((x) => x.nombre === '2B Salidas B')?.filas).toBe(3);
    expect(r.hojas.find((x) => x.nombre === '4b Dispensaciones forzadas')?.filas).toBe(1);
    expect(r.hojas.find((x) => x.nombre === '4c Producto no valido forzado')?.filas).toBe(1);
    expect(r.auditoria.ok).toBe(true);
    const x = await blob.get('reportes', 'semanal/2026-10-12_2026-10-18/reporte-semanal.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x!.bytes) as never);
    expect(wb.worksheets).toHaveLength(12);
    expect(await blob.get('reportes', 'semanal/2026-10-12_2026-10-18/2b-salidas-b.csv')).not.toBeNull();
    expect(mailer.enviados[0]).toMatchObject({ para: ['garante@example.org', 'jc@example.org'] });
    expect(mailer.enviados[0]!.adjuntos![0]!.nombre).toMatch(/\.xlsx$/);
    expect(await h.db.select().from(reportRun)).toHaveLength(1);
  });

  it('weekly-reports avisa en el correo si la cadena de auditoría está rota', async () => {
    const { appendAudit } = await import('@mmx/db');
    const { sql } = await import('drizzle-orm');
    await h.db.transaction((tx) => appendAudit(tx, { actor: 'x', accion: 'y', entidad: 'z' }));
    await h.db.execute(sql`alter table audit_event disable trigger audit_event_append_only`);
    await h.db.update(auditEvent).set({ actor: 'manipulado' });
    await h.db.execute(sql`alter table audit_event enable trigger audit_event_append_only`);
    const r = (await JOBS['weekly-reports']!(ctx, { desde: '2026-10-01', hasta: '2026-10-07' })) as { auditoria: { ok: boolean } };
    expect(r.auditoria.ok).toBe(false);
    expect(mailer.enviados.at(-1)!.asunto).toMatch(/ALERTA/);
  });

  it('sales-reconciliation inactivo sin la API de movimientos (D-02b); activo con un origen configurado', async () => {
    expect(await JOBS['sales-reconciliation']!(ctx, {})).toEqual({ inactivo: 'D-02b' });
    const conVentas = { ...ctx, clock: fixedClock('2026-10-14T20:00:00Z'), ventas: { configurado: true, movimientos: async () => [{ id: 'm1', variantId: 1, cn: '570025', lote: 'OTRO', unidades: 1, fecha: '2026-10-14' }] } };
    expect(await JOBS['sales-reconciliation']!(conVentas, {})).toEqual({ conciliadas: 0, discrepancias: 1 });
    expect((await h.db.select().from(discrepancia))[0]?.tipo).toBe('LOTE_DISTINTO');
  });

  it('outbox-dispatcher inactivo sin Siweb360 o con escritura desactivada', async () => {
    expect(await JOBS['outbox-dispatcher']!(ctx, {})).toEqual({ inactivo: 'Siweb360 no configurado' });
    expect(await JOBS['outbox-dispatcher']!({ ...ctx, siweb: {} as never }, {})).toEqual({ inactivo: 'SIWEB_STOCK_WRITE_MODE=off' });
  });

  it('retention-sweep anonimiza recetas y propietarios de más de 5 años sin tocar los registros', async () => {
    const viejo = new Date('2020-01-01T00:00:00Z');
    const [p] = await h.db.insert(propietario).values({ nombreEnc: ctx.cipher.encrypt('Nombre'), dniEnc: ctx.cipher.encrypt('12345678Z'), createdAt: viejo }).returning();
    const [r] = await h.db.insert(receta).values({ tipo: 'papel', creadaPor: 'x', createdAt: viejo, confirmacion: { titular: { nombre: 'cifrado', telefono: 'cifrado' } }, extraccion: { cifrado: 'v1:x' } }).returning();
    const res = (await JOBS['retention-sweep']!(ctx, {})) as { recetasAnonimizadas: number; propietariosAnonimizados: number };
    expect(res).toMatchObject({ recetasAnonimizadas: 1, propietariosAnonimizados: 1 });
    const [r2] = await h.db.select().from(receta).where(eq(receta.id, r!.id));
    expect(r2!.extraccion).toBeNull();
    expect((r2!.confirmacion as { titular: unknown }).titular).toEqual({ nombre: null, telefono: null });
    const [p2] = await h.db.select().from(propietario).where(eq(propietario.id, p!.id));
    expect(p2!.dniEnc).toBeNull();
  });

  it('nomenclator-import exige fichero o muestra', async () => {
    await expect(JOBS['nomenclator-import']!(ctx, {})).rejects.toThrow(/--descargar|--fichero|--muestra/);
    const r = (await JOBS['nomenclator-import']!(ctx, { muestra: '' })) as { leidos: number };
    expect(r.leidos).toBe(REGISTROS_MUESTRA);
  }, 120_000);
});
