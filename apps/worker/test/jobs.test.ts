import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { eq, sql } from 'drizzle-orm';
import { CimavetClient, CimavetRepository } from '@mmx/cimavet';
import {
  ColumnCipher,
  salidaImportada,
  procedimientoAprobado,
  discrepancia,
  dispensacion,
  distribuidor,
  entradaImportada,
  importacion,
  propietario,
  receta,
  recetaImagen,
  recetaLinea,
  recepcion,
  recepcionLinea,
  reportRun,
  auditEvent,
  type DbHandle,
} from '@mmx/db';
import { createTestDb } from '@mmx/db/testing';
import { fixedClock } from '@mmx/domain';
import { ConsoleMailer, MemoryBlobStore, semanaAnterior } from '@mmx/reports';
import { loadConfig } from '@mmx/shared';
import { loadRules } from '@mmx/shared/node';
import { NotConfiguredSalesMovementsSource } from '@mmx/siweb';
import type { Contexto } from '../src/contexto';
import { JOBS, parsearArgs } from '../src/main';

const ROOT = resolve(__dirname, '../../..');
const REGISTROS_MUESTRA =
  readFileSync(resolve(ROOT, 'fixtures/nomenclator/PrescripcionVET.sample.xml'), 'utf8').split(
    '<prescription>',
  ).length - 1;
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
    config: loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'x',
      BLOB_CONNECTION_STRING: 'memory',
      AUTH_MODE: 'dev',
      REPORT_RECIPIENTS: 'garante@example.org, jc@example.org',
    }),
    db: h.db,
    clock: fixedClock('2026-10-19T05:00:00Z'), // lunes 07:00 en Madrid
    rules: loadRules(resolve(ROOT, 'config/rules')).bundle,
    cipher,
    cimavet: {
      client: new CimavetClient({ baseUrl: 'https://cimavet.test/' }),
      repo: new CimavetRepository(h.db),
    },
    siweb: null,
    ventas: new NotConfiguredSalesMovementsSource(),
    blob,
    mailer,
    log: () => {},
  };
  const base = {
    canal: 'presencial',
    conReceta: false,
    cn: '570025',
    nombreFarmaco: 'ADOEQMINA',
    lote: 'L1',
    unidades: 1,
    metodoCaptura: 'manual',
    empleado: 'dev-empleado',
  };
  await h.db.insert(dispensacion).values([
    { ...base, fechaVenta: new Date('2026-10-14T10:00:00Z') },
    {
      ...base,
      forzado: true,
      defectosForzados: ['ENVASE_CADUCADO'],
      motivoForzado: 'Normalización pendiente',
      fechaVenta: new Date('2026-10-15T10:00:00Z'),
    },
    {
      ...base,
      forzado: true,
      defectosForzados: ['FIRMA_FALTA'],
      motivoForzado: 'Llamado al veterinario',
      fechaVenta: new Date('2026-10-16T10:00:00Z'),
    },
  ]);
}, 120_000);
afterAll(async () => {
  await h.close();
});

