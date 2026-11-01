import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppDeps } from './deps';
import { registrarAuth, type OpcionesAuth } from './plugins/auth';
import { registrarErrores } from './plugins/errores';
import { rutasAdmin } from './rutas/admin';
import { rutasAsistente } from './rutas/asistente';
import { rutasMedicamentos } from './rutas/medicamentos';
import { rutasMovil } from './rutas/movil';
import { rutasOperativa } from './rutas/operativa';
import { rutasRecetas } from './rutas/recetas';
import { rutasRegistros } from './rutas/registros';
import { rutasReportes } from './rutas/reportes';
import { rutasSistema } from './rutas/sistema';

// Mensajes de validación en español (se devuelven a la UI campo a campo).
z.config(z.locales.es());

/** Rutas de log que se redactan: nunca datos personales en logs (SPEC §9.2, §11). */
export const REDACCION = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-dev-user"]',
  'req.headers["x-movil-token"]',
  'req.headers["x-ms-client-principal"]',
  'req.headers["x-ms-client-principal-name"]',
  'req.headers["x-ms-client-principal-id"]',
  '*.dni',
  '*.dniRetira',
  '*.movil',
  '*.telefono',
  '*.pregunta',
  '*.respuesta',
  '*.texto',
  '*.comentario',
  '*.direccion',
  '*.propietario',
  '*.titular',
  '*.contactoTutor',
];

export interface BuildAppOptions {
  deps: AppDeps;
  auth?: Pick<OpcionesAuth, 'verificar'>;
  logger?: boolean;
}

export async function buildApp({ deps, auth, logger }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      logger === false || deps.config.NODE_ENV === 'test'
        ? false
        : { level: deps.config.LOG_LEVEL, redact: { paths: REDACCION, censor: '[redactado]' } },
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarErrores(app);
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 10, fields: 30 } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Mundo Mascotix · Recetas veterinarias', version: '0.1.0', description: 'API de verificación de recetas, dispensación y registro de entradas/salidas (SPEC §7).' },
      components: { securitySchemes: { entra: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ entra: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await registrarAuth(app, { config: deps.config, ...(auth?.verificar ? { verificar: auth.verificar } : {}) });
  await rutasSistema(app, deps);
  await rutasRecetas(app, deps);
  await rutasMedicamentos(app, deps);
  await rutasOperativa(app, deps);
  await rutasRegistros(app, deps);
  await rutasAdmin(app, deps);
  await rutasReportes(app, deps);
  await rutasMovil(app, deps);
  await rutasAsistente(app, deps);

  // SPA estática (PWA) en producción: misma app "mmx-api" (SPEC §1.1).
  const web = deps.config.WEB_DIST_DIR;
  if (web && existsSync(web)) {
    await app.register(fastifyStatic, { root: web, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.status(404).send({ error: { code: 'NO_ENCONTRADO' } }) : reply.sendFile('index.html')));
  }
  return app;
}
