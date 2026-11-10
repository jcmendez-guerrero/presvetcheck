import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  distribuidor,
  recepcion,
  recepcionLinea,
  cimavetMedicamento,
  dispensacion,
  importacion,
  outbox,
  receta,
  salidaImportada,
} from '@mmx/db';
import type { DemoSalesMovementsSource } from '@mmx/siweb';
import { generarReporteSemanal } from '@mmx/reports';
import { primeraDispensacion } from '../src/servicios/dispensaciones';
import { ACTIVA, altaManual, api, datosManuales, entorno, multipart } from './entorno';

const SIN_VENTA = 'SIN_MOVIMIENTO_STOCK_RETROSPECTIVO';

/** Entrega de 1 envase de CLAVUBAY (CN 570016) de la línea 1. Sin Siweb360 en los tests no hay venta del día. */
const entrega = (recetaId: string, fechaOriginal: string, forzar: string[] = [SIN_VENTA]) => ({
  conReceta: true,
  recetaId,
  lineaOrden: 1,
  cn: '570016',
  envases: [
    {
      lote: 'LOTE-MANUAL',
      caducidad: '2026-10-10',
      unidades: 1,
      metodoCaptura: 'manual',
      cnEscaneado: '570016',
    },
  ],
  modo: 'en_vivo',
  fechaOriginal,
  ...(forzar.length
    ? {
        forzado: {
          codigos: forzar,
          motivo: 'Entrega anterior a la aplicación, sin ticket localizado',
          aceptaRiesgos: true,
        },
      }
    : {}),
});

async function recetaManualConfirmada(numero: string) {
  const e = await entorno(ACTIVA);
  const id = await altaManual(e.app);
  const r = await api(
    e.app,
    'dev-veterinaria',
    'PUT',
    `/api/recetas/${id}/confirmacion`,
    datosManuales(numero),
  );
  expect(r.status).toBe(200);
  return { ...e, id };
}

