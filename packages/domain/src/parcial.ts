import type { Decision } from '@mmx/shared';

/**
 * Dispensación parcial (SPEC §4.3, D-10): se dispensan las líneas disponibles, la receta en papel
 * se retiene desde la primera dispensación y las no disponibles pasan a PENDIENTE_ENTREGA con un
 * pedido vinculado.
 */
export interface LineaPlan {
  orden: number;
  decision: Decision;
  /** El empleado ha decidido dispensarla ahora. */
  dispensarAhora: boolean;
}

export interface PlanParcial {
  dispensables: number[];
  pendientesEntrega: number[];
  bloqueadas: number[];
  esParcial: boolean;
  permitido: boolean;
  retenerReceta: boolean;
}

const DISPENSABLE: Decision[] = ['DISPENSAR', 'DISPENSAR_CON_AVISO', 'SUSTITUIR'];

export function planificarDispensacion(lineas: LineaPlan[], allowPartial: boolean, tipo: 'papel' | 'electronica'): PlanParcial {
  const dispensables = lineas.filter((l) => l.dispensarAhora && DISPENSABLE.includes(l.decision)).map((l) => l.orden);
  const bloqueadas = lineas.filter((l) => l.decision === 'NO_CONFORME').map((l) => l.orden);
  const pendientesEntrega = lineas
    .filter((l) => !dispensables.includes(l.orden) && !bloqueadas.includes(l.orden))
    .map((l) => l.orden);
  const esParcial = dispensables.length > 0 && pendientesEntrega.length > 0;
  return {
    dispensables,
    pendientesEntrega,
    bloqueadas,
    esParcial,
    permitido: !esParcial || allowPartial,
    // La receta en papel solo admite una dispensación: se retiene desde la primera.
    retenerReceta: tipo === 'papel' && dispensables.length > 0,
  };
}

/** Texto del resguardo para el tutor (nº de receta, pendientes, fecha y teléfono de la farmacia). */
export function textoResguardo(d: {
  numeroReceta: string | null;
  fecha: string;
  telefonoFarmacia: string;
  pendientes: { nombre: string; unidades: number }[];
}): string {
  return [
    'RESGUARDO DE RECETA RETENIDA',
    `Receta nº: ${d.numeroReceta ?? '(sin número)'}`,
    `Fecha: ${d.fecha}`,
    'Medicamentos pendientes de entrega:',
    ...d.pendientes.map((p) => `  · ${p.nombre} — ${p.unidades} envase(s)`),
    `Le avisaremos cuando lleguen. Teléfono de la farmacia: ${d.telefonoFarmacia}`,
  ].join('\n');
}
