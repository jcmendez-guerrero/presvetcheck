import { sql } from 'drizzle-orm';
import type { AppDeps } from '../deps';
import { PendientesService } from '../servicios/pendientes';
import { ROLES, requiereRol, usuario } from '../plugins/auth';
import type { App } from './comun';

export async function rutasSistema(app: App, d: AppDeps) {
  app.get('/api/health', { schema: { tags: ['sistema'], summary: 'Sonda de vida' } }, async () => ({
    status: 'ok',
  }));
  app.get(
    '/api/ready',
    { schema: { tags: ['sistema'], summary: 'Sonda de disponibilidad (BD)' } },
    async (_req, reply) => {
      try {
        await d.db.execute(sql`select 1`);
        return { status: 'ready' };
      } catch {
        return reply.status(503).send({ status: 'no-ready' });
      }
    },
  );
  app.get(
    '/api/config/publica',
    { schema: { tags: ['sistema'], summary: 'Configuración que necesita la PWA' } },
    async () => ({
      authMode: d.config.AUTH_MODE,
      entra:
        d.config.AUTH_MODE === 'entra'
          ? { tenantId: d.config.ENTRA_TENANT_ID, clientId: d.config.ENTRA_CLIENT_ID }
          : null,
      extractor: d.extractor.proveedor,
      umbralConfianza: d.config.EXTRACTION_CONFIDENCE_THRESHOLD,
      scannerGsSubstitute: d.config.SCANNER_GS_SUBSTITUTE ?? null,
      modoSustitucion: d.config.SUBSTITUTION_APPROVAL_MODE,
      permitirCambioFormato: d.config.ALLOW_PACK_SIZE_CHANGE,
      permitirParcial: d.config.ALLOW_PARTIAL_DISPENSATION,
      stock: d.stock.tipo,
      // Fuente de tickets para conciliar: Siweb360, simulada (demo) o ninguna.
      ventas: !d.ventas.configurado ? 'off' : 'demo' in d.ventas ? 'demo' : 'siweb',
      escrituraStock: d.config.SIWEB_STOCK_WRITE_MODE,
      modoRetrospectivoHabilitado: d.config.RETROSPECTIVE_DISPENSATION_MODE === 'enabled',
      fechaCorteEntradas: d.config.ENTRY_CUTOVER_DATE ?? null,
      telefonoFarmacia: d.telefonoFarmacia,
    }),
  );
  app.get('/api/me', { schema: { tags: ['sistema'], summary: 'Usuario actual' } }, async (req) =>
    usuario(req),
  );
  app.get(
    '/api/inicio',
    {
      schema: { tags: ['sistema'], summary: 'Contadores de Inicio' },
      preHandler: requiereRol(...ROLES.operativa, 'admin'),
    },
    async () => new PendientesService(d).inicio(),
  );
}
