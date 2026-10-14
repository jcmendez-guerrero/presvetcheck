import type { Plazo, TipoTratamiento, ValidezRules } from '@mmx/shared';
import { comparar, minFecha, sumarPlazo, type FechaIso } from './fechas';

/**
 * Validez temporal de la receta (SPEC §4.1.3). Por línea se determina el caso legal; a la
 * receta se aplica el más restrictivo. `validez_efectiva = min(plazo declarado ?? máximo legal,
 * máximo legal)`.
 */

export type CasoValidez =
  | 'general'
  | 'antimicrobiano'
  | 'cronico_no_productora'
  | 'preventivo_no_productora'
  | 'estupefaciente'
  | 'psicotropo';

export interface LineaValidez {
  orden: number;
  /** false si la línea no se ha resuelto contra CIMAVet: nunca obtiene la validez ampliada. */
  resuelta: boolean;
  antimicrobiano: boolean;
  estupefaciente: boolean;
  psicotropo: boolean;
  /** ATC excluido de crónico/preventivo (gases medicinales…). */
  excluidaAmpliada: boolean;
}

export interface EntradaValidez {
  fechaEmision: FechaIso;
  plazoDeclarado: { cantidad: number; unidad: 'dias' | 'meses' } | null;
  /** Si no consta en la receta se usa `agudo`. */
  tipoTratamiento: TipoTratamiento | null;
  especieProduccion: boolean;
  lineas: LineaValidez[];
  rules: ValidezRules;
}

export interface ResultadoValidez {
  caso: CasoValidez;
  maximoLegal: FechaIso;
  plazoMaximo: Plazo;
  efectiva: FechaIso;
  plazoDeclaradoSuperior: boolean;
  porLinea: { orden: number; caso: CasoValidez; limite: FechaIso }[];
}

export function casoLinea(l: LineaValidez, tipo: TipoTratamiento, produccion: boolean): CasoValidez {
  if (l.estupefaciente) return 'estupefaciente';
  if (l.antimicrobiano) return 'antimicrobiano';
  if (l.psicotropo) return 'psicotropo';
  const ampliable = !produccion && l.resuelta && !l.excluidaAmpliada;
  if (ampliable && tipo === 'cronico') return 'cronico_no_productora';
  if (ampliable && tipo === 'preventivo') return 'preventivo_no_productora';
  return 'general';
}

export function calcularValidez(e: EntradaValidez): ResultadoValidez {
  const tipo = e.tipoTratamiento ?? 'agudo';
  const porLinea = e.lineas.map((l) => {
    const caso = casoLinea(l, tipo, e.especieProduccion);
    return { orden: l.orden, caso, limite: sumarPlazo(e.fechaEmision, e.rules[caso]) };
  });
  if (porLinea.length === 0) {
    porLinea.push({ orden: 0, caso: 'general', limite: sumarPlazo(e.fechaEmision, e.rules.general) });
  }
  const masRestrictiva = porLinea.reduce((a, b) => (comparar(b.limite, a.limite) < 0 ? b : a));
  let efectiva = masRestrictiva.limite;
  let plazoDeclaradoSuperior = false;
  if (e.plazoDeclarado) {
    const declarado =
      e.plazoDeclarado.unidad === 'meses'
        ? sumarPlazo(e.fechaEmision, { meses: e.plazoDeclarado.cantidad })
        : sumarPlazo(e.fechaEmision, { dias: e.plazoDeclarado.cantidad });
    plazoDeclaradoSuperior = comparar(declarado, masRestrictiva.limite) > 0;
    efectiva = minFecha(declarado, masRestrictiva.limite);
  }
  return {
    caso: masRestrictiva.caso,
    maximoLegal: masRestrictiva.limite,
    plazoMaximo: e.rules[masRestrictiva.caso],
    efectiva,
    plazoDeclaradoSuperior,
    porLinea,
  };
}

/** Caducada si la fecha de referencia (dispensación) es posterior a la validez efectiva. */
export function recetaCaducada(efectiva: FechaIso, fechaReferencia: FechaIso): boolean {
  return comparar(fechaReferencia, efectiva) > 0;
}

/** Texto del plazo ("1 mes", "5 días"). */
export function textoPlazo(p: Plazo): string {
  if (p.meses !== undefined) return p.meses === 1 ? '1 mes' : `${p.meses} meses`;
  return p.dias === 1 ? '1 día' : `${p.dias} días`;
}
