/**
 * Banco de evaluación de la extracción (SPEC §5.3 punto 3): `pnpm eval:extraction`.
 * Recorre fixtures/recetas/ (pares imagen + .expected.json) con el extractor configurado (EXTRACTOR) y
 * calcula exactitud por campo (exacta y normalizada), tasa de campos bajo umbral y coste estimado.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExtractionResult } from '@mmx/shared';
import { findUp, loadConfigFromProcess } from '@mmx/shared/node';
import { crearExtractor } from '../factory';
import { compararExtraccion, costeEstimado, type MetricaCampo } from './metricas';

const config = loadConfigFromProcess();
const dir = findUp('fixtures/recetas', process.cwd());
if (!dir) throw new Error('No se encuentra fixtures/recetas');
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' };
const pares = readdirSync(dir)
  .filter((f) => /\.(png|jpe?g|pdf)$/i.test(f))
  .map((img) => ({ img, json: img.replace(/\.[^.]+$/, '.expected.json') }))
  .filter((p) => existsSync(resolve(dir, p.json)));

if (!pares.length) {
  console.log('No hay recetas reales en fixtures/recetas (imagen + .expected.json). Las aporta JC; ver fixtures/recetas/README.md.');
  process.exit(0);
}
const hoy = () => new Date().toISOString().slice(0, 10);
const extractor = await crearExtractor(config, { fixturesDir: dir, hoy });
const acc = new Map<string, MetricaCampo>();
let paginas = 0;
for (const p of pares) {
  const bytes = new Uint8Array(readFileSync(resolve(dir, p.img)));
  const esperado = ExtractionResult.parse(JSON.parse(readFileSync(resolve(dir, p.json), 'utf8')));
  const ext = (p.img.split('.').pop() ?? '').toLowerCase();
  const obtenido = await extractor.extract({ pages: [bytes], mime: MIME[ext] ?? 'application/octet-stream' });
  compararExtraccion(esperado, obtenido, config.EXTRACTION_CONFIDENCE_THRESHOLD, acc);
  paginas++;
}
const filas = [...acc.values()].sort((a, b) => a.campo.localeCompare(b.campo));
console.table(
  filas.map((m) => ({
    campo: m.campo,
    exacta: `${((100 * m.exactos) / m.total).toFixed(1)} %`,
    normalizada: `${((100 * m.normalizados) / m.total).toFixed(1)} %`,
    bajoUmbral: `${((100 * m.bajoUmbral) / m.total).toFixed(1)} %`,
  })),
);
const total = filas.reduce((s, m) => s + m.total, 0);
const bajo = filas.reduce((s, m) => s + m.bajoUmbral, 0);
console.log(`Recetas: ${pares.length} · proveedor: ${extractor.proveedor} · campos bajo umbral: ${((100 * bajo) / Math.max(total, 1)).toFixed(1)} %`);
console.log(`Coste estimado (orientativo): ${costeEstimado(paginas, paginas * 3000, 1500 * paginas).toFixed(3)} €`);
