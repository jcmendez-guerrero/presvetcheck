import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { RecipeExtractor } from '@mmx/domain';
import { ExtractionResult } from '@mmx/shared';

/**
 * Extractor falso (tests y desarrollo sin coste): devuelve el JSON esperado de
 * `fixtures/recetas/*.expected.json`. Elige la fixture por:
 *  1. hint `fixture` (nombre sin extensión);
 *  2. SHA-256 de la primera página igual al de una imagen `<nombre>.<ext>` de la carpeta;
 *  3. la fixture por defecto (o la primera demo).
 * Los valores `@HOY-n` se sustituyen por la fecha de hoy − n días.
 */
export class FakeRecipeExtractor implements RecipeExtractor {
  readonly proveedor = 'fake' as const;

  constructor(
    private readonly opts: { dir: string; porDefecto?: string; hoy: () => string },
  ) {}

  fixtures(): string[] {
    if (!existsSync(this.opts.dir)) return [];
    return readdirSync(this.opts.dir)
      .filter((f) => f.endsWith('.expected.json'))
      .map((f) => f.replace(/\.expected\.json$/, ''))
      .sort();
  }

  private porHash(page: Uint8Array | undefined): string | null {
    if (!page) return null;
    const h = createHash('sha256').update(page).digest('hex');
    for (const f of readdirSync(this.opts.dir)) {
      if (!/\.(png|jpe?g|pdf|heic)$/i.test(f)) continue;
      if (createHash('sha256').update(readFileSync(resolve(this.opts.dir, f))).digest('hex') === h) {
        return basename(f).replace(/\.[^.]+$/, '');
      }
    }
    return null;
  }

  async extract(input: { pages: Uint8Array[]; mime: string; hints?: { channel?: string; fixture?: string } }) {
    const disponibles = this.fixtures();
    const nombre =
      (input.hints?.fixture && disponibles.includes(input.hints.fixture) ? input.hints.fixture : null) ??
      this.porHash(input.pages[0]) ??
      this.opts.porDefecto ??
      disponibles[0];
    if (!nombre) throw new Error(`No hay fixtures de recetas en ${this.opts.dir}`);
    const raw = readFileSync(resolve(this.opts.dir, `${nombre}.expected.json`), 'utf8');
    const conFechas = raw.replace(/"@HOY(?:-(\d+))?"/g, (_m, n: string | undefined) => JSON.stringify(restarDias(this.opts.hoy(), Number(n ?? 0))));
    return ExtractionResult.parse({ ...JSON.parse(conFechas), proveedor: 'fake', modelo: `fixture:${nombre}` });
  }
}

function restarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}
