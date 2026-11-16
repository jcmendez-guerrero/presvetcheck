import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { albaranDocumento, distribuidor, recepcion, recepcionAjuste, recepcionLinea } from '@mmx/db';
import { api, entorno } from './entorno';

type Fila = {
  id: string;
  albaran: string | null;
  proveedor: string;
  fechaRecepcion: string | null;
  fechaCompra: string;
  registradaAt: string;
  estado: string;
};
type Lista = {
  filas: Fila[];
  total: number;
  pagina: number;
  porPagina: number;
  proveedores: { id: string; nombre: string }[];
};

type Semilla = {
  prov?: string;
  albaran?: string | null;
  fechaCompra?: string;
  fechaRecepcion?: string | null;
  estado?: string;
  createdAt?: string;
};

/** Entorno con recepciones insertadas directamente (fechas y estados controlados por el test). */
async function conRecepciones(semillas: Semilla[], provs = ['Distribuidora Norte', 'Farma Sur']) {
  const E = await entorno();
  // La base de pruebas (en memoria) se comparte entre los tests del fichero y trae recepciones de demostración:
  // se vacía para que totales y órdenes dependan solo de este test. Los disparadores append-only se desactivan
  // solo durante esta limpieza de la base de pruebas.
  await E.deps.db.execute(sql`set session_replication_role = replica`);
  await E.deps.db.delete(recepcionAjuste);
  await E.deps.db.delete(recepcionLinea);
  await E.deps.db.update(albaranDocumento).set({ recepcionId: null });
  await E.deps.db.delete(recepcion);
  await E.deps.db.execute(sql`set session_replication_role = origin`);
  const ds = await E.deps.db
    .insert(distribuidor)
    .values(provs.map((nombre) => ({ nombre })))
    .returning();
  const idDe = (n: string) => ds.find((d) => d.nombre === n)!.id;
  const base = Date.parse('2026-01-01T09:00:00Z');
  const filas = semillas.length
    ? await E.deps.db
        .insert(recepcion)
        .values(
          semillas.map((s, i) => ({
            distribuidorId: idDe(s.prov ?? provs[0]!),
            albaran: s.albaran === undefined ? `A-${i}` : s.albaran,
            fechaCompra: s.fechaCompra ?? '2026-11-01',
            fechaRecepcion: s.fechaRecepcion === undefined ? '2026-11-02' : s.fechaRecepcion,
            estado: s.estado ?? 'FINALIZADA',
            empleado: 'dev-empleado',
            // Por defecto, cada semilla se registra un minuto después de la anterior.
            createdAt: new Date(s.createdAt ?? base + i * 60_000),
          })),
        )
        .returning({ id: recepcion.id })
    : [];
  const ids = filas.map((f) => f.id);
  const listar = async (qs = '', u: 'dev-empleado' | 'dev-admin' | null = 'dev-empleado') =>
    api(E.app, u, 'GET', `/api/recepciones${qs ? `?${qs}` : ''}`);
  const lista = async (qs = '') => {
    const r = await listar(qs);
    expect(r.status).toBe(200);
    return r.json as Lista;
  };
  return { E, ids, idDe, listar, lista };
}

describe('GET /api/recepciones: forma y paginación (US1)', () => {
  it('devuelve solo los campos de la tabla, con el nombre del proveedor y lo más reciente primero', async () => {
    const { ids, lista } = await conRecepciones([
      { prov: 'Farma Sur', albaran: null, fechaRecepcion: null },
      { albaran: 'A-1234', fechaCompra: '2026-11-10', fechaRecepcion: '2026-11-12' },
    ]);
    const r = await lista();
    expect(r.total).toBe(2);
    expect(r.filas.map((f) => f.id)).toEqual([ids[1], ids[0]]);
    expect(Object.keys(r.filas[0]!).sort()).toEqual(
      ['albaran', 'estado', 'fechaCompra', 'fechaRecepcion', 'id', 'proveedor', 'registradaAt'].sort(),
    );
    expect(r.filas[0]).toMatchObject({
      albaran: 'A-1234',
      proveedor: 'Distribuidora Norte',
      fechaCompra: '2026-11-10',
      fechaRecepcion: '2026-11-12',
      estado: 'FINALIZADA',
    });
    expect(r.filas[1]).toMatchObject({ albaran: null, fechaRecepcion: null, proveedor: 'Farma Sur' });
    expect(new Date(r.filas[0]!.registradaAt).toISOString()).toBe(r.filas[0]!.registradaAt);
  });

  it('oculta las descartadas por defecto', async () => {
    const { ids, lista } = await conRecepciones([{}, { estado: 'DESCARTADA' }]);
    const r = await lista();
    expect(r.filas.map((f) => f.id)).toEqual([ids[0]]);
    expect(r.total).toBe(1);
  });

  it('pagina con total real y rechaza porPagina > 100 y pagina 0', async () => {
    const { lista, listar } = await conRecepciones(Array.from({ length: 30 }, () => ({})));
    const p1 = await lista();
    expect([p1.filas.length, p1.total, p1.pagina, p1.porPagina]).toEqual([25, 30, 1, 25]);
    const p2 = await lista('pagina=2');
    expect([p2.filas.length, p2.total]).toEqual([5, 30]);
    const p9 = await lista('pagina=9');
    expect([p9.filas.length, p9.total]).toEqual([0, 30]);
    expect((await listar('porPagina=101')).status).toBe(400);
    expect((await listar('pagina=0')).status).toBe(400);
  });
});

