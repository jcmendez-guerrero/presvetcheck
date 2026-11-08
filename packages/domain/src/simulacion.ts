import {
  textoDefecto,
  textoEquivalencia,
  type ClasePrescripcion,
  type CodigoEquivalencia,
  type CodigoIncidencia,
  type CriterioComparativaSustitucion,
  type DecisionSimulacion,
  type RulesBundle,
  type TipoTratamiento,
} from '@mmx/shared';
import { hoy, type Clock } from './clock';
import { fechaEs, type FechaIso } from './fechas';
import { evaluarEquivalencia } from './equivalencia';
import { evaluarAlternativaFormato, notaAdministracion, validarEnvasesFormato } from './formato';
import { esIndicacionGenerica } from './indicacion';
import { esAntimicrobiano, excluidoValidezAmpliada } from './medicamento';
import { sustitucionPermitida } from './sustitucion';
import type { ContextoPrescripcion, MedicamentoInfo, PresentacionInfo, ResultadoEquivalencia, ResultadoMotor } from './tipos';
import { concentracionDelNombre } from './unidades';
import { calcularValidez, recetaCaducada, textoPlazo, type LineaValidez } from './validez';

/**
 * Simulaciones del motor para el asistente de consultas (specs/002-prescription-chat-assistant, FR-009a): evalúan
 * un caso hipotético con las mismas funciones que la verificación real, sin crear ni modificar nada. Puras: sin I/O
 * y con el reloj inyectado. Siempre devuelven `{ decision, motivos, evidencias, reglaVersion }` más los supuestos
 * usados; si falta un dato obligatorio, `FALTAN_DATOS` con la lista (el asistente los pide, no los supone).
 */
export interface MotivoSimulacion {
  code: string;
  mensaje: string;
}

export interface ResultadoSimulacion {
  decision: DecisionSimulacion;
  motivos: MotivoSimulacion[];
  evidencias: Record<string, unknown>;
  reglaVersion: string;
  supuestos: Record<string, unknown>;
  faltan?: string[];
}

export type { ResultadoMotor };

const faltanDatos = (
  faltan: string[],
  supuestos: Record<string, unknown>,
  reglaVersion: string,
): ResultadoSimulacion => ({
  decision: 'FALTAN_DATOS',
  motivos: faltan.map((f) => ({ code: 'FALTA_DATO', mensaje: `Falta el dato: ${f}` })),
  evidencias: {},
  reglaVersion,
  supuestos,
  faltan,
});

const motivoDe = (code: CodigoIncidencia, params?: Record<string, string | number>): MotivoSimulacion => ({
  code,
  mensaje: textoDefecto(code, params).titulo,
});

// ── Validez de la receta ─────────────────────────────────────────────────────

export interface LineaSimuladaValidez {
  antimicrobiano: boolean;
  psicotropo: boolean;
  estupefaciente: boolean;
  /** El medicamento se ha identificado en CIMAVet (sin identificar, nunca se aplica la validez ampliada). */
  resuelta: boolean;
  /** ATC excluido de la validez ampliada de crónico/preventivo. */
  excluidaAmpliada: boolean;
}

export interface EntradaSimularValidez {
  fechaEmision: FechaIso | null;
  tipoTratamiento: TipoTratamiento | null;
  especieProduccion: boolean | null;
  lineas: LineaSimuladaValidez[];
  plazoDeclarado: { cantidad: number; unidad: 'dias' | 'meses' } | null;
  /** Si se indica, se comprueba si la receta seguiría siendo válida ese día; si no, se usa hoy. */
  fechaConsulta: FechaIso | null;
  rules: RulesBundle;
  clock: Clock;
}

/** Línea de validez a partir de un medicamento de CIMAVet. */
export function lineaValidezDe(m: MedicamentoInfo, rules: RulesBundle): LineaSimuladaValidez {
  return {
    antimicrobiano: esAntimicrobiano(m, rules.recetaCampos),
    psicotropo: m.psicotropo,
    estupefaciente: m.estupefaciente,
    resuelta: true,
    excluidaAmpliada: excluidoValidezAmpliada(m, rules.recetaCampos),
  };
}

