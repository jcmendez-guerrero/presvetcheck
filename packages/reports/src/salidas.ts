import type { PlantillaSalidas } from '@mmx/shared';
import { fechaEs, type Tabla } from './formato';

/**
 * Registro de salidas: tres plantillas con el orden exacto de columnas del requisito (SPEC §4.8) y
 * columnas internas al final (o en hoja aparte `trazabilidad`).
 */
export const COLUMNAS_A = [
  'NOMBRE DEL FÁRMACO',
  'PRINCIPIO ACTIVO',
  'FORMA FARMACÉUTICA',
  'ESPECIE',
  'FECHA VENTA',
  'CADUCIDAD',
  'LOTE',
  'CÓDIGO NACIONAL',
  'UNIDADES DISPENSADAS',
  'FECHA RECETA',
  'Nº RECETA',
  'VETERINARIO',
  'Nº COLEGIADO',
  'NOMBRE CLÍNICA',
  'DIRECCIÓN VETERINARIO',
] as const;
export const COLUMNAS_PROPIETARIO = ['NOMBRE PROPIETARIO', 'MÓVIL', 'DNI', 'DIRECCIÓN'] as const;
export const COLUMNAS_B = COLUMNAS_A.slice(0, 9);
export const COLUMNAS_INTERNAS = [
  'ID DISPENSACIÓN',
  'CANAL',
  'TIPO RECETA',
  'PLATAFORMA',
  'SUSTITUCIÓN (S/N)',
  'FORZADO (S/N)',
  'DEFECTOS FORZADOS',
  'MEDICAMENTO PRESCRITO (si sustitución)',
  'AUTORIZADO POR',
  'EMPLEADO',
  'MÉTODO CAPTURA',
  'ANULADA (S/N)',
] as const;

/** Fila de salida ya resuelta (la construye la API desde `v_dispensacion` + receta + veterinario + propietario). */
export interface Salida {
  id: string;
  canal: 'presencial' | 'online';
  conReceta: boolean;
  nombreFarmaco: string;
  principioActivo: string | null;
  forma: string | null;
  especie: string | null;
  fechaVenta: Date | string;
  caducidad: string | null;
  lote: string;
  cn: string;
  unidades: number;
  fechaReceta: string | null;
  numeroReceta: string | null;
  veterinario: string | null;
  numColegiado: string | null;
  clinica: string | null;
  direccionVeterinario: string | null;
  propietario: { nombre: string | null; movil: string | null; dni: string | null; direccion: string | null } | null;
  tipoReceta: string | null;
  plataforma: string | null;
  esSustitucion: boolean;
  forzado: boolean;
  defectosForzados: string[];
  medicamentoPrescrito: string | null;
  autorizadoPor: string | null;
  empleado: string;
  metodoCaptura: string;
  anulada: boolean;
}

const sn = (b: boolean) => (b ? 'S' : 'N');

export function plantillaDe(s: Pick<Salida, 'conReceta' | 'canal'>): PlantillaSalidas {
  if (s.conReceta) return 'A';
  return s.canal === 'online' ? 'C' : 'B';
}

export interface OpcionesSalidas {
  /** Las exportaciones excluyen por defecto los datos del propietario (SPEC §9.2). */
  incluirPropietario: boolean;
  /** Columnas internas al final o en hoja aparte `trazabilidad`. */
  internas: 'final' | 'hoja' | 'ninguna';
}

export function tablasSalidas(salidas: Salida[], plantilla: PlantillaSalidas, o: OpcionesSalidas): Tabla[] {
  const filas = salidas.filter((s) => plantillaDe(s) === plantilla);
  const base = (s: Salida) => [
    s.nombreFarmaco,
    s.principioActivo ?? '',
    s.forma ?? '',
    s.especie ?? '',
    fechaEs(s.fechaVenta),
    fechaEs(s.caducidad),
    s.lote,
    s.cn,
    s.unidades,
  ];
  const receta = (s: Salida) => [fechaEs(s.fechaReceta), s.numeroReceta ?? '', s.veterinario ?? '', s.numColegiado ?? '', s.clinica ?? '', s.direccionVeterinario ?? ''];
  const prop = (s: Salida) =>
    o.incluirPropietario ? [s.propietario?.nombre ?? '', s.propietario?.movil ?? '', s.propietario?.dni ?? '', s.propietario?.direccion ?? ''] : ['', '', '', ''];
  const internas = (s: Salida) => [
    s.id,
    s.canal,
    s.tipoReceta ?? '',
    s.plataforma ?? '',
    sn(s.esSustitucion),
    sn(s.forzado),
    s.defectosForzados.join(', '),
    s.esSustitucion ? (s.medicamentoPrescrito ?? '') : '',
    s.autorizadoPor ?? '',
    s.empleado,
    s.metodoCaptura,
    sn(s.anulada),
  ];

  let columnas: string[];
  let fila: (s: Salida) => Array<string | number | null>;
  if (plantilla === 'A') {
    columnas = [...COLUMNAS_A, ...(o.incluirPropietario ? COLUMNAS_PROPIETARIO : [])];
    fila = (s) => [...base(s), ...receta(s), ...(o.incluirPropietario ? prop(s) : [])];
  } else if (plantilla === 'B') {
    columnas = [...COLUMNAS_B];
    fila = base;
  } else {
    // C = B + datos del propietario (obligatorios, D-07). Valores solo si se piden expresamente.
    columnas = [...COLUMNAS_B, ...COLUMNAS_PROPIETARIO];
    fila = (s) => [...base(s), ...prop(s)];
  }
  const nombre = { A: 'Con receta', B: 'Sin receta presencial', C: 'Sin receta online' }[plantilla];
  if (o.internas === 'final') {
    return [{ nombre, columnas: [...columnas, ...COLUMNAS_INTERNAS], filas: filas.map((s) => [...fila(s), ...internas(s)]) }];
  }
  const principal: Tabla = { nombre, columnas, filas: filas.map(fila) };
  if (o.internas === 'ninguna') return [principal];
  return [principal, { nombre: 'trazabilidad', columnas: ['CÓDIGO NACIONAL', 'LOTE', ...COLUMNAS_INTERNAS], filas: filas.map((s) => [s.cn, s.lote, ...internas(s)]) }];
}
