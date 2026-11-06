import { describe, expect, it } from 'vitest';
import { api, entorno } from './entorno';
import { receta, ticketReceta } from '@mmx/db';
import { eq } from 'drizzle-orm';

describe('Vincular y desvincular ticket multi-receta', () => {
  it('permite vincular dos recetas a un mismo ticket y luego desvincular una si está pendiente', async () => {
    const { app, h } = await entorno();

    const rx1 = '0192e212-3456-7890-abcd-ef0123456781';
    const rx2 = '0192e212-3456-7890-abcd-ef0123456782';
    const rx3 = '0192e212-3456-7890-abcd-ef0123456783';

    for (const id of [rx1, rx2, rx3]) {
      await h.db.insert(receta).values({
        id,
        tipo: 'papel',
        estado: 'DISPENSADA',
        creadaPor: 'dev-empleado',
        fechaEmision: '2026-10-14',
        createdAt: new Date('2026-10-14T10:00:00Z'),
        updatedAt: new Date('2026-10-14T10:00:00Z'),
      });
    }

    // 1. Vincular rx1 al ticket TKT-100
    const v1 = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/vincular', {
      ticketId: '100',
      ticketNumero: 'TKT-2026-000100',
      recetaId: rx1,
    });
    expect(v1.status).toBe(200);
    expect((v1.json as { ok: boolean }).ok).toBe(true);

    // 2. Vincular rx2 al MISMO ticket TKT-100 (multi-receta)
    const v2 = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/vincular', {
      ticketId: '100',
      ticketNumero: 'TKT-2026-000100',
      recetaId: rx2,
    });
    expect(v2.status).toBe(200);
    const recs = (v2.json as { recetasVinculadas: string[] }).recetasVinculadas;
    expect(recs).toContain(rx1);
    expect(recs).toContain(rx2);

    // 3. Intentar vincular rx1 de nuevo (a otro ticket) -> debe fallar con RECETA_YA_VINCULADA (409)
    const vDup = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/vincular', {
      ticketId: '200',
      ticketNumero: 'TKT-2026-000200',
      recetaId: rx1,
    });
    expect(vDup.status).toBe(409);
    expect((vDup.json as { error: { code: string } }).error.code).toBe('RECETA_YA_VINCULADA');

    // 4. Desvincular rx2
    const d1 = await api(app, 'dev-empleado', 'POST', '/api/conciliacion/tickets/desvincular', {
      ticketId: '100',
      recetaId: rx2,
    });
    expect(d1.status).toBe(200);

    // Comprobar que en la base de datos solo queda rx1
    const filas = await h.db.select().from(ticketReceta).where(eq(ticketReceta.ticketId, '100'));
    expect(filas.length).toBe(1);
    expect(filas[0]?.recetaId).toBe(rx1);
  });
});
