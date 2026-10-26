import ExcelJS from 'exceljs';
import { normalizeText } from '@mmx/shared';

/**
 * Importación de registros anteriores (entradas y salidas llevadas antes de la app, p. ej. en Excel). El fichero
 * usa las MISMAS columnas que exporta la app (registro de entradas; salidas en las plantillas A, B o C, o el
 * informe «Todas las salidas»), reconocidas por su nombre y en cualquier orden. Aquí solo se lee y se valida:
 * guardar es cosa del servicio, que exige que no haya errores.
 */
export type TipoImportacion = 'entradas' | 'salidas';
export type Celda = string | number | Date | null;

export interface EntradaImportada {
  fila: number;
  fecha: string;
  fechaRecepcion: string | null;
  distribuidor: string;
  albaran: string | null;
  nombreFarmaco: string;
  principioActivo: string | null;
  forma: string | null;
  cn: string | null;
  lote: string | null;
  caducidad: string | null;
  unidades: number;
  precioNetoCompra: string | null;
  ivaPct: string | null;
  rePct: string | null;
  precioCoste: string | null;
}

export interface SalidaImportada {
  fila: number;
  fecha: string;
  /** A con receta, B sin receta presencial, C sin receta online. */
  plantilla: 'A' | 'B' | 'C';
  nombreFarmaco: string;
  principioActivo: string | null;
  forma: string | null;
  especie: string | null;
  cn: string | null;
  lote: string | null;
  caducidad: string | null;
  unidades: number | null;
  unidadesTexto: string | null;
  fechaReceta: string | null;
  numeroReceta: string | null;
  veterinario: string | null;
  numColegiado: string | null;
  clinica: string | null;
  direccionVeterinario: string | null;
  propietario: { nombre: string | null; movil: string | null; dni: string | null; direccion: string | null } | null;
}

export interface AnalisisImportacion<T> {
  tipo: TipoImportacion;
  /** Columnas del fichero reconocidas (nombre normalizado) y las que se ignoran. */
  reconocidas: string[];
  ignoradas: string[];
  filas: T[];
  errores: { fila: number; mensajes: string[] }[];
}

