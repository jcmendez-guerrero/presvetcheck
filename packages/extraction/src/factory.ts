import type { RecipeExtractor } from '@mmx/domain';
import { DomainError, type AppConfig } from '@mmx/shared';
import { AzureRecipeExtractor } from './azure/extractor';
import { DocumentIntelligenceClient } from './azure/docintel';
import { FakeRecipeExtractor } from './fake';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LectorAlbaranes, albaranDesdeFactura, type LecturaAlbaran } from './albaran';
import type { AnalyzeResult } from './azure/docintel';

/** Extractor desactivado: la app funciona (entrada manual de datos) pero no lee recetas solas. */
export class DisabledRecipeExtractor implements RecipeExtractor {
  readonly proveedor = 'desactivado' as const;
  constructor(public readonly motivo: string) {}
  async extract(): Promise<never> {
    throw new DomainError('EXTRACTOR_NO_CONFIGURADO', this.motivo);
  }
}

const SCOPE_COGNITIVE = 'https://cognitiveservices.azure.com/.default';

/** Proveedor de tokens de Entra con identidad gestionada (DefaultAzureCredential). */
export async function tokenProviderAzure(): Promise<() => Promise<string>> {
  const { DefaultAzureCredential } = await import('@azure/identity');
  const cred = new DefaultAzureCredential();
  return async () => {
    const t = await cred.getToken(SCOPE_COGNITIVE);
    if (!t) throw new Error('No se pudo obtener un token de Entra para Document Intelligence');
    return t.token;
  };
}

export async function crearExtractor(
  config: Pick<AppConfig, 'EXTRACTOR' | 'DOCINTEL_ENDPOINT' | 'DOCINTEL_MODEL_ID' | 'DOCINTEL_API_VERSION'>,
  deps: { fixturesDir: string; hoy: () => string; getToken?: () => Promise<string> },
): Promise<RecipeExtractor> {
  if (config.EXTRACTOR === 'fake') return new FakeRecipeExtractor({ dir: deps.fixturesDir, hoy: deps.hoy });
  const faltan = (['DOCINTEL_ENDPOINT', 'DOCINTEL_MODEL_ID'] as const).filter((k) => !config[k]);
  if (faltan.length)
    return new DisabledRecipeExtractor(`Falta configuración de Document Intelligence: ${faltan.join(', ')}`);
  const getToken = deps.getToken ?? (await tokenProviderAzure());
  return new AzureRecipeExtractor(
    new DocumentIntelligenceClient({
      endpoint: config.DOCINTEL_ENDPOINT as string,
      getToken,
      apiVersion: config.DOCINTEL_API_VERSION,
    }),
    config.DOCINTEL_MODEL_ID as string,
  );
}

/** Lee albaranes y facturas de proveedor (recepción de mercancía). */
export interface LectorDocumentosProveedor {
  readonly simulado: boolean;
  leer(bytes: Uint8Array, mime: string): Promise<LecturaAlbaran>;
}

/**
 * Con Document Intelligence configurado, `prebuilt-invoice`; con EXTRACTOR=fake (demo y tests), la lectura
 * de la fixture sintética (fixtures/albaranes/sintetico-1.invoice.json) sea cual sea el documento.
 */
export async function crearLectorAlbaranes(
  config: Pick<AppConfig, 'EXTRACTOR' | 'DOCINTEL_ENDPOINT' | 'DOCINTEL_API_VERSION'>,
  deps: { fixturesDir: string; getToken?: () => Promise<string> },
): Promise<LectorDocumentosProveedor | null> {
  if (config.EXTRACTOR === 'fake') {
    // Se lee al usarla (no al arrancar): la imagen de producción no lleva las fixtures.
    const ruta = resolve(deps.fixturesDir, 'albaranes/sintetico-1.invoice.json');
    return {
      simulado: true,
      leer: async () => albaranDesdeFactura(JSON.parse(readFileSync(ruta, 'utf8')) as AnalyzeResult),
    };
  }
  if (!config.DOCINTEL_ENDPOINT) return null;
  const getToken = deps.getToken ?? (await tokenProviderAzure());
  const lector = new LectorAlbaranes(
    new DocumentIntelligenceClient({
      endpoint: config.DOCINTEL_ENDPOINT,
      getToken,
      apiVersion: config.DOCINTEL_API_VERSION,
    }),
  );
  return { simulado: false, leer: (b, m) => lector.leer(b, m) };
}