describe('worker', () => {
  it('parsea argumentos y expone todos los jobs de AGENTS.md', () => {
    expect(Object.keys(JOBS).sort()).toEqual([
      'cimavet-delta',
      'cimavet-full',
      'db-migrate',
      'importaciones-corregir',
      'nomenclator-import',
      'outbox-dispatcher',
      'procedimiento-cargar',
      'retention-sweep',
      'sales-reconciliation',
      'weekly-reports',
    ]);
    expect(parsearArgs(['weekly-reports', '--', '--desde', '2026-10-01', '--muestra'])).toEqual({
      job: 'weekly-reports',
      args: { desde: '2026-10-01', muestra: '' },
    });
  });

  it('weekly-reports: semana anterior, XLSX y CSV en Blob, correo y verificación de la auditoría', async () => {
    expect(semanaAnterior('2026-10-19')).toMatchObject({ desde: '2026-10-12', hasta: '2026-10-18' });
    const r = (await JOBS['weekly-reports']!(ctx, {})) as {
      hojas: { nombre: string; filas: number }[];
      blob: string;
      auditoria: { ok: boolean };
    };
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
    const r = (await JOBS['weekly-reports']!(ctx, { desde: '2026-10-01', hasta: '2026-10-07' })) as {
      auditoria: { ok: boolean };
    };
    expect(r.auditoria.ok).toBe(false);
    expect(mailer.enviados.at(-1)!.asunto).toMatch(/ALERTA/);
  });

  it('sales-reconciliation inactivo sin fuente de ventas; activo con un origen configurado', async () => {
    expect(await JOBS['sales-reconciliation']!(ctx, {})).toEqual({ inactivo: true });
    const conVentas = {
      ...ctx,
      clock: fixedClock('2026-10-14T20:00:00Z'),
      ventas: {
        configurado: true,
        movimientos: async () => [
          { id: 'm1', variantId: 1, cn: '570025', lote: 'OTRO', unidades: 1, fecha: '2026-10-14' },
        ],
      },
    };
    expect(await JOBS['sales-reconciliation']!(conVentas, {})).toEqual({
      conciliadas: 0,
      loteSinVerificar: 0,
      discrepancias: 1,
    });
    expect((await h.db.select().from(discrepancia))[0]?.tipo).toBe('LOTE_DISTINTO');
    // Repetir el cierre no duplica la discrepancia.
    expect(await JOBS['sales-reconciliation']!(conVentas, {})).toEqual({
      conciliadas: 0,
      loteSinVerificar: 0,
      discrepancias: 0,
    });
    expect(await h.db.select().from(discrepancia)).toHaveLength(1);
  });

  it('procedimiento-cargar: la nueva versión queda vigente y la anterior no; exige texto y autor', async () => {
    const texto =
      'Directrices de sustitución de prueba: equivalente con la misma composición, forma y dosis.';
    await expect(JOBS['procedimiento-cargar']!(ctx, { version: '1' })).rejects.toThrow(
      /Uso: procedimiento-cargar/,
    );
    await JOBS['procedimiento-cargar']!(ctx, {
      version: '1',
      'aprobado-por': 'Garante (firma en papel)',
      'texto-b64': Buffer.from(texto).toString('base64'),
    });
    const r = await JOBS['procedimiento-cargar']!(ctx, {
      version: '2',
      'aprobado-por': 'Garante',
      texto: `${texto} Revisión 2.`,
      'aprobado-el': '2026-10-20',
    });
    expect(r).toMatchObject({ codigo: 'SUSTITUCION', version: '2' });
    const todos = await h.db.select().from(procedimientoAprobado);
    expect(todos.filter((p) => p.vigente).map((p) => p.version)).toEqual(['2']);
    expect(todos.find((p) => p.version === '2')).toMatchObject({
      soloDesarrollo: false,
      aprobadoPor: 'Garante',
    });
  });

  it('outbox-dispatcher inactivo sin Siweb360 o con escritura desactivada', async () => {
    expect(await JOBS['outbox-dispatcher']!(ctx, {})).toEqual({ inactivo: 'Siweb360 no configurado' });
    expect(await JOBS['outbox-dispatcher']!({ ...ctx, siweb: {} as never }, {})).toEqual({
      inactivo: 'SIWEB_STOCK_WRITE_MODE=off',
    });
  });

  it('retention-sweep ELIMINA lo de más de 5 años (salidas, recetas con imágenes, propietarios, entradas) y deja lo reciente', async () => {
    const viejo = new Date('2020-01-01T00:00:00Z');
    const [p] = await h.db
      .insert(propietario)
      .values({
        nombreEnc: ctx.cipher.encrypt('Nombre'),
        dniEnc: ctx.cipher.encrypt('12345678Z'),
        createdAt: viejo,
      })
      .returning();
    const [r] = await h.db
      .insert(receta)
      .values({ tipo: 'papel', creadaPor: 'x', createdAt: viejo, propietarioId: p!.id })
      .returning();
    const [l] = await h.db
      .insert(recetaLinea)
      .values({ recetaId: r!.id, orden: 1, createdAt: viejo })
      .returning();
    await blob.put('recetas', `${r!.id}/pagina-1.png`, new Uint8Array([1]), 'image/png');
    await h.db.insert(recetaImagen).values({
      recetaId: r!.id,
      pagina: 1,
      blobPath: `${r!.id}/pagina-1.png`,
      mime: 'image/png',
      sha256: 'x',
      createdAt: viejo,
    });
    const base = {
      canal: 'presencial',
      conReceta: true,
      cn: '570016',
      nombreFarmaco: 'X',
      lote: 'L',
      unidades: 1,
      metodoCaptura: 'manual',
      empleado: 'e',
      fechaVenta: viejo,
      createdAt: viejo,
    };
    const [dv] = await h.db
      .insert(dispensacion)
      .values({ ...base, recetaId: r!.id, recetaLineaId: l!.id, propietarioId: p!.id })
      .returning();
    // Original antiguo con anulación reciente: se conservan los dos.
    const [o] = await h.db
      .insert(dispensacion)
      .values({ ...base, conReceta: false })
      .returning();
    await h.db.insert(dispensacion).values({
      ...base,
      conReceta: false,
      anulaDispensacionId: o!.id,
      motivoAnulacion: 'x',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fechaVenta: new Date('2026-01-01T00:00:00Z'),
    });
    const [d] = await h.db.insert(distribuidor).values({ nombre: 'Viejo' }).returning();
    const [rc] = await h.db
      .insert(recepcion)
      .values({ distribuidorId: d!.id, fechaCompra: '2020-01-01', empleado: 'e', createdAt: viejo })
      .returning();
    await h.db.insert(recepcionLinea).values({
      recepcionId: rc!.id,
      numero: 1,
      nombreFarmaco: 'X',
      unidades: 1,
      empleado: 'e',
      origenDatos: 'manual',
      createdAt: viejo,
    });
    await h.db.update(recepcion).set({ estado: 'FINALIZADA' }).where(eq(recepcion.id, rc!.id));

    // Registros anteriores importados: uno antiguo (se purga) y uno reciente (se queda).
    const [imp] = await h.db
      .insert(importacion)
      .values({
        tipo: 'entradas',
        fichero: 'antiguo.xlsx',
        sha256: 'h',
        filas: 2,
        creadaPor: 'e',
        createdAt: viejo,
      })
      .returning();
    const ent = { importacionId: imp!.id, distribuidor: 'D', nombreFarmaco: 'X', unidades: 1 };
    const [ev] = await h.db
      .insert(entradaImportada)
      .values({ ...ent, fila: 2, fecha: '2019-06-01' })
      .returning();
    await h.db.insert(entradaImportada).values({ ...ent, fila: 3, fecha: '2026-06-01' });
    // De solo inserción: ni se modifican ni se borran fuera de la purga.
    await expect(
      h.db.update(entradaImportada).set({ unidades: 9 }).where(eq(entradaImportada.id, ev!.id)),
    ).rejects.toThrow();
    await expect(h.db.delete(entradaImportada).where(eq(entradaImportada.id, ev!.id))).rejects.toThrow();

    // Sin la marca de purga la base de datos no deja borrar ni lo antiguo.
    await expect(h.db.delete(dispensacion).where(eq(dispensacion.id, dv!.id))).rejects.toThrow();

    const res = (await JOBS['retention-sweep']!(ctx, { anios: '1' })) as Record<string, unknown>;
    expect(res).toMatchObject({
      dispensaciones: 1,
      recetas: 1,
      propietarios: 1,
      recepciones: 1,
      blobsBorrados: 1,
      importadas: 1,
    });
    expect((await h.db.select().from(entradaImportada)).map((x) => x.fecha)).toEqual(['2026-06-01']);
    expect(await h.db.select().from(receta).where(eq(receta.id, r!.id))).toEqual([]);
    expect(await h.db.select().from(propietario).where(eq(propietario.id, p!.id))).toEqual([]);
    expect(await h.db.select().from(dispensacion).where(eq(dispensacion.id, o!.id))).toHaveLength(1);
    expect(await blob.get('recetas', `${r!.id}/pagina-1.png`)).toBeNull();
    // Lo reciente sigue (las dispensaciones de 2026 del beforeAll) y la auditoría registra la purga.
    expect((await h.db.select().from(dispensacion)).length).toBeGreaterThanOrEqual(4);
    expect(
      (await h.db.select().from(auditEvent).where(eq(auditEvent.accion, 'retencion_eliminar'))).length,
    ).toBe(1);
  });

  it('con la marca de purga, la base de datos sigue impidiendo borrar filas de menos de 5 años', async () => {
    const [x] = await h.db.select().from(dispensacion).limit(1);
    await expect(
      h.db.transaction(async (tx) => {
        await tx.execute(sql`set local mmx.purga_retencion = 'on'`);
        await tx.delete(dispensacion).where(eq(dispensacion.id, x!.id));
      }),
    ).rejects.toThrow();
  });

  it('nomenclator-import exige fichero o muestra', async () => {
    await expect(JOBS['nomenclator-import']!(ctx, {})).rejects.toThrow(/--descargar|--fichero|--muestra/);
    const r = (await JOBS['nomenclator-import']!(ctx, { muestra: '' })) as { leidos: number };
    expect(r.leidos).toBe(REGISTROS_MUESTRA);
  }, 120_000);

  it('importaciones-corregir: sin --aplicar solo informa; con --aplicar crea la corregida con CIMAVet y anula la original', async () => {
    await JOBS['nomenclator-import']!(ctx, { muestra: '' });
    const [imp] = await h.db
      .insert(importacion)
      .values({
        tipo: 'salidas',
        fichero: 'antiguo.csv',
        sha256: 'x-corregir',
        filas: 3,
        creadaPor: 'dev-veterinaria',
      })
      .returning();
    const enc = ctx.cipher.encrypt('Titular de prueba');
    await h.db.insert(salidaImportada).values([
      {
        importacionId: imp!.id,
        fila: 2,
        fecha: '2025-02-05',
        plantilla: 'A',
        nombreFarmaco: 'clavubay 400',
        principioActivo: 'amoxicilina',
        forma: 'comp',
        cn: '570016',
        lote: 'L1',
        unidades: 1,
        clinica: 'Clínica de prueba',
        propietarioNombreEnc: enc,
      },
      {
        importacionId: imp!.id,
        fila: 3,
        fecha: '2025-02-06',
        plantilla: 'B',
        nombreFarmaco: 'Sin código',
        cn: null,
        lote: 'L2',
        unidades: 1,
      },
      {
        importacionId: imp!.id,
        fila: 4,
        fecha: '2025-02-07',
        plantilla: 'B',
        nombreFarmaco: 'Clavubay 400 mg comprimidos',
        principioActivo: 'amoxi',
        forma: 'comp',
        cn: null,
        lote: 'L3',
        unidades: 1,
      },
    ]);
    const prueba = (await JOBS['importaciones-corregir']!(ctx, { importacion: imp!.id })) as {
      aplicado: boolean;
      importaciones: {
        cambios: Record<string, number>;
        sinCn: number;
        sinIdentificar: number;
        corregida: string | null;
      }[];
    };
    expect(prueba.aplicado).toBe(false);
    expect(prueba.importaciones[0]).toMatchObject({
      cambios: { nombre: 2, principioActivo: 2, forma: 2 },
      sinCn: 2,
      sinIdentificar: 1,
      corregida: null,
    });
    expect(
      (await h.db.select().from(importacion).where(eq(importacion.id, imp!.id)))[0]!.anuladaAt,
    ).toBeNull();

    const r = (await JOBS['importaciones-corregir']!(ctx, {
      importacion: imp!.id,
      aplicar: '',
    })) as typeof prueba;
    const nueva = r.importaciones[0]!.corregida!;
    expect(
      (await h.db.select().from(importacion).where(eq(importacion.id, imp!.id)))[0]!.motivoAnulacion,
    ).toContain(nueva);
    const filas = await h.db.select().from(salidaImportada).where(eq(salidaImportada.importacionId, nueva));
    const f2 = filas.find((f) => f.fila === 2)!;
    expect(f2).toMatchObject({ forma: 'COMPRIMIDO', clinica: 'Clínica de prueba', lote: 'L1' });
    expect(f2.nombreFarmaco).toMatch(/^CLAVUBAY/);
    expect(f2.principioActivo).toMatch(/amoxicilina trihidrato/);
    expect(ctx.cipher.decrypt(f2.propietarioNombreEnc)).toBe('Titular de prueba');
    expect(filas.find((f) => f.fila === 3)).toMatchObject({ nombreFarmaco: 'Sin código', cn: null });
    // Sin código nacional, pero CIMAVet lo reconoce por el nombre: también se corrige (sin inventar el CN).
    const f4 = filas.find((f) => f.fila === 4)!;
    expect(f4).toMatchObject({ cn: null, forma: 'COMPRIMIDO', lote: 'L3' });
    expect(f4.nombreFarmaco).toMatch(/^CLAVUBAY/);
    expect(f4.principioActivo).toMatch(/amoxicilina trihidrato/);
    // La original sigue guardada (no se borra ni se modifica).
    expect(
      await h.db.select().from(salidaImportada).where(eq(salidaImportada.importacionId, imp!.id)),
    ).toHaveLength(3);
  });
});
