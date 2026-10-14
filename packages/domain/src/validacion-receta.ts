import type { CampoReceta, RecetaConfirmada, SeveridadCampo } from '@mmx/shared';
import { comparar, fechaEs, type FechaIso } from './fechas';
import { esAntimicrobiano } from './medicamento';
import { incidencia, type PoliticaSeveridad } from './severidad';
import type { Incidencia, MedicamentoInfo, PresentacionInfo } from './tipos';

/** Datos de CIMAVet de cada línea, ya resueltos por la persona (o null si aún no). */
export interface LineaResuelta {
  orden: number;
  medicamento: MedicamentoInfo | null;
  presentacion: PresentacionInfo | null;
}

const presente = (v: unknown) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');

/**
 * Comprueba los campos obligatorios de la receta según `receta-campos.v1.yaml` (SPEC §4.1.2).
 * El contexto es `especie_produccion` o `especie_compania`.
 */
export function validarCampos(
  r: RecetaConfirmada,
  lineas: LineaResuelta[],
  pol: PoliticaSeveridad,
  hoy: FechaIso,
): Incidencia[] {
  const out: Incidencia[] = [];
  const produccion = r.especieProduccion;
  const idIndividual = r.especie.especieId !== null && pol.rules.especies_id_individual.includes(r.especie.especieId);

  const severidadCampo = (campo: CampoReceta): SeveridadCampo => {
    const regla = pol.rules.campos[campo];
    if (produccion) return regla.produccion;
    if (idIndividual && regla.compania_id_individual) return regla.compania_id_individual;
    return regla.compania;
  };

  const exigir = (campo: CampoReceta, ok: boolean, extra: { linea?: number; params?: Record<string, string | number> } = {}) => {
    if (ok) return;
    const sev = severidadCampo(campo);
    if (sev === 'NO_APLICA' || sev === 'OPCIONAL') return;
    const regla = pol.rules.campos[campo];
    out.push({
      code: regla.codigo,
      severidad: sev,
      ambito: extra.linea !== undefined ? 'linea' : 'receta',
      campo,
      ...(extra.linea !== undefined ? { linea: extra.linea, params: { linea: extra.linea, ...extra.params } } : {}),
    });
  };

  if (!r.comprobadoConOriginal) out.push(incidencia('DATOS_NO_COMPROBADOS', pol));

  exigir('numero_receta', presente(r.numero));
  exigir('tipo_dispensacion', presente(r.tipoDispensacion));
  if (r.tipoDispensacion && r.tipoDispensacion !== 'dispensacion') {
    const nombre = r.tipoDispensacion === 'botiquin' ? 'de botiquín' : 'de no dispensación';
    out.push(incidencia('TIPO_DISPENSACION_NO_DISPENSABLE', pol, { campo: 'tipo_dispensacion', params: { tipo: nombre } }));
  }
  exigir('titular_nombre', presente(r.titular.nombre));
  exigir('titular_telefono', presente(r.titular.telefono));
  exigir('rega', presente(r.rega));
  exigir('especie', presente(r.especie.especieId) || presente(r.especie.texto));
  exigir('animal_identificacion', presente(r.animalIdentificacion));
  exigir('num_animales', presente(r.numAnimales));
  exigir('fecha_emision', presente(r.fechaEmision));
  if (r.fechaEmision && comparar(r.fechaEmision, hoy) > 0) {
    out.push(incidencia('FECHA_EMISION_FUTURA', pol, { campo: 'fecha_emision', params: { fecha: fechaEs(r.fechaEmision) } }));
  }
  exigir('veterinario_nombre', presente(r.veterinario.nombre));
  exigir('veterinario_telefono', presente(r.veterinario.telefono));
  exigir('veterinario_email', presente(r.veterinario.email));
  exigir('num_colegiado', presente(r.veterinario.numColegiado) || r.talonarioColegial);
  exigir('firma', r.firmaConfirmada);
  exigir('clase_prescripcion', presente(r.clasePrescripcion));
  exigir('indicacion', presente(r.indicacion));

  for (const l of r.lineas) {
    const res = lineas.find((x) => x.orden === l.orden);
    const linea = l.orden;
    const tieneNombre = presente(l.medicamentoTexto);
    const tienePa = presente(l.principioActivoTexto);
    if (!tieneNombre && tienePa) {
      out.push(incidencia('PRESCRIPCION_SOLO_PA', pol, { linea, campo: 'medicamento_nombre', params: { linea } }));
    } else {
      exigir('medicamento_nombre', tieneNombre, { linea });
    }
    exigir('principio_activo', tienePa, { linea });
    exigir('forma_concentracion', presente(l.formaTexto) && presente(l.concentracionTexto), { linea });
    exigir('cantidad', presente(l.cantidadEnvases), { linea });
    exigir(
      'posologia',
      l.posologia !== null && presente(l.posologia.via) && presente(l.posologia.dosis) && presente(l.posologia.duracionDias),
      { linea },
    );
    exigir('tiempo_espera', presente(l.tiempoEsperaTexto), { linea });
    if (res?.medicamento && esAntimicrobiano(res.medicamento, pol.rules)) {
      exigir('declaracion_antimicrobiano', l.declaracionAntimicrobiano?.declarada === true, { linea });
    }
  }
  return out;
}