export function simularValidez(e: EntradaSimularValidez): ResultadoSimulacion {
  const tipo = e.tipoTratamiento ?? 'agudo';
  const supuestos: Record<string, unknown> = {
    fechaEmision: e.fechaEmision,
    tipoTratamiento: tipo,
    tipoTratamientoIndicado: e.tipoTratamiento !== null,
    especieProduccion: e.especieProduccion,
    plazoDeclarado: e.plazoDeclarado,
    lineas: e.lineas,
  };
  const faltan: string[] = [];
  if (!e.fechaEmision) faltan.push('fecha de emisión de la receta');
  if ((tipo === 'cronico' || tipo === 'preventivo') && e.especieProduccion === null) {
    faltan.push('si el animal es de producción (de consumo humano) o de compañía');
  }
  const version = e.rules.version;
  if (faltan.length || !e.fechaEmision) return faltanDatos(faltan, supuestos, version);

  const lineas: LineaValidez[] = (
    e.lineas.length
      ? e.lineas
      : [
          {
            antimicrobiano: false,
            psicotropo: false,
            estupefaciente: false,
            resuelta: false,
            excluidaAmpliada: false,
          },
        ]
  ).map((l, i) => ({ orden: i + 1, ...l }));
  const v = calcularValidez({
    fechaEmision: e.fechaEmision,
    plazoDeclarado: e.plazoDeclarado,
    tipoTratamiento: e.tipoTratamiento,
    especieProduccion: e.especieProduccion ?? false,
    lineas,
    rules: e.rules.validez,
  });
  const fechaConsulta = e.fechaConsulta ?? hoy(e.clock);
  const caducada = recetaCaducada(v.efectiva, fechaConsulta);
  const motivos: MotivoSimulacion[] = [];
  if (v.plazoDeclaradoSuperior)
    motivos.push(motivoDe('PLAZO_DECLARADO_SUPERIOR', { maximo: fechaEs(v.maximoLegal) }));
  if (caducada) motivos.push(motivoDe('RECETA_CADUCADA', { fecha: fechaEs(v.efectiva) }));
  if (!lineas.some((l) => l.resuelta)) {
    motivos.push({
      code: 'MEDICAMENTO_SIN_IDENTIFICAR',
      mensaje:
        'Sin identificar el medicamento no se aplica la validez ampliada de tratamientos crónicos o preventivos.',
    });
  }
  return {
    decision: caducada ? 'CADUCADA' : 'VALIDA_HASTA',
    motivos,
    evidencias: {
      caso: v.caso,
      plazoMaximo: textoPlazo(v.plazoMaximo),
      maximoLegal: v.maximoLegal,
      validezEfectiva: v.efectiva,
      plazoDeclaradoSuperior: v.plazoDeclaradoSuperior,
      porLinea: v.porLinea,
      fechaConsulta,
      caducada,
    },
    reglaVersion: version,
    supuestos,
  };
}

// ── Sustituibilidad ──────────────────────────────────────────────────────────

/** Medicamento hipotético sin identificar (para «¿se puede sustituir una vacuna?»): solo lleva los rasgos indicados. */
export function medicamentoGenerico(
  rasgos: Partial<Pick<MedicamentoInfo, 'inmunologico' | 'biologico'>> = {},
): MedicamentoInfo {
  return {
    nregistro: '',
    nombre: 'Medicamento sin identificar',
    labtitular: null,
    receta: true,
    antibiotico: false,
    estupefaciente: false,
    psicotropo: false,
    inmunologico: false,
    biologico: false,
    usoHumano: false,
    formaId: null,
    viaIds: [],
    especieIds: [],
    atc: [],
    indicaciones: [],
    tiemposEspera: [],
    estado: 'autorizado',
    comerc: true,
    psum: null,
    notas: false,
    composicion: { pas: [], porCantidad: null, porUnidad: null },
    ...rasgos,
  };
}

export interface EntradaSimularSustituibilidad {
  prescrito: MedicamentoInfo;
  /** null = clase no indicada (se asume ordinaria y se bloquea la sustitución). */
  clasePrescripcion: ClasePrescripcion | null;
  rules: RulesBundle;
}

export function simularSustituibilidad(e: EntradaSimularSustituibilidad): ResultadoSimulacion {
  const r = sustitucionPermitida(e.prescrito, e.clasePrescripcion, e.rules.exclusiones.exclusiones);
  return {
    decision: r.permitida ? 'PERMITIDA' : 'NO_PERMITIDA',
    motivos: r.motivos.map((c) => motivoDe(c)),
    evidencias: {
      medicamento: e.prescrito.nombre,
      nregistro: e.prescrito.nregistro,
      siNoPermitida: r.permitida ? null : 'La línea pasa a pedido del medicamento prescrito.',
    },
    reglaVersion: e.rules.version,
    supuestos: {
      nregistro: e.prescrito.nregistro || null,
      inmunologico: e.prescrito.inmunologico,
      biologico: e.prescrito.biologico,
      clasePrescripcion: e.clasePrescripcion,
    },
  };
}

