/**
 * Obtiene el Nomenclátor Veterinario de CIMAVet y genera la muestra que usan los tests.
 * Los XML de CIMAVet NO se versionan (.gitignore): se descargan cuando hacen falta.
 *
 *   pnpm nomenclator:fetch                 descarga (NOMENCLATOR_URL) a fixtures/nomenclator/ y genera la muestra
 *   pnpm nomenclator:fetch --si-falta      no hace nada si ya están la muestra y los diccionarios
 *   pnpm nomenclator:fetch --solo-muestra  regenera la muestra desde el PrescripcionVET.xml local
 *
 * La muestra (PrescripcionVET.sample.xml) copia literalmente registros reales: todas las presentaciones
 * de los nregistro que usan los tests y unos pocos ejemplos de cada caso especial (psicótropos,
 * estupefacientes, tiempos de espera con no_aplica_tejido, suspendidos y dispensación fraccionada).
 */
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { descargarNomenclator } from '@mmx/cimavet';
import { DICCIONARIOS } from '@mmx/db';

const DIR = resolve(import.meta.dirname, '../../../../fixtures/nomenclator');
const SRC = resolve(DIR, 'PrescripcionVET.xml');
const DST = resolve(DIR, 'PrescripcionVET.sample.xml');
const URL_DEFECTO = 'https://listadomedicamentos.aemps.gob.es/prescripcionVET.zip';

/** Medicamentos reales que usan los tests (se copian todas sus presentaciones). */
const REQUERIDOS = ['1077 ESP', '1179 ESP', '1181 ESP', '1182 ESP', '1183 ESP', '1300 ESP', '1332 ESP', '1714 ESP', '177 ESP', '1801 ESP', '1865 ESP', '1868 ESP', '1892 ESP', '1896 ESP', '2466 ESP', '384 ESP', '737 ESP'];
const CASOS: Record<string, { n: number; test: (r: string) => boolean }> = {
  psicotropo: { n: 3, test: (r) => r.includes('<psicotropo>SI') },
  estupefaciente: { n: 2, test: (r) => r.includes('<estupefaciente>SI') },
  noAplicaTejido: { n: 2, test: (r) => r.includes('<no_aplica_tejido>') },
  suspendido: { n: 2, test: (r) => /<cod_estado_registro_medicamento>[34]</.test(r) },
  fraccionadaJeringas: { n: 1, test: (r) => /<fracciones_autorizadas>[^<]*jeringa/i.test(r) },
  fraccionadaPipeta: { n: 1, test: (r) => /<fracciones_autorizadas>[^<]*pipeta/i.test(r) },
  fraccionadaComprimidos: { n: 2, test: (r) => /<fracciones_autorizadas>\d+ fracciones de \d+ comprimidos/i.test(r) },
};

async function generarMuestra(src = SRC, dst = DST) {
  const nreg = (r: string) => /<nro_definitivo>([^<]*)</.exec(r)?.[1] ?? '';
  const got: Record<string, number> = Object.fromEntries(Object.keys(CASOS).map((k) => [k, 0]));
  const header: string[] = [];
  const picked: string[] = [];
  let current: string[] | null = null;
  let inHeader = true;
  for await (const line of createInterface({ input: createReadStream(src, 'utf8'), crlfDelay: Infinity })) {
    if (line.includes('<prescription>')) {
      inHeader = false;
      current = [line];
      continue;
    }
    if (inHeader) {
      header.push(line);
      continue;
    }
    if (!current) continue;
    current.push(line);
    if (!line.includes('</prescription>')) continue;
    const rec = current.join('\n');
    current = null;
    let take = REQUERIDOS.includes(nreg(rec));
    for (const [k, c] of Object.entries(CASOS)) {
      if ((got[k] ?? 0) < c.n && c.test(rec)) {
        got[k] = (got[k] ?? 0) + 1;
        take = true;
      }
    }
    if (take) picked.push(rec);
  }
  const faltan = REQUERIDOS.filter((n) => !picked.some((r) => nreg(r) === n));
  if (faltan.length) throw new Error(`El Nomenclátor ya no contiene ${faltan.join(', ')}: revisa los tests que los usan`);
  writeFileSync(dst, [...header, ...picked, '</aemps_prescripcion_vet>', ''].join('\n'));
  console.log(`Muestra escrita en ${dst}: ${picked.length} registros`, got);
}

const args = new Set(process.argv.slice(2));
const completo = existsSync(DST) && DICCIONARIOS.every((d) => existsSync(resolve(DIR, d.fichero)));
if (args.has('--si-falta') && completo) {
  console.log('Nomenclátor ya presente en fixtures/nomenclator (usa `pnpm nomenclator:fetch` para actualizarlo).');
} else {
  if (!args.has('--solo-muestra')) {
    const url = process.env.NOMENCLATOR_URL || URL_DEFECTO;
    console.log(`Descargando ${url} …`);
    const r = await descargarNomenclator({ url, destino: DIR });
    console.log(`${r.ficheros.length} ficheros (${(r.bytesZip / 1e6).toFixed(1)} MB comprimido, publicado ${r.ultimaModificacion ?? '¿?'})`);
  }
  await generarMuestra();
}
