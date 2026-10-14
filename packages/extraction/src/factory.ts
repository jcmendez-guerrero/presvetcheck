import type { RecipeExtractor } from '@mmx/domain';
import { DomainError, type AppConfig } from '@mmx/shared';
import { AzureRecipeExtractor } from './azure/extractor';
import { DocumentIntelligenceClient } from './azure/docintel';
import { AzureOpenAiClient } from './azure/openai';
import { FakeRecipeExtractor } from './fake';

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
    if (!t) throw new Error('No se pudo obtener un token de Entra para Azure AI');
    return t.token;
  };
}

export async function crearExtractor(
  config: Pick<AppConfig, 'EXTRACTOR' | 'DOCINTEL_ENDPOINT' | 'AOAI_ENDPOINT' | 'AOAI_DEPLOYMENT' | 'AOAI_API_VERSION'>,
  deps: { fixturesDir: string; hoy: () => string; getToken?: () => Promise<string> },
): Promise<RecipeExtractor> {
  if (config.EXTRACTOR === 'fake') return new FakeRecipeExtractor({ dir: deps.fixturesDir, hoy: deps.hoy });
  const faltan = (['DOCINTEL_ENDPOINT', 'AOAI_ENDPOINT', 'AOAI_DEPLOYMENT'] as const).filter((k) => !config[k]);
  if (faltan.length) return new DisabledRecipeExtractor(`Falta configuración de Azure: ${faltan.join(', ')}`);
  const getToken = deps.getToken ?? (await tokenProviderAzure());
  return new AzureRecipeExtractor(
    new DocumentIntelligenceClient({ endpoint: config.DOCINTEL_ENDPOINT as string, getToken }),
    new AzureOpenAiClient({ endpoint: config.AOAI_ENDPOINT as string, deployment: config.AOAI_DEPLOYMENT as string, apiVersion: config.AOAI_API_VERSION, getToken }),
    config.AOAI_DEPLOYMENT as string,
  );
}
