import { desc, eq, sql } from 'drizzle-orm';
import { asistenteConsumoMes, type Db } from '@mmx/db';
import { costeEstimado, estadoConsumo, mesMadrid, type Precios } from '@mmx/assistant';
import { DomainError, type AppConfig, type ConsumoMesDto } from '@mmx/shared';

type Fila = typeof asistenteConsumoMes.$inferSelect;

export interface EstadoMes {
  fila: Fila;
  estado: ConsumoMesDto['estado'];
  usados: number;
  limiteEfectivo: number;
  porcentaje: number;
}

/**
 * Consumo mensual del asistente (FR-027a, FR-027b): incremento atómico por mes natural (Europe/Madrid), estado
 * derivado y marcas de aviso del 80 % y de pausa. Sin datos personales.
 */
export class ConsumoRepo {
  constructor(
    private readonly db: Db,
    private readonly config: Pick<
      AppConfig,
      'ASSISTANT_MONTHLY_TOKEN_LIMIT' | 'ASSISTANT_PRICE_IN_PER_1K_EUR' | 'ASSISTANT_PRICE_OUT_PER_1K_EUR'
    >,
  ) {}

  private precios(): Precios {
    return {
      entradaPor1k: this.config.ASSISTANT_PRICE_IN_PER_1K_EUR,
      salidaPor1k: this.config.ASSISTANT_PRICE_OUT_PER_1K_EUR,
    };
  }

  private derivar(fila: Fila): EstadoMes {
    const e = estadoConsumo({
      tokensEntrada: fila.tokensEntrada,
      tokensSalida: fila.tokensSalida,
      limiteTokens: fila.limiteTokens,
      limiteAmpliado: fila.limiteAmpliado,
    });
    return {
      fila,
      estado: e.estado,
      usados: e.usados,
      limiteEfectivo: e.limiteEfectivo,
      porcentaje: e.porcentaje,
    };
  }

  /** Fila del mes (se crea con el límite configurado si no existe). */
  async mes(ahora: Date): Promise<EstadoMes> {
    const mes = mesMadrid(ahora);
    await this.db
      .insert(asistenteConsumoMes)
      .values({ mes, limiteTokens: this.config.ASSISTANT_MONTHLY_TOKEN_LIMIT })
      .onConflictDoNothing();
    const [fila] = await this.db.select().from(asistenteConsumoMes).where(eq(asistenteConsumoMes.mes, mes));
    return this.derivar(fila as Fila);
  }

  /**
   * Suma el uso de una pregunta. Devuelve el estado resultante y si esta llamada es la que cruza el umbral del
   * aviso (para enviarlo una sola vez al mes).
   */
  async registrar(
    ahora: Date,
    uso: { entrada: number; salida: number },
  ): Promise<EstadoMes & { avisar: boolean }> {
    const mes = mesMadrid(ahora);
    const [fila] = await this.db
      .insert(asistenteConsumoMes)
      .values({
        mes,
        limiteTokens: this.config.ASSISTANT_MONTHLY_TOKEN_LIMIT,
        tokensEntrada: uso.entrada,
        tokensSalida: uso.salida,
        preguntas: 1,
      })
      .onConflictDoUpdate({
        target: asistenteConsumoMes.mes,
        set: {
          tokensEntrada: sql`${asistenteConsumoMes.tokensEntrada} + ${uso.entrada}`,
          tokensSalida: sql`${asistenteConsumoMes.tokensSalida} + ${uso.salida}`,
          preguntas: sql`${asistenteConsumoMes.preguntas} + 1`,
        },
      })
      .returning();
    let st = this.derivar(fila as Fila);
    let avisar = false;
    if (st.estado !== 'normal' && !st.fila.avisoEnviadoAt) {
      // Solo una llamada gana la marca: es la que envía el aviso.
      const marcada = await this.db
        .update(asistenteConsumoMes)
        .set({ avisoEnviadoAt: ahora })
        .where(sql`${asistenteConsumoMes.mes} = ${mes} and ${asistenteConsumoMes.avisoEnviadoAt} is null`)
        .returning();
      avisar = marcada.length > 0;
    }
    if (st.estado === 'en_pausa' && !st.fila.pausadoAt) {
      await this.db
        .update(asistenteConsumoMes)
        .set({ pausadoAt: ahora })
        .where(sql`${asistenteConsumoMes.mes} = ${mes} and ${asistenteConsumoMes.pausadoAt} is null`);
    }
    st = await this.mes(ahora);
    return { ...st, avisar };
  }

  /** Meses anteriores (más recientes primero), sin el actual. */
  async historico(ahora: Date, meses: number): Promise<EstadoMes[]> {
    const filas = await this.db
      .select()
      .from(asistenteConsumoMes)
      .orderBy(desc(asistenteConsumoMes.mes))
      .limit(meses + 1);
    return filas
      .filter((f) => f.mes !== mesMadrid(ahora))
      .slice(0, meses)
      .map((f) => this.derivar(f));
  }

  /** Amplía el límite del mes en curso (administración). Devuelve el estado anterior y el nuevo. */
  async ampliar(
    ahora: Date,
    limiteTokens: number,
    por: string,
  ): Promise<{ antes: EstadoMes; despues: EstadoMes }> {
    const antes = await this.mes(ahora);
    if (limiteTokens <= antes.usados) {
      throw new DomainError(
        'VALIDACION',
        `El nuevo límite debe superar lo ya consumido este mes (${antes.usados} tokens).`,
      );
    }
    await this.db
      .update(asistenteConsumoMes)
      .set({ limiteAmpliado: limiteTokens, ampliadoPor: por, ampliadoAt: ahora, pausadoAt: null })
      .where(eq(asistenteConsumoMes.mes, antes.fila.mes));
    return { antes, despues: await this.mes(ahora) };
  }

  dto(st: EstadoMes): ConsumoMesDto {
    const f = st.fila;
    return {
      mes: f.mes,
      tokensEntrada: f.tokensEntrada,
      tokensSalida: f.tokensSalida,
      preguntas: f.preguntas,
      limiteEfectivo: st.limiteEfectivo,
      porcentaje: st.porcentaje,
      estado: st.estado,
      costeEstimadoEur: costeEstimado(f.tokensEntrada, f.tokensSalida, this.precios()),
      ampliadoPor: f.ampliadoPor,
      ampliadoAt: f.ampliadoAt ? f.ampliadoAt.toISOString() : null,
    };
  }
}
