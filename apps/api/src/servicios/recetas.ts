import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import {
  appendAudit,
  dispensacion,
  dispensacionVigente,
  importacion,
  salidaImportada,
  plataformaRecetaElectronica,
  receta,
  recetaImagen,
  recetaLinea,
  reglaVersion,
  sustitucion,
  veterinario,
  MAESTRA,
  type DbOrTx,
} from '@mmx/db';
import {
  calcularValidez,
  decidirLinea,
  esAntimicrobiano,
  evaluarReceta,
  excluidoValidezAmpliada,
  fechaReferenciaValidez,
  recetaCaducada,
  textoPlazo,
  prescripcionVirtual,
  resumenReceta,
  validarEleccionSoloPA,
  validarForzado,
  type ForzadoAceptado,
  type Incidencia,
  type ResultadoDecision,
  type SolicitudForzado,
  type StockPorCn,
  parseFraccion,
} from '@mmx/domain';
import { borradorDesdeExtraccion } from '@mmx/extraction';
import { identificarMedicamentos } from './identificacion';
import type { ExtractionResult } from '@mmx/shared';
import {
  DomainError,
  PeticionSobreescribirSustitucion,
  type PeticionAltaManual,
  RecetaConfirmada,
  enParalelo,
  type RecetaConfirmadaInput,
} from '@mmx/shared';
import { ahoraDe, hoyDe, politica, type AppDeps } from '../deps';
import { sha256 } from '@mmx/reports';
import type { Usuario } from '../plugins/auth';
import { MedicamentosService } from './medicamentos';
import { procedimientoVigente } from './sustituciones';

/**
 * Alta manual de recetas (specs/011): solo con `MANUAL_PRESCRIPTION_ENTRY=enabled` y para la veterinaria
 * responsable. Se comprueba en la API en cada operación, no solo en la interfaz.
 */
export function exigirAltaManual(d: AppDeps, u: Usuario) {
  if (d.config.MANUAL_PRESCRIPTION_ENTRY !== 'enabled') throw new DomainError('ALTA_MANUAL_DESHABILITADA');
  if (!u.roles.includes('veterinaria_responsable'))
    throw new DomainError(
      'PROHIBIDO',
      'Las recetas de alta manual solo las gestiona la veterinaria responsable',
    );
}

export interface ContextoPeticion {
  usuario: Usuario;
  ip: string | null;
  userAgent: string | null;
}

const audit = (
  tx: DbOrTx,
  c: ContextoPeticion,
  accion: string,
  entidad: string,
  entidadId: string,
  antes?: unknown,
  despues?: unknown,
) =>
  appendAudit(tx, {
    actor: c.usuario.id,
    accion,
    entidad,
    entidadId,
    antes,
    despues,
    ip: c.ip,
    userAgent: c.userAgent,
  });

/** Aplana un objeto para comparar valor extraído y corregido campo a campo. */
function aplanar(o: unknown, prefijo = ''): Record<string, unknown> {
  if (o === null || typeof o !== 'object') return { [prefijo]: o };
  if (Array.isArray(o)) return Object.assign({}, ...o.map((v, i) => aplanar(v, `${prefijo}[${i}]`)));
  return Object.assign({}, ...Object.entries(o).map(([k, v]) => aplanar(v, prefijo ? `${prefijo}.${k}` : k)));
}

export interface LineaEvaluada {
  orden: number;
  /** Id de la línea guardada (para preguntar al asistente sobre ella); null si la línea aún no se ha guardado. */
  lineaId: string | null;
  resultado: ResultadoDecision;
  incidencias: Incidencia[];
  forzado: ForzadoAceptado | null;
  opcionesSoloPA: Awaited<ReturnType<MedicamentosService['opcionesSoloPA']>> | null;
  /** Presentación prescrita autorizada para dispensación fraccionada (guía §5.9), si lo está. */
  fraccion: {
    texto: string;
    unidades: number | null;
    unidad: string | null;
    prescritas: number | null;
  } | null;
}

export interface EvaluacionReceta {
  recetaId: string;
  resumen: string | null;
  validez: { efectiva: string; caso: string; maximoLegal: string } | null;
  incidenciasReceta: Incidencia[];
  lineas: LineaEvaluada[];
  reglaVersion: string;
  evaluadaAt: string;
}

export class RecetasService {
  readonly med: MedicamentosService;
  constructor(private readonly d: AppDeps) {
    this.med = new MedicamentosService(d);
  }

  // ── Alta y extracción ────────────────────────────────────────────────────────

  async crear(
    paginas: { bytes: Uint8Array; mime: string; phash: string | null }[],
    c: ContextoPeticion,
    hints: { fixture?: string } = {},
  ) {
    if (!paginas.length) throw new DomainError('VALIDACION', 'Sube al menos una página');
    const hashTotal = sha256(Buffer.concat(paginas.map((p) => Buffer.from(p.bytes))));
    const [r] = await this.d.db
      .insert(receta)
      .values({
        tipo: 'papel',
        estado: 'BORRADOR',
        sha256: hashTotal,
        phash: paginas[0]?.phash ?? null,
        creadaPor: c.usuario.id,
      })
      .returning();
    const id = r!.id;
    for (let i = 0; i < paginas.length; i++) {
      const p = paginas[i]!;
      const ext = p.mime === 'application/pdf' ? 'pdf' : p.mime === 'image/jpeg' ? 'jpg' : 'png';
      const path = `${id}/pagina-${i + 1}.${ext}`;
      await this.d.blob.put('recetas', path, p.bytes, p.mime);
      await this.d.db
        .insert(recetaImagen)
        .values({ recetaId: id, pagina: i + 1, blobPath: path, mime: p.mime, sha256: sha256(p.bytes) });
    }
    let aviso: string | null = null;
    try {
      const ext = await this.d.extractor.extract({
        pages: paginas.map((p) => p.bytes),
        mime: paginas[0]!.mime,
        hints,
      });
      const b = borradorDesdeExtraccion(ext, this.d.config.EXTRACTION_CONFIDENCE_THRESHOLD);
      // Medicamento: por código nacional si lo trae la receta; si no, por nombre o en el texto (propuesta).
      const especieId = b.receta.especie?.especieId ?? null;
      const ident = await identificarMedicamentos(b.receta, ext.ocrTexto, (q) =>
        this.d.cimavet.buscar(q, { limite: 5, especieId }),
      );
      const completa = await this.completarDesdeCimavet(ident.receta);
      const dudosos = [...new Set([...b.dudosos, ...ident.dudosos, ...completa.dudosos])];
      await this.guardarBorrador(id, completa.receta, { extraccion: ext, dudosos }, c, 'EXTRAIDA');
    } catch (e) {
      aviso = e instanceof DomainError ? e.code : 'EXTRACCION_FALLIDA';
      // Motivo técnico para diagnosticar (sin datos personales: mensajes del servicio, p. ej. tiempo agotado).
      console.warn(
        JSON.stringify({
          msg: 'extraccion_fallida',
          receta: id,
          aviso,
          error: (e as Error).message.slice(0, 200),
        }),
      );
      await this.d.db.transaction((tx) =>
        audit(tx, c, 'receta_extraccion_fallida', 'receta', id, null, { aviso }),
      );
    }
    await this.d.db.transaction((tx) =>
      audit(tx, c, 'receta_crear', 'receta', id, null, { paginas: paginas.length, sha256: hashTotal }),
    );
    return { id, aviso };
  }

