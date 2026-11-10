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
  SKU_NO_TEST: 400,
  CIMAVET_NO_DISPONIBLE: 503,
  EXTRACTOR_NO_CONFIGURADO: 503,
  SIWEB_ESCRITURA_DESACTIVADA: 409,
  ASISTENTE_DESACTIVADO: 409,
  ASISTENTE_NO_DISPONIBLE: 503,
  ASISTENTE_LIMITE_MENSUAL: 429,
  ASISTENTE_CONVERSACION_AJENA: 403,
  ASISTENTE_CONVERSACION_CERRADA: 409,
  RECETA_LINEA_NO_ENCONTRADA: 404,
  TICKET_YA_FINALIZADO: 409,
  TICKET_CANTIDAD_INSUFICIENTE: 422,
  MODO_RETROSPECTIVO_DESHABILITADO: 403,
  RECETA_YA_VINCULADA: 409,
  ALTA_MANUAL_DESHABILITADA: 403,
  MEDICAMENTO_NO_SELECCIONADO: 422,
  ESPECIE_NO_SELECCIONADA: 422,
  FECHA_ORIGINAL_INVALIDA: 422,
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
      // El mensaje concreto del dominio ("Indica el nombre del producto") si lo hay; si no, el genérico del código.
      const mensaje = err.message && err.message !== err.code ? err.message : textoError(err.code);
      return reply.status(status).send({ error: { code: err.code, mensaje, detalles: err.details ?? null } });
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
      return reply
        .status(fe.statusCode)
        .send({ error: { code: 'VALIDACION', mensaje: textoError('VALIDACION'), detalles: null } });
    }
    // Drizzle añade «params: …» al mensaje (y por tanto a la pila) y los parámetros pueden ser datos personales:
    // se cortan. La causa original (código y mensaje de la base de datos) se conserva, sin `detail`, que puede
    // llevar valores de filas.
    const mensajeSinParams = err.message.split('\nparams:')[0] ?? '';
    const causa = (err as { cause?: { name?: string; code?: string; message?: string } }).cause;
    req.log.error(
      {
        err: {
          name: err.name,
          message: mensajeSinParams,
          stack: err.stack?.replace(err.message, mensajeSinParams),
        },
        // Fuera de `err`: el serializador de pino trata `err.cause` por su cuenta y perdería el código.
        ...(causa && { causa: { name: causa.name, code: causa.code, message: causa.message } }),
      },
      'error no controlado',
    );
    return reply.status(500).send({
      error: {
        code: 'ERROR_INTERNO',
        mensaje: 'Se ha producido un error. Inténtalo de nuevo.',
        detalles: null,
      },
    });
  });
}
