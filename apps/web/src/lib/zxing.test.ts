import { describe, expect, it } from 'vitest';
import { conMargen } from './zxing';

describe('conMargen (QR del móvil)', () => {
  const zint = '<?xml version="1.0" standalone="no"?>\n<!DOCTYPE svg PUBLIC "x" "y">\n<svg width="342" height="342" version="1.1" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="42" height="6"/></svg>';

  it('añade viewBox con zona de silencio y quita el tamaño fijo para que escale sin recortarse', () => {
    const s = conMargen(zint);
    expect(s.startsWith('<svg')).toBe(true);
    expect(s).toContain('viewBox="-24 -24 390 390"');
    expect(s).not.toMatch(/<svg[^>]*\swidth=/);
    // Los rectángulos de los módulos conservan su tamaño.
    expect(s).toContain('<rect x="0" y="0" width="42" height="6"/>');
  });

  it('deja intacto un SVG sin dimensiones', () => {
    expect(conMargen('<svg viewBox="0 0 1 1"></svg>')).toBe('<svg viewBox="0 0 1 1"></svg>');
  });
});