// ── Cambio de formato o concentración ────────────────────────────────────────

export interface EntradaSimularFormato {
  prescrito: { medicamento: MedicamentoInfo; presentacion: PresentacionInfo; envases: number };
  candidato: { medicamento: MedicamentoInfo; presentacion: PresentacionInfo };
  /** Nº de envases del candidato que se quiere dar; por defecto, los que más se acercan sin pasarse. */
  envasesCandidato: number | null;
  contexto: ContextoPrescripcion;
  /** ALLOW_PACK_SIZE_CHANGE. */
  permitirCambioFormato: boolean;
  rules: RulesBundle;
}

const motivoEq = (code: CodigoEquivalencia): MotivoSimulacion => ({ code, mensaje: textoEquivalencia(code) });

/** Regla de formato y concentración (SPEC §4.3.1): concentración ≤ y cantidad total de principio activo ≤ la prescrita. */
export function simularCambioFormato(e: EntradaSimularFormato): ResultadoSimulacion {
  const r = evaluarAlternativaFormato(e.prescrito, e.candidato, e.contexto, e.rules.equivalencia);
  const motivos: MotivoSimulacion[] = r.motivos.map(motivoEq);
  const avisos = r.avisos.map((c) => motivoDe(c));
  const envases = e.envasesCandidato ?? r.envasesPropuestos;
  const excede = r.valido ? validarEnvasesFormato(r, envases) : null;
  if (excede) motivos.push(motivoEq(excede));
  const cambia = r.tipo !== 'MISMA_PRESENTACION';
  const desactivado = cambia && !e.permitirCambioFormato;
  if (desactivado) {
    motivos.push({
      code: 'CAMBIO_FORMATO_DESACTIVADO',
      mensaje: 'En este establecimiento no se admite dispensar otra presentación distinta de la prescrita.',
    });
  }
  const valida = r.valido && !excede && !desactivado;
  return {
    decision: valida ? 'ALTERNATIVA_VALIDA' : 'ALTERNATIVA_NO_VALIDA',
    motivos: valida ? avisos : [...motivos, ...avisos],
    evidencias: {
      tipo: r.tipo,
      envasesPropuestos: r.envasesPropuestos,
      envasesEvaluados: envases,
      totalPrescrito: r.totalPrescrito?.toString() ?? null,
      totalPorEnvase: r.totalPorEnvase?.toString() ?? null,
      totalDispensado: r.totalPorEnvase ? r.totalPorEnvase.mul(envases).toString() : null,
      factorDosis: r.factorDosis?.toString() ?? null,
      otroLaboratorio: r.otroLaboratorio,
      notaAdministracion: valida ? notaAdministracion(r) : null,
    },
    reglaVersion: e.rules.version,
    supuestos: {
      prescrito: {
        nregistro: e.prescrito.medicamento.nregistro,
        cn: e.prescrito.presentacion.cn,
        envases: e.prescrito.envases,
      },
      candidato: { nregistro: e.candidato.medicamento.nregistro, cn: e.candidato.presentacion.cn },
      especieId: e.contexto.especieId,
      permitirCambioFormato: e.permitirCambioFormato,
    },
  };
}

// ── Equivalencia para sustitución ────────────────────────────────────────────

export interface NombresEquivalencia {
  formaPrescrito?: string | null | undefined;
  formaCandidato?: string | null | undefined;
  viasPrescrito?: string[] | null | undefined;
  viasCandidato?: string[] | null | undefined;
  especiesPrescrito?: string[] | null | undefined;
  especiesCandidato?: string[] | null | undefined;
  especieContexto?: string | null | undefined;
}

export interface EntradaSimularEquivalencia {
  prescrito: MedicamentoInfo;
  candidato: MedicamentoInfo;
  contexto: ContextoPrescripcion;
  rules: RulesBundle;
  nombres?: NombresEquivalencia | undefined;
}

