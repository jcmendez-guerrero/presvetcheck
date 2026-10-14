import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { appendAudit, distribuidor, pedidoPendiente, recepcion, recepcionLinea, MAESTRA } from '@mmx/db';
import { acumularEscaneo, avisosEntrada, calcularPrecioCoste, camposFaltantes, normalizarCn, type LineaEntrada } from '@mmx/domain';
import { DomainError } from '@mmx/shared';
import { hoyDe, politica, type AppDeps } from '../deps';
import { MedicamentosService } from './medicamentos';
import type { ContextoPeticion } from './recetas';

export interface NuevaLineaEntrada {
  tipo: 'medicamento' | 'producto';
  cn: string | null;
  nombre: string | null;
  lote: string | null;
  caducidad: string | null;
  unidades: number;
  serie: string | null;
  gtin: string | null;
  /** CN leído del código; si no coincide con el seleccionado → bloqueo (camino A). */
  cnEscaneado: string | null;
  precioNetoCompra: string | null;
  ivaPct: number | null;
}

/** Recepción de mercancía (SPEC §4.9). */
export class RecepcionesService {
  private readonly med: MedicamentosService;
  constructor(private readonly d: AppDeps) {
    this.med = new MedicamentosService(d);
  }

  async crear(b: { distribuidorId: string; albaran: string | null; fechaCompra: string | null }, c: ContextoPeticion) {
    const [dist] = await this.d.db.select().from(distribuidor).where(and(eq(distribuidor.id, b.distribuidorId), eq(distribuidor.activo, true)));
    if (!dist) throw new DomainError('VALIDACION', 'Distribuidor no válido');
    return this.d.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(recepcion)
        .values({ distribuidorId: b.distribuidorId, albaran: b.albaran, fechaCompra: b.fechaCompra ?? hoyDe(this.d), empleado: c.usuario.id })
        .returning();
      await appendAudit(tx, { actor: c.usuario.id, accion: 'recepcion_crear', entidad: 'recepcion', entidadId: r!.id, despues: { distribuidor: dist.nombre }, ip: c.ip, userAgent: c.userAgent });
      return r!;
    });
  }

  async listar(limite = 50) {
    return this.d.db.select().from(recepcion).orderBy(desc(recepcion.createdAt)).limit(limite);
  }

  async detalle(id: string) {
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    const [dist] = await this.d.db.select().from(distribuidor).where(eq(distribuidor.id, r.distribuidorId));
    const lineas = await this.d.db.select().from(recepcionLinea).where(eq(recepcionLinea.recepcionId, id)).orderBy(asc(recepcionLinea.numero));
    return {
      ...r,
      distribuidor: dist?.nombre ?? null,
      fechaCorte: this.d.config.ENTRY_CUTOVER_DATE ?? null,
      escrituraStock: this.d.config.SIWEB_STOCK_WRITE_MODE,
      lineas: lineas.map((l) => ({
        ...l,
        faltan: camposFaltantes(this.aEntrada(l)),
        avisos: avisosEntrada(this.aEntrada(l), hoyDe(this.d), this.d.config.ENTRY_MIN_SHELF_LIFE_DAYS, politica(this.d)),
      })),
    };
  }

  private aEntrada(l: typeof recepcionLinea.$inferSelect): LineaEntrada {
    return {
      tipo: l.tipo as LineaEntrada['tipo'],
      unidades: l.unidades,
      nombreFarmaco: l.nombreFarmaco,
      principioActivo: l.principioActivoTxt,
      forma: l.formaTxt,
      caducidad: l.caducidad,
      lote: l.lote,
      cn: l.cn,
      seriales: l.seriales ?? [],
    };
  }

  /**
   * Añade una línea (o suma unidades si ya existe el mismo CN + lote, deduplicando por nº de serie).
   * Principio activo y forma salen SIEMPRE de CIMAVet; si no se encuentra el producto → origen manual.
   */
  async anadirLinea(id: string, b: NuevaLineaEntrada, c: ContextoPeticion) {
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    if (r.estado !== 'ABIERTA') throw new DomainError('RECEPCION_NO_EDITABLE');
    const cn = b.cn ? normalizarCn(b.cn) : null;
    if (b.tipo === 'medicamento' && cn && b.cnEscaneado && normalizarCn(b.cnEscaneado) !== cn) {
      throw new DomainError('VALIDACION', 'El código nacional escaneado no coincide con el medicamento seleccionado', { cnEscaneado: b.cnEscaneado, cnSeleccionado: cn });
    }
    const lineas = await this.d.db.select().from(recepcionLinea).where(eq(recepcionLinea.recepcionId, id));
    const existente = lineas.find((l) => l.cn === cn && l.lote === b.lote && l.tipo === b.tipo && cn !== null);
    if (existente) {
      const { linea, duplicado } = acumularEscaneo({ ...this.aEntrada(existente), unidades: existente.unidades }, b.serie);
      if (duplicado) return { linea: existente, duplicado: true };
      const extra = b.unidades - 1;
      const [u] = await this.d.db
        .update(recepcionLinea)
        .set({ unidades: (linea.unidades ?? 0) + extra, seriales: linea.seriales })
        .where(eq(recepcionLinea.id, existente.id))
        .returning();
      return { linea: u!, duplicado: false };
    }

    let datos = { nregistro: null as string | null, nombre: b.nombre, pa: null as string | null, forma: null as string | null, origen: 'manual' as 'cimavet' | 'manual' };
    let siwebVariantId: number | null = null;
    if (b.tipo === 'medicamento' && cn) {
      const pres = await this.med.presentacion(cn);
      const m = pres ? await this.med.info(pres.nregistro) : null;
      if (pres && m) {
        datos = {
          nregistro: m.nregistro,
          nombre: pres.nombre,
          pa: this.med.textoPrincipiosActivos(m),
          forma: await this.med.nombreMaestra(MAESTRA.FORMAS, m.formaId),
          origen: 'cimavet',
        };
        if (this.d.siweb) {
          try {
            const res = await this.d.siweb.resolver.resolver(cn, { nombre: m.nombre, labtitular: m.labtitular });
            if (res.estado === 'MAPEADO') siwebVariantId = res.variantes[0]?.variantId ?? null;
          } catch {
            // Siweb360 no responde: la línea quedará PENDIENTE_ALTA_SIWEB al finalizar y se podrá mapear después.
          }
        }
      }
    }
    if (!datos.nombre) throw new DomainError('VALIDACION', 'Indica el nombre del producto');
    let precio: { coste: string; re: string; iva: string } | null = null;
    if (b.precioNetoCompra) {
      const p = calcularPrecioCoste(b.precioNetoCompra, b.ivaPct, this.d.rules.bundle.precios);
      precio = { coste: p.costeAlmacen, re: p.rePct.toString(), iva: p.ivaPct.toString() };
    }
    const numero = Math.max(0, ...lineas.map((l) => l.numero)) + 1;
    const [nueva] = await this.d.db
      .insert(recepcionLinea)
      .values({
        recepcionId: id,
        numero,
        tipo: b.tipo,
        cn,
        nregistro: datos.nregistro,
        nombreFarmaco: datos.nombre,
        principioActivoTxt: datos.pa,
        formaTxt: datos.forma,
        lote: b.lote,
        caducidad: b.caducidad,
        unidades: b.unidades,
        seriales: b.serie ? [b.serie] : [],
        gtin: b.gtin,
        precioNetoCompra: b.precioNetoCompra,
        ivaPct: precio?.iva ?? null,
        rePct: precio?.re ?? null,
        precioCoste: precio?.coste ?? null,
        origenDatos: datos.origen,
        siwebVariantId,
        empleado: c.usuario.id,
      })
      .returning();
    return { linea: nueva!, duplicado: false };
  }

  async eliminarLinea(id: string, lineaId: string) {
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r || r.estado !== 'ABIERTA') throw new DomainError('RECEPCION_NO_EDITABLE');
    await this.d.db.delete(recepcionLinea).where(and(eq(recepcionLinea.id, lineaId), eq(recepcionLinea.recepcionId, id)));
  }

  /**
   * Finaliza: valida completitud, bloquea la edición y encola los ajustes de stock en el outbox si la
   * política lo permite (SIWEB_STOCK_WRITE_MODE). Avisa de pedidos pendientes de esos CN.
   */
  async finalizar(id: string, c: ContextoPeticion) {
    const det = await this.detalle(id);
    if (det.estado !== 'ABIERTA') throw new DomainError('RECEPCION_NO_EDITABLE');
    if (!det.lineas.length) throw new DomainError('RECEPCION_INCOMPLETA', 'La recepción no tiene líneas');
    const incompletas = det.lineas.filter((l) => l.faltan.length);
    if (incompletas.length) throw new DomainError('RECEPCION_INCOMPLETA', undefined, { lineas: incompletas.map((l) => ({ numero: l.numero, faltan: l.faltan })) });
    const res = await this.d.db.transaction(async (tx) => {
      await tx.update(recepcion).set({ estado: 'FINALIZADA', finalizadaAt: new Date(this.d.clock.now().epochMilliseconds) }).where(eq(recepcion.id, id));
      const enc = this.d.siweb ? await this.d.siweb.outbox.encolarRecepcion(tx, id) : { encoladas: 0, pendientesAlta: 0, escrituraDesactivada: true };
      if (!this.d.siweb) await tx.update(recepcion).set({ syncEstado: 'ESCRITURA_DESACTIVADA' }).where(eq(recepcion.id, id));
      const cns = det.lineas.map((l) => l.cn).filter((x): x is string => !!x);
      const pedidos = cns.length
        ? await tx.update(pedidoPendiente).set({ estado: 'recibido' }).where(and(inArray(pedidoPendiente.cn, cns), eq(pedidoPendiente.estado, 'pendiente'))).returning({ id: pedidoPendiente.id })
        : [];
      await appendAudit(tx, { actor: c.usuario.id, accion: 'recepcion_finalizar', entidad: 'recepcion', entidadId: id, despues: { lineas: det.lineas.length, ...enc, pedidosRecibidos: pedidos.length }, ip: c.ip, userAgent: c.userAgent });
      return { ...enc, pedidosRecibidos: pedidos.length };
    });
    // Disparo inmediato del dispatcher (sin bloquear la respuesta).
    if (this.d.siweb && !res.escrituraDesactivada) void this.d.siweb.outbox.despachar().catch(() => {});
    return res;
  }
}
