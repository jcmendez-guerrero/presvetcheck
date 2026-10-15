/**
 * Escribe el `fields.json` del proyecto de etiquetado de Document Intelligence Studio a partir de los
 * campos del código (así los nombres del modelo y de la app no se desincronizan).
 *   pnpm docintel:campos [ruta]   (por defecto packages/extraction/docintel/fields.json)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { camposDocIntelStudio } from '../campos';

const destino = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../../docintel/fields.json'));
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, `${JSON.stringify(camposDocIntelStudio(), null, 2)}\n`);
console.log(`fields.json escrito en ${destino}`);
