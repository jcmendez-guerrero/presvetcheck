import { fechaEs, type Tabla } from './formato';

/** Registro de entradas (SPEC §4.9 campos obligatorios + opcionales). */
export interface Entrada {
  recepcionId: string;
  distribuidor: string;
  albaran: string | null;
  fechaCompra: string;
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
  seriales: string[];
  origenDatos: string;
  empleado: string;
}

export const COLUMNAS_ENTRADAS = [
  'NOMBRE DEL FÁRMACO',
  'PRINCIPIO ACTIVO',
  'FORMA FARMACÉUTICA',
  'FECHA COMPRA',
  'CADUCIDAD',
  'LOTE',
  'CÓDIGO NACIONAL',
  'UNIDADES',
  'DISTRIBUIDOR',
  'Nº ALBARÁN',
  'PRECIO NETO COMPRA (sin IVA)',
  'IVA %',
  'RE %',
  'PRECIO COSTE',
  'Nº SERIE',
  'ORIGEN DATOS',
  'EMPLEADO',
] as const;

export function tablaEntradas(entradas: Entrada[]): Tabla {
  return {
    nombre: 'Entradas',
    columnas: [...COLUMNAS_ENTRADAS],
    filas: entradas.map((e) => [
      e.nombreFarmaco,
      e.principioActivo ?? '',
      e.forma ?? '',
      fechaEs(e.fechaCompra),
      fechaEs(e.caducidad),
      e.lote ?? '',
      e.cn ?? '',
      e.unidades,
      e.distribuidor,
      e.albaran ?? '',
      e.precioNetoCompra ?? '',
      e.ivaPct ?? '',
      e.rePct ?? '',
      e.precioCoste ?? '',
      e.seriales.join(', '),
      e.origenDatos,
      e.empleado,
    ]),
  };
}

/**
 * Registro de psicótropos: entradas, salidas y saldo por medicamento y lote (SPEC §4.1.5).
 * El formato oficial lo confirma el garante. TODO(decision D-06b)
 */
export interface MovimientoPsicotropo {
  fecha: string | Date;
  tipo: 'ENTRADA' | 'SALIDA' | 'ANULACIÓN SALIDA';
  cn: string;
  nombre: string;
  lote: string;
  unidades: number;
  referencia: string;
}

export function tablaPsicotropos(movs: MovimientoPsicotropo[]): Tabla {
  const orden = [...movs].sort((a, b) => `${a.cn}|${a.lote}|${new Date(a.fecha).toISOString()}`.localeCompare(`${b.cn}|${b.lote}|${new Date(b.fecha).toISOString()}`));
  const saldo = new Map<string, number>();
  return {
    nombre: 'Psicotropos',
    columnas: ['CÓDIGO NACIONAL', 'MEDICAMENTO', 'LOTE', 'FECHA', 'MOVIMIENTO', 'ENTRADAS', 'SALIDAS', 'SALDO', 'REFERENCIA'],
    filas: orden.map((m) => {
      const k = `${m.cn}|${m.lote}`;
      const delta = m.tipo === 'SALIDA' ? -m.unidades : m.unidades;
      saldo.set(k, (saldo.get(k) ?? 0) + delta);
      return [m.cn, m.nombre, m.lote, fechaEs(m.fecha), m.tipo, m.tipo === 'SALIDA' ? '' : m.unidades, m.tipo === 'SALIDA' ? m.unidades : '', saldo.get(k) as number, m.referencia];
    }),
  };
}
