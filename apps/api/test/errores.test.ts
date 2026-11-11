import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registrarErrores } from '../src/plugins/errores';

/** Registro técnico del error 500 (specs/012): causa original sí, parámetros de la consulta (datos personales) no. */
/** Lanza `error` desde una ruta y devuelve la respuesta y lo que se escribió en el registro técnico. */
async function provocar(error: Error) {
  const lineas: string[] = [];
  const app = Fastify({ logger: { level: 'error', stream: { write: (l: string) => lineas.push(l) } } });
  registrarErrores(app);
  app.get('/falla', async () => {
    throw error;
  });
  const res = await app.inject({ method: 'GET', url: '/falla' });
  await app.close();
  return { res, log: lineas.join('') };
}

describe('error no controlado', () => {
  it('registra la causa de la base de datos sin los parámetros de la consulta y responde con el mensaje genérico', async () => {
    const causa = Object.assign(new Error('boom de driver'), { code: 'ERR_X', detail: 'Ana Pérez' });
    const { res, log } = await provocar(
      new Error('Failed query: select 1\nparams: Ana Pérez,600000000', { cause: causa }),
    );

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: {
        code: 'ERROR_INTERNO',
        mensaje: 'Se ha producido un error. Inténtalo de nuevo.',
        detalles: null,
      },
    });
    expect(log).toContain('Failed query: select 1');
    expect(log).toContain('ERR_X');
    expect(log).toContain('boom de driver');
    expect(log).not.toContain('Ana');
    expect(log).not.toContain('600000000');
  });

  it('de un error de Postgres registra el código pero no su mensaje, que puede incluir el valor rechazado', async () => {
    const pg = Object.assign(new Error('invalid input syntax for type uuid: "Ana Pérez"'), {
      name: 'PostgresError',
      severity: 'ERROR',
      code: '22P02',
    });
    const { log } = await provocar(new Error('Failed query: select 1', { cause: pg }));

    expect(log).toContain('22P02');
    expect(log).toContain('PostgresError');
    expect(log).not.toContain('Ana');
  });

  it('no deja pasar los parámetros a la pila aunque el mensaje lleve símbolos especiales de reemplazo ($&)', async () => {
    const { log } = await provocar(new Error('Failed query: select $& from t\nparams: Ana Pérez'));

    expect(log).toContain('select $& from t');
    expect(log).not.toContain('Ana');
  });
});
