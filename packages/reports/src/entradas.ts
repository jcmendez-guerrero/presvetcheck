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
  /** Día de llegada de la mercancía (si se registró). */
  fechaRecepcion?: string | null;
  /** El precio de esta línea cuenta como precio de coste de referencia («Actualizar precio»). */
  actualizarPrecio?: boolean;
}

/** Fecha con la que cuenta la entrada: la de recepción (llegada del producto); si falta, la de compra. */
export function fechaEntrada(e: Pick<Entrada, 'fechaCompra' | 'fechaRecepcion'>): string {
  return e.fechaRecepcion ?? e.fechaCompra;
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
  'PRECIO NETO COMPRA (sin IVA ni RE)',
  'IVA %',
  'RE %',
  'PRECIO COSTE',
  'Nº SERIE',
  'ORIGEN DATOS',
  'EMPLEADO',
  'FECHA RECEPCIÓN',
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
      fechaEs(e.fechaRecepcion ?? null),
    ]),
  };
}

/**
 * Registro de psicótropos: entradas, salidas y saldo por medicamento y lote (SPEC §4.1.5).
 * El formato oficial lo confirma el garante. TODO(decision D-06b)
 */
export interface MovimientoPsicotropo {
  fecha: string | Date;
  tipo: 'ENTRADA' | 'SALIDA' | 'ANULACIÓN SALIDA' | 'BAJA' | 'ANULACIÓN BAJA';
  cn: string;
  nombre: string;
  lote: string;
  /** Envases completos (el saldo se lleva en envases; una fracción no consume un envase entero). */
  unidades: number;
  /** Texto de unidades dispensadas (fracciones: "10 comprimidos (fracción de caja 20 comprimidos)"). */
  unidadesTexto?: string | null;
  referencia: string;
}

export function tablaPsicotropos(movs: MovimientoPsicotropo[]): Tabla {
  const orden = [...movs].sort((a, b) =>
    `${a.cn}|${a.lote}|${new Date(a.fecha).toISOString()}`.localeCompare(
      `${b.cn}|${b.lote}|${new Date(b.fecha).toISOString()}`,
    ),
  );
  const saldo = new Map<string, number>();
  return {
    nombre: 'Psicotropos',
    columnas: [
      'CÓDIGO NACIONAL',
      'MEDICAMENTO',
      'LOTE',
      'FECHA',
      'MOVIMIENTO',
      'ENTRADAS',
      'SALIDAS',
      'SALDO',
      'REFERENCIA',
    ],
    filas: orden.map((m) => {
      const k = `${m.cn}|${m.lote}`;
      const resta = m.tipo === 'SALIDA' || m.tipo === 'BAJA';
      const delta = resta ? -m.unidades : m.unidades;
      saldo.set(k, (saldo.get(k) ?? 0) + delta);
      return [
        m.cn,
        m.nombre,
        m.lote,
        fechaEs(m.fecha),
        m.tipo,
        resta ? '' : m.unidades,
        resta ? (m.unidades === 0 && m.unidadesTexto ? m.unidadesTexto : m.unidades) : '',
        saldo.get(k) as number,
        m.referencia,
      ];
    }),
  };
}

/**
 * Baja de stock: salida de un medicamento en Siweb360 que no es una venta, justificada en la app con un motivo
 * (rotura, caducado, robo…; specs/011, FR-009d). Si la justificación se sustituye, el registro conserva la baja y
 * añade su anulación; nunca se edita.
 */
export interface Baja {
  fecha: string | Date;
  tipo: 'BAJA' | 'ANULACIÓN BAJA';
  cn: string;
  nombre: string;
  nregistro: string | null;
  lote: string;
  /** Envases (en positivo). */
  unidades: number;
  motivo: string;
  nota: string | null;
  /** Identificador de la justificación. */
  referencia: string;
  /** Posición de la justificación en su cadena de sustituciones (0 = la primera). */
  orden: number;
}

export function tablaBajas(bajas: Baja[]): Tabla {
  // Por fecha del movimiento; de una misma justificación, la baja antes que su anulación.
  const clave = (x: Baja) =>
    `${new Date(x.fecha).toISOString()}|${String(x.orden).padStart(4, '0')}|${x.tipo === 'BAJA' ? 0 : 1}|${x.referencia}`;
  const orden = [...bajas].sort((a, b) => clave(a).localeCompare(clave(b)));
  return {
    nombre: 'Bajas',
    columnas: [
      'FECHA',
      'MOVIMIENTO',
      'CÓDIGO NACIONAL',
      'MEDICAMENTO',
      'LOTE',
      'UNIDADES',
      'MOTIVO',
      'NOTA',
      'REFERENCIA',
    ],
    filas: orden.map((b) => [
      fechaEs(b.fecha),
      b.tipo,
      b.cn,
      b.nombre,
      b.lote,
      b.unidades,
      b.motivo,
      b.nota ?? '',
      b.referencia,
    ]),
  };
}
