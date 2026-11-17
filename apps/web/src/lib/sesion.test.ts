import { describe, expect, it } from 'vitest';
import { esRechazoDePlataforma, puedeRedirigir, rutaRetorno, urlLogin, urlLogout } from './sesion';

describe('rutaRetorno', () => {
  it.each([
    ['/recetas/abc/revision', '?x=1', '#l2', '/recetas/abc/revision?x=1#l2'],
    ['/', '', '', '/'],
    ['//evil.com', '', '', '/'],
    ['/\\evil.com', '', '', '/'],
    ['https://evil.com', '', '', '/'],
    ['/.auth/login/aad', '', '', '/'],
    ['', '', '', '/'],
  ])('%s %s %s → %s', (p, s, h, esperado) => {
    expect(rutaRetorno(p, s, h)).toBe(esperado);
  });
});

describe('puedeRedirigir', () => {
  const ahora = 1_000_000;
  it.each([
    ['sin intento previo', null, false, true],
    ['hace 59 999 ms', ahora - 59_999, false, false],
    ['hace 60 001 ms', ahora - 60_001, false, true],
    ['cerrada por el usuario, sin intento', null, true, false],
    ['cerrada por el usuario, intento antiguo', ahora - 600_000, true, false],
  ])('%s', (_, ultimo, cerrada, esperado) => {
    expect(puedeRedirigir(ahora, ultimo, cerrada)).toBe(esperado);
  });
});

describe('urls', () => {
  it('codifica la dirección de vuelta', () => {
    expect(urlLogin('/recetas?x=1')).toBe('/.auth/login/aad?post_login_redirect_uri=%2Frecetas%3Fx%3D1');
  });
  it('cierra sesión volviendo al inicio', () => {
    expect(urlLogout().endsWith('post_logout_redirect_uri=%2F')).toBe(true);
  });
});

describe('esRechazoDePlataforma', () => {
  it.each([
    [401, { error: { code: 'NO_AUTORIZADO' } }, true],
    [401, null, true],
    [403, null, true],
    [403, '<html>Forbidden</html>', true],
    [403, '', true],
    [403, {}, true],
    [403, { error: {} }, true],
    [403, { error: { code: '' } }, true],
    [403, { error: { code: 'PROHIBIDO' } }, false],
    [200, null, false],
    [404, { error: { code: 'NO_ENCONTRADO' } }, false],
    [500, '<html>Error</html>', false],
  ])('%i %j → %s', (status, cuerpo, esperado) => {
    expect(esRechazoDePlataforma(status, cuerpo)).toBe(esperado);
  });
});
