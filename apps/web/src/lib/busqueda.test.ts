import { describe, expect, it } from 'vitest';
import { estadoBusqueda } from './busqueda';

describe('estadoBusqueda', () => {
  it.each([
    // letras, pendiente, error, n, esperado
    [0, false, false, 0, 'corto'],
    [2, true, true, 5, 'corto'], // con menos de 3 letras no se busca, pase lo que pase
    [3, true, false, 0, 'buscando'],
    [3, true, true, 0, 'buscando'], // al reintentar, la búsqueda en marcha gana al error anterior
    [3, true, false, 4, 'buscando'], // lista anterior visible pero desfasada
    [3, false, true, 0, 'error'],
    [3, false, true, 4, 'error'],
    [3, false, false, 0, 'vacio'],
    [3, false, false, 1, 'resultados'],
    [12, false, false, 8, 'resultados'],
  ] as const)(
    '%i letras, pendiente=%s, error=%s, %i resultados → %s',
    (letras, pendiente, error, n, esperado) => {
      expect(estadoBusqueda({ letras, pendiente, error, n })).toBe(esperado);
    },
  );
});