describe('Dispensación de una receta de alta manual en su fecha original', () => {
  it('evalúa la validez en la fecha de entrega, no hoy (antimicrobiano, 5 días)', async () => {
    // Emitida el 01/10. Hoy (reloj de pruebas) es el 14/10: estaría caducada; el 04/10 no lo estaba.
    const { app, h, id } = await recetaManualConfirmada('RM-VALIDA');
    const sinForzar = await api(
      app,
      'dev-veterinaria',
      'POST',
      '/api/dispensaciones',
      entrega(id, '2026-10-04', []),
    );
    expect(sinForzar.json.error).toMatchObject({
      code: 'DISPENSACION_BLOQUEADA',
      detalles: { forzables: [SIN_VENTA] },
    });

    const ok = await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, '2026-10-04'));
    expect(ok.status).toBe(201);
    const [d] = await h.db.select().from(dispensacion).where(eq(dispensacion.recetaId, id));
    expect(d).toMatchObject({ modo: 'retrospectivo', fechaOriginal: '2026-10-04', lote: 'LOTE-MANUAL' });
    const [r] = await h.db.select().from(receta).where(eq(receta.id, id));
    const dia = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(
      r!.primeraDispensacionAt!,
    );
    expect(dia).toBe('2026-10-04');
    // El envase caducó el 10/10, después de la entrega: no cuenta como caducado.
    expect(d!.avisos ?? []).not.toContain('ENVASE_CADUCADO');
    // Nunca se escribe stock de salida en Siweb360.
    expect(await h.db.select().from(outbox)).toHaveLength(0);
  });

  it('fuera de plazo en la fecha de entrega solo se registra forzando con motivo', async () => {
    const { app, id } = await recetaManualConfirmada('RM-CADUC');
    const r = await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, '2026-10-08'));
    // Forzar solo la falta de venta no basta: la caducidad en esa fecha también hay que asumirla.
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('FORZADO_CODIGOS_NO_COINCIDEN');
    expect(r.json.error.detalles.esperados).toContain('RECETA_CADUCADA');
    const forzada = await api(
      app,
      'dev-veterinaria',
      'POST',
      '/api/dispensaciones',
      entrega(id, '2026-10-08', ['RECETA_CADUCADA', SIN_VENTA]),
    );
    expect(forzada.status).toBe(201);
  });

  it.each([
    ['posterior a hoy', '2026-10-15'],
    ['anterior a la emisión', '2026-09-30'],
  ])('rechaza una fecha de entrega %s', async (_caso, fecha) => {
    const { app, id } = await recetaManualConfirmada(`RM-F${fecha}`);
    const r = await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, fecha));
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('FECHA_ORIGINAL_INVALIDA');
  });

  it('funciona con el modo formación apagado y la registra siempre como retrospectiva', async () => {
    const { app, h, id, deps } = await recetaManualConfirmada('RM-MODO');
    expect(deps.config.RETROSPECTIVE_DISPENSATION_MODE).toBe('disabled');
    const r = await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, '2026-10-03'));
    expect(r.status).toBe(201);
    const [d] = await h.db.select().from(dispensacion).where(eq(dispensacion.recetaId, id));
    expect(d!.modo).toBe('retrospectivo');
  });

  it('un empleado no puede registrar la entrega de una receta de alta manual', async () => {
    const { app, id } = await recetaManualConfirmada('RM-EMPL');
    const r = await api(app, 'dev-empleado', 'POST', '/api/dispensaciones', entrega(id, '2026-10-03'));
    expect(r.status).toBe(403);
  });

  it('evaluar un borrador sin confirmar no abre la puerta a registrar la entrega', async () => {
    // El resultado se puede abrir con el borrador a medias (especie escrita a mano): evaluar no lo confirma.
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    await api(
      app,
      'dev-veterinaria',
      'PUT',
      `/api/recetas/${id}/confirmacion`,
      datosManuales('RM-EVBORR', {
        comprobadoConOriginal: false,
        especie: { texto: 'Perro escrito a mano', especieId: null },
      }),
    );
    expect((await api(app, 'dev-veterinaria', 'POST', `/api/recetas/${id}/evaluar`, {})).status).toBe(200);
    const r = await api(
      app,
      'dev-veterinaria',
      'POST',
      '/api/dispensaciones',
      entrega(id, '2026-10-03', ['ESPECIE_FALTA', SIN_VENTA]),
    );
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('VALIDACION');
  });

  it('exige confirmar los datos de la receta antes de registrar la entrega', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    await api(
      app,
      'dev-veterinaria',
      'PUT',
      `/api/recetas/${id}/confirmacion`,
      datosManuales('RM-SINCONF', { comprobadoConOriginal: false }),
    );
    const r = await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, '2026-10-03'));
    expect(r.status).toBe(400);
  });
});

describe('Receta de alta manual ya registrada en las salidas importadas', () => {
  it('se rechaza como ya dispensada y no se puede forzar', async () => {
    const { app, h, id } = await recetaManualConfirmada('RM-IMPORT');
    const [imp] = await h.db
      .insert(importacion)
      .values({
        tipo: 'salidas',
        fichero: 'salidas.xlsx',
        sha256: 'x'.repeat(64),
        filas: 1,
        creadaPor: 'dev-admin',
      })
      .returning();
    await h.db.insert(salidaImportada).values({
      importacionId: imp!.id,
      fila: 2,
      fecha: '2026-10-03',
      plantilla: 'A',
      nombreFarmaco: 'CLAVUBAY',
      numeroReceta: 'RM-IMPORT',
      numColegiado: '28/1234',
    });
    const r = await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, '2026-10-03'));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.json.error)).toContain('RECETA_YA_DISPENSADA');
    const forzada = await api(
      app,
      'dev-veterinaria',
      'POST',
      '/api/dispensaciones',
      entrega(id, '2026-10-03', ['RECETA_YA_DISPENSADA', SIN_VENTA]),
    );
    expect(forzada.status).toBeGreaterThanOrEqual(400);
  });
});