function construirComparativa(
  prescrito: MedicamentoInfo,
  candidato: MedicamentoInfo,
  contexto: ContextoPrescripcion,
  r: ResultadoEquivalencia,
  nombres?: NombresEquivalencia,
): CriterioComparativaSustitucion[] {
  const pPas = prescrito.composicion.pas.map((pa) => pa.nombre).join(', ') || 'Sin principio activo';
  const cPas = candidato.composicion.pas.map((pa) => pa.nombre).join(', ') || 'Sin principio activo';
  const paCoincide = !r.motivos.includes('COMPOSICION_DISTINTA');

  let pConc =
    prescrito.composicion.pas
      .map((pa) => `${pa.cantidad ?? ''} ${pa.unidad ?? ''}`.trim())
      .filter(Boolean)
      .join(', ') || 'No especificada';
  let cConc =
    candidato.composicion.pas
      .map((pa) => `${pa.cantidad ?? ''} ${pa.unidad ?? ''}`.trim())
      .filter(Boolean)
      .join(', ') || 'No especificada';
  const concCoincide =
    !r.motivos.includes('CONCENTRACION_DISTINTA') && !r.motivos.includes('CANTIDAD_NO_NORMALIZABLE');

  if (concCoincide) {
    const nomP = prescrito.nombre ? concentracionDelNombre(prescrito.nombre) : null;
    const nomC = candidato.nombre ? concentracionDelNombre(candidato.nombre) : null;
    if (nomP && nomC && nomP.toLowerCase() === nomC.toLowerCase()) {
      pConc = nomP;
      cConc = nomC;
    }
  }

  const pForma =
    nombres?.formaPrescrito ?? (prescrito.formaId !== null ? `Forma #${prescrito.formaId}` : 'No especificada');
  const cForma =
    nombres?.formaCandidato ?? (candidato.formaId !== null ? `Forma #${candidato.formaId}` : 'No especificada');
  const formaCoincide = !r.motivos.includes('FORMA_DISTINTA');

  const pVias =
    nombres?.viasPrescrito?.join(', ') ??
    (prescrito.viaIds.length > 0 ? prescrito.viaIds.map((v) => `Vía #${v}`).join(', ') : 'No especificada');
  const cVias =
    nombres?.viasCandidato?.join(', ') ??
    (candidato.viaIds.length > 0 ? candidato.viaIds.map((v) => `Vía #${v}`).join(', ') : 'No especificada');
  const viaCoincide = !r.motivos.includes('VIA_NO_AUTORIZADA');

  const pEspecie =
    nombres?.especieContexto ??
    (nombres?.especiesPrescrito?.join(', ') ??
      (contexto.especieId !== null ? `Especie #${contexto.especieId}` : 'No especificada'));
  const cEspecie =
    nombres?.especiesCandidato?.join(', ') ??
    (candidato.especieIds.length > 0
      ? candidato.especieIds.map((e) => `Especie #${e}`).join(', ')
      : 'No especificada');
  const especieCoincide = !r.motivos.includes('ESPECIE_NO_AUTORIZADA');

  const esGenerica = esIndicacionGenerica(contexto.indicacion);
  const pInd = contexto.indicacion?.trim() || 'No especificada';
  let cInd = 'No autorizada para la indicación prescrita';
  const indCoincide = !r.motivos.includes('INDICACION_NO_COINCIDE');
  let indEstado: 'coincide' | 'discrepancia' | 'aviso' = indCoincide ? 'coincide' : 'discrepancia';
  let indDetalle: string | undefined;

  if (esGenerica) {
    indEstado = 'aviso';
    indDetalle = 'Indicación no especificada en receta: comprobar ficha técnica del sustituto';
    if (candidato.indicaciones.length > 0) {
      cInd = candidato.indicaciones.map((i) => i.texto).slice(0, 2).join('; ');
    } else {
      cInd = 'Consultar indicaciones autorizadas en ficha técnica';
    }
  } else if (r.indicacion === 'COINCIDE') {
    cInd = 'Autorizada para la misma indicación';
  } else if (r.indicacion === 'PROBABLE') {
    cInd = 'Indicación probable (requiere aprobación previa del garante)';
    indEstado = 'aviso';
    indDetalle = 'Indicación probable (requiere validación del garante)';
  } else if (candidato.indicaciones.length > 0) {
    cInd = candidato.indicaciones.map((i) => i.texto).slice(0, 2).join('; ');
    indDetalle = 'Indicación clínica no coincidente con las autorizadas';
  }

  let pTe = 'No aplica (animal de compañía)';
  let cTe = 'No aplica (animal de compañía)';
  let teCoincide = true;
  let teDetalle: string | undefined;
  if (contexto.especieProduccion) {
    pTe =
      prescrito.tiemposEspera.length > 0
        ? prescrito.tiemposEspera
            .map((t) => `${t.tejido ?? 'Tejido'}: ${t.dias !== null ? `${t.dias} días` : 'No aplica'}`)
            .join(', ')
        : 'Sin datos';
    cTe =
      candidato.tiemposEspera.length > 0
        ? candidato.tiemposEspera
            .map((t) => `${t.tejido ?? 'Tejido'}: ${t.dias !== null ? `${t.dias} días` : 'No aplica'}`)
            .join(', ')
        : 'Sin datos';
    teCoincide =
      !r.motivos.includes('TIEMPO_ESPERA_SUPERIOR') && !r.motivos.includes('TIEMPO_ESPERA_DESCONOCIDO');
    if (!teCoincide) {
      teDetalle = r.motivos.includes('TIEMPO_ESPERA_SUPERIOR')
        ? 'El tiempo de espera del candidato supera al del prescrito'
        : 'Tiempo de espera no comparable o desconocido';
    }
  }

  return [
    {
      criterio: 'Principio activo',
      prescrito: pPas,
      candidato: cPas,
      coincide: paCoincide,
      estado: paCoincide ? 'coincide' : 'discrepancia',
      ...(paCoincide ? {} : { detalle: 'Composición cualitativa en principios activos distinta' }),
    },
    {
      criterio: 'Concentración',
      prescrito: pConc,
      candidato: cConc,
      coincide: concCoincide,
      estado: concCoincide ? 'coincide' : 'discrepancia',
      ...(concCoincide ? {} : { detalle: 'Concentración o cantidad por unidad distinta' }),
    },
    {
      criterio: 'Forma farmacéutica',
      prescrito: pForma,
      candidato: cForma,
      coincide: formaCoincide,
      estado: formaCoincide ? 'coincide' : 'discrepancia',
      ...(formaCoincide ? {} : { detalle: 'Forma farmacéutica distinta' }),
    },
    {
      criterio: 'Vía de administración',
      prescrito: pVias,
      candidato: cVias,
      coincide: viaCoincide,
      estado: viaCoincide ? 'coincide' : 'discrepancia',
      ...(viaCoincide ? {} : { detalle: 'Vía de administración no autorizada en el candidato' }),
    },
    {
      criterio: 'Especie de destino',
      prescrito: pEspecie,
      candidato: cEspecie,
      coincide: especieCoincide,
      estado: especieCoincide ? 'coincide' : 'discrepancia',
      ...(especieCoincide ? {} : { detalle: 'Candidato no autorizado para la especie de la receta' }),
    },
    {
      criterio: 'Indicación',
      prescrito: pInd,
      candidato: cInd,
      coincide: indCoincide,
      estado: indEstado,
      ...(indDetalle ? { detalle: indDetalle } : {}),
    },
    {
      criterio: 'Tiempo de espera',
      prescrito: pTe,
      candidato: cTe,
      coincide: teCoincide,
      estado: teCoincide ? 'coincide' : 'discrepancia',
      ...(teDetalle ? { detalle: teDetalle } : {}),
    },
  ];
}