describe('GET /api/recepciones: permisos (FR-015)', () => {
  it('admin (fuera de la operativa) → 403; sin usuario → 401', async () => {
    const { listar } = await conRecepciones([{}]);
    expect((await listar('', 'dev-admin')).status).toBe(403);
    expect((await listar('', null)).status).toBe(401);
  });
});

describe('GET /api/recepciones: filtros (US2)', () => {
  it('encuentra por parte del nº de albarán una recepción antigua, sin distinguir mayúsculas', async () => {
    const { ids, lista } = await conRecepciones([
      { albaran: 'F-2025-0099' },
      ...Array.from({ length: 60 }, (_, i) => ({ albaran: `B-${i}` })),
    ]);
    expect((await lista('numero=0099')).filas.map((f) => f.id)).toEqual([ids[0]]);
    expect((await lista('numero=f-2025')).filas.map((f) => f.id)).toEqual([ids[0]]);
    expect((await lista(`numero=${encodeURIComponent('  0099 ')}`)).total).toBe(1);
  });

  it('% y _ no actúan como comodines', async () => {
    const { ids, lista } = await conRecepciones([{ albaran: 'AB' }, { albaran: '50%_X' }]);
    expect((await lista(`numero=${encodeURIComponent('%')}`)).filas.map((f) => f.id)).toEqual([ids[1]]);
    expect((await lista('numero=_')).filas.map((f) => f.id)).toEqual([ids[1]]);
  });

  it('filtra por proveedor, por varios estados y muestra descartadas si se piden', async () => {
    const { ids, idDe, lista } = await conRecepciones([
      { prov: 'Distribuidora Norte', estado: 'ABIERTA' },
      { prov: 'Farma Sur', estado: 'ERROR_SINCRONIZACION' },
      { prov: 'Farma Sur', estado: 'FINALIZADA' },
      { prov: 'Farma Sur', estado: 'DESCARTADA' },
    ]);
    const sur = idDe('Farma Sur');
    expect((await lista(`distribuidorId=${sur}`)).filas.map((f) => f.id)).toEqual([ids[2], ids[1]]);
    expect((await lista('estado=ABIERTA,ERROR_SINCRONIZACION')).filas.map((f) => f.id)).toEqual([
      ids[1],
      ids[0],
    ]);
    expect((await lista('estado=DESCARTADA')).filas.map((f) => f.id)).toEqual([ids[3]]);
    // Combinados: proveedor y estado a la vez.
    expect(
      (await lista(`distribuidorId=${sur}&estado=ABIERTA,ERROR_SINCRONIZACION`)).filas.map((f) => f.id),
    ).toEqual([ids[1]]);
  });

  it('rangos de fecha de recepción y de compra: extremos incluidos y abiertos por un lado', async () => {
    const { ids, lista } = await conRecepciones([
      { fechaCompra: '2026-10-31', fechaRecepcion: '2026-10-31' },
      { fechaCompra: '2026-11-01', fechaRecepcion: '2026-11-01' },
      { fechaCompra: '2026-11-15', fechaRecepcion: '2026-11-15' },
      { fechaCompra: '2026-11-16', fechaRecepcion: null },
    ]);
    const idsDe = async (qs: string) => (await lista(qs)).filas.map((f) => f.id).sort();
    expect(await idsDe('recibidaDesde=2026-11-01&recibidaHasta=2026-11-15')).toEqual([ids[1], ids[2]].sort());
    expect(await idsDe('compraDesde=2026-11-01&compraHasta=2026-11-15')).toEqual([ids[1], ids[2]].sort());
    expect(await idsDe('compraDesde=2026-11-15')).toEqual([ids[2], ids[3]].sort());
    expect(await idsDe('recibidaHasta=2026-11-01')).toEqual([ids[0], ids[1]].sort());
    expect(await idsDe('compraDesde=2026-11-01&recibidaHasta=2026-11-01')).toEqual([ids[1]]);
  });

  it.each([
    ['compraDesde=2026-11-10&compraHasta=2026-11-01'],
    ['recibidaDesde=2026-11-10&recibidaHasta=2026-11-01'],
    ['registradaDesde=2026-11-10&registradaHasta=2026-11-01'],
    ['estado=OTRO'],
    ['compraDesde=2026-13-01'],
    ['distribuidorId=no-es-uuid'],
    ['orden=empleado'],
  ])('rechaza %s con 400 VALIDACION', async (qs) => {
    const { listar } = await conRecepciones([{}]);
    const r = await listar(qs);
    expect(r.status).toBe(400);
    expect((r.json as { error: { code: string } }).error.code).toBe('VALIDACION');
  });

  it('proveedores: solo los que tienen alguna recepción, por nombre', async () => {
    const { lista } = await conRecepciones(
      [{ prov: 'Farma Sur' }, { prov: 'Ápices' }],
      ['Farma Sur', 'Ápices', 'Sin Recepciones'],
    );
    expect((await lista()).proveedores.map((p) => p.nombre)).toEqual(['Ápices', 'Farma Sur']);
  });
});

