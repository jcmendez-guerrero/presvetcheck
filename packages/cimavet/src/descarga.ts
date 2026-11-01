import { createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

/**
 * Descarga del Nomenclátor Veterinario publicado por la AEMPS (enlace de
 * https://cimavet.aemps.es/cimavet/publico/nomenclator.html, configurable con NOMENCLATOR_URL).
 * Es un zip con `PrescripcionVET.xml` (~140 MB), `PrescripcionVETDatosBasicos.xml` y los
 * `DICCIONARIO_*.xml`. Los XML no se versionan en git: se obtienen de CIMAVet cuando hacen falta.
 */
export interface DescargaNomenclator {
  ficheros: string[];
  bytesZip: number;
  ultimaModificacion: string | null;
}

export interface OpcionesDescarga {
  url: string;
  destino: string;
  /** Filtro por nombre de fichero dentro del zip (por defecto, todos los .xml). */
  incluir?: (nombre: string) => boolean;
  fetch?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
  /** Tamaño máximo descomprimido por fichero (protección frente a zips anómalos). */
  maxBytesFichero?: number;
}

const abrirZip = (path: string) =>
  new Promise<yauzl.ZipFile>((ok, ko) =>
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (e, z) =>
      e || !z ? ko(e ?? new Error('zip')) : ok(z),
    ),
  );

const leerEntrada = (zip: yauzl.ZipFile, e: yauzl.Entry) =>
  new Promise<Readable>((ok, ko) =>
    zip.openReadStream(e, (err, s) => (err || !s ? ko(err ?? new Error('zip')) : ok(s))),
  );

function limite(max: number, nombre: string) {
  let n = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      if (n > max) cb(new Error(`${nombre} supera ${max} bytes descomprimido`));
      else cb(null, chunk);
    },
  });
}

/**
 * Copia sin `pipeline`: el stream de lectura de yauzl no emite `close` al destruirlo y `pipeline`
 * se quedaría esperando si el límite de tamaño corta la copia.
 */
function copiar(origen: Readable, filtro: Transform, path: string): Promise<void> {
  return new Promise((ok, ko) => {
    const destino = createWriteStream(path);
    const fallo = (err: Error) => {
      origen.unpipe(filtro);
      filtro.unpipe(destino);
      destino.destroy();
      ko(err);
    };
    origen.on('error', fallo);
    filtro.on('error', fallo);
    destino.on('error', fallo);
    destino.on('finish', () => ok());
    origen.pipe(filtro).pipe(destino);
  });
}

/** Extrae los .xml de un zip del Nomenclátor en `destino` (solo el nombre base: sin rutas). */
export async function extraerNomenclator(
  zipPath: string,
  destino: string,
  opts: Pick<OpcionesDescarga, 'incluir' | 'maxBytesFichero'> = {},
): Promise<string[]> {
  const incluir = opts.incluir ?? ((n: string) => n.toLowerCase().endsWith('.xml'));
  const max = opts.maxBytesFichero ?? 1024 ** 3;
  mkdirSync(destino, { recursive: true });
  const zip = await abrirZip(zipPath);
  const ficheros: string[] = [];
  await new Promise<void>((ok, ko) => {
    zip.on('error', ko);
    zip.on('end', () => ok());
    zip.on('entry', (e: yauzl.Entry) => {
      const nombre = basename(e.fileName);
      // Solo ficheros en la raíz del zip (el Nomenclátor no trae subcarpetas).
      if (/[\\/]/.test(e.fileName) || !incluir(nombre)) {
        zip.readEntry();
        return;
      }
      leerEntrada(zip, e)
        .then((s) => copiar(s, limite(max, nombre), join(destino, nombre)))
        .then(() => {
          ficheros.push(nombre);
          zip.readEntry();
        })
        .catch(ko);
    });
    zip.readEntry();
  });
  return ficheros.sort();
}

/** Descarga el zip y extrae los XML en `destino`. No toca la base de datos. */
export async function descargarNomenclator(o: OpcionesDescarga): Promise<DescargaNomenclator> {
  const f = o.fetch ?? fetch;
  const res = await f(o.url, {
    headers: {
      'user-agent': o.userAgent ?? 'Mozilla/5.0 (compatible; MundoMascotix-Recetas/0.1)',
      accept: 'application/zip',
    },
    signal: AbortSignal.timeout(o.timeoutMs ?? 300_000),
  });
  if (!res.ok || !res.body) throw new Error(`Descarga del Nomenclátor: HTTP ${res.status}`);
  mkdirSync(o.destino, { recursive: true });
  const zipPath = resolve(o.destino, `.nomenclator-${process.pid}.zip`);
  try {
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zipPath));
    const bytesZip = statSync(zipPath).size;
    const ficheros = await extraerNomenclator(zipPath, o.destino, o);
    if (!ficheros.includes('PrescripcionVET.xml'))
      throw new Error('El zip descargado no contiene PrescripcionVET.xml');
    return { ficheros, bytesZip, ultimaModificacion: res.headers.get('last-modified') };
  } finally {
    rmSync(zipPath, { force: true });
  }
}
