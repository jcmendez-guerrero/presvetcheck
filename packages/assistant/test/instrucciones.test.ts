import { describe, expect, it } from 'vitest';
import { CODIGOS_ERROR, RULE_FILES } from '@mmx/shared';
import { INSTRUCCIONES, instruccionesVersion } from '../src/instrucciones';

describe('instrucciones del modelo (FR-006: sin reglas legales)', () => {
  it('no contienen plazos, cantidades ni porcentajes', () => {
    expect(INSTRUCCIONES).not.toMatch(/\d+\s*(días|dias|meses|mes|mg|ml|%|envases?|unidades|años)/i);
    expect(INSTRUCCIONES).not.toMatch(/\d/);
  });

  it('no mencionan códigos de regla ni ficheros de reglas', () => {
    for (const c of CODIGOS_ERROR) expect(INSTRUCCIONES).not.toContain(c);
    for (const def of Object.values(RULE_FILES)) expect(INSTRUCCIONES).not.toContain(def.fichero);
    expect(INSTRUCCIONES).not.toMatch(/BLOQUEANTE|NO_CONFORME|PSICOTROPO_/);
  });

  it('la versión cambia con el contenido', () => {
    expect(instruccionesVersion).toMatch(/^instrucciones\.v1@[0-9a-f]{8}$/);
  });
});