/** Equivalencia entre el medicamento prescrito y un candidato (SPEC §4.4.2). Todas las condiciones son obligatorias. */
export function simularEquivalencia(e: EntradaSimularEquivalencia): ResultadoSimulacion {
  const r = evaluarEquivalencia(e.prescrito, e.candidato, e.contexto, e.rules.equivalencia);
  const motivos = r.motivos.map(motivoEq);
  const comparativa = construirComparativa(e.prescrito, e.candidato, e.contexto, r, e.nombres);
  const esGenerica = esIndicacionGenerica(e.contexto.indicacion);
  return {
    decision: r.equivalente ? 'EQUIVALENTE' : 'NO_EQUIVALENTE',
    motivos:
      r.equivalente && r.requiereAprobacionPrevia
        ? [
            ...motivos,
            {
              code: 'REQUIERE_APROBACION_PREVIA',
              mensaje: esGenerica
                ? 'Indicación clínica no especificada: comprobar indicaciones autorizadas en la ficha técnica del sustituto.'
                : 'Hay que confirmar con el farmacéutico garante antes de sustituir.',
            },
          ]
        : motivos,
    evidencias: {
      indicacion: r.indicacion,
      revisarManual: r.revisarManual,
      requiereAprobacionPrevia: r.requiereAprobacionPrevia,
      comparativa,
    },
    reglaVersion: e.rules.version,
    supuestos: {
      prescrito: e.prescrito.nregistro,
      candidato: e.candidato.nregistro,
      especieId: e.contexto.especieId,
      especieProduccion: e.contexto.especieProduccion,
      indicacion: e.contexto.indicacion,
    },
  };
}
