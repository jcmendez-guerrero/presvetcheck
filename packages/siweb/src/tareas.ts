import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { appendAudit, laboratorioSkuPrefijo, siwebTarea, type Db } from '@mmx/db';
import { normalizarCn, proponerNombre, proponerSku, siguienteCorrelativo, sugerirPrefijo } from '@mmx/domain';
import type { SiwebClient } from './client';
import type { VariantResolver } from './mapeo';
import type { Variant } from './schemas';

/**
 * Alta y edición de productos en Siweb360 (SPEC §5.2.2). La API pública no permite crear ni editar
 * productos o variantes: la app genera la propuesta y una tarea en la bandeja "Pendiente en Siweb360".
 */

export interface PropuestaAlta {
  sku: string;
  nombre: string;
  laboratorio: string | null;
  cn: string;
  nregistro: string | null;
  prefijo: string;
  correlativo: number;
  precioSugerido: string | null;
}

export interface PropuestaRenombrado {
  variantId: number;
  skuActual: string | null;
  skuNuevo: string;
  nombreActual: string | null;
  nombreNuevo: string;
  prefijo: string;
  correlativo: number;
}

export type ResultadoPrefijo =
  | { requierePrefijo: true; sugerido: string }
  | { requierePrefijo: false; prefijo: string };

/** Puerto de escritura de catálogo. v1: tareas manuales. TODO(decision D-04b) */
export interface SiwebCatalogWriter {
  readonly tipo: 'manual' | 'api';
  solicitarAlta(d: SolicitudAlta): Promise<{ tareaId: string; propuesta: PropuestaAlta } | ResultadoPrefijo>;
  solicitarRenombrado(
    d: SolicitudRenombrado,
  ): Promise<{ tareaId: string; propuesta: PropuestaRenombrado } | ResultadoPrefijo>;
}

export interface SolicitudAlta {
  cn: string;
  nregistro: string | null;
  nombre: string;
  labtitular: string;
  /** Prefijo confirmado por la persona la primera vez que aparece un laboratorio. */
  prefijoConfirmado?: string;
  precioSugerido?: string | null;
  origen: 'recepcion_linea' | 'mapeo' | 'dispensacion';
  origenId?: string | null;
  actor: string;
}

export interface SolicitudRenombrado {
  cn: string;
  nregistro: string | null;
  variante: Pick<Variant, 'id' | 'sku' | 'name' | 'product_name'>;
  labtitular: string;
  prefijoConfirmado?: string;
  actor: string;
}

export class SkuReservas {
  constructor(
    private readonly db: Db,
    private readonly client: SiwebClient,
  ) {}

  async prefijoDe(labtitular: string): Promise<ResultadoPrefijo> {
    const [r] = await this.db
      .select()
      .from(laboratorioSkuPrefijo)
      .where(eq(laboratorioSkuPrefijo.labtitularCimavet, labtitular));
    return r
      ? { requierePrefijo: false, prefijo: r.prefijo }
      : { requierePrefijo: true, sugerido: sugerirPrefijo(labtitular) };
  }

