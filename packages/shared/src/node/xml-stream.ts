import { createReadStream } from 'node:fs';
import { SaxesParser } from 'saxes';

/** Nodo XML genérico: cada hijo es siempre una lista (los elementos se repiten en el Nomenclátor). */
export interface XmlNode {
  [tag: string]: Array<string | XmlNode>;
}

/**
 * Lee un XML en streaming (SAX) y emite cada elemento `recordTag` como `XmlNode`.
 * No infiere esquema: devuelve lo que hay. Memoria constante salvo el registro en curso.
 */
export async function* streamXmlRecords(
  path: string,
  recordTag: string,
  opts: { highWaterMark?: number } = {},
): AsyncGenerator<XmlNode> {
  const parser = new SaxesParser({ xmlns: false });
  const queue: XmlNode[] = [];
  const stack: Array<{ tag: string; node: XmlNode; text: string; hasChildren: boolean }> = [];
  let error: Error | undefined;

  parser.on('error', (e) => {
    error = e;
  });
  parser.on('opentag', (tag) => {
    const name = stripPrefix(tag.name);
    if (stack.length === 0 && name !== recordTag) return;
    const parent = stack[stack.length - 1];
    if (parent) parent.hasChildren = true;
    stack.push({ tag: name, node: {}, text: '', hasChildren: false });
  });
  parser.on('text', (t) => {
    const top = stack[stack.length - 1];
    if (top) top.text += t;
  });
  parser.on('cdata', (t) => {
    const top = stack[stack.length - 1];
    if (top) top.text += t;
  });
  parser.on('closetag', (tag) => {
    const name = stripPrefix(tag.name);
    const top = stack[stack.length - 1];
    if (!top || top.tag !== name) return;
    stack.pop();
    const value: string | XmlNode = top.hasChildren ? top.node : top.text.trim();
    const parent = stack[stack.length - 1];
    if (parent) {
      (parent.node[name] ??= []).push(value);
    } else {
      queue.push(typeof value === 'string' ? { _text: [value] } : value);
    }
  });

  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: opts.highWaterMark ?? 1 << 16 });
  let first = true;
  for await (const chunk of stream as AsyncIterable<string>) {
    parser.write(first ? chunk.replace(/^\uFEFF/, '') : chunk);
    first = false;
    if (error) throw error;
    while (queue.length) yield queue.shift() as XmlNode;
  }
  parser.close();
  if (error) throw error;
  while (queue.length) yield queue.shift() as XmlNode;
}

function stripPrefix(name: string): string {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

/** Primer valor de texto de un hijo, o null. */
export function xmlText(node: XmlNode, tag: string): string | null {
  const v = node[tag]?.[0];
  if (v === undefined) return null;
  return typeof v === 'string' ? (v === '' ? null : v) : null;
}

/** Hijos compuestos con ese nombre. */
export function xmlChildren(node: XmlNode, tag: string): XmlNode[] {
  return (node[tag] ?? []).filter((v): v is XmlNode => typeof v !== 'string');
}

/** Todos los valores de texto de un hijo repetido. */
export function xmlTexts(node: XmlNode, tag: string): string[] {
  return (node[tag] ?? []).filter((v): v is string => typeof v === 'string' && v !== '');
}
