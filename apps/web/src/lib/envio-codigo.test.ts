import { describe, expect, it, vi } from 'vitest';
import {
  cargarLecturas,
  enviarCodigo,
  guardarLecturas,
  nuevoId,
  recortar,
  sePuedeReintentar,
  TEXTO_CADUCADO,
  TEXTO_INVALIDO,
  TEXTO_LARGO,
  TEXTO_SIN_RED,
  type Lectura,
} from './envio-codigo';

const TOKEN = 'x'.repeat(43);
const respuesta = (status: number, cuerpo?: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(cuerpo === undefined ? null : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), {
      status,
    }),
  ) as unknown as typeof fetch;
const lectura = (p: Partial<Lectura> = {}): Lectura => ({
  id: nuevoId(),
  raw: '(01)08470000570016',
  leidoAt: '2026-11-17T10:00:00.000Z',
  estado: 'enviada',
  motivo: null,
  ...p,
});

describe('enviarCodigo: la lectura solo está enviada cuando la API la acepta (204)', () => {
  it('204 → enviada; el cuerpo lleva el código íntegro y el id; va la cabecera del token', async () => {
    const f = respuesta(204);
    const raw = '0108470000570016\u001d10ABC123';
    const id = nuevoId();
    expect(await enviarCodigo(TOKEN, { id, raw }, f)).toEqual({ estado: 'enviada', motivo: null });
    const [url, init] = vi.mocked(f).mock.calls[0]!;
    expect(url).toBe('/api/movil/m/codigos');
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>)['x-movil-token']).toBe(TOKEN);
    expect(JSON.parse(init!.body as string)).toEqual({ raw, id });
  });

  it('cada lectura recibe un id UUID distinto, también sin HTTPS', () => {
    const a = nuevoId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nuevoId()).not.toBe(a);
  });

  it('red caída → por reintentar con el aviso de conexión', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    expect(await enviarCodigo(TOKEN, lectura(), f)).toEqual({
      estado: 'por-reintentar',
      motivo: TEXTO_SIN_RED,
    });
  });

  it.each([500, 502, 503])('%i del servidor → por reintentar', async (s) => {
    expect(
      (await enviarCodigo(TOKEN, lectura(), respuesta(s, { error: { code: 'ERROR_INTERNO' } }))).estado,
    ).toBe('por-reintentar');
  });

  it('una respuesta que no es de la API (HTML, 403 o 200 de la plataforma) → por reintentar, nunca «enviada»', async () => {
    for (const r of [
      respuesta(200, '<html>login</html>'),
      respuesta(403, '<html>no</html>'),
      respuesta(401, 'x'),
    ]) {
      expect(await enviarCodigo(TOKEN, lectura(), r)).toEqual({
        estado: 'por-reintentar',
        motivo: TEXTO_SIN_RED,
      });
    }
  });

  it('401 de la API (caducado o cerrado) → sin emparejamiento, sin reintentar', async () => {
    const r = await enviarCodigo(TOKEN, lectura(), respuesta(401, { error: { code: 'NO_AUTORIZADO' } }));
    expect(r).toEqual({ estado: 'sin-emparejamiento', motivo: TEXTO_CADUCADO });
    expect(sePuedeReintentar(lectura({ estado: r.estado }))).toBe(false);
  });

  it('código demasiado largo o vacío → rechazada sin llamar a la API', async () => {
    const f = respuesta(204);
    expect(await enviarCodigo(TOKEN, lectura({ raw: 'x'.repeat(513) }), f)).toEqual({
      estado: 'rechazada',
      motivo: TEXTO_LARGO,
    });
    expect(await enviarCodigo(TOKEN, lectura({ raw: '  ' }), f)).toEqual({
      estado: 'rechazada',
      motivo: TEXTO_INVALIDO,
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('400 de la API → rechazada («El código no es válido»)', async () => {
    expect(await enviarCodigo(TOKEN, lectura(), respuesta(400, { error: { code: 'VALIDACION' } }))).toEqual({
      estado: 'rechazada',
      motivo: TEXTO_INVALIDO,
    });
  });

  it('el reintento reutiliza el mismo id y el mismo código', async () => {
    const l = lectura({ estado: 'por-reintentar' });
    const f1 = vi.fn().mockRejectedValue(new Error('x')) as unknown as typeof fetch;
    const f2 = respuesta(204);
    await enviarCodigo(TOKEN, l, f1);
    await enviarCodigo(TOKEN, l, f2);
    const cuerpo = (f: typeof fetch) => JSON.parse(vi.mocked(f).mock.calls[0]![1]!.body as string);
    expect(cuerpo(f2)).toEqual(cuerpo(f1));
    expect(sePuedeReintentar(l)).toBe(true);
  });
});

describe('lecturas conservadas en la pestaña del móvil', () => {
  it('se conservan todas las no enviadas y solo las 5 últimas enviadas', () => {
    const ls = [
      lectura({ estado: 'por-reintentar' }),
      ...Array.from({ length: 7 }, (_, i) => lectura({ raw: `ok-${i}` })),
      lectura({ estado: 'por-reintentar', raw: 'vieja' }),
    ];
    const r = recortar(ls);
    expect(r.filter((l) => l.estado === 'enviada').map((l) => l.raw)).toEqual([
      'ok-0',
      'ok-1',
      'ok-2',
      'ok-3',
      'ok-4',
    ]);
    expect(r.filter((l) => l.estado === 'por-reintentar')).toHaveLength(2);
  });

  it('guardar y volver a cargar; una lectura que seguía enviando pasa a por reintentar', () => {
    const mem = new Map<string, string>();
    const a = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const en = lectura({ estado: 'enviando', raw: 'EN-VUELO' });
    guardarLecturas([en, lectura({ raw: 'OK' })], a);
    const c = cargarLecturas(a);
    expect(c.map((l) => [l.raw, l.estado])).toEqual([
      ['EN-VUELO', 'por-reintentar'],
      ['OK', 'enviada'],
    ]);
    expect(c[0]!.id).toBe(en.id);
  });

  it('un almacén vacío o roto da una lista vacía', () => {
    expect(cargarLecturas({ getItem: () => null, setItem: () => {} })).toEqual([]);
    expect(cargarLecturas({ getItem: () => '{no json', setItem: () => {} })).toEqual([]);
  });
});
