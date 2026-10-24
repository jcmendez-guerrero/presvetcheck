import { eq } from 'drizzle-orm';
import { appendAudit, procedimientoAprobado } from '@mmx/db';
import type { Contexto } from '../contexto';

/**
 * Carga el procedimiento de sustitución (D-01): la instrucción del farmacéutico garante, aprobada fuera de la
 * app. Sin un procedimiento vigente la app no arranca en modo POST. La nueva versión pasa a vigente y la anterior
 * deja de serlo (queda guardada y auditada). Texto en base64 (`--texto-b64`) para pasarlo como argumento del job.
 */
export async function cargarProcedimiento(ctx: Contexto, args: Record<string, string>) {
  const version = args.version?.trim();
  const aprobadoPor = args['aprobado-por']?.trim();
  const texto = args['texto-b64']
    ? Buffer.from(args['texto-b64'], 'base64').toString('utf8').trim()
    : args.texto?.trim();
  if (!version || !aprobadoPor || !texto || texto.length < 40) {
    throw new Error(
      'Uso: procedimiento-cargar --version <v> --aprobado-por <quién y cómo> --texto-b64 <texto en base64 (40+ caracteres)>',
    );
  }
  const ahora = new Date(ctx.clock.now().epochMilliseconds);
  const aprobadoAt = args['aprobado-el'] ? new Date(`${args['aprobado-el']}T00:00:00Z`) : ahora;
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(procedimientoAprobado)
      .set({ vigente: false })
      .where(eq(procedimientoAprobado.codigo, 'SUSTITUCION'));
    await tx
      .insert(procedimientoAprobado)
      .values({
        codigo: 'SUSTITUCION',
        version,
        texto,
        aprobadoPor,
        aprobadoAt,
        vigente: true,
        soloDesarrollo: false,
      });
    await appendAudit(tx, {
      actor: 'procedimiento-cargar',
      accion: 'procedimiento_cargar',
      entidad: 'procedimiento_aprobado',
      entidadId: null,
      despues: { codigo: 'SUSTITUCION', version, aprobadoPor },
    });
  });
  return { codigo: 'SUSTITUCION', version, caracteres: texto.length };
}
