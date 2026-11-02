import { and, asc, desc, eq, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { asistenteConversacion, asistenteIntercambio, asistenteValoracion } from '@mmx/db';
import {
  ChatOrchestrator,
  INSTRUCCIONES,
  instruccionesVersion,
  limpiarDatosPersonales,
  type ResultadoTurno,
} from '@mmx/assistant';
import {
  DomainError,
  rangoMadrid,
  PREGUNTAS_EJEMPLO_GENERAL,
  PREGUNTAS_EJEMPLO_LINEA,
  PREGUNTAS_EJEMPLO_MEDICAMENTO,
  type ContextoConversacion,
  type IntercambioDto,
  type ListarConversacionesQuery,
} from '@mmx/shared';
import type { AppDeps } from '../deps';
import type { Usuario } from '../plugins/auth';
import { ahoraDe } from '../deps';
import { ConsumoRepo } from './asistente-consumo';

type Conversacion = typeof asistenteConversacion.$inferSelect;
type FilaIntercambio = typeof asistenteIntercambio.$inferSelect;

/** Horas sin actividad tras las cuales una conversación se cierra sola. */
export const HORAS_INACTIVIDAD = 8;

/**
 * Conversaciones del asistente (specs/002-prescription-chat-assistant). El asistente solo informa: ningún método
 * de este servicio crea ni modifica recetas, dispensaciones ni registros (FR-010).
 */
export class AsistenteService {
  readonly consumo: ConsumoRepo;
  constructor(private readonly d: AppDeps) {
    this.consumo = new ConsumoRepo(d.db, d.config);
  }

  private get a() {
    return this.d.asistente;
  }

  async estado() {
    const activo = this.a.modelo !== null;
    const mes = activo ? await this.consumo.mes(ahoraDe(this.d)) : null;
    return {
      activo,
      estadoConsumo: mes?.estado ?? 'normal',
      preguntasEjemplo: activo ? [...PREGUNTAS_EJEMPLO_GENERAL] : [],
    };
  }

  preguntasEjemplo(c: ContextoConversacion): string[] {
    return [
      ...(c.tipo === 'linea'
        ? PREGUNTAS_EJEMPLO_LINEA
        : c.tipo === 'medicamento'
          ? PREGUNTAS_EJEMPLO_MEDICAMENTO
          : PREGUNTAS_EJEMPLO_GENERAL),
    ];
  }

  async crearConversacion(contexto: ContextoConversacion, u: Usuario) {
    if (!this.a.modelo) throw new DomainError('ASISTENTE_DESACTIVADO');
    if (contexto.tipo === 'linea') {
      const existe = this.a.existeLinea ? await this.a.existeLinea(contexto.recetaLineaId) : false;
      if (!existe) throw new DomainError('RECETA_LINEA_NO_ENCONTRADA');
    }
    const [c] = await this.d.db
      .insert(asistenteConversacion)
      .values({
        usuarioOid: u.id,
        usuarioNombre: u.nombre,
        contextoTipo: contexto.tipo,
        recetaLineaId: contexto.tipo === 'linea' ? contexto.recetaLineaId : null,
        nregistro: contexto.tipo === 'medicamento' ? (contexto.nregistro ?? null) : null,
        createdAt: ahoraDe(this.d),
      })
      .returning();
    const conv = c as Conversacion;
    return {
      id: conv.id,
      contexto,
      createdAt: conv.createdAt.toISOString(),
      preguntasEjemplo: this.preguntasEjemplo(contexto),
    };
  }

  private contextoDe(c: Conversacion): ContextoConversacion {
    if (c.contextoTipo === 'linea' && c.recetaLineaId)
      return { tipo: 'linea', recetaLineaId: c.recetaLineaId };
    if (c.contextoTipo === 'medicamento')
      return { tipo: 'medicamento', ...(c.nregistro ? { nregistro: c.nregistro } : {}) };
    return { tipo: 'general' };
  }

  private async propia(id: string, u: Usuario): Promise<Conversacion> {
    const [c] = await this.d.db.select().from(asistenteConversacion).where(eq(asistenteConversacion.id, id));
    if (!c) throw new DomainError('NO_ENCONTRADO');
    if (c.usuarioOid !== u.id) throw new DomainError('ASISTENTE_CONVERSACION_AJENA');
    return c;
  }

  async cerrar(id: string, u: Usuario) {
    const c = await this.propia(id, u);
    if (c.estado === 'cerrada') return;
    await this.d.db
      .update(asistenteConversacion)
      .set({ estado: 'cerrada', cerradaAt: ahoraDe(this.d) })
      .where(eq(asistenteConversacion.id, id));
  }

  async preguntar(id: string, preguntaOriginal: string, u: Usuario): Promise<IntercambioDto> {
    const modelo = this.a.modelo;
    if (!modelo) throw new DomainError('ASISTENTE_DESACTIVADO');
    const conv = await this.propia(id, u);
    const ahora = ahoraDe(this.d);
    if (conv.estado === 'cerrada') throw new DomainError('ASISTENTE_CONVERSACION_CERRADA');
    const previos = await this.d.db
      .select()
      .from(asistenteIntercambio)
      .where(eq(asistenteIntercambio.conversacionId, id))
      .orderBy(asc(asistenteIntercambio.orden));
    const ultima = previos.at(-1)?.createdAt ?? conv.createdAt;
    if (ahora.getTime() - ultima.getTime() > HORAS_INACTIVIDAD * 3_600_000) {
      await this.d.db
        .update(asistenteConversacion)
        .set({ estado: 'cerrada', cerradaAt: ahora })
        .where(eq(asistenteConversacion.id, id));
      throw new DomainError('ASISTENTE_CONVERSACION_CERRADA');
    }

    // Saneado: ni al modelo ni a la base de datos llega un dato personal (FR-018, FR-019).
    const contexto = this.contextoDe(conv);
    const conocidos =
      contexto.tipo === 'linea' && this.a.conocidosLinea
        ? await this.a.conocidosLinea(contexto.recetaLineaId)
        : [];
    const limpia = limpiarDatosPersonales(preguntaOriginal, conocidos);
    const base = {
      conversacionId: id,
      pregunta: limpia.texto,
      piiEliminada: limpia.eliminada,
      reglaVersion: this.d.rules.bundle.version,
      fuentesVersion: this.a.fuentes?.version() ?? 'sin-fuentes',
      modelo: modelo.nombre,
      instruccionesVersion,
    };

    const mes = await this.consumo.mes(ahora);
    if (mes.estado === 'en_pausa') {
      await this.guardar(id, {
        ...base,
        estado: 'limite',
        errorCode: 'ASISTENTE_LIMITE_MENSUAL',
        createdAt: ahora,
      });
      throw new DomainError('ASISTENTE_LIMITE_MENSUAL');
    }

    const historial = previos
      .filter((p) => p.estado === 'respondida')
      .map((p) => ({ pregunta: p.pregunta, respuesta: p.respuesta }));
    let turno: ResultadoTurno;
    try {
      turno = await new ChatOrchestrator({
        modelo,
        herramientas: this.a.herramientas,
        instrucciones: INSTRUCCIONES,
      }).responder({
        pregunta: limpia.texto,
        historial,
        contexto,
        conocidos,
        hoy: ahora.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }),
      });
    } catch (e) {
      // El detalle puede contener texto del empleado: solo se conserva el código.
      await this.guardar(id, {
        ...base,
        estado: 'error',
        errorCode: 'ASISTENTE_NO_DISPONIBLE',
        createdAt: ahora,
      });
      if (e instanceof DomainError && e.code === 'ASISTENTE_NO_DISPONIBLE') throw e;
      throw new DomainError('ASISTENTE_NO_DISPONIBLE');
    }

    const fila = await this.guardar(id, {
      ...base,
      estado: 'respondida',
      tipoRespuesta: turno.salida.tipo,
      respuesta: turno.salida.texto,
      fuentes: turno.fuentes,
      simulaciones: turno.simulaciones,
      contextoMotor: turno.contextoLinea?.resultado ?? null,
      tokensEntrada: turno.uso.entrada,
      tokensSalida: turno.uso.salida,
      rondasHerramientas: turno.rondas,
      duracionMs: turno.duracionMs,
      createdAt: ahora,
    });
    const st = await this.consumo.registrar(ahora, turno.uso);
    if (st.avisar) await this.avisarConsumo(st.porcentaje, st.estado);
    return { ...this.aDto(fila, null), ...(turno.candidatos.length ? { candidatos: turno.candidatos } : {}) };
  }

  /** Inserta un intercambio con el siguiente orden de la conversación (bloquea la conversación). */
  private async guardar(
    conversacionId: string,
    v: Omit<typeof asistenteIntercambio.$inferInsert, 'orden'>,
  ): Promise<FilaIntercambio> {
    return this.d.db.transaction(async (tx) => {
      await tx
        .select({ id: asistenteConversacion.id })
        .from(asistenteConversacion)
        .where(eq(asistenteConversacion.id, conversacionId))
        .for('update');
      const [m] = await tx
        .select({ n: sql<number>`coalesce(max(${asistenteIntercambio.orden}), 0)` })
        .from(asistenteIntercambio)
        .where(eq(asistenteIntercambio.conversacionId, conversacionId));
      const [fila] = await tx
        .insert(asistenteIntercambio)
        .values({ ...v, orden: Number(m?.n ?? 0) + 1 })
        .returning();
      return fila as FilaIntercambio;
    });
  }

  /** Aviso del 80 % a administración. Si no hay correo configurado, queda constancia en Administración. */
  protected async avisarConsumo(porcentaje: number, estado: string): Promise<void> {
    const destinatarios = (this.d.config.REPORT_RECIPIENTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!this.a.mailer || !destinatarios.length) return;
    try {
      await this.a.mailer.enviar({
        para: destinatarios,
        asunto:
          estado === 'en_pausa'
            ? 'Asistente de consultas: límite mensual alcanzado'
            : 'Asistente de consultas: 80 % del límite mensual',
        texto: `El asistente de consultas lleva consumido el ${porcentaje} % del límite mensual.${estado === 'en_pausa' ? ' Está en pausa hasta el mes siguiente o hasta que se amplíe el límite en Administración.' : ''}`,
      });
    } catch {
      // Un fallo del correo no afecta a la respuesta ya dada.
    }
  }

  /**
   * Abre lo que una respuesta cita (FR-007): fragmento actual de la fuente y si coincide con la versión con la que se
   * respondió. Las fuentes `cimavet:` y `motor:` nunca llevan datos personales.
   */
  async abrirFuente(fuenteId: string, versionPedida: string | undefined, u: Usuario) {
    const tipo = fuenteId.split(':')[0];
    let r: { titulo: string; version: string; contenido: string; tipo: string } | null = null;
    if (tipo === 'guia' || tipo === 'ayuda') {
      const abierta = this.a.fuentes?.abrir(fuenteId);
      if (abierta)
        r = {
          tipo: abierta.fuente.tipo,
          titulo: abierta.fuente.titulo,
          version: abierta.fuente.version,
          contenido: abierta.contenido,
        };
    } else if (tipo === 'regla') {
      const h = this.a.herramientas.obtener('consultar_reglas', { contexto: { tipo: 'general' } });
      const tema = fuenteId.slice('regla:'.length);
      if (h) {
        const res = await (
          h as unknown as {
            ejecutar(
              a: unknown,
              c: unknown,
            ): Promise<{ datos: { titulo: string; version: string; contenido: unknown } }>;
          }
        ).ejecutar({ tema }, {});
        r = {
          tipo: 'regla',
          titulo: res.datos.titulo,
          version: res.datos.version,
          contenido: JSON.stringify(res.datos.contenido, null, 2),
        };
      }
    } else if (tipo === 'motor' && fuenteId.startsWith('motor:linea/')) {
      const dto = this.a.cargarLinea ? await this.a.cargarLinea(fuenteId.slice('motor:linea/'.length)) : null;
      if (dto)
        r = {
          tipo: 'motor',
          titulo: 'Resultado de la aplicación para esta línea',
          version: dto.version,
          contenido: JSON.stringify(dto.resultado, null, 2),
        };
    } else if (tipo === 'motor') {
      const id = fuenteId.slice('motor:'.length);
      const filas = await this.d.db
        .select({
          simulaciones: asistenteIntercambio.simulaciones,
          usuarioOid: asistenteConversacion.usuarioOid,
        })
        .from(asistenteIntercambio)
        .innerJoin(asistenteConversacion, eq(asistenteConversacion.id, asistenteIntercambio.conversacionId))
        .where(sql`${asistenteIntercambio.simulaciones} @> ${JSON.stringify([{ simulacionId: id }])}::jsonb`)
        .limit(1);
      const f = filas[0];
      const verTodo = u.roles.includes('veterinaria_responsable') || u.roles.includes('admin');
      const sim =
        f && (verTodo || f.usuarioOid === u.id)
          ? (f.simulaciones as { simulacionId: string; reglaVersion: string }[]).find(
              (x) => x.simulacionId === id,
            )
          : undefined;
      if (sim)
        r = {
          tipo: 'motor',
          titulo: 'Simulación del motor de reglas',
          version: sim.reglaVersion,
          contenido: JSON.stringify(sim, null, 2),
        };
    }
    if (!r) throw new DomainError('NO_ENCONTRADO');
    return {
      fuenteId,
      tipo: r.tipo,
      titulo: r.titulo,
      version: r.version,
      versionVigente: versionPedida === undefined || versionPedida === r.version,
      contenido: r.contenido,
    };
  }

  // ── Valoraciones e histórico (US4) ──────────────────────────────────────────

  /** Valoración del empleado sobre una respuesta (FR-024); volver a valorar sustituye la anterior. */
  async valorar(
    intercambioId: string,
    v: { valor: 'util' | 'incorrecta'; comentario?: string | undefined },
    u: Usuario,
  ) {
    const [fila] = await this.d.db
      .select({ usuarioOid: asistenteConversacion.usuarioOid })
      .from(asistenteIntercambio)
      .innerJoin(asistenteConversacion, eq(asistenteConversacion.id, asistenteIntercambio.conversacionId))
      .where(eq(asistenteIntercambio.id, intercambioId));
    if (!fila) throw new DomainError('NO_ENCONTRADO');
    if (fila.usuarioOid !== u.id) throw new DomainError('ASISTENTE_CONVERSACION_AJENA');
    // El comentario también pasa por el saneado: nunca se guardan datos personales (FR-019).
    const comentario = v.comentario ? limpiarDatosPersonales(v.comentario).texto : null;
    const ahora = ahoraDe(this.d);
    const [r] = await this.d.db
      .insert(asistenteValoracion)
      .values({ intercambioId, usuarioOid: u.id, valor: v.valor, comentario, createdAt: ahora })
      .onConflictDoUpdate({
        target: [asistenteValoracion.intercambioId, asistenteValoracion.usuarioOid],
        set: { valor: v.valor, comentario, createdAt: ahora },
      })
      .returning();
    return {
      valor: r!.valor as 'util' | 'incorrecta',
      comentario: r!.comentario,
      createdAt: r!.createdAt.toISOString(),
    };
  }

  private veTodo(u: Usuario): boolean {
    return u.roles.includes('veterinaria_responsable') || u.roles.includes('admin');
  }

  /** Histórico: el empleado ve solo sus conversaciones; veterinaria responsable y administración, las de todos (FR-025). */
  async listar(q: ListarConversacionesQuery, u: Usuario) {
    if (!this.veTodo(u) && q.usuario && q.usuario !== u.id)
      throw new DomainError('PROHIBIDO', 'Solo puedes ver tus propias consultas');
    const c = asistenteConversacion;
    // Drizzle no califica las columnas dentro de las subconsultas: se escribe el nombre completo para no confundirlo con `i.id`.
    const cid = sql.raw('"asistente_conversacion"."id"');
    const cond: (SQL | undefined)[] = [];
    if (!this.veTodo(u)) cond.push(eq(c.usuarioOid, u.id));
    else if (q.usuario) cond.push(eq(c.usuarioOid, q.usuario));
    if (q.desde) cond.push(gte(c.createdAt, rangoMadrid(q.desde, q.desde)[0]));
    if (q.hasta) cond.push(lt(c.createdAt, rangoMadrid(q.hasta, q.hasta)[1]));
    if (q.conReceta !== undefined)
      cond.push(q.conReceta ? isNotNull(c.recetaLineaId) : sql`${c.recetaLineaId} is null`);
    const conValoracion = (valor?: string) =>
      sql`exists (select 1 from asistente_valoracion v join asistente_intercambio i on i.id = v.intercambio_id where i.conversacion_id = ${cid}${valor ? sql` and v.valor = ${valor}` : sql``})`;
    if (q.valoracion === 'sin_valorar') cond.push(sql`not ${conValoracion()}`);
    else if (q.valoracion) cond.push(conValoracion(q.valoracion));
    const donde = and(...cond);
    const [{ n } = { n: 0 }] = await this.d.db
      .select({ n: sql<number>`count(*)::int` })
      .from(c)
      .where(donde);
    const filas = await this.d.db
      .select({
        id: c.id,
        usuarioOid: c.usuarioOid,
        usuarioNombre: c.usuarioNombre,
        contextoTipo: c.contextoTipo,
        recetaLineaId: c.recetaLineaId,
        nregistro: c.nregistro,
        createdAt: c.createdAt,
        intercambios: sql<number>`(select count(*)::int from asistente_intercambio i where i.conversacion_id = ${cid})`,
        incorrectas: sql<number>`(select count(*)::int from asistente_valoracion v join asistente_intercambio i on i.id = v.intercambio_id where i.conversacion_id = ${cid} and v.valor = 'incorrecta')`,
        primeraPregunta: sql<
          string | null
        >`(select i.pregunta from asistente_intercambio i where i.conversacion_id = ${cid} order by i.orden limit 1)`,
      })
      .from(c)
      .where(donde)
      .orderBy(desc(c.createdAt))
      .limit(q.tamano)
      .offset((q.pagina - 1) * q.tamano);
    return {
      total: Number(n),
      items: filas.map((f) => ({
        id: f.id,
        usuario: { id: f.usuarioOid, nombre: f.usuarioNombre },
        contexto: this.contextoDe(f as unknown as Conversacion),
        primeraPregunta: f.primeraPregunta,
        intercambios: Number(f.intercambios),
        incorrectas: Number(f.incorrectas),
        createdAt: f.createdAt.toISOString(),
      })),
    };
  }

  /** Conversación completa con las versiones de reglas y de fuentes vigentes cuando se respondió (US4-AS2). */
  async detalle(id: string, u: Usuario) {
    const [conv] = await this.d.db
      .select()
      .from(asistenteConversacion)
      .where(eq(asistenteConversacion.id, id));
    if (!conv) throw new DomainError('NO_ENCONTRADO');
    if (conv.usuarioOid !== u.id && !this.veTodo(u)) throw new DomainError('ASISTENTE_CONVERSACION_AJENA');
    const filas = await this.d.db
      .select()
      .from(asistenteIntercambio)
      .where(eq(asistenteIntercambio.conversacionId, id))
      .orderBy(asc(asistenteIntercambio.orden));
    const vals = filas.length
      ? await this.d.db
          .select()
          .from(asistenteValoracion)
          .where(
            sql`${asistenteValoracion.intercambioId} in (${sql.join(
              filas.map((f) => sql`${f.id}`),
              sql`, `,
            )})`,
          )
      : [];
    return {
      id: conv.id,
      usuario: { id: conv.usuarioOid, nombre: conv.usuarioNombre },
      contexto: this.contextoDe(conv),
      estado: conv.estado,
      createdAt: conv.createdAt.toISOString(),
      intercambios: filas.map((f) => {
        const v = vals.find((x) => x.intercambioId === f.id);
        return this.aDto(f, v ? { valor: v.valor, comentario: v.comentario } : null);
      }),
    };
  }

  aDto(f: FilaIntercambio, valoracion: { valor: string; comentario: string | null } | null): IntercambioDto {
    return {
      id: f.id,
      orden: f.orden,
      pregunta: f.pregunta,
      piiEliminada: f.piiEliminada,
      estado: f.estado as IntercambioDto['estado'],
      tipo: (f.tipoRespuesta as IntercambioDto['tipo']) ?? null,
      texto: f.respuesta,
      fuentes: (f.fuentes ?? []) as IntercambioDto['fuentes'],
      simulaciones: (f.simulaciones ?? []) as IntercambioDto['simulaciones'],
      resultadoMotor: (f.contextoMotor ?? null) as IntercambioDto['resultadoMotor'],
      reglaVersion: f.reglaVersion,
      fuentesVersion: f.fuentesVersion,
      valoracion: valoracion as IntercambioDto['valoracion'],
      createdAt: f.createdAt.toISOString(),
    };
  }
}
