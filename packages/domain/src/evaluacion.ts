import type { RecetaConfirmada, RulesBundle } from '@mmx/shared';
import { hoy, type Clock } from './clock';
import { fechaEs, type FechaIso } from './fechas';
import { autorizadoParaEspecie, esAntimicrobiano, excluidoValidezAmpliada } from './medicamento';
import { aplicarPoliticaPsicotropo, incidencia, type PoliticaSeveridad } from './severidad';
import type { Incidencia } from './tipos';
import { validarCampos, type LineaResuelta } from './validacion-receta';
import { calcularValidez, recetaCaducada, textoPlazo, type ResultadoValidez } from './validez';

/**
 * Evaluación de la receta (SPEC §4.1): campos, validez, duplicados, plataforma y comprobaciones
 * del medicamento. Devuelve las incidencias por línea (incluidas las de ámbito receta), listas
 * para el motor de decisión.
 */

export interface EntradaEvaluacion {
  receta: RecetaConfirmada;
  lineas: LineaResuelta[];
  /** Ya existe una dispensación completada para (nº receta, nº colegiado) en papel. */
  yaDispensada: boolean;
  /** Id de una receta anterior con el mismo pHash, si la hay. */
  recetaSimilarId: string | null;
  /** Plataforma de receta electrónica confirmada (null si papel). `desconocida` si no está en la lista. */
  plataforma: { nombre: string; reconocidaMapa: boolean | null } | 'desconocida' | null;
  /** CIMAVet no respondió en la verificación en vivo: fecha de la última sincronización. */
  cimavetCacheDesde: FechaIso | null;
  /**
   * Fecha de la primera dispensación de esta receta, si ya se dispensó parcialmente. La validez
   * se evalúa en esa fecha (D-10). TODO(decision D-10b)
   */
  primeraDispensacion: FechaIso | null;
  clock: Clock;
  politica: PoliticaSeveridad;
  rules: RulesBundle;
}

export interface ResultadoEvaluacion {
  incidencias: Incidencia[];
  porLinea: Record<number, Incidencia[]>;
  validez: ResultadoValidez | null;
  fechaReferencia: FechaIso;
  reglaVersion: string;
}

/** Fecha en la que se evalúa la validez: la de la 1.ª dispensación si la receta está retenida. TODO(decision D-10b) */
export function fechaReferenciaValidez(primeraDispensacion: FechaIso | null, hoyIso: FechaIso): FechaIso {
  return primeraDispensacion ?? hoyIso;
}

