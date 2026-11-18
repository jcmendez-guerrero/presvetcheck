import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AvisoCosteProveedor } from './aviso-coste-proveedor';

describe('AvisoCosteProveedor (specs/016)', () => {
  it('no muestra nada sin costes pendientes', () => {
    expect(renderToString(<AvisoCosteProveedor pendientes={0} />)).toBe('');
  });

  it('avisa en español claro, sin jerga y sin decir que el stock falla', () => {
    const html = renderToString(<AvisoCosteProveedor pendientes={2} />);
    expect(html).toContain('Coste de proveedor pendiente');
    expect(html).toContain('falta vincular a este distribuidor con su proveedor en Siweb360');
    expect(html).toContain('El stock no se ve afectado');
    expect(html).not.toMatch(/needs_supplier|outbox_/);
  });
});