describe('primeraDispensacion (fecha de referencia de la validez)', () => {
  const madrid = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(d);
  const ahora = new Date('2026-11-09T10:00:00Z');
  it.each(['2026-10-25', '2026-03-29', '2026-12-31', '2026-01-01'])(
    'la fecha %s se guarda como ese mismo día en Madrid (también en cambios de hora)',
    (f) => expect(madrid(primeraDispensacion(null, ahora, f))).toBe(f),
  );
  it('sin fecha original, conserva la actual o usa ahora', () => {
    const antes = new Date('2026-10-01T09:00:00Z');
    expect(primeraDispensacion(antes, ahora, null)).toBe(antes);
    expect(primeraDispensacion(null, ahora, null)).toBe(ahora);
  });
  it('con una entrega más antigua ya guardada, manda la más antigua', () => {
    const antes = new Date('2026-10-01T12:00:00Z');
    expect(primeraDispensacion(antes, ahora, '2026-10-05')).toBe(antes);
    expect(madrid(primeraDispensacion(new Date('2026-10-09T12:00:00Z'), ahora, '2026-10-05'))).toBe(
      '2026-10-05',
    );
  });
});

describe('Revisión y corrección de lo dado de alta a mano', () => {
  it('el registro de salidas la muestra en su fecha original, marcada como alta manual y filtrable', async () => {
    const { app, id } = await recetaManualConfirmada('RM-REG');
    expect(
      (await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, '2026-10-04'))).status,
    ).toBe(201);
    const url = (extra = '') =>
      `/api/registros/salidas?desde=2026-10-04&hasta=2026-10-04&plantilla=A${extra}`;
    const todas = await api(app, 'dev-veterinaria', 'GET', url());
    const t = todas.json.tablas[0];
    const col = (n: string) => t.columnas.indexOf(n);
    const fila = t.filas.find((f: unknown[]) => f.includes('LOTE-MANUAL'));
    expect(fila, 'aparece el día de la entrega, no el de hoy').toBeDefined();
    expect(fila[col('ALTA MANUAL (S/N)')]).toBe('S');
    // Estado de conciliación con el TPV y datos del alta manual en la misma fila (sin datos personales).
    expect(fila[col('CONCILIACIÓN TPV')]).toBe('pendiente');
    expect(fila[col('FECHA ALTA MANUAL')]).toBe('14/10/2026');
    expect(fila[col('MOTIVO ALTA MANUAL')]).toBe('Dispensada con la aplicación caída');
    expect(fila[col('CUSTODIA DEL PAPEL')]).toBe('Archivador de recetas de octubre');
    const solo = await api(app, 'dev-veterinaria', 'GET', url('&origen=manual'));
    expect(solo.json.tablas[0].filas.every((f: unknown[]) => f[col('ALTA MANUAL (S/N)')] === 'S')).toBe(true);
    const hoy = await api(
      app,
      'dev-veterinaria',
      'GET',
      '/api/registros/salidas?desde=2026-10-14&hasta=2026-10-14&plantilla=A',
    );
    expect(hoy.json.tablas[0].filas.some((f: unknown[]) => f.includes('LOTE-MANUAL'))).toBe(false);
  });

  it('se corrige anulando (la original sigue guardada) y solo la anula la veterinaria responsable', async () => {
    const { app, h, id } = await recetaManualConfirmada('RM-ANUL');
    const d = await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, '2026-10-04'));
    const [orig] = await h.db.select().from(dispensacion).where(eq(dispensacion.recetaId, id));
    expect(d.status).toBe(201);
    const motivo = { motivo: 'Lote equivocado al registrar la entrega' };
    expect(
      (await api(app, 'dev-empleado', 'POST', `/api/dispensaciones/${orig!.id}/anular`, motivo)).status,
    ).toBe(403);
    const a = await api(app, 'dev-veterinaria', 'POST', `/api/dispensaciones/${orig!.id}/anular`, motivo);
    expect(a.status).toBeLessThan(300);
    const filas = await h.db.select().from(dispensacion).where(eq(dispensacion.recetaId, id));
    expect(filas).toHaveLength(2);
    expect(filas.find((f) => f.anulaDispensacionId === orig!.id)).toBeDefined();
  });

  it('permite adjuntar después la imagen sin lanzar la extracción y sin dejar de ser manual', async () => {
    const { app, id } = await recetaManualConfirmada('RM-IMG');
    const m = multipart({}, [{ nombre: 'r.png', mime: 'image/png', bytes: Buffer.from('imagen-adjunta') }]);
    const r = await app.inject({
      method: 'POST',
      url: `/api/recetas/${id}/imagenes`,
      headers: { ...m.headers, 'x-dev-user': 'dev-veterinaria' },
      payload: m.payload,
    });
    expect(r.statusCode).toBe(201);
    const g = await api(app, 'dev-veterinaria', 'GET', `/api/recetas/${id}`);
    expect(g.json).toMatchObject({ origen: 'manual', extraccion: null });
    expect(g.json.imagenes).toHaveLength(1);
    expect(g.json.confirmacion.numero).toBe('RM-IMG');
  });
});

