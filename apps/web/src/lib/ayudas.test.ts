import { describe, expect, it } from 'vitest';
import { SECCIONES_AYUDA } from '@mmx/shared';
import { AYUDA_RECEPCION } from './ayudas';

describe('ayuda de «Actualizar precio» (specs/016)', () => {
  it('dice que el coste del proveedor en Siweb360 se actualiza siempre y qué controla la casilla', () => {
    expect(AYUDA_RECEPCION.actualizarPrecio).toMatch(/coste del proveedor en Siweb360 se actualiza siempre/);
    expect(AYUDA_RECEPCION.actualizarPrecio).toMatch(/coste de la variante/);
    expect(AYUDA_RECEPCION.actualizarPrecio).not.toMatch(/no permite|su API no lo permite/);
  });

  it('la guía de ayuda general dice lo mismo', () => {
    const texto = JSON.stringify(SECCIONES_AYUDA);
    expect(texto).toMatch(/coste del proveedor en Siweb360 se actualiza siempre/);
    expect(texto).not.toMatch(/su API no lo permite/);
  });
});