  /**
   * Alta manual sin imagen (specs/011): crea la receta en borrador, sin extracción. Los datos se rellenan en la
   * revisión, con medicamento y especie elegidos de CIMAVet.
   */
  async crearManual(p: PeticionAltaManual, c: ContextoPeticion) {
    exigirAltaManual(this.d, c.usuario);
    const electronica = p.tipo === 'electronica';
    return this.d.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(receta)
        .values({
          tipo: p.tipo,
          origen: 'manual',
          // Hora inyectada (no la de la base de datos): es la "fecha de alta" que ven el registro y el reporte.
          createdAt: ahoraDe(this.d),
          motivoAlta: p.motivo,
          custodiaPapel: electronica ? null : p.custodiaPapel,
          plataformaId: electronica ? p.plataformaId : null,
          idPlataforma: electronica ? p.idPlataforma : null,
          estado: 'BORRADOR',
          creadaPor: c.usuario.id,
        })
        .returning({ id: receta.id });
      const id = r!.id;
      await audit(tx, c, 'receta_alta_manual', 'receta', id, null, {
        tipo: p.tipo,
        motivoAlta: p.motivo,
        custodiaPapel: electronica ? null : p.custodiaPapel,
        idPlataforma: electronica ? p.idPlataforma : null,
      });
      return { id };
    });
  }

  /**
   * Adjunta después la imagen de una receta de alta manual (FR-024): se guarda sin lanzar la extracción y la
   * receta sigue siendo de origen manual.
   */
  async adjuntarImagen(id: string, paginas: { bytes: Uint8Array; mime: string }[], c: ContextoPeticion) {
    if (!paginas.length) throw new DomainError('VALIDACION', 'Sube al menos una página');
    const [r] = await this.d.db.select({ origen: receta.origen }).from(receta).where(eq(receta.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    if (r.origen !== 'manual')
      throw new DomainError('CONFLICTO', 'Solo se adjunta imagen a recetas de alta manual');
    exigirAltaManual(this.d, c.usuario);
    const existentes = await this.d.db
      .select({ pagina: recetaImagen.pagina })
      .from(recetaImagen)
      .where(eq(recetaImagen.recetaId, id));
    let pagina = Math.max(0, ...existentes.map((x) => x.pagina));
    const nuevas: number[] = [];
    for (const p of paginas) {
      pagina += 1;
      const ext = p.mime === 'application/pdf' ? 'pdf' : p.mime === 'image/jpeg' ? 'jpg' : 'png';
      const path = `${id}/pagina-${pagina}.${ext}`;
      await this.d.blob.put('recetas', path, p.bytes, p.mime);
      const hash = sha256(p.bytes);
      await this.d.db.transaction(async (tx) => {
        await tx
          .insert(recetaImagen)
          .values({ recetaId: id, pagina, blobPath: path, mime: p.mime, sha256: hash });
        await audit(tx, c, 'receta_imagen_adjunta', 'receta', id, null, { pagina, sha256: hash });
      });
      nuevas.push(pagina);
    }
    return { paginas: nuevas };
  }

  /**
   * Receta manual: medicamento, presentación y especie salen de CIMAVet, no del texto escrito. Forma, principios
   * activos y concentración se sustituyen siempre por los de CIMAVet; el tipo y la plataforma son los del alta.
   * Los borradores (guardado automático) pueden ir incompletos; al confirmar ("comprobado"), todo es obligatorio.
   */
  private async datosManuales(
    r: { tipo: string; plataformaId: string | null; idPlataforma: string | null },
    input: RecetaConfirmada,
  ): Promise<RecetaConfirmada> {
    const estricto = input.comprobadoConOriginal;
    const especieId = input.especie.especieId;
    if (estricto && (especieId === null || (await this.med.nombresEspecies([especieId])).length === 0))
      throw new DomainError('ESPECIE_NO_SELECCIONADA');
    // Fecha de entrega: entre la emisión y hoy (la validez se calcula en esa fecha).
    const f = input.fechaOriginal;
    if (estricto && (!f || f > hoyDe(this.d) || (input.fechaEmision !== null && f < input.fechaEmision)))
      throw new DomainError('FECHA_ORIGINAL_INVALIDA');
    const lineas = [];
    for (const l of input.lineas) {
      const f = l.cn ? await this.med.resumen(l.cn, especieId) : null;
      if (!f) {
        if (estricto)
          throw new DomainError(
            'MEDICAMENTO_NO_SELECCIONADO',
            `Línea ${l.orden}: elige el medicamento de CIMAVet`,
          );
        lineas.push({
          ...l,
          cn: null,
          nregistro: null,
          formaTexto: null,
          principioActivoTexto: null,
          concentracionTexto: null,
        });
        continue;
      }
      lineas.push({
        ...l,
        nregistro: f.nregistro,
        medicamentoTexto: f.medicamento,
        formaTexto: f.forma,
        principioActivoTexto: f.principiosActivos,
        concentracionTexto: f.concentracion,
      });
    }
    return RecetaConfirmada.parse({
      ...input,
      tipo: r.tipo,
      plataformaId: r.plataformaId,
      idPlataforma: r.idPlataforma,
      lineas,
      registroDiferido: false,
      modo: 'retrospectivo',
    });
  }

  /**
   * Validez de la receta con los datos del formulario (aviso inmediato en la revisión, SPEC §4.1.3). Las
   * mismas reglas del dominio que la evaluación; la fecha de referencia es la de la 1.ª dispensación si la hay.
   */
  async validez(id: string, borrador: RecetaConfirmadaInput) {
    const [r] = await this.d.db
      .select({ primera: receta.primeraDispensacionAt, origen: receta.origen })
      .from(receta)
      .where(eq(receta.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    const conf = RecetaConfirmada.parse(borrador);
    if (!conf.fechaEmision) return null;
    const reglas = this.d.rules.bundle;
    const lineas = [];
    for (const l of conf.lineas) {
      const m = l.nregistro ? await this.med.info(l.nregistro) : null;
      lineas.push({
        orden: l.orden,
        resuelta: m !== null,
        antimicrobiano: conf.antimicrobianos || (m ? esAntimicrobiano(m, reglas.recetaCampos) : false),
        estupefaciente: m?.estupefaciente ?? false,
        psicotropo: m?.psicotropo ?? false,
        excluidaAmpliada: m ? excluidoValidezAmpliada(m, reglas.recetaCampos) : true,
      });
    }
    const v = calcularValidez({
      fechaEmision: conf.fechaEmision,
      plazoDeclarado: conf.plazoValidezDeclarado,
      tipoTratamiento: conf.tipoTratamiento,
      especieProduccion: conf.especieProduccion,
      cronicoPlanSanitario: conf.cronicoPlanSanitario,
      rules: reglas.validez,
      lineas,
    });
    const primera = r.primera
      ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(r.primera)
      : r.origen === 'manual'
        ? conf.fechaOriginal
        : null;
    const referencia = fechaReferenciaValidez(primera, hoyDe(this.d));
    return {
      validaHasta: v.efectiva,
      caso: v.caso,
      plazoMaximo: textoPlazo(v.plazoMaximo),
      caducada: recetaCaducada(v.efectiva, referencia),
      fechaReferencia: referencia,
    };
  }

  /**
   * Con el medicamento identificado, forma farmacéutica, principios activos y concentración salen de CIMAVet
   * (no de lo leído). Si no está autorizado para la especie de la receta, es uso en cascada: se propone
   * prescripción excepcional (la persona lo confirma).
   */
  private async completarDesdeCimavet(
    receta: RecetaConfirmadaInput,
  ): Promise<{ receta: RecetaConfirmadaInput; dudosos: string[] }> {
    const especieId = receta.especie?.especieId ?? null;
    const dudosos: string[] = [];
    let cascada = false;
    const lineas = [];
    for (const l of receta.lineas ?? []) {
      const f = l.cn ? await this.med.resumen(l.cn, especieId) : null;
      if (!f) {
        lineas.push(l);
        continue;
      }
      if (f.autorizadoEspecie === false) cascada = true;
      lineas.push({
        ...l,
        nregistro: l.nregistro ?? f.nregistro,
        formaTexto: f.forma ?? l.formaTexto ?? null,
        principioActivoTexto: f.principiosActivos ?? l.principioActivoTexto ?? null,
        concentracionTexto: f.concentracion ?? l.concentracionTexto ?? null,
      });
    }
    const excepcional = cascada && !receta.clasePrescripcion;
    if (excepcional) dudosos.push('receta.clasePrescripcion');
    return {
      receta: { ...receta, lineas, ...(excepcional ? { clasePrescripcion: 'excepcional' as const } : {}) },
      dudosos,
    };
  }

  private async guardarBorrador(
    id: string,
    borrador: RecetaConfirmadaInput,
    extra: { extraccion: ExtractionResult; dudosos: string[] },
    c: ContextoPeticion,
    estado: string,
  ) {
    const conf = RecetaConfirmada.parse(borrador);
    await this.d.db
      .update(receta)
      .set({
        // La extracción (incluido el texto OCR) contiene datos personales: se guarda cifrada.
        extraccion: { cifrado: this.d.cipher.encrypt(JSON.stringify({ ...extra, borrador: conf })) } as never,
        confirmacion: this.cifrarConfirmacion(conf) as never,
        estado,
      })
      .where(eq(receta.id, id));
    await this.sincronizarLineas(this.d.db, id, conf);
    void c;
  }

  /** Datos del titular cifrados dentro del borrador (SPEC §9.2). */
  private cifrarConfirmacion(conf: RecetaConfirmada) {
    const titular = Object.fromEntries(
      Object.entries(conf.titular).map(([k, v]) => [k, this.d.cipher.encrypt(v)]),
    );
    return { ...conf, titular, _cifrado: true };
  }

  private descifrarConfirmacion(raw: unknown): RecetaConfirmada | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as RecetaConfirmada & { _cifrado?: boolean };
    const titular = r._cifrado
      ? Object.fromEntries(
          Object.entries(r.titular ?? {}).map(([k, v]) => [k, this.d.cipher.decrypt(v as string | null)]),
        )
      : r.titular;
    const { _cifrado, ...resto } = r as RecetaConfirmada & { _cifrado?: boolean };
    void _cifrado;
    return RecetaConfirmada.parse({ ...resto, titular });
  }

  extraccion(
    raw: unknown,
  ): { extraccion: ExtractionResult; dudosos: string[]; borrador: RecetaConfirmada } | null {
    const c = (raw as { cifrado?: string } | null)?.cifrado;
    if (!c) return null;
    return JSON.parse(this.d.cipher.decrypt(c) as string);
  }

  private async sincronizarLineas(tx: DbOrTx, recetaId: string, conf: RecetaConfirmada) {
    const existentes = await tx.select().from(recetaLinea).where(eq(recetaLinea.recetaId, recetaId));
    for (const l of conf.lineas) {
      const valores = {
        textoMedicamento: l.medicamentoTexto,
        textoPrincipioActivo: l.principioActivoTexto,
        formaTexto: l.formaTexto,
        concentracionTexto: l.concentracionTexto,
        cantidadEnvases: l.cantidadEnvases,
        formatoTexto: l.formatoTexto,
        unidadesMax: l.cantidadEnvases,
        unidadesFormaPrescritas: l.unidadesForma,
        posologia: l.posologia as never,
        duracionDias: l.posologia?.duracionDias ?? null,
        tiempoEsperaTexto: l.tiempoEsperaTexto,
        nregistro: l.nregistro,
        cnPrescrito: l.cn,
      };
      const ex = existentes.find((e) => e.orden === l.orden);
      if (ex) {
        if (ex.estado === 'DISPENSADA') continue; // una línea dispensada no se modifica
        await tx.update(recetaLinea).set(valores).where(eq(recetaLinea.id, ex.id));
      } else {
        await tx.insert(recetaLinea).values({ recetaId, orden: l.orden, ...valores });
      }
    }
    for (const e of existentes) {
      if (!conf.lineas.some((l) => l.orden === e.orden) && e.estado === 'PENDIENTE') {
        await tx.delete(recetaLinea).where(eq(recetaLinea.id, e.id));
      }
    }
  }

  /** Si la receta es de alta manual, exige el permiso de alta manual. Devuelve si es manual. */
  async exigirAccesoManual(id: string, u: Usuario): Promise<boolean> {
    const [r] = await this.d.db.select({ origen: receta.origen }).from(receta).where(eq(receta.id, id));
    if (r?.origen !== 'manual') return false;
    exigirAltaManual(this.d, u);
    return true;
  }

  async obtener(id: string) {
    const [r] = await this.d.db.select().from(receta).where(eq(receta.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    const imagenes = await this.d.db
      .select()
      .from(recetaImagen)
      .where(eq(recetaImagen.recetaId, id))
      .orderBy(asc(recetaImagen.pagina));
    const lineas = await this.d.db
      .select()
      .from(recetaLinea)
      .where(eq(recetaLinea.recetaId, id))
      .orderBy(asc(recetaLinea.orden));
    const ext = this.extraccion(r.extraccion);
    return {
      id: r.id,
      estado: r.estado,
      tipo: r.tipo,
      origen: r.origen,
      motivoAlta: r.motivoAlta,
      custodiaPapel: r.custodiaPapel,
      creadaPor: r.creadaPor,
      createdAt: r.createdAt,
      primeraDispensacionAt: r.primeraDispensacionAt,
      registroCompletadoAt: r.registroCompletadoAt,
      validezEfectiva: r.validezEfectiva,
      reglaVersion: r.reglaVersion,
      imagenes: imagenes.map((i) => ({
        pagina: i.pagina,
        mime: i.mime,
        url: `/api/recetas/${id}/imagenes/${i.pagina}`,
      })),
      extraccion: ext?.extraccion ?? null,
      dudosos: ext?.dudosos ?? [],
      extraido: ext?.borrador ?? null,
      confirmacion: this.descifrarConfirmacion(r.confirmacion),
      correcciones: r.correcciones ?? [],
      evaluacion: r.evaluacion,
      lineas,
    };
  }

  async imagen(id: string, pagina: number) {
    const [img] = await this.d.db
      .select()
      .from(recetaImagen)
      .where(and(eq(recetaImagen.recetaId, id), eq(recetaImagen.pagina, pagina)));
    if (!img) throw new DomainError('NO_ENCONTRADO');
    const b = await this.d.blob.get('recetas', img.blobPath);
    if (!b) throw new DomainError('NO_ENCONTRADO');
    return b;
  }

  /**
   * Guarda los datos confirmados por la persona (borrador en servidor). Registra la traza valor
   * extraído → corregido, quién y cuándo (corrección manual ≠ forzado, SPEC §4.1.6 punto 2).
   */
  async confirmar(id: string, entrada: RecetaConfirmada, c: ContextoPeticion) {
    const [r] = await this.d.db.select().from(receta).where(eq(receta.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    if (r.estado === 'DISPENSADA') throw new DomainError('CONFLICTO', 'La receta ya está dispensada');
    const input = r.origen === 'manual' ? await this.datosManuales(r, entrada) : entrada;
    const anterior = this.descifrarConfirmacion(r.confirmacion);
    const extraido = this.extraccion(r.extraccion)?.borrador ?? null;
    const base = aplanar(anterior ?? extraido ?? {});
    const nuevo = aplanar(input);
    const ext = extraido ? aplanar(extraido) : {};
    const at = ahoraDe(this.d).toISOString();
    const cambios = Object.keys(nuevo)
      .filter((k) => JSON.stringify(nuevo[k]) !== JSON.stringify(base[k]))
      .map((campo) => ({
        campo,
        // Datos del titular: no se guardan en claro en la traza.
        extraido: campo.startsWith('titular.') ? '(dato personal)' : (ext[campo] ?? null),
        corregido: campo.startsWith('titular.') ? '(dato personal)' : nuevo[campo],
        por: c.usuario.id,
        at,
      }));
    await this.d.db.transaction(async (tx) => {
      const vetId = (await this.guardarVeterinario(tx, input)) ?? r.veterinarioId;
      await tx
        .update(receta)
        .set({
          confirmacion: this.cifrarConfirmacion(input) as never,
          correcciones: [...((r.correcciones as unknown[]) ?? []), ...cambios] as never,
          tipo: input.tipo,
          plataformaId: input.plataformaId,
          idPlataforma: input.idPlataforma,
          numero: input.numero,
          fechaEmision: input.fechaEmision,
          tipoDispensacion: input.tipoDispensacion,
          clasePrescripcion: input.clasePrescripcion,
          tipoTratamiento: input.tipoTratamiento,
          veterinarioId: vetId,
          numColegiado: input.veterinario.numColegiado,
          especieId: input.especie.especieId,
          especieProduccion: input.especieProduccion,
          animalIdentificacion: input.animalIdentificacion,
          numAnimales: input.numAnimales,
          rega: input.rega,
          indicacion: input.indicacion,
          firmaConfirmada: input.firmaConfirmada,
          talonarioColegial: input.talonarioColegial,
          plazoValidezDeclarado: input.plazoValidezDeclarado as never,
          estado:
            r.estado === 'DISPENSADA_PARCIAL'
              ? r.estado
              : input.comprobadoConOriginal
                ? 'CONFIRMADA'
                : 'EXTRAIDA',
        })
        .where(eq(receta.id, id));
      await this.sincronizarLineas(tx, id, input);
      await audit(tx, c, 'receta_confirmar', 'receta', id, null, { cambios: cambios.map((x) => x.campo) });
    });
    return { correcciones: cambios.length };
  }

  /** Alta o actualización del veterinario de la receta (por nº de colegiado y colegio). */
  private async guardarVeterinario(tx: DbOrTx, input: RecetaConfirmada): Promise<string | null> {
    const v = input.veterinario;
    if (!v.nombre) return null;
    const [existente] = v.numColegiado
      ? await tx
          .select()
          .from(veterinario)
          .where(
            and(
              eq(veterinario.numColegiado, v.numColegiado),
              v.colegio ? eq(veterinario.colegio, v.colegio) : isNull(veterinario.colegio),
            ),
          )
      : [];
    if (existente) {
      await tx
        .update(veterinario)
        .set({
          nombre: v.nombre ?? existente.nombre,
          telefono: v.telefono,
          email: v.email,
          clinica: v.clinica,
          direccion: v.direccion,
        })
        .where(eq(veterinario.id, existente.id));
      return existente.id;
    }
    const [nv] = await tx
      .insert(veterinario)
      .values({
        nombre: v.nombre,
        numColegiado: v.numColegiado,
        colegio: v.colegio,
        telefono: v.telefono,
        email: v.email,
        clinica: v.clinica,
        direccion: v.direccion,
      })
      .returning();
    return nv!.id;
  }

  /**
   * Dispensación ágil: datos para el registro transcritos después de dispensar. Solo cambian los datos de
   * registro (titular, veterinario salvo el nº de colegiado, indicación, identificación del animal y textos y
   * posología de las líneas); lo comprobado antes de dispensar no se toca. Queda auditado.
   */
  async completarRegistro(id: string, input: RecetaConfirmada, c: ContextoPeticion) {
    const [r] = await this.d.db.select().from(receta).where(eq(receta.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    const anterior = this.descifrarConfirmacion(r.confirmacion);
    if (!anterior) throw new DomainError('CONFLICTO', 'La receta aún no se ha revisado');
    const lineas = anterior.lineas.map((l) => {
      const n = input.lineas.find((x) => x.orden === l.orden);
      return n
        ? {
            ...l,
            principioActivoTexto: n.principioActivoTexto,
            formaTexto: n.formaTexto,
            concentracionTexto: n.concentracionTexto,
            formatoTexto: n.formatoTexto,
            posologia: n.posologia,
            tiempoEsperaTexto: n.tiempoEsperaTexto,
          }
        : l;
    });
    const nuevo: RecetaConfirmada = {
      ...anterior,
      titular: input.titular,
      veterinario: { ...input.veterinario, numColegiado: anterior.veterinario.numColegiado },
      indicacion: input.indicacion,
      animalIdentificacion: input.animalIdentificacion,
      numAnimales: input.numAnimales,
      lineas,
    };
    const antes = aplanar(anterior);
    const despues = aplanar(nuevo);
    const cambios = Object.keys(despues).filter(
      (k) => JSON.stringify(despues[k]) !== JSON.stringify(antes[k]),
    );
    await this.d.db.transaction(async (tx) => {
      const vetId = (await this.guardarVeterinario(tx, nuevo)) ?? r.veterinarioId;
      await tx
        .update(receta)
        .set({
          confirmacion: this.cifrarConfirmacion(nuevo) as never,
          veterinarioId: vetId,
          indicacion: nuevo.indicacion,
          animalIdentificacion: nuevo.animalIdentificacion,
          numAnimales: nuevo.numAnimales,
          registroCompletadoAt: ahoraDe(this.d),
        })
        .where(eq(receta.id, id));
      // Sin datos personales en la traza: solo los nombres de los campos.
      await audit(tx, c, 'receta_completar_registro', 'receta', id, null, { cambios });
    });
    return { cambios: cambios.length };
  }

  // ── Evaluación ───────────────────────────────────────────────────────────────

  /**
   * Ejecuta reglas + resolución + stock → decisión por línea (SPEC §4.1–4.3). El forzado se valida
   * aquí (API), nunca solo en la UI.
   */
  /**
   * Comprobación documental de la receta confirmada (campos obligatorios, validez, duplicados, plataforma):
   * reglas puras del dominio, sin stock ni decisiones. La usa la evaluación completa y la revisión para avisar
   * antes de «Ver qué dispensar».
   */
  /**
   * `fechaReferencia`: en recetas de alta manual, fecha en que se entregó (validez en esa fecha, no hoy) mientras
   * no conste ninguna dispensación; después manda la primera dispensación guardada (specs/011).
   */
  private async evaluacionDocumental(id: string, fechaReferencia: string | null = null) {
    const [r] = await this.d.db.select().from(receta).where(eq(receta.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    const conf = this.descifrarConfirmacion(r.confirmacion);
    if (!conf) throw new DomainError('VALIDACION', 'La receta no tiene datos confirmados');
    const pol = politica(this.d);
    const especieId = conf.especie.especieId ?? (await this.med.especiePorTexto(conf.especie.texto));
    const receta2 = { ...conf, especie: { ...conf.especie, especieId } };

    let cacheDesde: Date | null = null;
    const lineas = [];
    for (const l of conf.lineas) {
      const presentacion = l.cn ? await this.med.presentacion(l.cn) : null;
      const nreg = presentacion?.nregistro ?? l.nregistro;
      if (nreg) {
        const desde = await this.med.verificar(nreg);
        if (desde && (!cacheDesde || desde < cacheDesde)) cacheDesde = desde;
      }
      const medicamento = nreg ? await this.med.info(nreg) : null;
      lineas.push({ orden: l.orden, medicamento, presentacion });
    }

    const yaDispensadaApp =
      conf.tipo === 'papel' && conf.numero && conf.veterinario.numColegiado
        ? (
            await this.d.db
              .select({ id: dispensacion.id })
              .from(dispensacion)
              .innerJoin(receta, eq(receta.id, dispensacion.recetaId))
              .where(
                and(
                  eq(receta.numero, conf.numero),
                  eq(receta.numColegiado, conf.veterinario.numColegiado),
                  eq(receta.tipo, 'papel'),
                  ne(receta.id, id),
                  dispensacionVigente,
                ),
              )
              .limit(1)
          ).length > 0
        : false;
    // Alta manual: la receta puede estar ya en las salidas importadas de los registros anteriores (Excel).
    const yaImportada =
      r.origen === 'manual' && conf.numero && conf.veterinario.numColegiado
        ? (
            await this.d.db
              .select({ id: salidaImportada.id })
              .from(salidaImportada)
              .innerJoin(importacion, eq(importacion.id, salidaImportada.importacionId))
              .where(
                and(
                  eq(salidaImportada.numeroReceta, conf.numero),
                  eq(salidaImportada.numColegiado, conf.veterinario.numColegiado),
                  isNull(importacion.anuladaAt),
                ),
              )
              .limit(1)
          ).length > 0
        : false;
    const yaDispensada = yaDispensadaApp || yaImportada;
    const [similar] = r.phash
      ? await this.d.db
          .select({ id: receta.id })
          .from(receta)
          .where(and(eq(receta.phash, r.phash), ne(receta.id, id)))
          .limit(1)
      : [];
    let plataforma: { nombre: string; reconocidaMapa: boolean | null } | 'desconocida' | null = null;
    if (conf.tipo === 'electronica') {
      const [p] = conf.plataformaId
        ? await this.d.db
            .select()
            .from(plataformaRecetaElectronica)
            .where(eq(plataformaRecetaElectronica.id, conf.plataformaId))
        : [];
      plataforma = p ? { nombre: p.nombre, reconocidaMapa: p.reconocidaMapa } : 'desconocida';
    }
    const primera = r.primeraDispensacionAt
      ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(r.primeraDispensacionAt)
      : r.origen === 'manual'
        ? (fechaReferencia ?? conf.fechaOriginal)
        : null;
    const ev = evaluarReceta({
      receta: receta2,
      lineas,
      yaDispensada,
      recetaSimilarId: similar?.id ?? null,
      plataforma,
      cimavetCacheDesde: cacheDesde ? cacheDesde.toISOString().slice(0, 10) : null,
      primeraDispensacion: primera,
      clock: this.d.clock,
      politica: pol,
      rules: this.d.rules.bundle,
    });
    return { r, conf, pol, especieId, receta2, lineas, ev };
  }

  /** Incidencias que impiden dispensar y que se corrigen en la revisión (para avisar antes de seguir). */
  async comprobar(id: string) {
    const { ev } = await this.evaluacionDocumental(id);
    return { incidencias: ev.incidencias.filter((i) => i.severidad !== 'AVISO') };
  }

  async evaluar(
    id: string,
    c: ContextoPeticion,
    forzados: Record<number, SolicitudForzado> = {},
    persistir = true,
    fechaReferencia: string | null = null,
  ): Promise<EvaluacionReceta> {
    const { r, conf, pol, especieId, receta2, lineas, ev } = await this.evaluacionDocumental(
      id,
      fechaReferencia,
    );
    const manual = r.origen === 'manual';

    const resultado: LineaEvaluada[] = [];
    const idsLinea = new Map(
      (
        await this.d.db
          .select({ id: recetaLinea.id, orden: recetaLinea.orden })
          .from(recetaLinea)
          .where(eq(recetaLinea.recetaId, id))
      ).map((x) => [x.orden, x.id]),
    );
    for (const l of conf.lineas) {
      const ctxL = lineas.find((x) => x.orden === l.orden)!;
      const incs = ev.porLinea[l.orden] ?? [];
      let forzado: ForzadoAceptado | null = null;
      const sol = forzados[l.orden];
      if (sol) {
        forzado = validarForzado(incs, sol);
        if (forzado.codigos.includes('PRESCRIPCION_SOLO_PA') && ctxL.medicamento)
          await this.validarSoloPA(l, ctxL.medicamento, receta2);
      }
      let res: ResultadoDecision;
      if (ctxL.medicamento && ctxL.presentacion) {
        const candidatos = await this.med.candidatos(ctxL.medicamento.nregistro, ctxL.presentacion.cn);
        // Alta manual: la entrega ya ocurrió y el TPV ya descontó el stock; el stock de hoy no cuenta.
        const stock = manual
          ? {
              stock: {
                [ctxL.presentacion.cn]: [
                  {
                    lote: '(entregado)',
                    caducidad: null,
                    disponible: l.cantidadEnvases ?? 1,
                    creadoAt: null,
                    variantId: 0,
                  },
                ],
              },
              avisos: [],
            }
          : await this.leerStock(
              ctxL.presentacion.cn,
              ctxL.medicamento,
              candidatos.map((x) => x.presentacion.cn),
            );
        res = decidirLinea({
          linea: l.orden,
          incidencias: incs,
          forzado,
          prescrito: {
            medicamento: ctxL.medicamento,
            presentacion: ctxL.presentacion,
            envases: l.cantidadEnvases ?? 1,
          },
          candidatos,
          stock: stock.stock,
          avisosStock: stock.avisos,
          ctx: {
            especieId,
            especieProduccion: conf.especieProduccion,
            clase: conf.clasePrescripcion,
            indicacion: conf.indicacion,
            viaPrescritaId: null,
            duracionDias: l.posologia?.duracionDias ?? null,
          },
          exclusiones: this.d.rules.bundle.exclusiones.exclusiones,
          politica: pol,
          equivalencia: this.d.rules.bundle.equivalencia,
          config: {
            allowPackSizeChange: this.d.config.ALLOW_PACK_SIZE_CHANGE,
            modoSustitucion: this.d.config.SUBSTITUTION_APPROVAL_MODE,
          },
          hoy: hoyDe(this.d),
          reglaVersion: ev.reglaVersion,
        });
      } else {
        res = decidirLinea({
          linea: l.orden,
          incidencias: incs,
          forzado: null,
          prescrito: null,
          candidatos: [],
          stock: {},
          ctx: {
            especieId,
            especieProduccion: conf.especieProduccion,
            clase: conf.clasePrescripcion,
            indicacion: conf.indicacion,
            viaPrescritaId: null,
            duracionDias: null,
          },
          exclusiones: [],
          politica: pol,
          equivalencia: this.d.rules.bundle.equivalencia,
          config: { allowPackSizeChange: false, modoSustitucion: 'POST' },
          hoy: hoyDe(this.d),
          reglaVersion: ev.reglaVersion,
        });
      }
      const soloPA = incs.some((i) => i.code === 'PRESCRIPCION_SOLO_PA');
      resultado.push({
        orden: l.orden,
        lineaId: idsLinea.get(l.orden) ?? null,
        resultado: res,
        incidencias: incs,
        forzado,
        opcionesSoloPA: soloPA ? await this.med.opcionesSoloPA(l.principioActivoTexto, especieId) : null,
        fraccion: ctxL.presentacion?.fraccionable
          ? {
              texto: ctxL.presentacion.fracciones ?? '',
              unidades: parseFraccion(ctxL.presentacion.fracciones)?.unidades ?? null,
              unidad: parseFraccion(ctxL.presentacion.fracciones)?.unidad ?? null,
              prescritas: l.unidadesForma,
            }
          : null,
      });
    }

    const evaluacion: EvaluacionReceta = {
      recetaId: id,
      resumen: resumenReceta(resultado.map((x) => x.resultado.decision)),
      validez: ev.validez
        ? { efectiva: ev.validez.efectiva, caso: ev.validez.caso, maximoLegal: ev.validez.maximoLegal }
        : null,
      incidenciasReceta: ev.incidencias.filter((i) => i.ambito === 'receta'),
      lineas: resultado,
      reglaVersion: ev.reglaVersion,
      evaluadaAt: ahoraDe(this.d).toISOString(),
    };
    if (persistir) await this.persistirEvaluacion(id, r.estado, evaluacion, c);
    return evaluacion;
  }

  private async validarSoloPA(
    l: RecetaConfirmada['lineas'][number],
    elegido: NonNullable<Awaited<ReturnType<MedicamentosService['info']>>>,
    rec: RecetaConfirmada,
  ) {
    const paIds = await this.med.idsPorTexto(MAESTRA.PRINCIPIOS_ACTIVOS, l.principioActivoTexto, 1);
    const formaIds = await this.med.idsPorTexto(MAESTRA.FORMAS, l.formaTexto, 1);
    const viaIds = await this.med.idsPorTexto(MAESTRA.VIAS, l.posologia?.via ?? null, 1);
    const conc = /(\d+(?:[.,]\d+)?)\s*([a-zµ%]+)(?:\s*\/\s*(\d+(?:[.,]\d+)?)?\s*([a-z]+))?/i.exec(
      l.concentracionTexto ?? '',
    );
    const virtual = prescripcionVirtual({
      pas: paIds.map((paId) => ({
        paId,
        nombre: l.principioActivoTexto ?? '',
        cantidad: conc?.[1] ?? null,
        unidad: conc?.[2] ?? null,
      })),
      porCantidad: conc?.[4] ? (conc[3] ?? '1') : '1',
      porUnidad: conc?.[4] ?? (l.formaTexto && /comprim|c[aá]psul/i.test(l.formaTexto) ? 'Comprimido' : null),
      formaId: formaIds[0] ?? null,
      viaId: viaIds[0] ?? null,
      especieId: rec.especie.especieId,
    });
    validarEleccionSoloPA(
      virtual,
      elegido,
      {
        especieId: rec.especie.especieId,
        especieProduccion: rec.especieProduccion,
        clase: rec.clasePrescripcion,
        indicacion: rec.indicacion,
        viaPrescritaId: viaIds[0] ?? null,
        duracionDias: null,
      },
      this.d.rules.bundle.equivalencia,
    );
  }

  /** Stock del prescrito y candidatos. El prescrito sin stock confirmable → NO_DISPONIBLE (PENDIENTE_STOCK). */
  async leerStock(
    cn: string,
    m: { nombre: string; labtitular: string | null },
    otros: string[],
  ): Promise<{ stock: StockPorCn; avisos: Incidencia[]; sinMapeo: boolean }> {
    const p = await this.d.stock.lotes(cn, m);
    if (p.estado !== 'OK')
      return { stock: 'NO_DISPONIBLE', avisos: p.avisos, sinMapeo: p.estado === 'SIN_MAPEO' };
    const stock: Record<string, typeof p.lotes> = { [cn]: p.lotes };
    const avisos = [...p.avisos];
    // Los equivalentes pueden ser decenas: se leen a la vez (máx. 4) para no tardar minutos.
    const leidos = await enParalelo(otros, 4, (o) => this.d.stock.lotes(o, null));
    otros.forEach((o, i) => {
      const s = leidos[i]!;
      stock[o] = s.estado === 'OK' ? s.lotes : [];
      avisos.push(...s.avisos);
    });
    return { stock, avisos, sinMapeo: false };
  }

  private async persistirEvaluacion(
    id: string,
    estadoActual: string,
    e: EvaluacionReceta,
    c: ContextoPeticion,
  ) {
    await this.d.db.transaction(async (tx) => {
      const activas = await tx
        .select({ id: reglaVersion.id })
        .from(reglaVersion)
        .where(and(eq(reglaVersion.activa, true), eq(reglaVersion.nombreFichero, 'receta-campos.v1.yaml')));
      const todasNoConformes =
        e.lineas.length > 0 &&
        e.lineas.every((l) => l.resultado.decision === 'NO_CONFORME' && !l.resultado.evidencias.forzable);
      await tx
        .update(receta)
        .set({
          evaluacion: e as never,
          validezEfectiva: e.validez?.efectiva ?? null,
          reglaVersion: e.reglaVersion,
          reglaVersionId: activas[0]?.id ?? null,
          estado: estadoActual.startsWith('DISPENSADA')
            ? estadoActual
            : todasNoConformes
              ? 'NO_CONFORME'
              : 'EVALUADA',
        })
        .where(eq(receta.id, id));
      for (const l of e.lineas) {
        await tx
          .update(recetaLinea)
          .set({
            decision: l.resultado.decision,
            motivos: l.resultado.motivos as never,
            evidencias: l.resultado.evidencias as never,
          })
          .where(
            and(
              eq(recetaLinea.recetaId, id),
              eq(recetaLinea.orden, l.orden),
              ne(recetaLinea.estado, 'DISPENSADA'),
            ),
          );
      }
      await audit(tx, c, 'receta_evaluar', 'receta', id, null, {
        resumen: e.resumen,
        reglaVersion: e.reglaVersion,
        lineas: e.lineas.map((l) => ({
          orden: l.orden,
          decision: l.resultado.decision,
          motivos: l.resultado.motivos.map((m) => m.code),
          forzado: l.forzado?.codigos ?? null,
        })),
      });
    });
  }

  /**
   * Sobreescribe la sustitución de una línea de receta registrando el motivo obligatorio (FR-017).
   * Valida que no exista un BLOQUEANTE_DURO, genera la fila en sustitucion con modo POST
   * y registra el evento inmutable de auditoría SUSTITUCION_SOBREESCRITA.
   */
  async sustituirManual(
    recetaId: string,
    lineaOrden: number,
    input: PeticionSobreescribirSustitucion,
    c: ContextoPeticion,
  ) {
    const peticion = PeticionSobreescribirSustitucion.parse(input);
    const [r] = await this.d.db.select().from(receta).where(eq(receta.id, recetaId));
    if (!r) throw new DomainError('NO_ENCONTRADO', 'Receta no encontrada');
    const [linea] = await this.d.db
      .select()
      .from(recetaLinea)
      .where(and(eq(recetaLinea.recetaId, recetaId), eq(recetaLinea.orden, lineaOrden)));
    if (!linea) throw new DomainError('NO_ENCONTRADO', 'Línea de receta no encontrada');

    if (r.clasePrescripcion === 'excepcional') {
      throw new DomainError(
        'SUSTITUCION_BLOQUEO_DURO',
        'Las prescripciones excepcionales (en cascada) no admiten sustitución por el dispensador',
      );
    }

    const nregPrescrito = linea.nregistro;
    if (nregPrescrito) {
      const medPrescrito = await this.med.info(nregPrescrito);
      if (medPrescrito?.biologico || medPrescrito?.inmunologico) {
        throw new DomainError(
          'SUSTITUCION_BLOQUEO_DURO',
          'Los medicamentos biológicos o inmunológicos no son sustituibles por ley',
        );
      }
    }

    const presCandidato = await this.med.presentacion(peticion.cn);
    if (!presCandidato) throw new DomainError('NO_ENCONTRADO', 'Medicamento sustituto no encontrado');
    const nregCandidato = peticion.nregistro ?? presCandidato.nregistro;
    const medCandidato = nregCandidato ? await this.med.info(nregCandidato) : null;
    if (!medCandidato)
      throw new DomainError('NO_ENCONTRADO', 'Ficha del medicamento candidato no encontrada');

    if (medCandidato.biologico || medCandidato.inmunologico) {
      throw new DomainError(
        'SUSTITUCION_BLOQUEO_DURO',
        'El medicamento sustituto candidato es biológico o inmunológico y no admite sustitución',
      );
    }
    if (medCandidato.estado === 'revocado' || medCandidato.estado === 'suspendido') {
      throw new DomainError(
        'SUSTITUCION_BLOQUEO_DURO',
        'El medicamento sustituto candidato no está debidamente autorizado (suspendido o revocado)',
      );
    }

    const proc = await procedimientoVigente(this.d);
    const ahora = ahoraDe(this.d);
    const modo = this.d.config.SUBSTITUTION_APPROVAL_MODE;

    return this.d.db.transaction(async (tx) => {
      const [sust] = await tx
        .insert(sustitucion)
        .values({
          recetaLineaId: linea.id,
          cnPrescrito: linea.cnPrescrito,
          cnPropuesto: peticion.cn,
          nregistroPropuesto: medCandidato.nregistro,
          equivalencia: {
            cn: peticion.cn,
            nregistro: medCandidato.nregistro,
            nombre: presCandidato.nombre,
            labtitular: medCandidato.labtitular,
            modo,
            sobreescritura: true,
            motivo: peticion.motivo,
            envases: linea.cantidadEnvases ?? 1,
          } as never,
          estado: 'AVISO_VETERINARIO',
          modo,
          consentimientoTutor: {
            consiente: true,
            fechaHora: ahora.toISOString(),
            empleado: c.usuario.id,
            medio: 'mostrador',
            motivo: peticion.motivo,
          } as never,
          avisoVeterinario: {
            fechaHora: ahora.toISOString(),
            empleado: c.usuario.id,
            medio: 'telefono',
          } as never,
          procedimientoVersion: proc ? `${proc.codigo}@${proc.version}` : null,
          historial: [
            { estado: 'PROPUESTA', por: c.usuario.id, at: ahora.toISOString() },
            { estado: 'CONSENTIMIENTO_TUTOR', por: c.usuario.id, at: ahora.toISOString() },
            { estado: 'AVISO_VETERINARIO', por: c.usuario.id, at: ahora.toISOString() },
          ] as never,
        })
        .returning();

      await tx
        .update(recetaLinea)
        .set({
          decision: 'SUSTITUIR',
          evidencias: {
            ...((linea.evidencias as object) ?? {}),
            sustitucionId: sust!.id,
            sustitucionManual: {
              cn: peticion.cn,
              nregistro: medCandidato.nregistro,
              motivo: peticion.motivo,
              por: c.usuario.id,
              at: ahora.toISOString(),
            },
          } as never,
        })
        .where(eq(recetaLinea.id, linea.id));

      if (r.evaluacion && typeof r.evaluacion === 'object') {
        const ev = r.evaluacion as {
          lineas?: Array<{
            orden: number;
            resultado: {
              decision: string;
              evidencias: Record<string, unknown>;
            };
          }>;
        };
        if (Array.isArray(ev.lineas)) {
          const lEv = ev.lineas.find((x) => x.orden === lineaOrden);
          if (lEv) {
            lEv.resultado.decision = 'SUSTITUIR';
            lEv.resultado.evidencias = {
              ...lEv.resultado.evidencias,
              sustitutoElegido: {
                cn: peticion.cn,
                nregistro: medCandidato.nregistro,
                nombre: presCandidato.nombre,
                sustitucionId: sust!.id,
                motivo: peticion.motivo,
              },
              sustitutos: [
                {
                  cn: peticion.cn,
                  nregistro: medCandidato.nregistro,
                  nombre: presCandidato.nombre,
                  labtitular: medCandidato.labtitular,
                  modo,
                  id: sust!.id,
                  sustitucionId: sust!.id,
                  equivalencia: { envases: linea.cantidadEnvases ?? 1 },
                },
                ...(((lEv.resultado.evidencias.sustitutos as unknown[]) ?? []) as unknown[]),
              ],
            };
          }
        }
        await tx
          .update(receta)
          .set({ evaluacion: ev as never })
          .where(eq(receta.id, recetaId));
      }

      await audit(tx, c, 'SUSTITUCION_SOBREESCRITA', 'receta_linea', linea.id, null, {
        recetaId,
        orden: lineaOrden,
        cnOriginal: linea.cnPrescrito,
        cnSustituto: peticion.cn,
        motivo: peticion.motivo,
        sustitucionId: sust!.id,
      });

      return { ok: true, sustitucionId: sust!.id };
    });
  }
}
