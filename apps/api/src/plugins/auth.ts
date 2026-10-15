import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { DomainError, Rol, type AppConfig } from '@mmx/shared';

/** Usuario autenticado (Microsoft Entra ID con app roles, SPEC §9.1). */
export interface Usuario {
  id: string;
  nombre: string;
  roles: Rol[];
  /** Autenticación multifactor en la sesión (claim `amr`). */
  mfa: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    usuario: Usuario | null;
  }
}

/** Usuarios del modo dev (selector de usuario/rol en la UI y cabecera `x-dev-user`). */
export const USUARIOS_DEV: Record<string, { nombre: string; roles: Rol[] }> = {
  'dev-empleado': { nombre: 'Empleada de prueba', roles: ['empleado'] },
  'dev-veterinaria': { nombre: 'Veterinaria responsable de prueba', roles: ['veterinaria_responsable'] },
  'dev-admin': { nombre: 'Administración de prueba', roles: ['admin'] },
};

const PUBLICAS = ['/api/health', '/api/ready', '/api/openapi.json', '/api/docs', '/api/config/publica'];

export interface OpcionesAuth {
  config: Pick<AppConfig, 'AUTH_MODE' | 'NODE_ENV' | 'ENTRA_TENANT_ID' | 'ENTRA_CLIENT_ID'> & { AUTH_EASYAUTH?: boolean };
  /** Verificador inyectable (tests). Por defecto, JWKS de Entra. */
  verificar?: (token: string) => Promise<JWTPayload>;
}

export function verificadorEntra(tenant: string, clientId: string) {
  const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`));
  return async (token: string) =>
    (
      await jwtVerify(token, jwks, {
        issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
        audience: [clientId, `api://${clientId}`],
      })
    ).payload;
}

export function usuarioDesdeClaims(p: JWTPayload): Usuario {
  const roles = (Array.isArray(p.roles) ? p.roles : []).filter((r): r is Rol => Rol.safeParse(r).success);
  const amr = Array.isArray(p.amr) ? (p.amr as string[]) : [];
  return {
    id: String(p.oid ?? p.sub ?? ''),
    nombre: String(p.name ?? p.preferred_username ?? 'Usuario'),
    roles,
    mfa: amr.includes('mfa'),
  };
}

export async function registrarAuth(app: FastifyInstance, o: OpcionesAuth) {
  // Doble comprobación (además de la validación de configuración): el modo dev nunca en producción.
  if (o.config.AUTH_MODE === 'dev' && o.config.NODE_ENV === 'production') {
    throw new Error('AUTH_MODE=dev está prohibido con NODE_ENV=production');
  }
  const verificar =
    o.verificar ??
    (o.config.AUTH_MODE === 'entra' && o.config.ENTRA_TENANT_ID && o.config.ENTRA_CLIENT_ID
      ? verificadorEntra(o.config.ENTRA_TENANT_ID, o.config.ENTRA_CLIENT_ID)
      : null);

  app.decorateRequest('usuario', null);
  app.addHook('onRequest', async (req) => {
    const ruta = req.url.split('?')[0] ?? '';
    if (!ruta.startsWith('/api/') || PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`))) return;
    if (o.config.AUTH_MODE === 'dev') {
      const id = String(req.headers['x-dev-user'] ?? '');
      const u = USUARIOS_DEV[id];
      if (!u) throw new DomainError('NO_AUTORIZADO', 'Cabecera x-dev-user ausente o desconocida');
      req.usuario = { id, nombre: u.nombre, roles: u.roles, mfa: req.headers['x-dev-mfa'] === '1' };
      return;
    }
    const auth = req.headers.authorization ?? '';
    const principal = req.headers['x-ms-client-principal'];
    if (!auth.startsWith('Bearer ') && o.config.AUTH_EASYAUTH && typeof principal === 'string') {
      req.usuario = usuarioDesdePrincipal(principal);
      if (!req.usuario.id) throw new DomainError('NO_AUTORIZADO');
      return;
    }
    if (!auth.startsWith('Bearer ') || !verificar) throw new DomainError('NO_AUTORIZADO');
    try {
      req.usuario = usuarioDesdeClaims(await verificar(auth.slice(7)));
    } catch {
      throw new DomainError('NO_AUTORIZADO', 'Token no válido');
    }
    if (!req.usuario.id) throw new DomainError('NO_AUTORIZADO');
  });
}

/**
 * Cabecera X-MS-CLIENT-PRINCIPAL (base64 JSON con `claims[]`) que inyecta la autenticación integrada de
 * Container Apps tras validar la sesión de Entra. Solo se usa con AUTH_EASYAUTH=true.
 */
export function usuarioDesdePrincipal(b64: string): Usuario {
  try {
    const p = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { claims?: { typ: string; val: string }[] };
    const claims = p.claims ?? [];
    const val = (...t: string[]) => claims.filter((c) => t.includes(c.typ)).map((c) => c.val);
    return usuarioDesdeClaims({
      oid: val('http://schemas.microsoft.com/identity/claims/objectidentifier', 'oid')[0],
      name: val('name')[0],
      roles: val('roles', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'),
      amr: val('amr', 'http://schemas.microsoft.com/claims/authnmethodsreferences'),
    });
  } catch {
    throw new DomainError('NO_AUTORIZADO');
  }
}

/** preHandler: exige alguno de los roles. */
export function requiereRol(...roles: Rol[]) {
  return async (req: FastifyRequest) => {
    const u = req.usuario;
    if (!u) throw new DomainError('NO_AUTORIZADO');
    if (!u.roles.some((r) => roles.includes(r))) throw new DomainError('PROHIBIDO', `Requiere rol: ${roles.join(' o ')}`);
  };
}

/** Acciones que exigen MFA (aprobar reglas, ver el DNI completo). */
export function exigirMfa(req: FastifyRequest) {
  if (!req.usuario?.mfa) throw new DomainError('PROHIBIDO', 'Esta acción exige autenticación multifactor (MFA)');
}

export function usuario(req: FastifyRequest): Usuario {
  if (!req.usuario) throw new DomainError('NO_AUTORIZADO');
  return req.usuario;
}

/**
 * Grupos de roles (SPEC §9.1). El farmacéutico garante NO usa la app: sus actuaciones (autorizar, firmar,
 * revisar) se hacen fuera y las registra el empleado. El admin no participa en la operativa.
 */
export const ROLES = {
  operativa: ['empleado', 'veterinaria_responsable'] as Rol[],
  lecturaRegistros: ['empleado', 'veterinaria_responsable', 'admin'] as Rol[],
  admin: ['admin'] as Rol[],
};
