import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  appendAudit,
  dispensacion,
  evidenciaStockRetrospectiva,
  gtinCn,
  pedidoPendiente,
  propietario,
  receta,
  recetaLinea,
  siwebVariantMap,
  sustitucion,
  MAESTRA,
  type DbOrTx,
} from '@mmx/db';
import {
  evaluarMovimientosRetrospectivos,
  incidencia,
  puedeDispensarSustitucion,
  transicionSustitucion,
  exigirMotivoLote,
  especieVentaSinReceta,
  planificarDispensacion,
  proponerLotes,
  dniNieValido,
  normalizarDni,
  parseFraccion,
  textoAnotacionDorso,
  textoResguardo,
  textoUnidadesDispensadas,
  validarUnidadesFraccion,
  validarEnvase,
  validarForzado,
  validarPropietario,
  validarVentaSinReceta,
  fechaEs,
  type Incidencia,
  type ResultadoDecision,
  type SolicitudForzado,
} from '@mmx/domain';
import {
  DomainError,
  type Canal,
  type CodigoIncidencia,
  type MetodoCaptura,
  type ConsultaStockRetrospectivoBody,
} from '@mmx/shared';
import { ahoraDe, hoyDe, politica, type AppDeps } from '../deps';
import { RecetasService, type ContextoPeticion } from './recetas';
import { estadoSustitucion } from './sustituciones';

export interface EnvaseDispensado {
  lote: string;
  caducidad: string | null;
  unidades: number;
  gtin: string | null;
  cnEscaneado: string | null;
  serie: string | null;
  metodoCaptura: MetodoCaptura;
}

export interface PropietarioDatos {
  nombre: string | null;
  movil: string | null;
  direccion: string | null;
  dni: string | null;
}

export interface SolicitudConReceta {
  recetaId: string;
  lineaOrden: number;
  cn: string;
  envases: EnvaseDispensado[];
  motivoLoteDistinto: string | null;
  forzado: SolicitudForzado | null;
  sustitucionId: string | null;
  confirmaCambioFormato: boolean;
  notaEntregadaTutor: boolean;
  confirmaDosisNoAjustable: boolean;
  /** Dispensación fraccionada: unidades de dosificación de un único envase. */
  fraccion: { unidadesForma: number } | null;
  dniRetira: string | null;
  propietario: PropietarioDatos | null;
  pendientes: { lineas: number[]; contactoTutor: string | null } | null;
  /** Modo retrospectivo para formación con recetas del pasado (D-14). */
  modo?: 'en_vivo' | 'retrospectivo' | null | undefined;
  fechaOriginal?: string | null | undefined;
}

export interface SolicitudSinReceta {
  canal: Canal;
  cn: string;
  envases: EnvaseDispensado[];
  motivoLoteDistinto: string | null;
  forzado: SolicitudForzado | null;
  especie: string | null;
  propietario: PropietarioDatos | null;
  referenciaPedido: string | null;
  modo?: 'en_vivo' | 'retrospectivo' | null | undefined;
  fechaOriginal?: string | null | undefined;
}

const codigos = (incs: Incidencia[], sev: Incidencia['severidad']) => [
  ...new Set(incs.filter((i) => i.severidad === sev).map((i) => i.code)),
];

export class DispensacionesService {
  private readonly recetas: RecetasService;
  constructor(private readonly d: AppDeps) {
    this.recetas = new RecetasService(d);
  }

