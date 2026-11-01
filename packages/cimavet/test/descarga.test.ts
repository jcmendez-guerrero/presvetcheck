import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { descargarNomenclator } from '../src/descarga';

/** Zip mínimo sin compresión (método 0) para probar la extracción sin dependencias. */
function zip(ficheros: Record<string, string>): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;
  for (const [nombre, contenido] of Object.entries(ficheros)) {
    const n = Buffer.from(nombre);
    const d = Buffer.from(contenido);
    const crc = crc32(d);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(d.length, 18);
    l.writeUInt32LE(d.length, 22);
    l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(d.length, 20);
    c.writeUInt32LE(d.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    locales.push(l, n, d);
    centrales.push(c, n);
    offset += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(ficheros).length, 8);
  fin.writeUInt16LE(Object.keys(ficheros).length, 10);
  fin.writeUInt32LE(cd.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, cd, fin]);
}

const fetchDe = (body: Buffer | null, status = 200) =>
  (async () =>
    new Response(body, {
      status,
      headers: { 'last-modified': 'Thu, 08 Oct 2026 04:03:23 GMT' },
    })) as unknown as typeof fetch;

describe('descarga del Nomenclátor', () => {
  it('descarga el zip, extrae solo los .xml (sin rutas) y borra el zip', async () => {
    const destino = mkdtempSync(join(tmpdir(), 'mmx-nom-'));
    const r = await descargarNomenclator({
      url: 'https://cimavet.test/prescripcionVET.zip',
      destino,
      fetch: fetchDe(
        zip({
          'PrescripcionVET.xml': '<a/>',
          'DICCIONARIO_ATC.xml': '<b/>',
          'LEEME.txt': 'x',
          'sub/DICCIONARIO_X.xml': 'x',
        }),
      ),
    });
    expect(r.ficheros).toEqual(['DICCIONARIO_ATC.xml', 'PrescripcionVET.xml']);
    expect(r.ultimaModificacion).toMatch(/2026/);
    expect(readdirSync(destino).sort()).toEqual(['DICCIONARIO_ATC.xml', 'PrescripcionVET.xml']);
    expect(readFileSync(join(destino, 'PrescripcionVET.xml'), 'utf8')).toBe('<a/>');
  });

  it('rechaza un zip con rutas relativas que saldrían del destino', async () => {
    const destino = mkdtempSync(join(tmpdir(), 'mmx-nom-'));
    await expect(
      descargarNomenclator({
        url: 'https://x/z.zip',
        destino,
        fetch: fetchDe(zip({ '../fuera.xml': 'x', 'PrescripcionVET.xml': '<a/>' })),
      }),
    ).rejects.toThrow(/relative path/);
    expect(existsSync(join(destino, '..', 'fuera.xml'))).toBe(false);
  });

  it('falla si la AEMPS responde error o el zip no trae PrescripcionVET.xml', async () => {
    const destino = mkdtempSync(join(tmpdir(), 'mmx-nom-'));
    await expect(
      descargarNomenclator({ url: 'https://x/z.zip', destino, fetch: fetchDe(null, 403) }),
    ).rejects.toThrow(/HTTP 403/);
    await expect(
      descargarNomenclator({ url: 'https://x/z.zip', destino, fetch: fetchDe(zip({ 'otro.xml': '<a/>' })) }),
    ).rejects.toThrow(/PrescripcionVET/);
    expect(readdirSync(destino).filter((f) => f.endsWith('.zip'))).toEqual([]);
  });

  it('limita el tamaño descomprimido por fichero', async () => {
    const destino = mkdtempSync(join(tmpdir(), 'mmx-nom-'));
    await expect(
      descargarNomenclator({
        url: 'https://x/z.zip',
        destino,
        maxBytesFichero: 3,
        fetch: fetchDe(zip({ 'PrescripcionVET.xml': '<grande/>' })),
      }),
    ).rejects.toThrow(/supera/);
  });
});
