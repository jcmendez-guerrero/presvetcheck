import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeText } from '@mmx/shared';
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

  it('compara medicamentos sin indicación clínica específica devolviendo EQUIVALENTE y estado aviso en indicación (FR-021)', async () => {
    const res = await api(E.app, 'dev-empleado', 'POST', '/api/medicamentos/comparar', {
      prescritoNregistro: '1868 ESP',
      candidatoNregistro: '9999 TEST',
      especie: 'perro',
    });

    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('EQUIVALENTE');
    const comparativa = res.json.evidencias.comparativa;
    const filaInd = comparativa.find((c: { criterio: string }) => c.criterio === 'Indicación');
    expect(filaInd).toMatchObject({
      criterio: 'Indicación',
      coincide: true,
      estado: 'aviso',
    });
  });

  it('compara Bioclanic (4332 ESP) y Clavusan (4161 ESP) reconciliando via oral, concentracion e indicacion con aviso (FR-019, FR-020, FR-021)', async () => {
    await E.deps.cimavet.upsert([
      {
        medicamento: {
          nregistro: '4332 ESP',
          nombre: 'BIOCLANIC 50 mg +12,5 mg COMPRIMIDOS CON SABOR PARA GATOS Y PERROS',
          nombreNorm: normalizeText('BIOCLANIC 50 mg +12,5 mg COMPRIMIDOS CON SABOR PARA GATOS Y PERROS'),
          labtitular: 'Axience',
          receta: true,
          antibiotico: true,
          estupefaciente: false,
          psicotropo: false,
          formaId: 1,
          estadoCodigo: 'autorizado',
          comerc: true,
          cantidadConcentracion: '1',
          unidadConcentracion: 'Comprimido',
          source: 'api',
          fetchedAt: new Date(),
        },
        presentaciones: [
          {
            cn: '591386',
            nregistro: '4332 ESP',
            nombre: 'BIOCLANIC 50 mg + 12,5 mg, 10 comprimidos',
            nombreNorm: normalizeText('BIOCLANIC 50 mg + 12,5 mg, 10 comprimidos'),
            comerc: true,
            estadoCodigo: 'autorizado',
            contenido: '10',
            unidadContenido: 'Comprimido',
            source: 'api',
            fetchedAt: new Date(),
          },
        ],
        principiosActivos: [
          {
            orden: 1,
            paId: 161,
            nombre: 'AMOXICILINA TRIHIDRATO',
            cantidadRaw: '57.40',
            cantidadValor: null,
            unidadRaw: 'mg',
            unidadCanonica: null,
            normalizable: true,
          },
          {
            orden: 2,
            paId: 200,
            nombre: 'CLAVULANATO POTASIO',
            cantidadRaw: '29.80',
            cantidadValor: null,
            unidadRaw: 'mg',
            unidadCanonica: null,
            normalizable: true,
          },
        ],
        especies: [14, 15],
        vias: [48], // legacy id 48 procedente de API
        atc: ['QJ01CR02'],
        indicaciones: [{ indicacionId: 1, nombre: 'Infecciones bacterianas', especieId: 14 }],
        tiemposEspera: [],
      },
      {
        medicamento: {
          nregistro: '4161 ESP',
          nombre: 'CLAVUSAN 50 mg + 12,5mg COMPRIMIDOS PARA PERROS Y GATOS',
          nombreNorm: normalizeText('CLAVUSAN 50 mg + 12,5mg COMPRIMIDOS PARA PERROS Y GATOS'),
          labtitular: 'ALFASAN NEDERLAND B.V.',
          receta: true,
          antibiotico: true,
          estupefaciente: false,
          psicotropo: false,
          formaId: 1,
          estadoCodigo: 'autorizado',
          comerc: true,
          cantidadConcentracion: '1',
          unidadConcentracion: 'Comprimido',
          source: 'api',
          fetchedAt: new Date(),
        },
        presentaciones: [
          {
            cn: '590388',
            nregistro: '4161 ESP',
            nombre: 'CLAVUSAN 50 mg + 12,5mg, 10 comprimidos',
            nombreNorm: normalizeText('CLAVUSAN 50 mg + 12,5mg, 10 comprimidos'),
            comerc: true,
            estadoCodigo: 'autorizado',
            contenido: '10',
            unidadContenido: 'Comprimido',
            source: 'api',
            fetchedAt: new Date(),
          },
        ],
        principiosActivos: [
          {
            orden: 1,
            paId: 161,
            nombre: 'AMOXICILINA TRIHIDRATO',
            cantidadRaw: '57.40',
            cantidadValor: null,
            unidadRaw: 'mg',
            unidadCanonica: null,
            normalizable: true,
          },
          {
            orden: 2,
            paId: 200,
            nombre: 'CLAVULANATO POTASIO',
            cantidadRaw: '14.89',
            cantidadValor: null,
            unidadRaw: 'mg',
            unidadCanonica: null,
            normalizable: true,
          },
        ],
        especies: [14, 15],
        vias: [54], // canónico 54
        atc: ['QJ01CR02'],
        indicaciones: [{ indicacionId: 2, nombre: 'Infección cutánea', especieId: 14 }],
        tiemposEspera: [],
      },
    ]);

    const res = await api(E.app, 'dev-empleado', 'POST', '/api/medicamentos/comparar', {
      prescritoNregistro: '4332 ESP',
      candidatoNregistro: '4161 ESP',
      especie: 'perro',
    });

    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('EQUIVALENTE');

    const comparativa = res.json.evidencias.comparativa;

    const filaVia = comparativa.find((c: { criterio: string }) => c.criterio === 'Vía de administración');
    expect(filaVia).toMatchObject({
      criterio: 'Vía de administración',
      coincide: true,
      prescrito: 'VÍA ORAL',
      candidato: 'VÍA ORAL',
    });

    const filaConc = comparativa.find((c: { criterio: string }) => c.criterio === 'Concentración');
    expect(filaConc).toMatchObject({
      criterio: 'Concentración',
      coincide: true,
    });

    const filaInd = comparativa.find((c: { criterio: string }) => c.criterio === 'Indicación');
    expect(filaInd).toMatchObject({
      criterio: 'Indicación',
      coincide: true,
      estado: 'aviso',
    });
  });
});