describe('GET /api/recepciones: fecha de registro en hora de Madrid (FR-013)', () => {
  it.each([
    ['2026-11-16', '2026-11-15T23:30:00Z', true], // 00:30 CET del 16
    ['2026-11-16', '2026-11-16T23:30:00Z', false], // 00:30 CET del 17
    ['2026-07-16', '2026-07-15T22:30:00Z', true], // 00:30 CEST del 16
    ['2026-07-16', '2026-07-16T22:30:00Z', false], // 00:30 CEST del 17
    ['2026-03-29', '2026-03-28T23:30:00Z', true], // día del cambio a verano, 00:30 CET
    ['2026-03-29', '2026-03-29T22:30:00Z', false], // 00:30 CEST del 30
    ['2026-10-25', '2026-10-24T22:30:00Z', true], // día del cambio a invierno, 00:30 CEST
    ['2026-10-25', '2026-10-25T23:30:00Z', false], // 00:30 CET del 26
  ])('día %s, registrada %s → %s', async (dia, createdAt, sale) => {
    const { lista } = await conRecepciones([{ createdAt }]);
    expect((await lista(`registradaDesde=${dia}&registradaHasta=${dia}`)).total).toBe(sale ? 1 : 0);
  });

  it('acepta solo «desde» o solo «hasta»', async () => {
    const { ids, lista } = await conRecepciones([
      { createdAt: '2026-11-14T10:00:00Z' },
      { createdAt: '2026-11-15T23:30:00Z' },
    ]);
    expect((await lista('registradaDesde=2026-11-16')).filas.map((f) => f.id)).toEqual([ids[1]]);
    expect((await lista('registradaHasta=2026-11-15')).filas.map((f) => f.id)).toEqual([ids[0]]);
  });
});

