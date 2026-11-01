import type { ExtractionResult } from '@mmx/shared';

/**
 * Puerto de extracción de recetas (SPEC §5.3, ADR-05): agnóstico de proveedor. Implementaciones en
 * packages/extraction (fake y Azure). Las páginas llegan como bytes (PNG/JPEG/PDF).
 */
export interface RecipeExtractor {
  readonly proveedor: 'fake' | 'azure' | 'desactivado';
  extract(input: {
    pages: Uint8Array[];
    mime: string;
    hints?: { channel?: string; fixture?: string };
  }): Promise<ExtractionResult>;
}