describe('Libro de psicótropos con entregas pasadas', () => {
  it('la salida cuenta en su fecha original y la anulación el día que se anula', async () => {
    const { app, h } = await entorno(ACTIVA);
    // Medicamento SINTÉTICO psicótropo, solo para esta prueba.
    await h.db
      .insert(cimavetMedicamento)
      .values({
        nregistro: '9998 PSICO',
        nombre: 'PSICOTROPO SINTÉTICO DE PRUEBA',
        nombreNorm: 'psicotropo sintetico de prueba',
        psicotropo: true,
        source: 'nomenclator',
        fetchedAt: new Date('2026-10-14T06:00:00Z'),
      })
      .onConflictDoNothing();
    const base = {
      canal: 'presencial',
      conReceta: true,
      cn: '999801',
      nregistro: '9998 PSICO',
      nombreFarmaco: 'PSICOTROPO SINTÉTICO DE PRUEBA',
      lote: 'PSI-1',
      unidades: 1,
      metodoCaptura: 'manual',
      empleado: 'dev-veterinaria',
      modo: 'retrospectivo',
      fechaOriginal: '2026-10-04',
      fechaVenta: new Date('2026-10-14T09:00:00Z'),
    };
    const [venta] = await h.db.insert(dispensacion).values(base).returning();
    await h.db
      .insert(dispensacion)
      .values({ ...base, anulaDispensacionId: venta!.id, motivoAnulacion: 'Lote equivocado' });
    const libro = async (dia: string) =>
      (
        await api(app, 'dev-veterinaria', 'GET', `/api/registros/psicotropos?desde=${dia}&hasta=${dia}`)
      ).json.tablas[0].filas
        .filter((f: unknown[]) => f.includes('PSI-1'))
        .map((f: unknown[]) => f.find((x) => x === 'SALIDA' || x === 'ANULACIÓN SALIDA'));
    expect(await libro('2026-10-04')).toEqual(['SALIDA']);
    expect(await libro('2026-10-14')).toEqual(['ANULACIÓN SALIDA']);
  });
});