describe('GET /api/recepciones: orden (US3)', () => {
  const semillas: Semilla[] = [
    {
      albaran: 'C',
      prov: 'Farma Sur',
      fechaRecepcion: '2026-11-03',
      fechaCompra: '2026-11-01',
      estado: 'FINALIZADA',
    },
    {
      albaran: 'A',
      prov: 'Distribuidora Norte',
      fechaRecepcion: '2026-11-01',
      fechaCompra: '2026-11-03',
      estado: 'ABIERTA',
    },
    {
      albaran: 'B',
      prov: 'Alfa Vet',
      fechaRecepcion: '2026-11-02',
      fechaCompra: '2026-11-02',
      estado: 'SINCRONIZADA',
    },
  ];
  const provs = ['Farma Sur', 'Distribuidora Norte', 'Alfa Vet'];

  it.each([
    ['albaran', 'asc', [1, 2, 0]],
    ['albaran', 'desc', [0, 2, 1]],
    ['proveedor', 'asc', [2, 1, 0]],
    ['proveedor', 'desc', [0, 1, 2]],
    ['recibida', 'asc', [1, 2, 0]],
    ['recibida', 'desc', [0, 2, 1]],
    ['compra', 'asc', [0, 2, 1]],
    ['compra', 'desc', [1, 2, 0]],
    ['registrada', 'asc', [0, 1, 2]],
    ['registrada', 'desc', [2, 1, 0]],
    // Estado: por el texto que se ve (Abierta, Enviada, Finalizada), no por el código interno.
    ['estado', 'asc', [1, 2, 0]],
    ['estado', 'desc', [0, 2, 1]],
  ] as const)('orden=%s dir=%s', async (orden, dir, esperado) => {
    const { ids, lista } = await conRecepciones(semillas, [...provs]);
    expect((await lista(`orden=${orden}&dir=${dir}`)).filas.map((f) => f.id)).toEqual(
      esperado.map((i) => ids[i]),
    );
  });

  it('estado: orden alfabético del texto visible con los cinco estados', async () => {
    const estados = ['FINALIZADA', 'ERROR_SINCRONIZACION', 'SINCRONIZADA', 'DESCARTADA', 'ABIERTA'] as const;
    const { ids, lista } = await conRecepciones(estados.map((estado) => ({ estado })));
    const r = await lista(`orden=estado&dir=asc&estado=${estados.join(',')}`);
    // Abierta, Descartada, Enviada, Error al enviar, Finalizada
    expect(r.filas.map((f) => f.id)).toEqual([4, 3, 2, 1, 0].map((i) => ids[i]));
  });

  it.each(['asc', 'desc'])('sin fecha de recepción va al final (dir=%s)', async (dir) => {
    const { ids, lista } = await conRecepciones([
      { fechaRecepcion: null },
      { fechaRecepcion: '2026-11-01' },
      { fechaRecepcion: '2026-11-05' },
    ]);
    expect((await lista(`orden=recibida&dir=${dir}`)).filas.at(-1)!.id).toBe(ids[0]);
  });

  it('paginación estable con fechas de compra iguales', async () => {
    const { lista } = await conRecepciones(Array.from({ length: 7 }, () => ({ fechaCompra: '2026-11-01' })));
    const vistos = [
      ...(await lista('orden=compra&porPagina=3&pagina=1')).filas,
      ...(await lista('orden=compra&porPagina=3&pagina=2')).filas,
      ...(await lista('orden=compra&porPagina=3&pagina=3')).filas,
    ].map((f) => f.id);
    expect(new Set(vistos).size).toBe(7);
  });
});

describe('GET /api/recepciones: volumen (SC-003)', () => {
  it('con 5.000 recepciones cada consulta tarda menos de 1 s', async () => {
    const provs = Array.from({ length: 20 }, (_, i) => `Proveedor ${i}`);
    const estados = ['ABIERTA', 'FINALIZADA', 'SINCRONIZADA', 'ERROR_SINCRONIZACION'];
    const { E, idDe, lista } = await conRecepciones([], provs);
    const filas = Array.from({ length: 5000 }, (_, i) => ({
      distribuidorId: idDe(provs[i % 20]!),
      albaran: `ALB-${i}`,
      fechaCompra: `2026-${String((i % 12) + 1).padStart(2, '0')}-10`,
      fechaRecepcion: `2026-${String((i % 12) + 1).padStart(2, '0')}-12`,
      estado: estados[i % 4]!,
      empleado: 'dev-empleado',
      createdAt: new Date(Date.parse('2026-01-01T09:00:00Z') + i * 60_000),
    }));
    for (let i = 0; i < filas.length; i += 1000) {
      await E.deps.db.insert(recepcion).values(filas.slice(i, i + 1000));
    }
    expect((await lista()).total).toBe(5000);
    // shortcut: umbral medido sobre PGlite en memoria; si es inestable en CI, subirlo y medir a mano (quickstart.md paso 16).
    for (const qs of [
      '',
      'numero=12',
      `distribuidorId=${idDe('Proveedor 3')}&estado=ABIERTA,FINALIZADA&compraDesde=2026-03-01&compraHasta=2026-09-30`,
    ]) {
      const t0 = performance.now();
      await lista(qs);
      expect(performance.now() - t0).toBeLessThan(1000);
    }
  }, 60_000);
});
