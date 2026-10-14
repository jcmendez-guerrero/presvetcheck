import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { loadConfig, DomainError } from '@mmx/shared';
import { registrarAuth, usuarioDesdeClaims, requiereRol } from '../src/plugins/auth';
import { registrarErrores } from '../src/plugins/errores';
import { buildApp } from '../src/app';
import { entorno, type Entorno } from './entorno';

describe('autenticación Microsoft Entra (SPEC §9.1)', () => {
  let E: Entorno;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    E = await entorno();
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'x', BLOB_CONNECTION_STRING: 'x', AUTH_MODE: 'entra', ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c' });
    app = await buildApp({
      deps: { ...E.deps, config },
      logger: false,
      auth: {
        verificar: async (token) => {
          if (token === 'garante-mfa') return { oid: 'g1', name: 'Garante', roles: ['farmaceutico_garante'], amr: ['pwd', 'mfa'] };
          if (token === 'empleado') return { oid: 'e1', name: 'Empleada', roles: ['empleado', 'rol_inventado'] };
          throw new Error('firma no válida');
        },
      },
    });
  }, 180_000);
  afterAll(async () => {
    await app.close();
    await E.app.close();
  });

  it('valida el Bearer, mapea app roles y MFA (amr)', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer garante-mfa' } });
    expect(me.json()).toEqual({ id: 'g1', nombre: 'Garante', roles: ['farmaceutico_garante'], mfa: true });
    const e = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer empleado' } });
    expect(e.json()).toMatchObject({ roles: ['empleado'], mfa: false });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer malo' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    // x-dev-user no tiene efecto en modo entra
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-dev-user': 'dev-garante' } })).statusCode).toBe(401);
  });

  it('cabecera X-MS-CLIENT-PRINCIPAL solo con AUTH_EASYAUTH=true', async () => {
    const principal = Buffer.from(JSON.stringify({ claims: [{ typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'p1' }, { typ: 'name', val: 'Garante' }, { typ: 'roles', val: 'farmaceutico_garante' }, { typ: 'amr', val: 'mfa' }] })).toString('base64');
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-ms-client-principal': principal } })).statusCode).toBe(401);
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'x', BLOB_CONNECTION_STRING: 'x', AUTH_MODE: 'entra', ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', AUTH_EASYAUTH: 'true' });
    const app2 = await buildApp({ deps: { ...E.deps, config }, logger: false, auth: { verificar: async () => ({}) } });
    expect((await app2.inject({ method: 'GET', url: '/api/me', headers: { 'x-ms-client-principal': principal } })).json()).toEqual({ id: 'p1', nombre: 'Garante', roles: ['farmaceutico_garante'], mfa: true });
    expect((await app2.inject({ method: 'GET', url: '/api/me', headers: { 'x-ms-client-principal': 'no-es-json' } })).statusCode).toBe(401);
    await app2.close();
  });

  it('claims sin roles ni oid', () => {
    expect(usuarioDesdeClaims({ sub: 's' })).toEqual({ id: 's', nombre: 'Usuario', roles: [], mfa: false });
  });
});

describe('AUTH_MODE=dev es imposible en producción', () => {
  it('la configuración lo rechaza y el plugin también', async () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'dev', DATABASE_URL: 'x' })).toThrow(/AUTH_MODE=dev/);
    const app = Fastify();
    registrarErrores(app);
    await expect(registrarAuth(app, { config: { AUTH_MODE: 'dev', NODE_ENV: 'production', ENTRA_TENANT_ID: undefined, ENTRA_CLIENT_ID: undefined } })).rejects.toThrow(/prohibido/);
  });

  it('requiereRol sin usuario → NO_AUTORIZADO', async () => {
    await expect(requiereRol('admin')({ usuario: null } as never)).rejects.toBeInstanceOf(DomainError);
  });
});
