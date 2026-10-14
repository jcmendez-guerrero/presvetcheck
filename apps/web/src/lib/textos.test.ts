import { describe, expect, it } from 'vitest';
import { Decision } from '@mmx/shared';
import { DECISION, fecha, textoMotivo } from './textos';

describe('textos de la UI', () => {
  it('cada decisión tiene texto y clase (nunca solo color)', () => {
    for (const d of Decision.options) {
      expect(DECISION[d]?.texto).toBeTruthy();
      expect(DECISION[d]?.clase).toMatch(/text-/);
    }
  });
  it('fechas en formato español y Europe/Madrid', () => {
    expect(fecha('2026-10-14')).toBe('14/10/2026');
    expect(fecha(null)).toBe('—');
    expect(fecha('2026-10-14T22:30:00Z')).toMatch(/^15\/10\/26/);
  });
  it('motivos legibles', () => {
    expect(textoMotivo({ code: 'RECETA_CADUCADA', severidad: 'BLOQUEANTE_FORMA', params: { fecha: '12/10/2026' } }).titulo).toBe('La receta caducó el 12/10/2026');
  });
});
