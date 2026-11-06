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
    /** `entra`: PostgreSQL con la identidad gestionada (token de Entra, sin contraseña en DATABASE_URL). */
    DATABASE_AUTH: z.enum(['password', 'entra']).default('password'),
    BLOB_CONNECTION_STRING: optStr,
    BLOB_ACCOUNT_URL: optStr,
    KEY_VAULT_URL: optStr,
    /** Nombres de los secretos en Key Vault (para reutilizar un almacén compartido con otros nombres). */
    KV_SECRETO_SIWEB_TOKEN: z.string().default('siweb-token'),
    KV_SECRETO_CIFRADO: z.string().default('column-encryption-key'),
    KV_SECRETO_SMTP: z.string().default('smtp-password'),
    KV_SECRETO_ASISTENTE: z.string().default('gcp-gemini-api-key'),

    CIMAVET_BASE_URL: z.string().url().default('https://cimavet.aemps.es/cimavet/rest/'),
    CIMAVET_RPS: num(3),
    CIMAVET_LIVE_CHECK_MAX_AGE_H: num(24),
    NOMENCLATOR_URL: z.string().url().default('https://listadomedicamentos.aemps.gob.es/prescripcionVET.zip'),

    SIWEB_BASE_URL: z.string().url().default('https://app.siweb360.com/api/public/'),
    SIWEB_TOKEN: optStr,
    SIWEB_STOCK_WRITE_MODE: z.enum(['off', 'entries_only']).default('off'),
    SIWEB_SKU_CN_REGEX: z.string().default('CN(\\d{6,7})$'),
    // TODO(decision D-02b): confirmar con tickets reales que la línea conserva el nombre con el CN.
    SIWEB_SALES_SOURCE: z.enum(['off', 'tickets']).default('tickets'),
    SIWEB_TICKET_CN_REGEX: z.string().default('CN\\s?(\\d{6,7})'),
    // TODO(decision D-04b): alta/edición de productos por API. Por defecto tareas manuales.
    SIWEB_CATALOG_WRITE: bool(false),
    SIWEB_PRICE_WRITE: bool(false),
    SIWEB_WAREHOUSE_NAME: z.string().default('Farmacia'),
    SIWEB_WAREHOUSE_ID: optStr.pipe(z.string().regex(/^\d+$/).transform(Number).optional()),

    EXTRACTOR: z.enum(['fake', 'azure']).default('fake'),
    DOCINTEL_ENDPOINT: optStr,
    /** Id del modelo personalizado de Document Intelligence entrenado con las recetas (DUDA-27). */
    DOCINTEL_MODEL_ID: optStr,
    DOCINTEL_API_VERSION: z.string().default('2024-11-30'),
    EXTRACTION_CONFIDENCE_THRESHOLD: num(0.85).pipe(z.number().min(0).max(1)),

    /**
     * Asistente de consultas (specs/002-prescription-chat-assistant). `off`: sin asistente; `fake`: modelo con
     * guiones (demo y tests); `azure`: despliegue de chat de Azure OpenAI / Foundry en la UE; `gemini`: API de
     * Gemini (compatible con OpenAI); `ASSISTANT_DEPLOYMENT` es el nombre del modelo.
     */
    // TODO(decision DUDA-29): despliegue de chat concreto, precios y límite mensual por defecto.
    ASSISTANT: z.enum(['off', 'fake', 'azure', 'gemini']).default('off'),
    ASSISTANT_ENDPOINT: optStr,
    ASSISTANT_DEPLOYMENT: optStr,
    /** Clave de la API de Gemini (solo local); en Azure se lee de Key Vault (`KV_SECRETO_ASISTENTE`). */
    ASSISTANT_API_KEY: optStr,
    ASSISTANT_API_VERSION: z.string().default('2024-10-21'),
    ASSISTANT_TIMEOUT_MS: num(20000).pipe(z.number().int().min(1000)),
    /** Límite mensual global de tokens (entrada + salida). Al 80 % avisa; al 100 % pausa el asistente. */
    ASSISTANT_MONTHLY_TOKEN_LIMIT: num(3_000_000).pipe(z.number().int().min(1)),
    /** Precio por 1.000 tokens en euros (solo para la estimación de coste). */
    ASSISTANT_PRICE_IN_PER_1K_EUR: optStr.pipe(
      z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .optional(),
    ),
    ASSISTANT_PRICE_OUT_PER_1K_EUR: optStr.pipe(
      z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .optional(),
    ),

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
    ENTRY_CUTOVER_DATE: optStr.pipe(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    ),

    /** Modo retrospectivo de dispensación para formación (specs/004-multi-rx-ticket-training-mode, D-14). */
    RETROSPECTIVE_DISPENSATION_MODE: z.enum(['enabled', 'disabled']).default('disabled'),
    RETROSPECTIVE_MAX_AGE_DAYS: num(90),

    AUTH_MODE: z.enum(['entra', 'dev']).default('entra'),
    ENTRA_TENANT_ID: optStr,
    ENTRA_CLIENT_ID: optStr,
    /**
     * Confiar en la cabecera X-MS-CLIENT-PRINCIPAL que inyecta la autenticación integrada de Container Apps.
     * Solo si la app NO es accesible sin pasar por ella (ingress con autenticación obligatoria).
     */
    AUTH_EASYAUTH: bool(false),

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
    /** URL pública de la web para el QR del móvil. Si falta, la del navegador (en local, la IP de la red). */
    APP_PUBLIC_URL: optStr.pipe(z.string().url().optional()),
    /** Horas que dura el emparejamiento del móvil con el PC (un turno). */
    MOVIL_SESION_HORAS: num(10).pipe(z.number().min(0.25).max(24)),
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
      req('DOCINTEL_MODEL_ID', 'con EXTRACTOR=azure');
    }
    if (env.ASSISTANT === 'azure' && env.NODE_ENV === 'production') {
      req('ASSISTANT_ENDPOINT', 'con ASSISTANT=azure');
      req('ASSISTANT_DEPLOYMENT', 'con ASSISTANT=azure');
    }
    if (env.ASSISTANT === 'gemini' && env.NODE_ENV === 'production') {
      req('ASSISTANT_DEPLOYMENT', 'con ASSISTANT=gemini');
    }
    if (env.ASSISTANT === 'fake' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['ASSISTANT'],
        message: 'ASSISTANT=fake no se admite en producción',
      });
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
        ctx.addIssue({
          code: 'custom',
          path: ['EXTRACTOR'],
          message: 'EXTRACTOR=fake no se admite en producción',
        });
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
      new RegExp(env.SIWEB_TICKET_CN_REGEX);
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