  /**
   * Reserva el siguiente correlativo del laboratorio (D-04c): max(usado en Siweb360, reservado en
   * tareas pendientes, último reservado) + 1, con bloqueo de fila para que dos tareas simultáneas no
   * propongan el mismo SKU.
   */
  async reservar(
    labtitular: string,
    prefijoConfirmado?: string,
  ): Promise<{ prefijo: string; correlativo: number } | ResultadoPrefijo> {
    const actual = await this.prefijoDe(labtitular);
    let prefijo: string;
    if (actual.requierePrefijo) {
      if (!prefijoConfirmado) return actual;
      prefijo = prefijoConfirmado.trim().toUpperCase();
      if (!/^[A-Z0-9]{2,12}$/.test(prefijo))
        throw new Error('El prefijo debe tener entre 2 y 12 letras o números');
      await this.db
        .insert(laboratorioSkuPrefijo)
        .values({ labtitularCimavet: labtitular, prefijo, ultimoReservado: 0 })
        .onConflictDoNothing();
    } else prefijo = actual.prefijo;

    // Fuera de la transacción: lectura de Siweb360 (paginada).
    const skus = (await this.client.variants({ search: `${prefijo}-` })).map((v) => v.sku ?? '');
    return this.db.transaction(async (tx) => {
      const [fila] = await tx
        .select()
        .from(laboratorioSkuPrefijo)
        .where(eq(laboratorioSkuPrefijo.labtitularCimavet, labtitular))
        .for('update');
      const pendientes = await tx
        .select({ n: siwebTarea.correlativoReservado })
        .from(siwebTarea)
        .where(
          and(
            eq(siwebTarea.prefijo, prefijo),
            eq(siwebTarea.estado, 'pendiente'),
            isNotNull(siwebTarea.correlativoReservado),
          ),
        );
      const correlativo = siguienteCorrelativo(skus, prefijo, [
        ...pendientes.map((p) => p.n as number),
        fila?.ultimoReservado ?? 0,
      ]);
      await tx
        .update(laboratorioSkuPrefijo)
        .set({ ultimoReservado: correlativo })
        .where(eq(laboratorioSkuPrefijo.labtitularCimavet, labtitular));
      return { prefijo, correlativo };
    });
  }
}

/** Implementación v1: tareas en la bandeja "Pendiente en Siweb360". */
export class ManualTaskCatalogWriter implements SiwebCatalogWriter {
  readonly tipo = 'manual' as const;
  constructor(
    private readonly db: Db,
    private readonly reservas: SkuReservas,
  ) {}

  async solicitarAlta(d: SolicitudAlta) {
    const r = await this.reservas.reservar(d.labtitular, d.prefijoConfirmado);
    if ('requierePrefijo' in r) return r;
    const cn = normalizarCn(d.cn);
    const propuesta: PropuestaAlta = {
      sku: proponerSku(r.prefijo, r.correlativo, cn),
      nombre: proponerNombre(d.nombre, cn),
      laboratorio: d.labtitular,
      cn,
      nregistro: d.nregistro,
      prefijo: r.prefijo,
      correlativo: r.correlativo,
      precioSugerido: d.precioSugerido ?? null,
    };
    const [t] = await this.db
      .insert(siwebTarea)
      .values({
        tipo: 'crear',
        cn,
        nregistro: d.nregistro,
        propuesta: propuesta as never,
        prefijo: r.prefijo,
        correlativoReservado: r.correlativo,
        origen: d.origen,
        origenId: d.origenId ?? null,
        creadaPor: d.actor,
      })
      .returning({ id: siwebTarea.id });
    return { tareaId: t!.id, propuesta };
  }

  async solicitarRenombrado(d: SolicitudRenombrado) {
    const r = await this.reservas.reservar(d.labtitular, d.prefijoConfirmado);
    if ('requierePrefijo' in r) return r;
    const cn = normalizarCn(d.cn);
    const propuesta: PropuestaRenombrado = {
      variantId: d.variante.id,
      skuActual: d.variante.sku ?? null,
      skuNuevo: proponerSku(r.prefijo, r.correlativo, cn),
      nombreActual: d.variante.product_name ?? d.variante.name ?? null,
      nombreNuevo: proponerNombre(d.variante.product_name ?? d.variante.name ?? '', cn),
      prefijo: r.prefijo,
      correlativo: r.correlativo,
    };
    const [t] = await this.db
      .insert(siwebTarea)
      .values({
        tipo: 'renombrar',
        cn,
        nregistro: d.nregistro,
        propuesta: propuesta as never,
        prefijo: r.prefijo,
        correlativoReservado: r.correlativo,
        origen: 'mapeo',
        creadaPor: d.actor,
      })
      .returning({ id: siwebTarea.id });
    return { tareaId: t!.id, propuesta };
  }
}

