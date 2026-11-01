import { type Entrada } from './entradas';
import { fechaEs, type Tabla } from './formato';
import { COLUMNAS_PROPIETARIO, plantillaDe, type Salida } from './salidas';

/**
 * Informes de conjunto (además de los registros por plantilla): todas las salidas en una sola tabla y todos
 * los movimientos (entradas y salidas) ordenados por fecha. Los datos del propietario solo se añaden (al final, con el
 * DNI enmascarado) si se piden expresamente, como en la plantilla A (SPEC §9.2).
 */
const TIPO_SALIDA = { A: 'Con receta', B: 'Sin receta (presencial)', C: 'Sin receta (online)' } as const;
const sn = (b: boolean) => (b ? 'S' : 'N');

export const COLUMNAS_TODAS_SALIDAS = [
  'FECHA',
  'TIPO DE SALIDA',
  'NOMBRE DEL FÁRMACO',
  'PRINCIPIO ACTIVO',
  'FORMA FARMACÉUTICA',
  'ESPECIE',
  'CÓDIGO NACIONAL',
  'LOTE',
  'CADUCIDAD',
  'UNIDADES DISPENSADAS',
  'Nº RECETA',
  'FECHA RECETA',
  'VETERINARIO',
  'Nº COLEGIADO',
  'NOMBRE CLÍNICA',
  'DIRECCIÓN VETERINARIO',
  'SUSTITUCIÓN (S/N)',
  'ANULADA (S/N)',
  'EMPLEADO',
  'REGISTRO',
  'CONCILIACIÓN CON TICKET',
] as const;

const ordenFecha = (a: Date | string, b: Date | string) => new Date(a).getTime() - new Date(b).getTime();

export function tablaTodasSalidas(salidas: Salida[], o: { incluirPropietario?: boolean } = {}): Tabla {
  const prop = (x: Salida) =>
    o.incluirPropietario
      ? [
          x.propietario?.nombre ?? '',
          x.propietario?.movil ?? '',
          x.propietario?.dni ?? '',
          x.propietario?.direccion ?? '',
        ]
      : [];
  return {
    nombre: 'Todas las salidas',
    columnas: [...COLUMNAS_TODAS_SALIDAS, ...(o.incluirPropietario ? COLUMNAS_PROPIETARIO : [])],
    filas: [...salidas]
      .sort((a, b) => ordenFecha(a.fechaVenta, b.fechaVenta))
      .map((s) => [
        fechaEs(s.fechaVenta),
        TIPO_SALIDA[plantillaDe(s)],
        s.nombreFarmaco,
        s.principioActivo ?? '',
        s.forma ?? '',
        s.especie ?? '',
        s.cn,
        s.lote,
        fechaEs(s.caducidad),
        s.unidadesTexto ?? s.unidades,
        s.numeroReceta ?? '',
        fechaEs(s.fechaReceta),
        s.veterinario ?? '',
        s.numColegiado ?? '',
        s.clinica ?? '',
        s.direccionVeterinario ?? '',
        sn(s.esSustitucion),
        sn(s.anulada),
        s.empleado,
        s.registro ?? '',
        s.conciliacion ?? '',
        ...prop(s),
      ]),
  };
}

export const COLUMNAS_MOVIMIENTOS = [
  'FECHA',
  'MOVIMIENTO',
  'NOMBRE DEL FÁRMACO',
  'PRINCIPIO ACTIVO',
  'FORMA FARMACÉUTICA',
  'CÓDIGO NACIONAL',
  'LOTE',
  'CADUCIDAD',
  'ENTRADA (UDS.)',
  'SALIDA (UDS.)',
  'PROCEDENCIA / DESTINO',
  'DOCUMENTO',
  'ANULADA (S/N)',
  'EMPLEADO',
] as const;

/** Entradas y salidas del periodo en una sola tabla, por fecha (en el mismo día, primero las entradas). */
export function tablaMovimientos(entradas: Entrada[], salidas: Salida[]): Tabla {
  type Fila = { fecha: Date | string; orden: number; fila: Array<string | number | null> };
  const filas: Fila[] = [
    ...entradas.map((e) => ({
      fecha: e.fechaCompra,
      orden: 0,
      fila: [
        fechaEs(e.fechaCompra),
        'Entrada',
        e.nombreFarmaco,
        e.principioActivo ?? '',
        e.forma ?? '',
        e.cn ?? '',
        e.lote ?? '',
        fechaEs(e.caducidad),
        e.unidades,
        '',
        e.distribuidor,
        e.albaran ? `Albarán ${e.albaran}` : '',
        'N',
        e.empleado,
      ],
    })),
    ...salidas.map((s) => ({
      fecha: s.fechaVenta,
      orden: 1,
      fila: [
        fechaEs(s.fechaVenta),
        `Salida · ${TIPO_SALIDA[plantillaDe(s)].toLowerCase()}`,
        s.nombreFarmaco,
        s.principioActivo ?? '',
        s.forma ?? '',
        s.cn,
        s.lote,
        fechaEs(s.caducidad),
        '',
        s.unidades,
        s.veterinario
          ? `${s.veterinario}${s.numColegiado ? ` (col. ${s.numColegiado})` : ''}`
          : s.canal === 'online'
            ? 'Venta online'
            : 'Venta presencial',
        s.numeroReceta ? `Receta ${s.numeroReceta}` : '',
        sn(s.anulada),
        s.empleado,
      ],
    })),
  ];
  const dia = (f: Date | string) => fechaEs(f).split('/').reverse().join('');
  return {
    nombre: 'Entradas y salidas',
    columnas: [...COLUMNAS_MOVIMIENTOS],
    filas: filas
      .sort(
        (a, b) =>
          dia(a.fecha).localeCompare(dia(b.fecha)) || a.orden - b.orden || ordenFecha(a.fecha, b.fecha),
      )
      .map((f) => f.fila),
  };
}
