import { textoDefecto, type CodigoIncidencia } from '@mmx/shared';

/** Textos de decisión para personal no técnico (siempre con icono además de color). */
export const DECISION: Record<string, { texto: string; clase: string }> = {
  DISPENSAR: { texto: 'Se puede dispensar', clase: 'text-dispensar bg-dispensar-bg' },
  DISPENSAR_CON_AVISO: { texto: 'Dispensar otro formato', clase: 'text-dispensar bg-dispensar-bg' },
  SUSTITUIR: { texto: 'Sustituir', clase: 'text-sustituir bg-sustituir-bg' },
  PEDIR: { texto: 'Pedir', clase: 'text-pedir bg-pedir-bg' },
  NO_CONFORME: { texto: 'No se puede dispensar', clase: 'text-noconforme bg-noconforme-bg' },
  PENDIENTE_STOCK: { texto: 'Stock sin confirmar', clase: 'text-pedir bg-pedir-bg' },
};

export interface Motivo {
  code: CodigoIncidencia;
  severidad: 'AVISO' | 'BLOQUEANTE_FORMA' | 'BLOQUEANTE_DURO';
  params?: Record<string, string | number>;
  linea?: number;
}

export const textoMotivo = (m: Motivo) => textoDefecto(m.code, m.params ?? {});

/** "Código nacional" en lugar de "CN" (AGENTS.md). */
export const CN = 'Código nacional';

export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export const hoyIso = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
