import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, entorno, type Entorno } from './entorno';

let E: Entorno;
beforeAll(async () => {
  E = await entorno();
}, 180_000);

afterAll(async () => {
  await E.app.close();
});

describe('POST /api/medicamentos/comparar (FR-018)', () => {
  it('devuelve 404 si el medicamento prescrito o candidato no existe', async () => {
    const res = await api(E.app, 'dev-empleado', 'POST', '/api/medicamentos/comparar', {
      prescritoNregistro: 'INEXISTENTE ESP',
      candidatoNregistro: '9999 TEST',
      especie: 'perro',
    });
    expect(res.status).toBe(404);
  });

  it('compara dos medicamentos equivalentes para perro y devuelve la comparativa de 7 criterios', async () => {
    const res = await api(E.app, 'dev-empleado', 'POST', '/api/medicamentos/comparar', {
      prescritoNregistro: '1868 ESP',
      candidatoNregistro: '9999 TEST',
      especie: 'perro',
      indicacion: 'Infección cutánea',
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      decision: expect.stringMatching(/EQUIVALENTE/),
      reglaVersion: expect.any(String),
      esBloqueanteDuro: false,
      evidencias: {
        comparativa: expect.arrayContaining([
          expect.objectContaining({ criterio: 'Principio activo' }),
          expect.objectContaining({ criterio: 'Concentración' }),
          expect.objectContaining({ criterio: 'Forma farmacéutica' }),
          expect.objectContaining({ criterio: 'Vía de administración' }),
          expect.objectContaining({ criterio: 'Especie de destino' }),
          expect.objectContaining({ criterio: 'Indicación' }),
          expect.objectContaining({ criterio: 'Tiempo de espera' }),
        ]),
      },
    });

    const comparativa = res.json.evidencias.comparativa;
    expect(comparativa.length).toBe(7);
  });
});
