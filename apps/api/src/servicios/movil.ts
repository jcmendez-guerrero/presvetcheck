import { createHash, randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { appendAudit, sesionMovil, sesionMovilEvento } from '@mmx/db';
import { DomainError, Rol } from '@mmx/shared';
import { ahoraDe, type AppDeps } from '../deps';
import type { Usuario } from '../plugins/auth';
import type { ContextoPeticion } from './recetas';

/**
 * Emparejamiento móvil ↔ PC. El PC (con sesión) abre una sesión y enseña un QR con un token; el móvil, sin
 * iniciar sesión, usa ese token para subir fotos de recetas y lecturas de códigos, que el PC recibe como
 * eventos. El móvil actúa en nombre de quien abrió la sesión (auditoría con su id) y nunca ve datos: solo
 * envía. El token vale mientras la sesión no caduque ni se cierre; en base de datos solo está su hash.
 */
export type EventoMovil = { tipo: 'leyendo' } | { tipo: 'receta'; recetaId: string; aviso: string | null } | { tipo: 'codigo'; raw: string };

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const MAX_CODIGO = 512;

export class MovilService {
  constructor(private readonly d: AppDeps) {}

  async abrir(c: ContextoPeticion) {
    const token = randomBytes(32).toString('base64url');
    const expiraAt = new Date(ahoraDe(this.d).getTime() + this.d.config.MOVIL_SESION_HORAS * 3_600_000);
    const [s] = await this.d.db
      .insert(sesionMovil)
      .values({ tokenHash: hashToken(token), usuarioId: c.usuario.id, usuarioNombre: c.usuario.nombre, roles: c.usuario.roles, expiraAt })
      .returning();
    await appendAudit(this.d.db, { actor: c.usuario.id, accion: 'movil_emparejar', entidad: 'sesion_movil', entidadId: s!.id, ip: c.ip, userAgent: c.userAgent });
    return { id: s!.id, token, expiraAt: expiraAt.toISOString() };
  }

  /** Sesión del PC: solo su dueño la consulta. */
  private async propia(id: string, u: Usuario) {
    const [s] = await this.d.db.select().from(sesionMovil).where(eq(sesionMovil.id, id));
    if (!s || s.usuarioId !== u.id) throw new DomainError('NO_ENCONTRADO', 'Sesión de móvil no encontrada');
    return s;
  }

  async eventos(id: string, u: Usuario, desde: number) {
    const s = await this.propia(id, u);
    const ev = await this.d.db
      .select()
      .from(sesionMovilEvento)
      .where(and(eq(sesionMovilEvento.sesionId, id), gt(sesionMovilEvento.seq, desde)))
      .orderBy(asc(sesionMovilEvento.seq))
      .limit(50);
    return {
      activa: !s.cerradaAt && s.expiraAt > ahoraDe(this.d),
      movilConectado: s.movilVistoAt !== null,
      expiraAt: s.expiraAt.toISOString(),
      eventos: ev.map((e) => ({ seq: e.seq, ...(e.datos as EventoMovil) })),
    };
  }

  async cerrar(id: string, c: ContextoPeticion) {
    await this.propia(id, c.usuario);
    await this.d.db.update(sesionMovil).set({ cerradaAt: ahoraDe(this.d) }).where(eq(sesionMovil.id, id));
    await appendAudit(this.d.db, { actor: c.usuario.id, accion: 'movil_desemparejar', entidad: 'sesion_movil', entidadId: id, ip: c.ip, userAgent: c.userAgent });
  }

  /** Token del móvil → sesión activa y contexto de la persona que la abrió en el PC. */
  async autenticar(token: string | undefined, ip: string | null, userAgent: string | null): Promise<{ sesionId: string; ctx: ContextoPeticion; expiraAt: string }> {
    if (!token || token.length < 20) throw new DomainError('NO_AUTORIZADO', 'Falta el código de emparejamiento');
    const ahora = ahoraDe(this.d);
    const [s] = await this.d.db
      .select()
      .from(sesionMovil)
      .where(and(eq(sesionMovil.tokenHash, hashToken(token)), isNull(sesionMovil.cerradaAt), gt(sesionMovil.expiraAt, ahora)));
    if (!s) throw new DomainError('NO_AUTORIZADO', 'El emparejamiento ha caducado: vuelve a leer el código QR del ordenador');
    if (!s.movilVistoAt) await this.d.db.update(sesionMovil).set({ movilVistoAt: ahora }).where(eq(sesionMovil.id, s.id));
    const roles = s.roles.filter((r): r is Rol => Rol.safeParse(r).success);
    return {
      sesionId: s.id,
      expiraAt: s.expiraAt.toISOString(),
      ctx: { usuario: { id: s.usuarioId, nombre: s.usuarioNombre, roles, mfa: false }, ip, userAgent: userAgent ? `movil · ${userAgent}` : 'movil' },
    };
  }

  async publicar(sesionId: string, e: EventoMovil) {
    if (e.tipo === 'codigo' && (!e.raw.trim() || e.raw.length > MAX_CODIGO)) throw new DomainError('VALIDACION', 'Código no válido');
    await this.d.db.insert(sesionMovilEvento).values({ sesionId, tipo: e.tipo, datos: e });
  }
}

/**
 * Base de la URL del QR: APP_PUBLIC_URL; si no, el origen del navegador. Fuera de producción, si el
 * navegador está en localhost, se cambia por la IP de este equipo en la red local para que el móvil llegue.
 */
export function urlBaseMovil(publica: string | undefined, origen: string | undefined, produccion: boolean): string | null {
  if (publica) return publica.replace(/\/$/, '');
  if (!origen) return null;
  try {
    const u = new URL(origen);
    if (!produccion && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
      const ip = ipLocal();
      if (ip) u.hostname = ip;
    }
    return u.origin;
  } catch {
    return null;
  }
}

function ipLocal(): string | null {
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) return i.address;
  }
  return null;
}
