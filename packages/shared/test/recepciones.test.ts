import { describe, expect, it } from 'vitest';
import { ESTADOS_RECEPCION_POR_TEXTO, TEXTO_ESTADO_RECEPCION } from '../src/recepciones';

describe('estados de recepción (specs/014)', () => {
  it('el orden de la columna Estado sigue el texto visible, no el código', () => {
    expect(ESTADOS_RECEPCION_POR_TEXTO.map((e) => TEXTO_ESTADO_RECEPCION[e])).toEqual([
      'Abierta',
      'Descartada',
      'Enviada',
      'Error al enviar',
      'Finalizada',
    ]);
  });
});