/**
 * Fábrica del escritor de catálogo. `SIWEB_CATALOG_WRITE=true` solo tendrá sentido si Siweb360
 * publica endpoints de alta/edición. TODO(decision D-04b)
 */
export function crearCatalogWriter(
  cfg: { catalogWrite: boolean },
  db: Db,
  reservas: SkuReservas,
): SiwebCatalogWriter {
  if (cfg.catalogWrite) {
    throw new Error(
      'SIWEB_CATALOG_WRITE=true: no hay ApiCatalogWriter porque la API pública de Siweb360 no permite alta/edición (D-04b)',
    );
  }
  return new ManualTaskCatalogWriter(db, reservas);
}

export interface ResultadoTareaHecha {
  variantId: number;
  skuReal: string | null;
  /** El SKU real no coincide con la propuesta: se guarda el real y se avisa. */
  skuDistinto: boolean;
}

/** Bandeja "Pendiente en Siweb360". */
export class BandejaSiweb {
  constructor(
    private readonly db: Db,
    private readonly client: SiwebClient,
    private readonly resolver: VariantResolver,
  ) {}

  pendientes() {
    return this.db
      .select()
      .from(siwebTarea)
      .where(eq(siwebTarea.estado, 'pendiente'))
      .orderBy(asc(siwebTarea.createdAt));
  }

  /**
   * Marca la tarea como hecha tras revalidar en Siweb360 (paso 2 de la resolución): se busca el SKU
   * propuesto y, si no está, el CN. Si el empleado usó otro SKU se guarda el real y se avisa.
   */
  async marcarHecha(id: string, actor: string): Promise<ResultadoTareaHecha> {
    const [t] = await this.db.select().from(siwebTarea).where(eq(siwebTarea.id, id));
    if (!t || t.estado !== 'pendiente') throw new Error('Tarea no encontrada o ya resuelta');
    const p = t.propuesta as { sku?: string; skuNuevo?: string; variantId?: number };
    const skuPropuesto = (p.sku ?? p.skuNuevo ?? '').toUpperCase();
    let variante: Variant | undefined = (await this.client.variants({ search: skuPropuesto })).find(
      (v) => (v.sku ?? '').toUpperCase() === skuPropuesto,
    );
    if (!variante && t.tipo === 'renombrar' && p.variantId) variante = await this.client.variant(p.variantId);
    if (!variante) {
      const r = await this.resolver.resolver(t.cn, null);
      if (r.estado === 'MAPEADO') variante = await this.client.variant(r.variantes[0]!.variantId);
    }
    if (!variante)
      throw new Error('No se encuentra el producto en Siweb360: comprueba el SKU o el CN en el nombre');
    await this.resolver.guardar(t.cn, variante, 'manual', actor);
    const skuDistinto = (variante.sku ?? '').toUpperCase() !== skuPropuesto;
    await this.db.transaction(async (tx) => {
      await tx
        .update(siwebTarea)
        .set({ estado: 'hecha', resueltaPor: actor, resueltaAt: new Date(), skuReal: variante.sku ?? null })
        .where(eq(siwebTarea.id, id));
      await appendAudit(tx, {
        actor,
        accion: 'siweb_tarea_hecha',
        entidad: 'siweb_tarea',
        entidadId: id,
        despues: { variantId: variante.id, sku: variante.sku, skuDistinto },
      });
    });
    return { variantId: variante.id, skuReal: variante.sku ?? null, skuDistinto };
  }

  async descartar(id: string, actor: string, motivo: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(siwebTarea)
        .set({ estado: 'descartada', resueltaPor: actor, resueltaAt: new Date() })
        .where(and(eq(siwebTarea.id, id), eq(siwebTarea.estado, 'pendiente')));
      await appendAudit(tx, {
        actor,
        accion: 'siweb_tarea_descartada',
        entidad: 'siweb_tarea',
        entidadId: id,
        despues: { motivo },
      });
    });
  }
}
