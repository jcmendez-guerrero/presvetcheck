import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvent, sustitucion } from '@mmx/db';
import { api, confirmar, crearReceta, entorno, recetaCorrecta, type Entorno } from './entorno';

let E: Entorno;
beforeAll(async () => {
  E = await entorno();
}, 180_000);

afterAll(async () => {
  await E.app.close();
});

describe('POST /api/recetas/:id/lineas/:orden/sustituir-manual (FR-017)', () => {
  it('rechaza si el motivo tiene menos de 5 caracteres', async () => {
    const recetaId = await crearReceta(E.app);
    await confirmar(E.app, recetaId, recetaCorrecta('R-SUST-01'));
    await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${recetaId}/evaluar`, {});

    const res = await api(
      E.app,
      'dev-empleado',
      'POST',
      `/api/recetas/${recetaId}/lineas/1/sustituir-manual`,
      {
        cn: '999901',
        motivo: 'abc', // < 5 chars
      },
    );

    expect(res.status).toBe(400);
  });

  it('rechaza sustitución manual si existe un BLOQUEANTE_DURO (ej. prescripción excepcional)', async () => {
    const recetaId = await crearReceta(E.app);
    // Prescripción en cascada / excepcional: RD 1157/2021 no admite sustitución por dispensador
    await confirmar(E.app, recetaId, (r) => ({
      ...recetaCorrecta('R-SUST-02')(r),
      clasePrescripcion: 'excepcional',
    }));
    await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${recetaId}/evaluar`, {});

    const res = await api(
      E.app,
      'dev-empleado',
      'POST',
      `/api/recetas/${recetaId}/lineas/1/sustituir-manual`,
      {
        cn: '999901',
        motivo: 'Falta de stock del prescrito; intento sustituir',
      },
    );

    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({
      error: { code: 'SUSTITUCION_BLOQUEO_DURO' },
    });
  });

  it('permite sustitución manual con motivo válido, genera sustitución y registra evento de auditoría', async () => {
    const recetaId = await crearReceta(E.app);
    await confirmar(E.app, recetaId, recetaCorrecta('R-SUST-03'));
    await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${recetaId}/evaluar`, {});

    const motivo = 'Falta de stock en almacén del prescrito Clavubay; sustituido por Genériclav con acuerdo del tutor';
    const res = await api(
      E.app,
      'dev-empleado',
      'POST',
      `/api/recetas/${recetaId}/lineas/1/sustituir-manual`,
      {
        cn: '999901',
        motivo,
      },
    );

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      ok: true,
      sustitucionId: expect.any(String),
    });

    const sustitucionId = res.json.sustitucionId;

    // Verificar en BD la fila de sustitucion
    const [sust] = await E.deps.db.select().from(sustitucion).where(eq(sustitucion.id, sustitucionId));
    expect(sust).toBeDefined();
    expect(sust?.cnPropuesto).toBe('999901');
    expect(sust?.modo).toBe('POST');

    // Verificar que se registró el evento inmutable de auditoría
    const eventos = await E.deps.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.accion, 'SUSTITUCION_SOBREESCRITA'));
    expect(eventos.length).toBeGreaterThan(0);
    const ev = eventos.find((e) => (e.despues as { sustitucionId?: string })?.sustitucionId === sustitucionId);
    expect(ev).toBeDefined();
    expect(ev?.actor).toBe('dev-empleado');
    expect((ev?.despues as { motivo?: string })?.motivo).toBe(motivo);
  });
});
