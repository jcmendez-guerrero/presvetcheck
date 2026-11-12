import { describe, expect, it, vi } from 'vitest';
import { BuzonAlbaranes, preguntaAlSustituir } from './albaran-movil';

describe('BuzonAlbaranes: albarán que llega del móvil (spec 013)', () => {
  it('con una pantalla de recepción abierta se le entrega el id', () => {
    const b = new BuzonAlbaranes();
    const f = vi.fn();
    b.suscribir(f);
    expect(b.recibir('doc-1')).toBe('entregado');
    expect(f).toHaveBeenCalledExactlyOnceWith('doc-1');
  });

  it('sin pantalla abierta queda pendiente y se entrega a la primera que se abre (no se pierde)', () => {
    const b = new BuzonAlbaranes();
    expect(b.recibir('doc-1')).toBe('pendiente');
    const f = vi.fn();
    b.suscribir(f);
    expect(f).toHaveBeenCalledExactlyOnceWith('doc-1');
    // Ya entregado: la siguiente pantalla no lo recibe otra vez.
    const g = vi.fn();
    b.suscribir(g);
    expect(g).not.toHaveBeenCalled();
  });

  it('si llegan dos sin pantalla abierta, queda el último', () => {
    const b = new BuzonAlbaranes();
    b.recibir('doc-1');
    b.recibir('doc-2');
    const f = vi.fn();
    b.suscribir(f);
    expect(f).toHaveBeenCalledExactlyOnceWith('doc-2');
  });

  it('descartar el aviso quita el pendiente; darse de baja deja de recibir', () => {
    const b = new BuzonAlbaranes();
    b.recibir('doc-1');
    b.descartar();
    const f = vi.fn();
    const baja = b.suscribir(f);
    expect(f).not.toHaveBeenCalled();
    baja();
    expect(b.recibir('doc-2')).toBe('pendiente');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('preguntaAlSustituir: no pisar lo que la persona tiene en pantalla', () => {
  const base = { hayLectura: false, modo: 'elegir' as const, distribuidor: '', albaran: '' };
  it.each([
    { caso: 'pantalla vacía', c: base, pregunta: false },
    {
      caso: 'ya hay un albarán leído',
      c: { ...base, modo: 'albaran' as const, hayLectura: true },
      pregunta: true,
    },
    { caso: 'a mano con la cabecera vacía', c: { ...base, modo: 'manual' as const }, pregunta: false },
    {
      caso: 'a mano con solo espacios',
      c: { ...base, modo: 'manual' as const, distribuidor: '  ', albaran: ' ' },
      pregunta: false,
    },
    {
      caso: 'a mano con el distribuidor escrito',
      c: { ...base, modo: 'manual' as const, distribuidor: 'Dist' },
      pregunta: true,
    },
    {
      caso: 'a mano con el nº de albarán escrito',
      c: { ...base, modo: 'manual' as const, albaran: 'A-1' },
      pregunta: true,
    },
    {
      caso: 'modo albarán sin lectura, con texto sobrante',
      c: { ...base, modo: 'albaran' as const, distribuidor: 'x' },
      pregunta: false,
    },
  ])('$caso → pregunta: $pregunta', ({ c, pregunta }) => {
    expect(preguntaAlSustituir(c) !== null).toBe(pregunta);
  });

  it('el texto distingue entre sustituir un albarán leído y lo escrito a mano', () => {
    expect(preguntaAlSustituir({ ...base, hayLectura: true })).toMatch(/albarán leído/);
    expect(preguntaAlSustituir({ ...base, modo: 'manual', albaran: 'A-1' })).toMatch(/lo que has escrito/);
  });
});
