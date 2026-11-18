import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CodigoRecibido } from './escaner';

const pend = (raw: string) => ({ raw, recibidoAt: 1 });

describe('CodigoRecibido: código del móvil recibido sin campo de escaneo abierto (spec 016)', () => {
  it('con un código pendiente ofrece «Usar el código recibido»; nunca lo aplica solo', () => {
    let usado = 0;
    const html = renderToString(
      <CodigoRecibido codigos={{ pendientes: [pend('A')], aviso: null }} onUsar={() => usado++} />,
    );
    expect(html).toContain('Usar el código recibido');
    expect(html).toContain('data-testid="usar-codigo-recibido"');
    expect(usado).toBe(0); // pintar el botón no entrega nada
  });

  it('con varios, dice cuántos hay en espera', () => {
    const html = renderToString(
      <CodigoRecibido codigos={{ pendientes: [pend('A'), pend('B')], aviso: null }} onUsar={() => {}} />,
    );
    expect(html).toContain('2 en espera');
  });

  it('sin código pendiente no hay botón', () => {
    const html = renderToString(
      <CodigoRecibido codigos={{ pendientes: [], aviso: null }} onUsar={() => {}} />,
    );
    expect(html).toBe('');
  });

  it('si el código caducó, lo explica en lugar de ofrecer el botón', () => {
    const html = renderToString(
      <CodigoRecibido codigos={{ pendientes: [], aviso: 'caducado' }} onUsar={() => {}} />,
    );
    expect(html).toContain('El código recibido ha caducado: vuelve a leer el envase');
    expect(html).not.toContain('Usar el código recibido');
  });
});
