/**
 * Genera fixtures/nomenclator/PrescripcionVET.sample.xml a partir del Nomenclátor real
 * (fixtures/nomenclator/PrescripcionVET.xml, 140 MB, fuera de git). Copia literalmente
 * registros reales: no inventa estructura. Selección: los primeros N, más ejemplos de
 * psicótropos, estupefacientes, tiempos de espera con no_aplica_tejido y comprimidos.
 *
 *   pnpm tsx scripts/make-nomenclator-sample.ts
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SRC = 'fixtures/nomenclator/PrescripcionVET.xml';
const DST = 'fixtures/nomenclator/PrescripcionVET.sample.xml';

const want = {
  primeros: 25,
  psicotropo: 3,
  estupefaciente: 2,
  noAplicaTejido: 2,
  comprimidos: 6,
  suspendido: 2,
};
const got = { primeros: 0, psicotropo: 0, estupefaciente: 0, noAplicaTejido: 0, comprimidos: 0, suspendido: 0 };

const header: string[] = [];
const picked: string[] = [];
let current: string[] | null = null;
let inHeader = true;

const rl = createInterface({ input: createReadStream(SRC, 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  if (line.includes('<prescription>')) {
    inHeader = false;
    current = [line];
    continue;
  }
  if (inHeader) {
    header.push(line);
    continue;
  }
  if (current) {
    current.push(line);
    if (line.includes('</prescription>')) {
      const rec = current.join('\n');
      current = null;
      const tags: (keyof typeof want)[] = [];
      if (got.primeros < want.primeros) tags.push('primeros');
      if (rec.includes('<psicotropo>SI')) tags.push('psicotropo');
      if (rec.includes('<estupefaciente>SI')) tags.push('estupefaciente');
      if (rec.includes('<no_aplica_tejido>')) tags.push('noAplicaTejido');
      if (/<unidad_contenido_total_envase>25</.test(rec) && /<sw_antibiotico>SI/.test(rec)) tags.push('comprimidos');
      if (/<cod_estado_registro_medicamento>[34]</.test(rec)) tags.push('suspendido');
      const take = tags.filter((t) => got[t] < want[t]);
      if (take.length) {
        for (const t of take) got[t]++;
        picked.push(rec);
      }
    }
  }
}

const out = [...header, ...picked, '</aemps_prescripcion_vet>', ''].join('\n');
writeFileSync(DST, out);
console.log(`Muestra escrita en ${DST}: ${picked.length} registros`, got);