const n = (s: string) => normalizeText(s).replace(/[^a-z0-9% ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Campo → nombres de columna aceptados (los de la exportación de la app y variantes habituales). */
const COL_ENTRADAS: Record<keyof Omit<EntradaImportada, 'fila'>, string[]> = {
  nombreFarmaco: ['nombre del farmaco', 'farmaco', 'medicamento', 'producto'],
  principioActivo: ['principio activo'],
  forma: ['forma farmaceutica'],
  fecha: ['fecha compra', 'fecha de compra'],
  fechaRecepcion: ['fecha recepcion', 'fecha de recepcion'],
  caducidad: ['caducidad'],
  lote: ['lote'],
  cn: ['codigo nacional', 'cn'],
  unidades: ['unidades'],
  distribuidor: ['distribuidor', 'proveedor'],
  albaran: ['n albaran', 'albaran', 'n factura', 'factura'],
  precioNetoCompra: ['precio neto compra sin iva ni re', 'precio neto compra sin iva', 'precio neto compra', 'precio neto'],
  ivaPct: ['iva %', 'iva'],
  rePct: ['re %', 're'],
  precioCoste: ['precio coste'],
};
const COL_SALIDAS: Record<string, string[]> = {
  nombreFarmaco: ['nombre del farmaco', 'farmaco', 'medicamento'],
  principioActivo: ['principio activo'],
  forma: ['forma farmaceutica'],
  especie: ['especie'],
  fecha: ['fecha venta', 'fecha de venta', 'fecha', 'fecha dispensacion'],
  caducidad: ['caducidad'],
  lote: ['lote'],
  cn: ['codigo nacional', 'cn'],
  unidades: ['unidades dispensadas', 'unidades'],
  fechaReceta: ['fecha receta'],
  numeroReceta: ['n receta', 'numero receta', 'numero de receta'],
  veterinario: ['veterinario'],
  numColegiado: ['n colegiado', 'numero de colegiado'],
  clinica: ['nombre clinica', 'clinica', 'centro veterinario', 'nombre centro veterinario', 'clinica veterinaria', 'nombre de la clinica'],
  direccionVeterinario: ['direccion veterinario'],
  propNombre: ['nombre propietario', 'propietario', 'titular'],
  propMovil: ['movil', 'telefono'],
  propDni: ['dni', 'dni nie', 'nif'],
  propDireccion: ['direccion'],
  tipoSalida: ['tipo de salida', 'tipo salida'],
};

function indice(cabecera: string[], mapa: Record<string, string[]>) {
  const idx: Record<string, number> = {};
  const usadas = new Set<number>();
  for (const [campo, nombres] of Object.entries(mapa)) {
    for (const nombre of nombres) {
      const i = cabecera.findIndex((c, j) => !usadas.has(j) && c === nombre);
      if (i >= 0) {
        idx[campo] = i;
        usadas.add(i);
        break;
      }
    }
  }
  return { idx, reconocidas: [...usadas].map((i) => cabecera[i] as string), ignoradas: cabecera.filter((c, i) => c && !usadas.has(i)) };
}

const texto = (v: Celda | undefined) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return fechaDe(v);
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Fecha de una celda: Date de Excel, "dd/mm/aaaa", "dd-mm-aa" o "aaaa-mm-dd" → "aaaa-mm-dd". */
export function fechaDe(v: Celda | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return valida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dma = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (dma) return valida(Number(dma[3]!.length === 2 ? `20${dma[3]}` : dma[3]), Number(dma[2]), Number(dma[1]));
  return null;
}
function valida(a: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

/** Importe "12,50" / "1.234,50" / 12.5 → "12.50" (texto, sin coma flotante). */
export function importeDe(v: Celda | undefined): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  const s = typeof v === 'number' ? String(v) : String(v).replace(/[€\s]/g, '');
  const normal = /,\d+$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(normal) ? normal : undefined;
}

export function analizarEntradas(cabecera: string[], filas: Celda[][]): AnalisisImportacion<EntradaImportada> {
  const cab = cabecera.map((c) => n(c ?? ''));
  const { idx, reconocidas, ignoradas } = indice(cab, COL_ENTRADAS);
  const errores: AnalisisImportacion<EntradaImportada>['errores'] = [];
  const faltan = (['nombreFarmaco', 'fecha', 'unidades', 'distribuidor'] as const).filter((c) => idx[c] === undefined);
  if (faltan.length) {
    const nombres = { nombreFarmaco: 'NOMBRE DEL FÁRMACO', fecha: 'FECHA COMPRA', unidades: 'UNIDADES', distribuidor: 'DISTRIBUIDOR' };
    return { tipo: 'entradas', reconocidas, ignoradas, filas: [], errores: [{ fila: 1, mensajes: [`Faltan columnas obligatorias: ${faltan.map((c) => nombres[c]).join(', ')}`] }] };
  }
  const out: EntradaImportada[] = [];
  filas.forEach((f, k) => {
    const fila = k + 2;
    if (f.every((c) => texto(c) === null)) return;
    const v = (c: keyof typeof COL_ENTRADAS) => (idx[c] === undefined ? undefined : f[idx[c] as number]);
    const m: string[] = [];
    const fecha = fechaDe(v('fecha'));
    if (!fecha) m.push('Fecha de compra no válida (usa dd/mm/aaaa)');
    const caducidad = fechaDe(v('caducidad'));
    if (texto(v('caducidad')) && !caducidad) m.push('Caducidad no válida (usa dd/mm/aaaa)');
    const fechaRecepcion = fechaDe(v('fechaRecepcion'));
    if (texto(v('fechaRecepcion')) && !fechaRecepcion) m.push('Fecha de recepción no válida');
    const nombre = texto(v('nombreFarmaco'));
    if (!nombre) m.push('Falta el nombre del fármaco');
    const distribuidor = texto(v('distribuidor'));
    if (!distribuidor) m.push('Falta el distribuidor');
    const uds = Number(String(texto(v('unidades')) ?? '').replace(',', '.'));
    if (!Number.isInteger(uds) || uds < 1) m.push('Unidades no válidas (número entero de 1 o más)');
    const cn = texto(v('cn'));
    if (cn && !/^\d{6,7}$/.test(cn)) m.push('Código nacional no válido (6 o 7 cifras)');
    const precios = { precioNetoCompra: importeDe(v('precioNetoCompra')), ivaPct: importeDe(v('ivaPct')), rePct: importeDe(v('rePct')), precioCoste: importeDe(v('precioCoste')) };
    for (const [k2, p] of Object.entries(precios)) if (p === undefined) m.push(`Importe no válido en ${k2 === 'precioNetoCompra' ? 'precio neto' : k2 === 'precioCoste' ? 'precio coste' : k2 === 'ivaPct' ? 'IVA' : 'RE'}`);
    if (m.length) return errores.push({ fila, mensajes: m });
    out.push({
      fila,
      fecha: fecha as string,
      fechaRecepcion,
      distribuidor: distribuidor as string,
      albaran: texto(v('albaran')),
      nombreFarmaco: nombre as string,
      principioActivo: texto(v('principioActivo')),
      forma: texto(v('forma')),
      cn: cn ? cn.slice(0, 6) : null,
      lote: texto(v('lote')),
      caducidad,
      unidades: uds,
      precioNetoCompra: precios.precioNetoCompra ?? null,
      ivaPct: precios.ivaPct ?? null,
      rePct: precios.rePct ?? null,
      precioCoste: precios.precioCoste ?? null,
    });
  });
  return { tipo: 'entradas', reconocidas, ignoradas, filas: out, errores };
}

const TIPOS: Record<string, 'A' | 'B' | 'C'> = { 'con receta': 'A', 'sin receta presencial': 'B', 'sin receta online': 'C', a: 'A', b: 'B', c: 'C' };

/**
 * Salidas: la plantilla de cada fila sale de la columna «TIPO DE SALIDA» (informe «Todas las salidas») o, si no
 * la hay, de la elegida al importar (A, B o C).
 */
export function analizarSalidas(cabecera: string[], filas: Celda[][], plantillaPorDefecto: 'A' | 'B' | 'C' | null): AnalisisImportacion<SalidaImportada> {
  const cab = cabecera.map((c) => n(c ?? ''));
  const { idx, reconocidas, ignoradas } = indice(cab, COL_SALIDAS);
  const faltan = (['nombreFarmaco', 'fecha'] as const).filter((c) => idx[c] === undefined);
  if (faltan.length) {
    return { tipo: 'salidas', reconocidas, ignoradas, filas: [], errores: [{ fila: 1, mensajes: [`Faltan columnas obligatorias: ${faltan.map((c) => (c === 'fecha' ? 'FECHA VENTA' : 'NOMBRE DEL FÁRMACO')).join(', ')}`] }] };
  }
  if (idx.tipoSalida === undefined && !plantillaPorDefecto) {
    return { tipo: 'salidas', reconocidas, ignoradas, filas: [], errores: [{ fila: 1, mensajes: ['Indica la plantilla de las salidas (A con receta, B sin receta presencial, C sin receta online)'] }] };
  }
  const errores: AnalisisImportacion<SalidaImportada>['errores'] = [];
  const out: SalidaImportada[] = [];
  filas.forEach((f, k) => {
    const fila = k + 2;
    if (f.every((c) => texto(c) === null)) return;
    const v = (c: string) => (idx[c] === undefined ? undefined : f[idx[c] as number]);
    const m: string[] = [];
    const fecha = fechaDe(v('fecha'));
    if (!fecha) m.push('Fecha de venta no válida (usa dd/mm/aaaa)');
    const nombre = texto(v('nombreFarmaco'));
    if (!nombre) m.push('Falta el nombre del fármaco');
    const caducidad = fechaDe(v('caducidad'));
    if (texto(v('caducidad')) && !caducidad) m.push('Caducidad no válida');
    const fechaReceta = fechaDe(v('fechaReceta'));
    if (texto(v('fechaReceta')) && !fechaReceta) m.push('Fecha de receta no válida');
    const cn = texto(v('cn'));
    if (cn && !/^\d{6,7}$/.test(cn)) m.push('Código nacional no válido (6 o 7 cifras)');
    const tipoTxt = texto(v('tipoSalida'));
    const plantilla = tipoTxt ? TIPOS[n(tipoTxt)] : plantillaPorDefecto;
    if (!plantilla) m.push(`Tipo de salida no reconocido: «${tipoTxt}»`);
    const udsTexto = texto(v('unidades'));
    const uds = udsTexto ? Number(/^\s*(\d+)/.exec(udsTexto)?.[1] ?? NaN) : NaN;
    if (m.length) return errores.push({ fila, mensajes: m });
    const prop = { nombre: texto(v('propNombre')), movil: texto(v('propMovil')), dni: texto(v('propDni')), direccion: texto(v('propDireccion')) };
    out.push({
      fila,
      fecha: fecha as string,
      plantilla: plantilla as 'A' | 'B' | 'C',
      nombreFarmaco: nombre as string,
      principioActivo: texto(v('principioActivo')),
      forma: texto(v('forma')),
      especie: texto(v('especie')),
      cn: cn ? cn.slice(0, 6) : null,
      lote: texto(v('lote')),
      caducidad,
      unidades: Number.isInteger(uds) && uds > 0 ? uds : null,
      unidadesTexto: udsTexto,
      fechaReceta,
      numeroReceta: texto(v('numeroReceta')),
      veterinario: texto(v('veterinario')),
      numColegiado: texto(v('numColegiado')),
      clinica: texto(v('clinica')),
      direccionVeterinario: texto(v('direccionVeterinario')),
      propietario: Object.values(prop).some(Boolean) ? prop : null,
    });
  });
  return { tipo: 'salidas', reconocidas, ignoradas, filas: out, errores };
}

/** Lee la primera hoja de un XLSX o un CSV (separador `;` o `,`, UTF-8 con o sin BOM) → cabecera y filas. */
export async function leerHoja(bytes: Uint8Array, nombre: string): Promise<{ cabecera: string[]; filas: Celda[][] }> {
  if (/\.csv$/i.test(nombre)) {
    const txt = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '');
    const lineas = parsearCsv(txt);
    return { cabecera: (lineas[0] ?? []).map(String), filas: lineas.slice(1) };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as never);
  const hoja = wb.worksheets[0];
  if (!hoja) return { cabecera: [], filas: [] };
  const valores: Celda[][] = [];
  hoja.eachRow({ includeEmpty: false }, (row) => {
    const celdas: Celda[] = [];
    for (let c = 1; c <= hoja.columnCount; c++) {
      const val = row.getCell(c).value as unknown;
      const plano =
        val && typeof val === 'object' && !(val instanceof Date)
          ? ((val as { result?: unknown; text?: unknown; richText?: { text: string }[] }).result ??
            (val as { text?: unknown }).text ??
            (val as { richText?: { text: string }[] }).richText?.map((r) => r.text).join('') ??
            null)
          : val;
      celdas.push(plano === undefined ? null : (plano as Celda));
    }
    valores.push(celdas);
  });
  return { cabecera: (valores[0] ?? []).map((c) => (c === null ? '' : String(c))), filas: valores.slice(1) };
}

function parsearCsv(txt: string): string[][] {
  const sep = (txt.split(/\r?\n/)[0] ?? '').split(';').length > 1 ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i] as string;
    if (comillas) {
      if (ch === '"' && txt[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) {
      fila.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && txt[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else campo += ch;
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => c.trim() !== ''));
}
