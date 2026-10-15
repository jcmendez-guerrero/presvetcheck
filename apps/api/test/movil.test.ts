import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvent, sesionMovil } from '@mmx/db';
import { urlBaseMovil } from '../src/servicios/movil';
import { api, entorno, multipart, type Entorno } from './entorno';

let E: Entorno;
beforeAll(async () => {
  E = await entorno();
}, 180_000);
afterAll(async () => {
  await E.app.close();
});

const delMovil = (token: string, method: 'GET' | 'POST', url: string, body?: unknown) =>
  E.app.inject({ method, url, headers: { 'x-movil-token': token }, ...(body !== undefined ? { payload: body as object } : {}) });

describe('emparejamiento del móvil con el PC', () => {
  it('el PC abre la sesión; el móvil sube la receta y envía códigos; el PC los recibe en orden', async () => {
    const s = await api(E.app, 'dev-empleado', 'POST', '/api/movil/sesiones');
    expect(s.status).toBe(201);
    const { id, token } = s.json as { id: string; token: string };
    // En base de datos solo el hash del token.
    const [fila] = await E.h.db.select().from(sesionMovil).where(eq(sesionMovil.id, id));
    expect(JSON.stringify(fila)).not.toContain(token);

    expect((await api(E.app, 'dev-empleado', 'GET', `/api/movil/sesiones/${id}/eventos`)).json).toMatchObject({ activa: true, movilConectado: false, eventos: [] });
    expect((await delMovil(token, 'GET', '/api/movil/m/sesion')).json()).toMatchObject({ usuario: 'Empleada de prueba' });

    const m = multipart({ fixture: 'demo-compania-papel' }, [{ nombre: 'r.jpg', mime: 'image/jpeg', bytes: Buffer.from(`foto-${Math.random()}`) }]);
    const sub = await E.app.inject({ method: 'POST', url: '/api/movil/m/recetas', headers: { ...m.headers, 'x-movil-token': token }, payload: m.payload });
    expect(sub.statusCode).toBe(201);
    const recetaId = sub.json().id as string;
    expect((await delMovil(token, 'POST', '/api/movil/m/codigos', { raw: '010847000057001617261130' })).statusCode).toBe(204);

    const ev = (await api(E.app, 'dev-empleado', 'GET', `/api/movil/sesiones/${id}/eventos`)).json as { movilConectado: boolean; eventos: { seq: number; tipo: string }[] };
    expect(ev.movilConectado).toBe(true);
    expect(ev.eventos.map((e) => e.tipo)).toEqual(['leyendo', 'receta', 'codigo']);
    expect(ev.eventos[1]).toMatchObject({ recetaId });
    expect(ev.eventos[2]).toMatchObject({ raw: '010847000057001617261130' });
    // Cursor: solo lo nuevo.
    expect((await api(E.app, 'dev-empleado', 'GET', `/api/movil/sesiones/${id}/eventos?desde=${ev.eventos[2]!.seq}`)).json.eventos).toEqual([]);

    // La receta queda a nombre de quien abrió la sesión, y se audita que vino del móvil.
    expect((await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${recetaId}`)).json.estado).toBe('EXTRAIDA');
    const [a] = await E.h.db.select().from(auditEvent).where(eq(auditEvent.entidadId, recetaId));
    expect(a!.actor).toBe('dev-empleado');
    expect(a!.userAgent).toMatch(/^movil/);
  });

  it('sin token, con token falso o tras desconectar: 401; otra persona no ve la sesión', async () => {
    expect((await E.app.inject({ method: 'GET', url: '/api/movil/m/sesion' })).statusCode).toBe(401);
    expect((await delMovil('x'.repeat(43), 'GET', '/api/movil/m/sesion')).statusCode).toBe(401);
    const { id, token } = (await api(E.app, 'dev-empleado', 'POST', '/api/movil/sesiones')).json as { id: string; token: string };
    expect((await api(E.app, 'dev-veterinaria', 'GET', `/api/movil/sesiones/${id}/eventos`)).status).toBe(404);
    expect((await api(E.app, 'dev-admin', 'POST', '/api/movil/sesiones')).status).toBe(403);
    expect((await api(E.app, 'dev-empleado', 'POST', `/api/movil/sesiones/${id}/cerrar`)).status).toBe(204);
    expect((await delMovil(token, 'POST', '/api/movil/m/codigos', { raw: '123' })).statusCode).toBe(401);
  });

  it('URL del QR: la pública si está configurada; en local, la IP de la red en lugar de localhost', () => {
    expect(urlBaseMovil('https://recetas.example.org/', 'http://localhost:5173', false)).toBe('https://recetas.example.org');
    expect(urlBaseMovil(undefined, 'https://app.example.org', true)).toBe('https://app.example.org');
    expect(urlBaseMovil(undefined, 'http://localhost:5173', true)).toBe('http://localhost:5173');
    expect(urlBaseMovil(undefined, 'http://localhost:5173', false)).toMatch(/^http:\/\/[\d.a-z]+:5173$/);
  });
});
