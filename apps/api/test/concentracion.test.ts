import { describe, expect, it } from 'vitest';
import { concentracionDelNombre } from '../src/servicios/medicamentos';

describe('concentración desde el nombre autorizado', () => {
  it.each([
    ['AMODIP 1,25 mg COMPRIMIDOS MASTICABLES PARA GATOS', '1,25 mg'],
    ['CLAVUBAY 400 mg / 100 mg COMPRIMIDOS SABOR PARA PERROS', '400 mg / 100 mg'],
    ['CONVENIA 80 mg/ml POLVO Y DISOLVENTE PARA SOLUCION INYECTABLE', '80 mg/ml'],
    ['LOXICOM 0,5 mg/ml SUSPENSIÓN ORAL PARA GATOS', '0,5 mg/ml'],
    ['SYNULOX 140 mg/ml + 35 mg/ml SUSPENSION INYECTABLE', '140 mg/ml + 35 mg/ml'],
    ['APOQUEL 3,6 mg COMPRIMIDOS RECUBIERTOS CON PELICULA PARA PERROS # OTRO 5 mg', '3,6 mg'],
    ['VACUNA SIN DOSIS SUSPENSION', null],
  ])('%s → %s', (n, c) => expect(concentracionDelNombre(n)).toBe(c));
});
