import { z } from 'zod';

/**
 * Configuración de la aplicación a partir de variables de entorno (AGENTS.md §Configuración).
 * Se valida al arrancar; en producción la app no arranca si falta una variable obligatoria.
 * Todas las variables están documentadas en `.env.example`.
 */

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const optStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return def;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: 'custom', message: `"${v}" no es un número` });
        return z.NEVER;
      }
      return n;
    });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: num(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
    BLOB_CONNECTION_STRING: optStr,
    BLOB_ACCOUNT_URL: optStr,
    KEY_VAULT_URL: optStr,

    CIMAVET_BASE_URL: z.string().url().default('https://cimavet.aemps.es/cimavet/rest/'),
    CIMAVET_RPS: num(3),
    CIMAVET_LIVE_CHECK_MAX_AGE_H: num(24),

    SIWEB_BASE_URL: z.string().url().default('https://app.siweb360.com/api/public/'),
    SIWEB_TOKEN: optStr,
    SIWEB_STOCK_WRITE_MODE: z.enum(['off', 'entries_only']).default('off'),
    SIWEB_SKU_CN_REGEX: z.string().default('CN(\\d{6,7})$'),
    // TODO(decision D-04b): alta/edición de productos por API. Por defecto tareas manuales.
    SIWEB_CATALOG_WRITE: bool(false),
    SIWEB_PRICE_WRITE: bool(false),
    SIWEB_WAREHOUSE_NAME: z.string().default('Farmacia'),
    SIWEB_WAREHOUSE_ID: optStr.pipe(z.string().regex(/^\d+$/).transform(Number).optional()),

    EXTRACTOR: z.enum(['fake', 'azure']).default('fake'),
    DOCINTEL_ENDPOINT: optStr,
    AOAI_ENDPOINT: optStr,
    AOAI_DEPLOYMENT: optStr,
    AOAI_API_VERSION: z.string().default('2024-10-21'),
    EXTRACTION_CONFIDENCE_THRESHOLD: num(0.85).pipe(z.number().min(0).max(1)),

    SUBSTITUTION_APPROVAL_MODE: z.enum(['POST', 'PRE']).default('POST'),
    SUBSTITUTION_SIGN_MAX_DAYS: num(7),
    ALLOW_PACK_SIZE_CHANGE: bool(true),
    ALLOW_PARTIAL_DISPENSATION: bool(true),
    ENTRY_MIN_SHELF_LIFE_DAYS: num(90),
    SCANNER_GS_SUBSTITUTE: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? undefined : v))
      .pipe(z.string().length(1, 'SCANNER_GS_SUBSTITUTE debe ser un único carácter').optional()),
    // TODO(decision D-05c): cuándo pasar "producto no válido" a no forzable.
    PRODUCT_VALIDITY_HARD_BLOCK: bool(false),
    PSYCHOTROPIC_ALLOW_FORCE: bool(false),
    ENTRY_CUTOVER_DATE: optStr.pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),

    AUTH_MODE: z.enum(['entra', 'dev']).default('entra'),
    ENTRA_TENANT_ID: optStr,
    ENTRA_CLIENT_ID: optStr,

    MAILER: z.enum(['smtp', 'acs', 'console']).default('console'),
    REPORT_RECIPIENTS: optStr,
    SMTP_HOST: optStr,
    SMTP_PORT: num(587),
    SMTP_USER: optStr,
    SMTP_PASSWORD: optStr,
    SMTP_FROM: optStr,
    ACS_ENDPOINT: optStr,
    ACS_SENDER: optStr,
    FARMACIA_TELEFONO: z.string().default('(teléfono de la farmacia)'),

    COLUMN_ENCRYPTION_KEY: optStr,
    WEB_DIST_DIR: optStr,
  })
  .superRefine((env, ctx) => {
    const req = (key: keyof typeof env, why: string) => {
      if (env[key] === undefined || env[key] === '') {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} es obligatoria ${why}` });
      }
    };
    if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'AUTH_MODE=dev está prohibido con NODE_ENV=production',
      });
    }
    if (env.AUTH_MODE === 'entra') {
      req('ENTRA_TENANT_ID', 'con AUTH_MODE=entra');
      req('ENTRA_CLIENT_ID', 'con AUTH_MODE=entra');
    }
    // Fuera de producción, EXTRACTOR=azure sin configuración deja la extracción desactivada (SPEC §12.1.7).
    if (env.EXTRACTOR === 'azure' && env.NODE_ENV === 'production') {
      req('DOCINTEL_ENDPOINT', 'con EXTRACTOR=azure');
      req('AOAI_ENDPOINT', 'con EXTRACTOR=azure');
      req('AOAI_DEPLOYMENT', 'con EXTRACTOR=azure');
    }
    if (env.MAILER === 'acs') {
      req('ACS_ENDPOINT', 'con MAILER=acs');
      req('ACS_SENDER', 'con MAILER=acs');
    }
    if (env.MAILER === 'smtp') {
      req('SMTP_HOST', 'con MAILER=smtp');
      req('SMTP_FROM', 'con MAILER=smtp');
    }
    if (env.NODE_ENV === 'production') {
      req('BLOB_ACCOUNT_URL', 'en producción');
      req('KEY_VAULT_URL', 'en producción');
      if (env.EXTRACTOR === 'fake') {
        ctx.addIssue({ code: 'custom', path: ['EXTRACTOR'], message: 'EXTRACTOR=fake no se admite en producción' });
      }
      if (env.SIWEB_TOKEN) {
        ctx.addIssue({
          code: 'custom',
          path: ['SIWEB_TOKEN'],
          message: 'SIWEB_TOKEN solo se admite en local; en producción se lee de Key Vault',
        });
      }
      if (env.COLUMN_ENCRYPTION_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['COLUMN_ENCRYPTION_KEY'],
          message: 'COLUMN_ENCRYPTION_KEY solo se admite en local; en producción se lee de Key Vault',
        });
      }
    } else {
      if (!env.BLOB_CONNECTION_STRING && !env.BLOB_ACCOUNT_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['BLOB_CONNECTION_STRING'],
          message: 'BLOB_CONNECTION_STRING o BLOB_ACCOUNT_URL es obligatoria',
        });
      }
    }
    if (env.COLUMN_ENCRYPTION_KEY && base64ByteLength(env.COLUMN_ENCRYPTION_KEY) !== 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['COLUMN_ENCRYPTION_KEY'],
        message: 'COLUMN_ENCRYPTION_KEY debe ser una clave de 32 bytes en base64',
      });
    }
    try {
      new RegExp(env.SIWEB_SKU_CN_REGEX);
    } catch {
      ctx.addIssue({ code: 'custom', path: ['SIWEB_SKU_CN_REGEX'], message: 'Expresión regular no válida' });
    }
  });

function base64ByteLength(b64: string): number {
  try {
    return atob(b64).length;
  } catch {
    return -1;
  }
}

export type AppConfig = z.output<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuración no válida:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/** Valida el entorno. Lanza `ConfigError` con todos los problemas a la vez. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`));
  }
  return parsed.data;
}
