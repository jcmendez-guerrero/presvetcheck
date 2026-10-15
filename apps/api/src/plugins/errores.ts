import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { DomainError, textoError, type CodigoError } from '@mmx/shared';

const ESTADO: Partial<Record<CodigoError, number>> = {
  VALIDACION: 400,
  NO_AUTORIZADO: 401,
  PROHIBIDO: 403,
  NO_ENCONTRADO: 404,
  MEDICAMENTO_NO_EN_SISTEMA: 422,
  FRACCION_NO_VALIDA: 422,
  DNI_RETIRA_OBLIGATORIO: 422,
  CONFLICTO: 409,
  ANULACION_DUPLICADA: 409,
  TRANSICION_NO_PERMITIDA: 409,
  SIWEB_NO_DISPONIBLE: 503,
  CIMAVET_NO_DISPONIBLE: 503,
  EXTRACTOR_NO_CONFIGURADO: 503,
  SIWEB_ESCRITURA_DESACTIVADA: 409,
};

/**
 * Errores con `code` estable y mensaje en español; nunca se devuelven datos personales ni el
 * cuerpo de la petición (SPEC §9.2).
 */
export function registrarErrores(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | DomainError | Error, req, reply) => {
    if (err instanceof DomainError) {
      const status = ESTADO[err.code] ?? 422;
      if (status >= 500) req.log.warn({ code: err.code }, 'error de dependencia');
      return reply.status(status).send({ error: { code: err.code, mensaje: textoError(err.code), detalles: err.details ?? null } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDACION',
          mensaje: textoError('VALIDACION'),
          // Solo rutas y mensajes, nunca los valores enviados.
          detalles: err.validation.map((v) => ({ campo: v.instancePath, mensaje: v.message })),
        },
      });
    }
    const fe = err as FastifyError;
    if (fe.statusCode && fe.statusCode < 500) {
      return reply.status(fe.statusCode).send({ error: { code: 'VALIDACION', mensaje: textoError('VALIDACION'), detalles: null } });
    }
    req.log.error({ err: { name: err.name, message: err.message, stack: err.stack } }, 'error no controlado');
    return reply.status(500).send({ error: { code: 'ERROR_INTERNO', mensaje: 'Se ha producido un error. Inténtalo de nuevo.', detalles: null } });
  });
}
