import { createHash } from 'node:crypto';
import { asc, desc, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from './client';
import { auditEvent } from './schema';

export interface AuditInput {
  actor: string;
  accion: string;
  entidad: string;
  entidadId?: string | null;
  antes?: unknown;
  despues?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  at?: Date;
}

export const GENESIS_HASH = '0'.repeat(64);

/** JSON canónico (claves ordenadas) para que el hash sea reproducible. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export function computeAuditHash(
  hashPrev: string,
  e: { at: Date; actor: string; accion: string; entidad: string; entidadId: string | null; antes: unknown; despues: unknown },
): string {
  const payload = canonicalJson({
    at: e.at.toISOString(),
    actor: e.actor,
    accion: e.accion,
    entidad: e.entidad,
    entidadId: e.entidadId,
    antes: e.antes ?? null,
    despues: e.despues ?? null,
  });
  return createHash('sha256').update(hashPrev).update('\n').update(payload).digest('hex');
}

/**
 * Añade un evento de auditoría encadenado (SPEC §9.4). Debe llamarse dentro de una
 * transacción: el bloqueo consultivo serializa la cadena.
 */
export async function appendAudit(tx: DbOrTx, input: AuditInput): Promise<{ hash: string }> {
  await tx.execute(sql`select pg_advisory_xact_lock(7210001)`);
  const last = await tx.select({ hash: auditEvent.hash }).from(auditEvent).orderBy(desc(auditEvent.seq)).limit(1);
  const hashPrev = last[0]?.hash ?? GENESIS_HASH;
  const at = input.at ?? new Date();
  // Se redondea a milisegundos para que el hash sea idéntico al releerlo de la BD.
  const row = {
    at,
    actor: input.actor,
    accion: input.accion,
    entidad: input.entidad,
    entidadId: input.entidadId ?? null,
    antes: (input.antes ?? null) as unknown,
    despues: (input.despues ?? null) as unknown,
  };
  const hash = computeAuditHash(hashPrev, row);
  await tx.insert(auditEvent).values({
    ...row,
    antes: row.antes as never,
    despues: row.despues as never,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    hashPrev,
    hash,
  });
  return { hash };
}

export interface AuditChainResult {
  ok: boolean;
  total: number;
  roturaEn?: { seq: number; id: string };
}

/** Verifica la cadena completa (job semanal; una ruptura genera alerta). */
export async function verifyAuditChain(db: Db): Promise<AuditChainResult> {
  const rows = await db.select().from(auditEvent).orderBy(asc(auditEvent.seq));
  let prev = GENESIS_HASH;
  for (const r of rows) {
    const expected = computeAuditHash(prev, {
      at: r.at,
      actor: r.actor,
      accion: r.accion,
      entidad: r.entidad,
      entidadId: r.entidadId,
      antes: r.antes,
      despues: r.despues,
    });
    if (r.hashPrev !== prev || r.hash !== expected) {
      return { ok: false, total: rows.length, roturaEn: { seq: r.seq, id: r.id } };
    }
    prev = r.hash;
  }
  return { ok: true, total: rows.length };
}
