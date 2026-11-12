import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { albaranDocumento, auditEvent, sesionMovil } from '@mmx/db';
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

describe('albarán o factura desde el móvil (spec 013)', () => {
  const emparejar = async () =>
    (await api(E.app, 'dev-empleado', 'POST', '/api/movil/sesiones')).json as { id: string; token: string };
  const subirDelMovil = (token: string, paginas: number, semilla: string, mime = 'image/jpeg') => {
    const m = multipart(
      {},
      Array.from({ length: paginas }, (_, i) => ({
        nombre: `p${i}.jpg`,
        mime,
        bytes: Buffer.from(`albaran-${semilla}-${i}`),
      })),
    );
    return E.app.inject({
      method: 'POST',
      url: '/api/movil/m/albaranes',
      headers: { ...m.headers, 'x-movil-token': token },
      payload: m.payload,
    });
  };
  type Ev = { tipo: string; documentoId?: string | null };
  const eventos = async (id: string) =>
    ((await api(E.app, 'dev-empleado', 'GET', `/api/movil/sesiones/${id}/eventos`)).json.eventos as Ev[]).map(
      (e) => ({ tipo: e.tipo, documentoId: e.documentoId }),
    );
  const filas = async () => (await E.h.db.select().from(albaranDocumento)).length;

  it('2 fotos: el móvil solo recibe «enviado»; el PC recibe el id y pide lo leído; auditoría a nombre de quien emparejó', async () => {
    const { id, token } = await emparejar();
    expect((await delMovil(token, 'GET', '/api/movil/m/sesion')).json()).toMatchObject({ albaranes: true });
    const r = await subirDelMovil(token, 2, 'a');
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ enviado: true });

    const ev = await eventos(id);
    expect(ev.map((e) => e.tipo)).toEqual(['leyendo', 'albaran']);
    const documentoId = ev[1]!.documentoId as string;

    const lectura = await api(E.app, 'dev-empleado', 'GET', `/api/recepciones/albaranes/${documentoId}`);
    expect(lectura.status).toBe(200);
    expect(lectura.json).toMatchObject({
      documentoId,
      lectura: { numero: 'ALB-2026-00417', proveedor: 'DISTRIBUIDORA VETERINARIA DE PRUEBA S.L.' },
    });
    expect(lectura.json).toHaveProperty('distribuidorSugerido');
    expect(lectura.json).toHaveProperty('duplicados');
    expect(lectura.json).toHaveProperty('mismoFichero');

    const [fila] = await E.h.db.select().from(albaranDocumento).where(eq(albaranDocumento.id, documentoId));
    expect(fila!.paginas).toHaveLength(2);
    expect(fila!.creadoPor).toBe('dev-empleado');
    const [a] = await E.h.db.select().from(auditEvent).where(eq(auditEvent.entidadId, documentoId));
    expect(a).toMatchObject({ accion: 'albaran_leer', actor: 'dev-empleado' });
    expect(a!.userAgent).toMatch(/^movil/);
  });

  it('SC-002: lo leído desde el móvil es lo mismo que al subir el mismo documento desde el ordenador', async () => {
    const { id, token } = await emparejar();
    expect((await subirDelMovil(token, 1, 'igual')).statusCode).toBe(201);
    const documentoId = (await eventos(id))[1]!.documentoId as string;
    const delTelefono = (await api(E.app, 'dev-empleado', 'GET', `/api/recepciones/albaranes/${documentoId}`)).json;
    // Otra persona sube los mismos bytes desde el PC (así no se reutiliza la lectura del móvil).
    const m = multipart({}, [{ nombre: 'p0.jpg', mime: 'image/jpeg', bytes: Buffer.from('albaran-igual-0') }]);
    const pc = await E.app.inject({
      method: 'POST',
      url: '/api/recepciones/albaranes',
      headers: { ...m.headers, 'x-dev-user': 'dev-veterinaria' },
      payload: m.payload,
    });
    expect(pc.statusCode).toBe(201);
    expect(pc.json().documentoId).not.toBe(documentoId);
    expect(pc.json().lectura).toEqual(delTelefono.lectura);
  });

  it('el mismo envío dos veces no lee dos veces: mismo documento y una sola fila', async () => {
    const { token } = await emparejar();
    const antes = await filas();
    const a = await subirDelMovil(token, 2, 'repetido');
    const b = await subirDelMovil(token, 2, 'repetido');
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(await filas()).toBe(antes + 1);
  });

  it('errores: sesión cerrada → 401; sin ficheros o tipo no admitido → 400; más de 10 → rechazado sin guardar ni avisar', async () => {
    const { id, token } = await emparejar();
    const antes = await filas();
    expect((await subirDelMovil(token, 0, 'x')).statusCode).toBe(400);
    expect((await subirDelMovil(token, 1, 'x', 'text/plain')).statusCode).toBe(400);
    const demasiados = await subirDelMovil(token, 11, 'x');
    expect(demasiados.statusCode).toBeGreaterThanOrEqual(400);
    expect(demasiados.statusCode).toBeLessThan(500);
    expect(await filas()).toBe(antes);
    expect(await eventos(id)).toEqual([]);

    expect((await api(E.app, 'dev-empleado', 'POST', `/api/movil/sesiones/${id}/cerrar`)).status).toBe(204);
    expect((await subirDelMovil(token, 1, 'y')).statusCode).toBe(401);
  });

  it('más de 25 MB entre todas las páginas: 400, sin guardar ni avisar (se corta antes de leer)', async () => {
    const { id, token } = await emparejar();
    const antes = await filas();
    const m = multipart(
      {},
      [0, 1].map((i) => ({ nombre: `g${i}.pdf`, mime: 'application/pdf', bytes: Buffer.alloc(13 * 1024 * 1024, i + 1) })),
    );
    const r = await E.app.inject({
      method: 'POST',
      url: '/api/movil/m/albaranes',
      headers: { ...m.headers, 'x-movil-token': token },
      payload: m.payload,
    });
    expect(r.statusCode).toBe(400);
    expect(await filas()).toBe(antes);
    expect(await eventos(id)).toEqual([]);
  });

  it('sin lector de albaranes: la sesión lo indica, la subida da 503 y el PC recibe el aviso de fallo', async () => {
    const { id, token } = await emparejar();
    const lector = E.deps.lectorAlbaranes;
    Object.assign(E.deps, { lectorAlbaranes: null });
    try {
      expect((await delMovil(token, 'GET', '/api/movil/m/sesion')).json()).toMatchObject({ albaranes: false });
      expect((await subirDelMovil(token, 1, 'sin-lector')).statusCode).toBe(503);
      expect(await eventos(id)).toEqual([
        { tipo: 'leyendo', documentoId: undefined },
        { tipo: 'albaran', documentoId: null },
      ]);
    } finally {
      Object.assign(E.deps, { lectorAlbaranes: lector });
    }
  });
});
