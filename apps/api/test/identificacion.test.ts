import { describe, expect, it } from 'vitest';
import type { ResultadoBusqueda } from '@mmx/cimavet';
import { RecetaConfirmada, type RecetaConfirmadaInput } from '@mmx/shared';
import { identificarMedicamentos, lineasCandidatas, marcaPresente } from '../src/servicios/identificacion';

const cand = (cn: string, medicamento: string, puntuacion: number): ResultadoBusqueda => ({
  cn,
  nregistro: `${cn.slice(0, 4)} ESP`,
  nombre: `${medicamento}, Caja`,
  medicamento,
  labtitular: null,
  comerc: true,
  estado: 'autorizado',
  puntuacion,
  autorizadoEspecie: null,
});
// Catálogo ficticio: la búsqueda devuelve por similitud de texto, como pg_trgm.
const CATALOGO = [cand('570001', 'PROPALIN 40 mg/ml JARABE', 0.9), cand('570002', 'TAF SPRAY 28,5 mg/g', 0.9), cand('570003', 'PROCACTIVE 300 mg/ml', 0.9)];
const buscar = async (q: string) => {
  const n = q.toLowerCase();
  if (/^\d{6}$/.test(q)) return CATALOGO.filter((c) => c.cn === q);
  if (n === 'propalin') return [cand('570001', 'PROPALIN 40 mg/ml JARABE', 0.8)];
  if (n.includes('propalin')) return [cand('570003', 'PROCACTIVE 300 mg/ml', 0.63)]; // el falso positivo real
  if (n.includes('envase')) return [cand('570002', 'TAF SPRAY 28,5 mg/g', 0.8)]; // "% del envase: 100" → spray
  return [];
};
const receta = (lineas: Partial<NonNullable<RecetaConfirmadaInput['lineas']>[number]>[]): RecetaConfirmadaInput =>
  RecetaConfirmada.parse({ tipo: 'papel', lineas: lineas.map((l, i) => ({ orden: i + 1, ...l })) }) as RecetaConfirmadaInput;

describe('identificación del medicamento (el código nacional no es obligatorio)', () => {
  it('marca del candidato en lo leído', () => {
    expect(marcaPresente('PROPALIN 100 ML', cand('1', 'PROPALIN 40 mg/ml JARABE', 1))).toBe(true);
    expect(marcaPresente('% del envase: 100', cand('1', 'TAF SPRAY 28,5 mg/g', 1))).toBe(false);
    expect(marcaPresente('X', cand('1', '5 mg', 1))).toBe(false);
  });

  it('fragmentos candidatos del texto', () => {
    expect(lineasCandidatas('TRATAMIENTO: PRUEBAVET 5 MG COMP. PREDNISOLONA. CONGESTION\nHola\nPRUEBAVET 5 MG COMP\nJARABE PARA PERROS | 1/DIA')).toEqual(['PRUEBAVET 5 MG COMP', 'JARABE PARA PERROS', '1/DIA'].filter((x) => /[A-Za-z]{4,}/.test(x)));
  });

  it('código nacional leído y existente → se usa; inexistente → se descarta y queda dudoso', async () => {
    const r = await identificarMedicamentos(receta([{ cn: '570001' }, { cn: '123456' }]), null, buscar);
    expect(r.receta.lineas?.map((l) => [l.cn, l.nregistro])).toEqual([['570001', '5700 ESP'], [null, null]]);
    expect(r.dudosos).toEqual(['lineas.1.cn']);
  });

  it('sin código: por nombre, exigiendo la marca (descarta PROCACTIVE y reintenta con «PROPALIN»)', async () => {
    const r = await identificarMedicamentos(receta([{ medicamentoTexto: 'PROPALIN 100 ML' }, { medicamentoTexto: 'Lactulosa' }]), null, buscar);
    expect(r.receta.lineas?.map((l) => l.cn)).toEqual(['570001', null]);
    expect(r).toMatchObject({ propuestas: 1, dudosos: ['lineas.0.medicamento'] });
  });

  it('sin líneas: busca en el texto de la receta, sin falsos positivos', async () => {
    const r = await identificarMedicamentos(receta([{}]), 'Diagnóstico: tos\n% del envase: 100\nTRATAMIENTO: PROPALIN 100 ML. CADA 8 H', buscar);
    expect(r.receta.lineas?.map((l) => [l.medicamentoTexto, l.cn])).toEqual([['PROPALIN 100 ML', '570001']]);
    expect(r.dudosos).toEqual(['lineas.0.medicamento']);
    const nada = await identificarMedicamentos(receta([{}]), '% del envase: 100', buscar);
    expect(nada.receta.lineas?.[0]?.cn).toBeNull();
    expect((await identificarMedicamentos(receta([{}]), null, buscar)).propuestas).toBe(0);
  });
});
