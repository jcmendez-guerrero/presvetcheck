import { describe, expect, it } from 'vitest';
import { api, confirmar, crearReceta, entorno, recetaCorrecta } from './entorno';
import { dispensacion, evidenciaStockRetrospectiva } from '@mmx/db';
import { eq } from 'drizzle-orm';

describe('Dispensación en modo retrospectivo (formación)', () => {
  it('permite consultar movimientos retrospectivos y registrar dispensación con evidencia', async () => {
    const { app, h } = await entorno({
      config: { RETROSPECTIVE_DISPENSATION_MODE: 'enabled' },
    });

    // 1. Consulta de movimientos históricos de stock
    const movRes = await api(app, 'dev-empleado', 'POST', '/api/inventario/movimientos/retrospectivo', {
      cn: '570016',
      fechaOriginal: '2026-09-15',
      unidadesRequeridas: 1,
    });
    expect(movRes.status).toBe(200);
    expect(movRes.json).toMatchObject({
      cn: '570016',
      fechaOriginal: '2026-09-15',
      unidadesRequeridas: 1,
    });
    expect(['OK', 'MOVIMIENTO_PARCIAL', 'SIN_MOVIMIENTO']).toContain(movRes.json.estado);

    // 2. Crear y confirmar una receta para dispensar
    const id = await crearReceta(app);
    await confirmar(app, id, recetaCorrecta('R-COMPLETA'));
    await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});

    // 3. Dispensar en modo retrospectivo
    const dispRes = await api(app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: true,
      recetaId: id,
      lineaOrden: 1,
      cn: '570016',
      envases: [
        {
          lote: 'CLV-2611',
          caducidad: '2026-11-30',
          unidades: 1,
          metodoCaptura: 'manual',
          cnEscaneado: '570016',
        },
      ],
      modo: 'retrospectivo',
      fechaOriginal: '2026-09-15',
    });
    expect(dispRes.status).toBe(201);
    const dispIds = (dispRes.json as { dispensaciones: string[] }).dispensaciones;
    expect(dispIds.length).toBeGreaterThan(0);
    const dispId = dispIds[0]!;

    // 4. Comprobar que en dispensacion se guardaron modo y fechaOriginal
    const [dRow] = await h.db.select().from(dispensacion).where(eq(dispensacion.id, dispId));
    expect(dRow).toBeDefined();
    expect(dRow!.modo).toBe('retrospectivo');
    expect(dRow!.fechaOriginal).toBe('2026-09-15');

    // 5. Comprobar que se guardó la evidencia retrospectiva
    const [evRow] = await h.db
      .select()
      .from(evidenciaStockRetrospectiva)
      .where(eq(evidenciaStockRetrospectiva.dispensacionId, dispId));
    expect(evRow).toBeDefined();
    expect(evRow!.cn).toBe('570016');
    expect(evRow!.fechaOriginal).toBe('2026-09-15');
    expect(evRow!.unidadesRequeridas).toBe(1);
    expect(evRow!.unidadesEncontradas).toBe(1);

    await app.close();
  });

  it('rechaza modo retrospectivo si la configuración está deshabilitada', async () => {
    const { app } = await entorno({
      config: { RETROSPECTIVE_DISPENSATION_MODE: 'disabled' },
    });

    const movRes = await api(app, 'dev-empleado', 'POST', '/api/inventario/movimientos/retrospectivo', {
      cn: '570016',
      fechaOriginal: '2026-09-15',
      unidadesRequeridas: 1,
    });
    expect(movRes.status).toBe(403);
    expect((movRes.json as { error: { code: string } }).error.code).toBe('MODO_RETROSPECTIVO_DESHABILITADO');

    // Intentar dispensar con modo retrospectivo debe ser rechazado
    const id = await crearReceta(app);
    await confirmar(app, id, recetaCorrecta('R-COMPLETA'));
    await api(app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});

    const dispRes = await api(app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: true,
      recetaId: id,
      lineaOrden: 1,
      cn: '570016',
      envases: [
        {
          lote: 'CLV-2611',
          caducidad: '2026-11-30',
          unidades: 1,
          metodoCaptura: 'manual',
          cnEscaneado: '570016',
        },
      ],
      modo: 'retrospectivo',
      fechaOriginal: '2026-09-15',
    });
    expect(dispRes.status).toBe(403);
    expect((dispRes.json as { error: { code: string } }).error.code).toBe('MODO_RETROSPECTIVO_DESHABILITADO');

    await app.close();
  });
});