  /** Unidades de dosificación ya entregadas en fracciones para la línea (sin anuladas). */
  private async unidadesFormaYaDispensadas(tx: DbOrTx, recetaLineaId: string): Promise<number> {
    const r = await tx.execute(sql`
      select coalesce(sum(d.unidades_forma), 0)::int as n from dispensacion d
      where d.receta_linea_id = ${recetaLineaId} and d.anula_dispensacion_id is null
        and not exists (select 1 from dispensacion a where a.anula_dispensacion_id = d.id)`);
    const rows = (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  private async unidadesYaDispensadas(tx: DbOrTx, recetaLineaId: string): Promise<number> {
    const r = await tx.execute(sql`
      select coalesce(sum(d.unidades), 0)::int as n from dispensacion d
      where d.receta_linea_id = ${recetaLineaId} and d.anula_dispensacion_id is null
        and not exists (select 1 from dispensacion a where a.anula_dispensacion_id = d.id)`);
    const rows = (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  private async seriesDispensadas(cn: string): Promise<string[]> {
    const rows = await this.d.db
      .select({ s: dispensacion.serial })
      .from(dispensacion)
      .where(and(eq(dispensacion.cn, cn), isNull(dispensacion.anulaDispensacionId)));
    return rows.map((r) => r.s).filter((s): s is string => !!s);
  }

  /** Validaciones de escaneo de todos los envases (SPEC §4.6). */
  private async validarEnvases(p: {
    cn: string;
    envases: EnvaseDispensado[];
    loteRecomendado: string | null;
    motivo: string | null;
    yaDispensadas: number;
    max: number;
    psicotropo: boolean;
    linea?: number;
  }): Promise<Incidencia[]> {
    const series = await this.seriesDispensadas(p.cn);
    const out: Incidencia[] = [];
    let acumuladas = p.yaDispensadas;
    for (const e of p.envases) {
      const incs = validarEnvase({
        ...(p.linea !== undefined ? { linea: p.linea } : {}),
        cnSeleccionado: p.cn,
        envase: { cn: e.cnEscaneado, lote: e.lote, caducidad: e.caducidad, serie: e.serie },
        loteRecomendado: p.loteRecomendado,
        motivoLoteDistinto: p.motivo,
        unidadesYaDispensadas: acumuladas,
        unidadesAhora: e.unidades,
        unidadesMax: p.max,
        seriesYaDispensadas: series,
        psicotropo: p.psicotropo,
        hoy: hoyDe(this.d),
        politica: politica(this.d),
      });
      acumuladas += e.unidades;
      for (const i of incs)
        if (!out.some((x) => x.code === i.code && JSON.stringify(x.params) === JSON.stringify(i.params)))
          out.push(i);
    }
    exigirMotivoLote(out, p.motivo);
    return out;
  }

  /**
   * Comprueba los bloqueos del escaneo: los duros nunca se pueden forzar; los de forma (grupo
   * "producto no válido") exigen que el forzado los incluya junto con los de la receta.
   */
  private comprobarBloqueos(
    lineaIncs: Incidencia[],
    escaneoIncs: Incidencia[],
    forzado: SolicitudForzado | null,
  ): string[] {
    const duros = codigos(escaneoIncs, 'BLOQUEANTE_DURO');
    if (duros.length)
      throw new DomainError('DISPENSACION_BLOQUEADA', 'Bloqueo no forzable', { codigos: duros });
    const forma = [
      ...new Set([...codigos(lineaIncs, 'BLOQUEANTE_FORMA'), ...codigos(escaneoIncs, 'BLOQUEANTE_FORMA')]),
    ];
    if (!forma.length) return [];
    if (!forzado)
      throw new DomainError('DISPENSACION_BLOQUEADA', 'Hay defectos: hace falta forzar', {
        forzables: forma,
      });
    return validarForzado([...lineaIncs, ...escaneoIncs], forzado).codigos;
  }

  async dispensarConReceta(s: SolicitudConReceta, c: ContextoPeticion) {
    if (!s.envases.length) throw new DomainError('VALIDACION', 'Indica al menos un envase');
    if (s.modo === 'retrospectivo') {
      if (this.d.config.RETROSPECTIVE_DISPENSATION_MODE !== 'enabled') {
        throw new DomainError('MODO_RETROSPECTIVO_DESHABILITADO');
      }
      if (!s.fechaOriginal) {
        throw new DomainError('VALIDACION', 'Indica la fecha original en modo retrospectivo');
      }
    }
    // 1. Evaluación sin forzado para conocer los defectos de la línea; con forzado si procede.
    const ev0 = await this.recetas.evaluar(s.recetaId, c, {}, false);
    const l0 = ev0.lineas.find((x) => x.orden === s.lineaOrden);
    if (!l0) throw new DomainError('NO_ENCONTRADO', 'Línea de receta no encontrada');
    // Pedir forzar con un bloqueo duro presente se rechaza explícitamente (nunca se fuerza un BLOQUEANTE_DURO).
    if (s.forzado && l0.incidencias.some((i) => i.severidad === 'BLOQUEANTE_DURO'))
      validarForzado(l0.incidencias, s.forzado);
    const formaLinea = codigos(l0.incidencias, 'BLOQUEANTE_FORMA');
    const ev =
      s.forzado && formaLinea.length
        ? await this.recetas.evaluar(
            s.recetaId,
            c,
            {
              [s.lineaOrden]: {
                ...s.forzado,
                codigos: s.forzado.codigos.filter((x) => formaLinea.includes(x)),
              },
            },
            false,
          )
        : ev0;
    const linea = ev.lineas.find((x) => x.orden === s.lineaOrden)!;
    const r: ResultadoDecision = linea.resultado;
    if (!['DISPENSAR', 'DISPENSAR_CON_AVISO', 'SUSTITUIR'].includes(r.decision)) {
      throw new DomainError('DISPENSACION_BLOQUEADA', `La línea está en ${r.decision}`, {
        decision: r.decision,
        codigos: r.motivos.filter((m) => m.severidad !== 'AVISO').map((m) => m.code),
        forzables: r.evidencias.forzable ? codigos(linea.incidencias, 'BLOQUEANTE_FORMA') : [],
      });
    }
    const [lineaDb] = await this.d.db
      .select()
      .from(recetaLinea)
      .where(and(eq(recetaLinea.recetaId, s.recetaId), eq(recetaLinea.orden, s.lineaOrden)));
    if (!lineaDb) throw new DomainError('NO_ENCONTRADO');
    const [rec] = await this.d.db.select().from(receta).where(eq(receta.id, s.recetaId));
    const conf = (await this.recetas.obtener(s.recetaId)).confirmacion!;

    // 2. Presentación permitida y tope de unidades según la decisión.
    let cnPermitido: string;
    let max: number;
    let loteRecomendado: string | null = null;
    let sust: typeof sustitucion.$inferSelect | null = null;
    let cambioFormato = false;
    let cambioConcentracion = false;
    let nota: string | null = null;
    const envasesPrescritos = lineaDb.cantidadEnvases ?? 1;
    if (r.decision === 'DISPENSAR') {
      cnPermitido = r.evidencias.cn as string;
      max = envasesPrescritos;
      loteRecomendado = r.evidencias.lotes?.recomendado?.lote ?? null;
    } else if (r.decision === 'DISPENSAR_CON_AVISO') {
      const alt = r.evidencias.alternativaFormato!;
      if (!s.confirmaCambioFormato)
        throw new DomainError('VALIDACION', 'Confirma el cambio de formato con el cliente', {
          requiere: 'confirmaCambioFormato',
        });
      cambioFormato = alt.formato.tipo === 'CAMBIO_FORMATO';
      cambioConcentracion = alt.formato.tipo === 'CAMBIO_CONCENTRACION';
      if (cambioConcentracion && !s.notaEntregadaTutor)
        throw new DomainError('VALIDACION', 'Entrega la nota de administración al tutor', {
          requiere: 'notaEntregadaTutor',
        });
      if (alt.formato.avisos.includes('DOSIS_NO_AJUSTABLE') && !s.confirmaDosisNoAjustable) {
        throw new DomainError(
          'VALIDACION',
          'Confirma expresamente que la dosis no se ajusta con unidades enteras',
          { requiere: 'confirmaDosisNoAjustable' },
        );
      }
      cnPermitido = alt.cn;
      max = alt.formato.envasesPropuestos;
      loteRecomendado = alt.lotes.recomendado?.lote ?? null;
      nota = alt.nota;
    } else {
      if (!s.sustitucionId)
        throw new DomainError(
          'SUSTITUCION_REQUISITOS',
          'Inicia la sustitución y registra el consentimiento y el aviso',
        );
      [sust] = (await this.d.db.select().from(sustitucion).where(eq(sustitucion.id, s.sustitucionId))) as [
        typeof sustitucion.$inferSelect,
      ];
      if (!sust || sust.recetaLineaId !== lineaDb.id)
        throw new DomainError('NO_ENCONTRADO', 'Sustitución no encontrada');
      const st = estadoSustitucion(sust);
      if (!puedeDispensarSustitucion(st)) throw new DomainError('SUSTITUCION_REQUISITOS');
      cnPermitido = sust.cnPropuesto;
      max = (sust.equivalencia as { envases?: number }).envases ?? envasesPrescritos;
      const st2 = await this.d.stock.lotes(cnPermitido, null);
      loteRecomendado =
        proponerLotes({
          lotes: st2.lotes,
          unidades: 1,
          hoy: hoyDe(this.d),
          duracionDias: lineaDb.duracionDias,
        }).recomendado?.lote ?? null;
      nota = (sust.equivalencia as { nota?: string | null }).nota ?? null;
    }
    if (s.cn !== cnPermitido) {
      throw new DomainError('VALIDACION', 'La presentación no es la propuesta para esta línea', {
        cnPermitido,
      });
    }
    const pres = await this.recetas.med.presentacion(cnPermitido);
    const med = pres ? await this.recetas.med.info(pres.nregistro) : null;
    if (!pres || !med) throw new DomainError('NO_ENCONTRADO');

    // 2b. Dispensación fraccionada (guía §5.9): solo la presentación prescrita, autorizada para fraccionar,
    // en múltiplos de la fracción del laboratorio y sin superar las unidades prescritas pendientes.
    const yaForma = await this.unidadesFormaYaDispensadas(this.d.db, lineaDb.id);
    if (s.fraccion) {
      if (r.decision !== 'DISPENSAR')
        throw new DomainError('FRACCION_NO_VALIDA', 'Solo se fracciona la presentación prescrita', {
          motivo: 'SOLO_PRESCRITA',
        });
      if (s.envases.length !== 1)
        throw new DomainError('FRACCION_NO_VALIDA', 'Una fracción sale de un único envase', {
          motivo: 'UN_ENVASE',
        });
      if (lineaDb.unidadesFormaPrescritas === null) {
        throw new DomainError('FRACCION_NO_VALIDA', 'La receta no indica unidades de dosificación', {
          motivo: 'SIN_UNIDADES_PRESCRITAS',
        });
      }
      const v = validarUnidadesFraccion(
        pres,
        s.fraccion.unidadesForma,
        lineaDb.unidadesFormaPrescritas - yaForma,
      );
      if (!v.valida)
        throw new DomainError('FRACCION_NO_VALIDA', `Fracción no válida: ${v.motivo}`, {
          motivo: v.motivo,
          fraccion: parseFraccion(pres.fracciones)?.unidades ?? null,
        });
    }

    // 2c. Psicótropos: identidad de quien retira con DNI/NIE válido (se anota cifrado).
    if (med.psicotropo && !dniNieValido(s.dniRetira))
      throw new DomainError('DNI_RETIRA_OBLIGATORIO', 'Psicótropo: falta el DNI/NIE válido de quien retira');

    // 3. Escaneo y forzado combinado (receta + envase).
    const ya = await this.unidadesYaDispensadas(this.d.db, lineaDb.id);
    const escaneo = await this.validarEnvases({
      cn: cnPermitido,
      envases: s.envases,
      loteRecomendado,
      motivo: s.motivoLoteDistinto,
      yaDispensadas: ya,
      max,
      psicotropo: med.psicotropo,
      linea: s.lineaOrden,
    });
    const forzados = this.comprobarBloqueos(linea.incidencias, escaneo, s.forzado);
    if (s.propietario) validarPropietario('presencial', s.propietario);
    if (s.pendientes?.lineas.length) {
      const plan = planificarDispensacion(
        ev.lineas.map((x) => ({
          orden: x.orden,
          decision: x.resultado.decision,
          dispensarAhora: x.orden === s.lineaOrden,
        })),
        this.d.config.ALLOW_PARTIAL_DISPENSATION,
        conf.tipo,
      );
      if (!plan.permitido)
        throw new DomainError(
          'VALIDACION',
          'La dispensación parcial está desactivada (ALLOW_PARTIAL_DISPENSATION=false)',
        );
    }

    const forma = await this.recetas.med.nombreMaestra(MAESTRA.FORMAS, med.formaId);
    const especie =
      conf.especie.texto ??
      (await this.recetas.med.nombresEspecies(conf.especie.especieId ? [conf.especie.especieId] : [])).join(
        ', ',
      );
    const ahora = ahoraDe(this.d);
    const avisos = [
      ...r.motivos.filter((m) => m.severidad === 'AVISO').map((m) => m.code),
      ...escaneo.filter((i) => i.severidad === 'AVISO').map((i) => i.code),
    ];
    const prescrito =
      r.decision === 'SUSTITUIR' || r.decision === 'DISPENSAR_CON_AVISO'
        ? await this.recetas.med.presentacion(lineaDb.cnPrescrito ?? '')
        : null;

    const ids = await this.d.db.transaction(async (tx) => {
      const propietarioId = s.propietario ? await this.guardarPropietario(tx, s.propietario, c) : null;
      const out: string[] = [];
      for (const e of s.envases) {
        const [row] = await tx
          .insert(dispensacion)
          .values({
            recetaLineaId: lineaDb.id,
            recetaId: s.recetaId,
            canal: 'presencial',
            conReceta: true,
            cn: cnPermitido,
            nregistro: med.nregistro,
            nombreFarmaco: pres.nombre,
            principioActivoTxt: this.recetas.med.textoPrincipiosActivos(med),
            formaTxt: forma,
            especieTxt: especie || null,
            lote: e.lote,
            caducidad: e.caducidad,
            // En fraccionada no se entrega ningún envase completo: cuentan las unidades de dosificación.
            unidades: s.fraccion ? 0 : e.unidades,
            unidadesForma: s.fraccion?.unidadesForma ?? null,
            unidadesTexto: s.fraccion
              ? textoUnidadesDispensadas(pres, {
                  unidadesForma: s.fraccion.unidadesForma,
                  unidad: parseFraccion(pres.fracciones)?.unidad ?? pres.unidadContenido ?? 'unidad',
                })
              : textoUnidadesDispensadas(pres, { envases: e.unidades }),
            dniRetiraEnc: med.psicotropo ? this.d.cipher.encrypt(normalizarDni(s.dniRetira as string)) : null,
            gtin: e.gtin,
            serial: e.serie,
            metodoCaptura: e.metodoCaptura,
            loteFefoRecomendado: loteRecomendado,
            motivoLoteDistinto: loteRecomendado && e.lote !== loteRecomendado ? s.motivoLoteDistinto : null,
            esSustitucion: r.decision === 'SUSTITUIR',
            cnPrescrito: lineaDb.cnPrescrito,
            nombrePrescrito: prescrito?.nombre ?? null,
            sustitucionId: sust?.id ?? null,
            cambioFormato,
            cambioConcentracion,
            forzado: forzados.length > 0,
            defectosForzados: forzados,
            motivoForzado: forzados.length ? (s.forzado?.motivo.trim() ?? null) : null,
            avisos: [...new Set(avisos)] as never,
            propietarioId,
            procedimientoVersion: sust?.procedimientoVersion ?? null,
            reglaVersion: r.reglaVersion,
            empleado: c.usuario.id,
            fechaVenta: ahora,
            modo: s.modo ?? 'en_vivo',
            fechaOriginal: s.modo === 'retrospectivo' && s.fechaOriginal ? s.fechaOriginal : null,
          })
          .returning({ id: dispensacion.id });
        out.push(row!.id);
        if (s.modo === 'retrospectivo' && s.fechaOriginal) {
          await tx.insert(evidenciaStockRetrospectiva).values({
            dispensacionId: row!.id,
            cn: cnPermitido,
            fechaOriginal: s.fechaOriginal,
            movimientosConsultados: [],
            unidadesRequeridas: e.unidades,
            unidadesEncontradas: e.unidades,
            resultado: 'OK',
            forzado: forzados.length > 0,
            motivoForzado: forzados.length ? (s.forzado?.motivo.trim() ?? null) : null,
          });
        }
        if (e.gtin && (e.cnEscaneado === null || e.cnEscaneado === cnPermitido)) {
          // Tabla aprendida GTIN → CN, confirmada por una persona al dispensar (SPEC §4.6).
          await tx
            .insert(gtinCn)
            .values({ gtin: e.gtin, cn: cnPermitido, confirmadoPor: c.usuario.id, confirmadoAt: ahora })
            .onConflictDoNothing();
        }
      }
      const total = ya + (s.fraccion ? 0 : s.envases.reduce((a, e) => a + e.unidades, 0));
      const totalForma = yaForma + (s.fraccion?.unidadesForma ?? 0);
      const completa =
        s.fraccion || yaForma > 0
          ? totalForma >= (lineaDb.unidadesFormaPrescritas ?? Infinity) || total >= max
          : total >= max;
      await tx
        .update(recetaLinea)
        .set({ estado: completa ? 'DISPENSADA' : 'PENDIENTE_ENTREGA' })
        .where(eq(recetaLinea.id, lineaDb.id));
      for (const orden of s.pendientes?.lineas ?? []) {
        if (orden === s.lineaOrden) continue;
        const [lp] = await tx
          .select()
          .from(recetaLinea)
          .where(and(eq(recetaLinea.recetaId, s.recetaId), eq(recetaLinea.orden, orden)));
        if (!lp || lp.estado === 'DISPENSADA') continue;
        await tx.update(recetaLinea).set({ estado: 'PENDIENTE_ENTREGA' }).where(eq(recetaLinea.id, lp.id));
        if (lp.cnPrescrito) {
          await tx.insert(pedidoPendiente).values({
            cn: lp.cnPrescrito,
            nregistro: lp.nregistro,
            unidades: lp.cantidadEnvases ?? 1,
            motivo: 'Dispensación parcial: receta retenida',
            recetaLineaId: lp.id,
            contactoTutorEnc: this.d.cipher.encrypt(s.pendientes?.contactoTutor ?? null),
            creadoPor: c.usuario.id,
          });
        }
      }
      const lineas = await tx
        .select({ estado: recetaLinea.estado })
        .from(recetaLinea)
        .where(eq(recetaLinea.recetaId, s.recetaId));
      await tx
        .update(receta)
        .set({
          estado: lineas.every((x) => x.estado === 'DISPENSADA') ? 'DISPENSADA' : 'DISPENSADA_PARCIAL',
          primeraDispensacionAt: rec?.primeraDispensacionAt ?? ahora,
        })
        .where(eq(receta.id, s.recetaId));
      if (sust) {
        const st = transicionSustitucion(
          estadoSustitucion(sust),
          { tipo: 'DISPENSAR' },
          c.usuario.roles[0] ?? 'empleado',
        );
        await tx
          .update(sustitucion)
          .set({
            estado: st.estado,
            historial: [
              ...((sust.historial as unknown[]) ?? []),
              { estado: st.estado, por: c.usuario.id, at: ahora.toISOString(), dispensaciones: out },
            ] as never,
          })
          .where(eq(sustitucion.id, sust.id));
      }
      await appendAudit(tx, {
        actor: c.usuario.id,
        accion: 'dispensar',
        entidad: 'receta_linea',
        entidadId: lineaDb.id,
        despues: {
          dispensaciones: out,
          cn: cnPermitido,
          decision: r.decision,
          forzado: forzados,
          lotes: s.envases.map((e) => e.lote),
        },
        ip: c.ip,
        userAgent: c.userAgent,
      });
      return out;
    });

    const apartar = r.decision === 'SUSTITUIR' || forzados.length > 0 || cambioFormato || cambioConcentracion;
    const pendientes = (s.pendientes?.lineas ?? []).filter((o) => o !== s.lineaOrden);
    return {
      dispensaciones: ids,
      recordatorioTpv: s.envases.map((e) => ({
        cn: cnPermitido,
        lote: e.lote,
        unidades: e.unidades,
        texto: `Cobrar en el TPV seleccionando el lote ${e.lote}`,
      })),
      avisos: [...new Set(avisos)],
      forzado: forzados,
      apartarReceta: apartar
        ? {
            // El garante no usa la app: revisa y firma sobre el papel y el reporte semanal.
            motivo:
              r.decision === 'SUSTITUIR'
                ? 'Separar la receta para la firma del garante en la anotación del dorso; después registra la firma en Pendientes'
                : forzados.length
                  ? 'Receta con defecto forzado: sepárala para la revisión del garante (figura en el reporte semanal)'
                  : 'Cambio de formato: separa la receta para la revisión del garante (figura en el reporte semanal)',
            etiqueta:
              r.decision === 'SUSTITUIR'
                ? textoAnotacionDorso({
                    nombre: pres.nombre,
                    cn: cnPermitido,
                    lote: s.envases.map((e) => e.lote).join(', '),
                    fecha: fechaEs(hoyDe(this.d)),
                  })
                : null,
          }
        : null,
      notaAdministracion: nota,
      resguardo: pendientes.length
        ? textoResguardo({
            numeroReceta: conf.numero,
            fecha: fechaEs(hoyDe(this.d)),
            telefonoFarmacia: this.d.telefonoFarmacia,
            pendientes: (
              await this.d.db
                .select()
                .from(recetaLinea)
                .where(and(eq(recetaLinea.recetaId, s.recetaId), inArray(recetaLinea.orden, pendientes)))
            ).map((l) => ({
              nombre: l.textoMedicamento ?? l.textoPrincipioActivo ?? 'Medicamento',
              unidades: l.cantidadEnvases ?? 1,
            })),
          })
        : null,
    };
  }

  private async guardarPropietario(tx: DbOrTx, p: PropietarioDatos, c: ContextoPeticion): Promise<string> {
    const [row] = await tx
      .insert(propietario)
      .values({
        nombreEnc: this.d.cipher.encrypt(p.nombre),
        movilEnc: this.d.cipher.encrypt(p.movil),
        dniEnc: this.d.cipher.encrypt(p.dni),
        direccionEnc: this.d.cipher.encrypt(p.direccion),
        dniHash: this.d.cipher.blindIndex(p.dni),
        createdBy: c.usuario.id,
      })
      .returning({ id: propietario.id });
    return row!.id;
  }

  /** Venta sin receta presencial y pedidos online (SPEC §4.7). */
  async dispensarSinReceta(s: SolicitudSinReceta, c: ContextoPeticion) {
    if (s.modo === 'retrospectivo') {
      if (this.d.config.RETROSPECTIVE_DISPENSATION_MODE !== 'enabled') {
        throw new DomainError('MODO_RETROSPECTIVO_DESHABILITADO');
      }
      if (!s.fechaOriginal) {
        throw new DomainError('VALIDACION', 'Indica la fecha original en modo retrospectivo');
      }
    }
    if (!s.envases.length) throw new DomainError('VALIDACION', 'Indica al menos un envase');
    const pres = await this.recetas.med.presentacion(s.cn);
    const med = pres ? await this.recetas.med.info(pres.nregistro) : null;
    if (!pres || !med)
      throw new DomainError('MEDICAMENTO_NO_EN_SISTEMA', 'CN no encontrado en la caché de CIMAVet');
    const incs = validarVentaSinReceta(s.canal, med, politica(this.d));
    const duros = codigos(incs, 'BLOQUEANTE_DURO');
    if (duros.length)
      throw new DomainError('DISPENSACION_BLOQUEADA', 'Medicamento no dispensable sin receta', {
        codigos: duros,
      });
    validarPropietario(s.canal, s.propietario);
    const stock = await this.d.stock.lotes(s.cn, med);
    const recomendado =
      stock.estado === 'OK'
        ? (proponerLotes({ lotes: stock.lotes, unidades: 1, hoy: hoyDe(this.d), duracionDias: null })
            .recomendado?.lote ?? null)
        : null;
    const productoIncs: Incidencia[] = [];
    if (med.estado === 'suspendido' || med.estado === 'revocado' || pres.estado !== 'autorizado') {
      productoIncs.push(
        incidencia(
          med.estado === 'revocado' ? 'MEDICAMENTO_REVOCADO' : 'MEDICAMENTO_SUSPENDIDO',
          politica(this.d),
          { params: { medicamento: med.nombre } },
        ),
      );
    }
    const total = s.envases.reduce((a, e) => a + e.unidades, 0);
    const escaneo = await this.validarEnvases({
      cn: s.cn,
      envases: s.envases,
      loteRecomendado: recomendado,
      motivo: s.motivoLoteDistinto,
      yaDispensadas: 0,
      max: total,
      psicotropo: med.psicotropo,
    });
    const forzados = this.comprobarBloqueos(productoIncs, escaneo, s.forzado);
    const forma = await this.recetas.med.nombreMaestra(MAESTRA.FORMAS, med.formaId);
    const especie = especieVentaSinReceta(s.especie, await this.recetas.med.nombresEspecies(med.especieIds));
    const ahora = ahoraDe(this.d);
    const ids = await this.d.db.transaction(async (tx) => {
      const propietarioId =
        s.propietario && Object.values(s.propietario).some(Boolean)
          ? await this.guardarPropietario(tx, s.propietario, c)
          : null;
      const out: string[] = [];
      for (const e of s.envases) {
        const [row] = await tx
          .insert(dispensacion)
          .values({
            canal: s.canal,
            conReceta: false,
            cn: s.cn,
            nregistro: med.nregistro,
            nombreFarmaco: pres.nombre,
            principioActivoTxt: this.recetas.med.textoPrincipiosActivos(med),
            formaTxt: forma,
            especieTxt: especie,
            lote: e.lote,
            caducidad: e.caducidad,
            unidades: e.unidades,
            unidadesTexto: textoUnidadesDispensadas(pres, { envases: e.unidades }),
            gtin: e.gtin,
            serial: e.serie,
            metodoCaptura: e.metodoCaptura,
            loteFefoRecomendado: recomendado,
            motivoLoteDistinto: recomendado && e.lote !== recomendado ? s.motivoLoteDistinto : null,
            forzado: forzados.length > 0,
            defectosForzados: forzados,
            motivoForzado: forzados.length ? (s.forzado?.motivo.trim() ?? null) : null,
            avisos: escaneo.filter((i) => i.severidad === 'AVISO').map((i) => i.code) as never,
            propietarioId,
            referenciaPedido: s.referenciaPedido,
            reglaVersion: this.d.rules.bundle.version,
            empleado: c.usuario.id,
            fechaVenta: ahora,
            modo: s.modo ?? 'en_vivo',
            fechaOriginal: s.modo === 'retrospectivo' && s.fechaOriginal ? s.fechaOriginal : null,
          })
          .returning({ id: dispensacion.id });
        out.push(row!.id);
        if (s.modo === 'retrospectivo' && s.fechaOriginal) {
          await tx.insert(evidenciaStockRetrospectiva).values({
            dispensacionId: row!.id,
            cn: s.cn,
            fechaOriginal: s.fechaOriginal,
            movimientosConsultados: [],
            unidadesRequeridas: e.unidades,
            unidadesEncontradas: e.unidades,
            resultado: 'OK',
            forzado: forzados.length > 0,
            motivoForzado: forzados.length ? (s.forzado?.motivo.trim() ?? null) : null,
          });
        }
      }
      await appendAudit(tx, {
        actor: c.usuario.id,
        accion: 'dispensar_sin_receta',
        entidad: 'dispensacion',
        entidadId: out[0] ?? null,
        despues: { canal: s.canal, cn: s.cn, dispensaciones: out, forzado: forzados },
        ip: c.ip,
        userAgent: c.userAgent,
      });
      return out;
    });
    return {
      dispensaciones: ids,
      recordatorioTpv: s.envases.map((e) => ({
        cn: s.cn,
        lote: e.lote,
        unidades: e.unidades,
        texto: `Cobrar en el TPV seleccionando el lote ${e.lote}`,
      })),
      avisos: escaneo.filter((i) => i.severidad === 'AVISO').map((i) => i.code),
      forzado: forzados,
    };
  }

  /** Anulación (garante): contramovimiento, nunca UPDATE (SPEC §0.2). */
  async anular(id: string, motivo: string, c: ContextoPeticion) {
    if (motivo.trim().length < 10) throw new DomainError('VALIDACION', 'Indica el motivo de la anulación');
    const [o] = await this.d.db.select().from(dispensacion).where(eq(dispensacion.id, id));
    if (!o || o.anulaDispensacionId) throw new DomainError('NO_ENCONTRADO');
    const ahora = ahoraDe(this.d);
    try {
      return await this.d.db.transaction(async (tx) => {
        const { id: _id, createdAt: _c, ...copia } = o;
        void _id;
        void _c;
        const [a] = await tx
          .insert(dispensacion)
          .values({
            ...copia,
            anulaDispensacionId: o.id,
            motivoAnulacion: motivo.trim(),
            empleado: c.usuario.id,
            fechaVenta: ahora,
          })
          .returning({ id: dispensacion.id });
        if (o.recetaLineaId) {
          const quedan = await this.unidadesYaDispensadas(tx, o.recetaLineaId);
          if (quedan === 0)
            await tx
              .update(recetaLinea)
              .set({ estado: 'PENDIENTE' })
              .where(eq(recetaLinea.id, o.recetaLineaId));
        }
        await appendAudit(tx, {
          actor: c.usuario.id,
          accion: 'anular_dispensacion',
          entidad: 'dispensacion',
          entidadId: o.id,
          despues: { anulacion: a!.id, motivo: motivo.trim() },
          ip: c.ip,
          userAgent: c.userAgent,
        });
        return { anulacionId: a!.id };
      });
    } catch (e) {
      if (/unique|duplicate/i.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message)))
        throw new DomainError('ANULACION_DUPLICADA');
      throw e;
    }
  }

  /** Consulta movimientos de stock históricos para una dispensación retrospectiva (D-14). */
  async consultarMovimientosRetrospectivos(body: ConsultaStockRetrospectivoBody, _c: ContextoPeticion) {
    if (this.d.config.RETROSPECTIVE_DISPENSATION_MODE !== 'enabled') {
      throw new DomainError('MODO_RETROSPECTIVO_DESHABILITADO');
    }

    const [mapa] = await this.d.db
      .select({ variantId: siwebVariantMap.variantId })
      .from(siwebVariantMap)
      .where(eq(siwebVariantMap.cn, body.cn))
      .limit(1);

    const variantId = mapa?.variantId ?? null;
    let movimientosRaw: Array<{
      id: number;
      variant_id: number;
      quantity: number;
      reason: string;
      reference_number?: string | null;
    }> = [];

    if (this.d.siweb?.client && variantId) {
      try {
        const res = await this.d.siweb.client.movements({
          variant_id: variantId,
          date_from: body.fechaOriginal,
          date_to: body.fechaOriginal,
          reason: 'sale_shipment',
        });
        movimientosRaw = res.map((m) => ({
          id: m.id,
          variant_id: m.variant_id,
          quantity: m.quantity,
          reason: m.reason,
          reference_number: m.reference_id ? String(m.reference_id) : null,
        }));
      } catch {
        // En caso de fallo de red con Siweb360, continúa con movimientos vacíos
      }
    }

    const simple = movimientosRaw.map((m) => ({
      id: m.id,
      variantId: m.variant_id,
      quantity: m.quantity,
      reason: m.reason,
      date: body.fechaOriginal,
    }));

    const resEvaluacion = evaluarMovimientosRetrospectivos({
      cn: body.cn,
      fechaOriginal: body.fechaOriginal,
      hoy: hoyDe(this.d),
      maxAgeDays: this.d.config.RETROSPECTIVE_MAX_AGE_DAYS,
      unidadesRequeridas: body.unidadesRequeridas,
      movimientos: simple,
      pol: politica(this.d),
    });

    return {
      estado: resEvaluacion.estado,
      cn: body.cn,
      fechaOriginal: body.fechaOriginal,
      unidadesEncontradas: resEvaluacion.unidadesEncontradas,
      unidadesRequeridas: body.unidadesRequeridas,
      movimientos: movimientosRaw,
    };
  }

  /** Códigos de incidencia de una dispensación (para la UI). */
  static codigosDe(incs: Incidencia[]): CodigoIncidencia[] {
    return incs.map((i) => i.code);
  }
}
