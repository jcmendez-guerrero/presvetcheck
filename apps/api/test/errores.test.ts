import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registrarErrores } from '../src/plugins/errores';

/** Registro técnico del error 500 (specs/012): causa original sí, parámetros de la consulta (datos personales) no. */
describe('error no controlado', () => {
  it('registra la causa de la base de datos sin los parámetros de la consulta y responde con el mensaje genérico', async () => {
    const lineas: string[] = [];
    const app = Fastify({ logger: { level: 'error', stream: { write: (l: string) => lineas.push(l) } } });
    registrarErrores(app);
    app.get('/falla', async () => {
      const causa = Object.assign(new Error('boom de postgres'), { code: 'XX000', detail: 'Ana Pérez' });
      throw new Error('Failed query: select 1\nparams: Ana Pérez,600000000', { cause: causa });
    });

    const res = await app.inject({ method: 'GET', url: '/falla' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'ERROR_INTERNO', mensaje: 'Se ha producido un error. Inténtalo de nuevo.', detalles: null },
    });
    const log = lineas.join('');
    expect(log).toContain('Failed query: select 1');
    expect(log).toContain('XX000');
    expect(log).toContain('boom de postgres');
    expect(log).not.toContain('Ana');
    expect(log).not.toContain('600000000');
    await app.close();
  });
});