describe('Conciliación con el TPV de una entrega pasada', () => {
  it('busca el ticket del día de la entrega, no del día en que se registró', async () => {
    const { app, deps, id } = await recetaManualConfirmada('RM-TPV');
    // Ticket del TPV cobrado el día de la entrega (02/10, día que no usa ninguna otra prueba: la base es compartida);
    // hoy, en el reloj de pruebas, es 14/10.
    await (deps.ventas as DemoSalesMovementsSource).cobrar(
      '570016',
      1,
      new Date('2026-10-02T10:00:00Z'),
      'dev-empleado',
    );
    expect(
      (await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, '2026-10-02'))).status,
    ).toBe(201);
    const c = await api(app, 'dev-veterinaria', 'GET', `/api/recetas/${id}/conciliacion`);
    expect(c.json.salidas.map((s: { estado: string }) => s.estado)).toEqual(['conciliada']);
  });
});

describe('Lote entregado que no consta en ninguna recepción', () => {
  it('avisa (sin bloquear) si el lote no está en las recepciones; no avisa si lo está', async () => {
    const { app, h, id } = await recetaManualConfirmada('RM-LOTE1');
    const sinRecepcion = await api(
      app,
      'dev-veterinaria',
      'POST',
      '/api/dispensaciones',
      entrega(id, '2026-10-04'),
    );
    expect(sinRecepcion.status).toBe(201);
    expect(sinRecepcion.json.avisos).toContain('LOTE_NO_RECIBIDO');

    const [dist] = await h.db.select().from(distribuidor).limit(1);
    const [rec] = await h.db
      .insert(recepcion)
      .values({ distribuidorId: dist!.id, fechaCompra: '2026-09-01', empleado: 'dev-empleado' })
      .returning();
    await h.db.insert(recepcionLinea).values({
      recepcionId: rec!.id,
      numero: 1,
      cn: '570016',
      nombreFarmaco: 'CLAVUBAY',
      lote: 'LOTE-RECIBIDO',
      unidades: 5,
      origenDatos: 'cimavet',
      empleado: 'dev-empleado',
    });
    const { id: id2 } = await recetaManualConfirmada('RM-LOTE2');
    const cuerpo = entrega(id2, '2026-10-04');
    cuerpo.envases[0]!.lote = 'LOTE-RECIBIDO';
    const conRecepcion = await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', cuerpo);
    expect(conRecepcion.status).toBe(201);
    expect(conRecepcion.json.avisos).not.toContain('LOTE_NO_RECIBIDO');
  });
});

describe('Fechas de entrega en Pendientes y en el reporte semanal (decisión T043)', () => {
  it('las hojas de dispensaciones forzadas muestran la fecha de entrega (filas de la semana en que se registró)', async () => {
    const { app, h, deps, id } = await recetaManualConfirmada('RM-SEM');
    // Forzada (sin venta en Siweb360 ese día): entregada el 06/10, registrada el 14/10.
    expect(
      (await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, '2026-10-06'))).status,
    ).toBe(201);
    const hojas = await generarReporteSemanal(
      { db: h.db, cipher: deps.cipher, lotesProximos: null, producto_no_valido: [] },
      { desde: '2026-10-12', hasta: '2026-10-18' },
      '2026-10-19',
    );
    const forzadas = hojas.find((t) => t.nombre === '4b Dispensaciones forzadas')!;
    const [d] = await h.db.select().from(dispensacion).where(eq(dispensacion.recetaId, id));
    const fila = forzadas.filas.find((f) => f[0] === d!.id);
    expect(fila?.[forzadas.columnas.indexOf('FECHA')]).toBe('06/10/2026');
  });

  it('«Pendientes de conciliar» muestra el día de la entrega, no el del registro', async () => {
    const { app, id } = await recetaManualConfirmada('RM-PEND');
    expect(
      (await api(app, 'dev-veterinaria', 'POST', '/api/dispensaciones', entrega(id, '2026-10-05'))).status,
    ).toBe(201);
    const p = await api(app, 'dev-veterinaria', 'GET', '/api/pendientes');
    const s = p.json.sinConciliar.salidas.find((x: { recetaId: string }) => x.recetaId === id);
    expect(s.fecha.slice(0, 10)).toBe('2026-10-05');
  });
});