export function evaluarReceta(e: EntradaEvaluacion): ResultadoEvaluacion {
  const pol = e.politica;
  const r = e.receta;
  const hoyIso = hoy(e.clock);
  const fechaReferencia = fechaReferenciaValidez(e.primeraDispensacion, hoyIso);
  const incs: Incidencia[] = validarCampos(r, e.lineas, pol, hoyIso);

  // Duplicados y plataforma (SPEC §4.1.5)
  if (r.tipo === 'papel' && e.yaDispensada) incs.push(incidencia('RECETA_YA_DISPENSADA', pol));
  if (e.recetaSimilarId)
    incs.push(incidencia('RECETA_POSIBLE_DUPLICADO', pol, { params: { recetaId: e.recetaSimilarId } }));
  if (r.tipo === 'electronica') {
    if (e.plataforma === null || e.plataforma === 'desconocida') {
      incs.push(incidencia('PLATAFORMA_DESCONOCIDA', pol));
    } else if (e.plataforma.reconocidaMapa === false) {
      incs.push(incidencia('PLATAFORMA_NO_RECONOCIDA', pol, { params: { plataforma: e.plataforma.nombre } }));
    } else if (e.plataforma.reconocidaMapa === null) {
      incs.push(
        incidencia('PLATAFORMA_PENDIENTE_VERIFICAR', pol, { params: { plataforma: e.plataforma.nombre } }),
      );
    }
  }
  if (e.cimavetCacheDesde)
    incs.push(incidencia('CIMAVET_NO_DISPONIBLE', pol, { params: { fecha: fechaEs(e.cimavetCacheDesde) } }));

  // Validez temporal (SPEC §4.1.3)
  let validez: ResultadoValidez | null = null;
  if (r.fechaEmision) {
    validez = calcularValidez({
      fechaEmision: r.fechaEmision,
      plazoDeclarado: r.plazoValidezDeclarado,
      tipoTratamiento: r.tipoTratamiento,
      especieProduccion: r.especieProduccion,
      cronicoPlanSanitario: r.cronicoPlanSanitario,
      rules: e.rules.validez,
      lineas: r.lineas.map((l) => {
        const m = e.lineas.find((x) => x.orden === l.orden)?.medicamento ?? null;
        return {
          orden: l.orden,
          resuelta: m !== null,
          // Antimicrobiano si lo dice CIMAVet o la propia receta (conservador: validez de 5 días).
          antimicrobiano: r.antimicrobianos || (m ? esAntimicrobiano(m, e.rules.recetaCampos) : false),
          estupefaciente: m?.estupefaciente ?? false,
          psicotropo: m?.psicotropo ?? false,
          excluidaAmpliada: m ? excluidoValidezAmpliada(m, e.rules.recetaCampos) : true,
        };
      }),
    });
    if (validez.plazoDeclaradoSuperior) {
      incs.push(
        incidencia('PLAZO_DECLARADO_SUPERIOR', pol, {
          campo: 'plazo_validez',
          params: { maximo: textoPlazo(validez.plazoMaximo), fecha: fechaEs(validez.efectiva) },
        }),
      );
    }
    if (recetaCaducada(validez.efectiva, fechaReferencia)) {
      incs.push(
        incidencia('RECETA_CADUCADA', pol, {
          campo: 'fecha_emision',
          params: { fecha: fechaEs(validez.efectiva) },
        }),
      );
    }
  }

  // Comprobaciones del medicamento por línea (SPEC §4.1.5, §4.2.5)
  for (const l of r.lineas) {
    const res = e.lineas.find((x) => x.orden === l.orden);
    const linea = l.orden;
    const m = res?.medicamento ?? null;
    if (!m || !res?.presentacion) {
      incs.push(incidencia('MEDICAMENTO_NO_EN_SISTEMA', pol, { linea, params: { linea } }));
      continue;
    }
    const p = { medicamento: m.nombre, linea };
    if (m.usoHumano) incs.push(incidencia('MEDICAMENTO_USO_HUMANO', pol, { linea, params: p }));
    if (m.estupefaciente) incs.push(incidencia('ESTUPEFACIENTE_NO_DISPENSABLE', pol, { linea, params: p }));
    if (m.psicotropo && (l.cantidadEnvases ?? 0) > 1) {
      incs.push(incidencia('PSICOTROPO_MAS_DE_UN_ENVASE', pol, { linea, params: p }));
    }
    const estado = m.estado !== 'autorizado' ? m.estado : res.presentacion.estado;
    if (estado === 'suspendido') incs.push(incidencia('MEDICAMENTO_SUSPENDIDO', pol, { linea, params: p }));
    if (estado === 'revocado') incs.push(incidencia('MEDICAMENTO_REVOCADO', pol, { linea, params: p }));
    if (!m.comerc || !res.presentacion.comerc)
      incs.push(incidencia('MEDICAMENTO_NO_COMERCIALIZADO', pol, { linea, params: p }));
    if (m.psum) incs.push(incidencia('PROBLEMA_SUMINISTRO', pol, { linea, params: p }));
    // Desconocido (Nomenclátor sin consulta a CIMAVet): se avisa para que no se dé por bueno.
    else if (m.psum === null) incs.push(incidencia('SUMINISTRO_NO_COMPROBADO', pol, { linea, params: p }));
    if (m.notas) incs.push(incidencia('NOTAS_SEGURIDAD', pol, { linea, params: p }));
    if (
      r.especie.especieId !== null &&
      !autorizadoParaEspecie(m, r.especie.especieId, e.rules.equivalencia.especie_padre)
    ) {
      incs.push(incidencia('MEDICAMENTO_ESPECIE_NO_AUTORIZADA', pol, { linea, params: p }));
    }
  }

  // Reparto por línea: cada línea ve las de receta + las suyas, con la política de psicótropos.
  const porLinea: Record<number, Incidencia[]> = {};
  for (const l of r.lineas) {
    const m = e.lineas.find((x) => x.orden === l.orden)?.medicamento ?? null;
    const propias = incs.filter((i) => i.ambito === 'receta' || i.linea === l.orden);
    porLinea[l.orden] = aplicarPoliticaPsicotropo(propias, m?.psicotropo ?? false, pol);
  }
  return { incidencias: incs, porLinea, validez, fechaReferencia, reglaVersion: e.rules.version };
}
