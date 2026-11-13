import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import {
  albaranDocumento,
  appendAudit,
  auditEvent,
  distribuidor,
  pedidoPendiente,
  recepcion,
  recepcionLinea,
  siwebVariantMap,
  MAESTRA,
} from '@mmx/db';
import { sha256 } from '@mmx/reports';
import { unirLecturas, type LecturaAlbaran } from '@mmx/extraction';
import {
  acumularEscaneo,
  avisosEntrada,
  calcularPrecioCoste,
  camposFaltantes,
  entradaCaducada,
  fechaEs,
  normalizarCn,
  precioConDescuento,
  totalesCompra,
  type LineaEntrada,
} from '@mmx/domain';
import { DomainError, MAX_PAGINAS_DOCUMENTO, normalizeText } from '@mmx/shared';
import { hoyDe, politica, type AppDeps } from '../deps';
import { MedicamentosService } from './medicamentos';
import { marcaPresente } from './identificacion';
import type { ContextoPeticion } from './recetas';

/** Tamaño máximo de todas las páginas de un albarán juntas: cada una se guarda en memoria al subirla. */
export const MAX_BYTES_ALBARAN = 25 * 1024 * 1024;

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
  /** Precio del documento antes del descuento y descuento en %; si vienen, el neto se calcula con ellos. */
  precioBruto?: string | null;
  descuentoPct?: number | null;
  actualizarStock?: boolean;
  actualizarPrecio?: boolean;
}

/** Recepción de mercancía (SPEC §4.9). */
export class RecepcionesService {
  private readonly med: MedicamentosService;
  constructor(private readonly d: AppDeps) {
    this.med = new MedicamentosService(d);
  }

  /** Distribuidor escrito a mano: el existente con el mismo nombre (sin distinguir mayúsculas ni tildes) o uno nuevo. */
  private async distribuidorPorNombre(nombre: string, c: ContextoPeticion) {
    const limpio = nombre.trim().replace(/\s+/g, ' ');
    const todos = await this.d.db.select().from(distribuidor);
    const existente = todos.find((x) => normalizeText(x.nombre) === normalizeText(limpio));
    if (existente) return existente;
    const [nuevo] = await this.d.db.insert(distribuidor).values({ nombre: limpio }).returning();
    await appendAudit(this.d.db, {
      actor: c.usuario.id,
      accion: 'distribuidor_alta',
      entidad: 'distribuidor',
      entidadId: nuevo!.id,
      despues: { nombre: limpio },
      ip: c.ip,
      userAgent: c.userAgent,
    });
    return nuevo!;
  }

  async crear(
    b: {
      distribuidorId?: string | undefined;
      distribuidor?: string | undefined;
      albaran: string | null;
      fechaCompra: string | null;
      fechaRecepcion?: string | null;
      /** Albarán ya leído (POST /api/recepciones/albaranes): se enlaza con su foto y lo leído. */
      documentoId?: string | null | undefined;
      /** La persona confirma que es otro albarán aunque coincida el número con uno ya registrado. */
      confirmarDuplicado?: boolean | undefined;
    },
    c: ContextoPeticion,
  ) {
    const [doc] = b.documentoId
      ? await this.d.db.select().from(albaranDocumento).where(eq(albaranDocumento.id, b.documentoId))
      : [];
    if (b.documentoId && (!doc || doc.recepcionId))
      throw new DomainError('VALIDACION', 'El documento leído no existe o ya pertenece a otra recepción', {
        campo: 'documentoId',
      });
    const [dist] = b.distribuidor
      ? [await this.distribuidorPorNombre(b.distribuidor, c)]
      : await this.d.db
          .select()
          .from(distribuidor)
          .where(and(eq(distribuidor.id, b.distribuidorId ?? ''), eq(distribuidor.activo, true)));
    if (!dist) throw new DomainError('VALIDACION', 'Distribuidor no válido');
    if (b.albaran && !b.confirmarDuplicado) {
      const dup = await this.duplicados(dist.id, b.albaran);
      if (dup.length)
        throw new DomainError(
          'CONFLICTO',
          `Ya hay una recepción del albarán ${b.albaran} de ${dist.nombre} (compra del ${fechaEs(dup[0]!.fechaCompra)}). Si es otro albarán distinto, confírmalo.`,
          { duplicados: dup },
        );
    }
    return this.d.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(recepcion)
        .values({
          distribuidorId: dist.id,
          albaran: b.albaran,
          fechaCompra: b.fechaCompra ?? hoyDe(this.d),
          fechaRecepcion: b.fechaRecepcion ?? hoyDe(this.d),
          empleado: c.usuario.id,
          ...(doc ? { lecturaDocumento: doc.lectura, documentoPath: doc.documentoPath } : {}),
        })
        .returning();
      if (doc)
        await tx.update(albaranDocumento).set({ recepcionId: r!.id }).where(eq(albaranDocumento.id, doc.id));
      await appendAudit(tx, {
        actor: c.usuario.id,
        accion: 'recepcion_crear',
        entidad: 'recepcion',
        entidadId: r!.id,
        despues: {
          distribuidor: dist.nombre,
          albaran: b.albaran,
          documento: doc?.id ?? null,
          duplicadoConfirmado: !!b.confirmarDuplicado,
        },
        ip: c.ip,
        userAgent: c.userAgent,
      });
      return r!;
    });
  }

  /**
   * Distribuidores para elegir al empezar una recepción: los ya usados en la app y los proveedores de Siweb360
   * (si Siweb360 no responde, solo los de la app). Sin duplicados (sin distinguir mayúsculas ni tildes).
   */
  async proveedores() {
    const locales = (await this.d.db.select().from(distribuidor).where(eq(distribuidor.activo, true))).map(
      (x) => ({ nombre: x.nombre, origen: 'app' as const }),
    );
    let siweb: { nombre: string; origen: 'siweb' }[] = [];
    let siwebDisponible = this.d.siweb !== null;
    if (this.d.siweb) {
      try {
        siweb = (await this.d.siweb.proveedores()).map((nombre) => ({ nombre, origen: 'siweb' as const }));
      } catch {
        siwebDisponible = false;
      }
    }
    const vistos = new Set<string>();
    const lista = [...locales, ...siweb].filter((p) => {
      const k = normalizeText(p.nombre);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    return { proveedores: lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), siwebDisponible };
  }

  /**
   * Lee el albarán o la factura con Document Intelligence y guarda la PROPUESTA (proveedor, número, fecha y
   * líneas con su medicamento de CIMAVet si se identifica). No añade ninguna línea: la persona revisa cada una
   * con el envase. Si la cabecera no tenía nº de albarán, se completa con el leído. Se guarda el documento.
   */
  async leerDocumento(id: string, doc: { bytes: Uint8Array; mime: string }, c: ContextoPeticion) {
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    if (r.estado !== 'ABIERTA') throw new DomainError('RECEPCION_NO_EDITABLE');
    if (!this.d.lectorAlbaranes)
      throw new DomainError(
        'EXTRACTOR_NO_CONFIGURADO',
        'La lectura de albaranes no está configurada (Document Intelligence)',
      );
    const lectura = await this.d.lectorAlbaranes.leer(doc.bytes, doc.mime);
    const lineas = await this.proponerLineas(lectura);
    const path = await this.guardarFichero(doc, `${id}/${Date.now()}`);
    const guardada = {
      proveedor: lectura.proveedor,
      numero: lectura.numero,
      fecha: lectura.fecha,
      totales: lectura.totales,
      modelo: lectura.modelo,
      simulada: this.d.lectorAlbaranes.simulado,
      lineas,
    };
    await this.d.db.transaction(async (tx) => {
      await tx.insert(albaranDocumento).values({
        sha256: sha256(doc.bytes),
        documentoPath: path,
        mime: doc.mime,
        lectura: guardada,
        recepcionId: id,
        creadoPor: c.usuario.id,
      });
      await tx
        .update(recepcion)
        .set({
          lecturaDocumento: guardada,
          documentoPath: path,
          ...(r.albaran ? {} : { albaran: lectura.numero }),
        })
        .where(eq(recepcion.id, id));
      await appendAudit(tx, {
        actor: c.usuario.id,
        accion: 'recepcion_leer_documento',
        entidad: 'recepcion',
        entidadId: id,
        despues: { lineas: lineas.length, modelo: lectura.modelo },
        ip: c.ip,
        userAgent: c.userAgent,
      });
    });
    return guardada;
  }

  /** Líneas leídas → propuesta con su medicamento de CIMAVet (por código nacional o, si no, por la marca). */
  private async proponerLineas(lectura: LecturaAlbaran) {
    const lineas = [];
    for (const l of lectura.lineas) {
      let candidato: { cn: string; nombre: string } | null = null;
      if (l.cn) {
        const p = await this.med.presentacion(l.cn);
        if (p) candidato = { cn: p.cn, nombre: p.nombre };
      }
      if (!candidato && l.descripcion) {
        // Sin código nacional válido: por nombre, solo si la marca del documento coincide (marcaPresente).
        const m = (await this.d.cimavet.buscar(l.descripcion, { limite: 3 })).find(
          (x) => x.puntuacion >= 0.5 && marcaPresente(l.descripcion as string, x),
        );
        if (m) candidato = { cn: m.cn, nombre: m.nombre };
      }
      lineas.push({
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        descuentoPct: l.descuentoPct,
        cn: l.cn,
        lote: l.lote,
        caducidad: l.caducidad,
        candidato,
      });
    }
    return lineas;
  }

  /** Guarda el albarán en el contenedor `albaranes`; devuelve la ruta dentro del contenedor. */
  private async guardarFichero(doc: { bytes: Uint8Array; mime: string }, base: string) {
    const ext = doc.mime === 'application/pdf' ? 'pdf' : (doc.mime.split('/')[1] ?? 'bin');
    const path = `${base}.${ext}`;
    await this.d.blob.put('albaranes', path, doc.bytes, doc.mime);
    return path;
  }

  /** Recepciones del mismo distribuidor con el mismo nº de albarán (sin distinguir espacios, guiones ni mayúsculas). */
  async duplicados(distribuidorId: string, numero: string) {
    const clave = (x: string) => normalizeText(x).replace(/[^a-z0-9]/g, '');
    if (!clave(numero)) return [];
    const filas = await this.d.db
      .select()
      .from(recepcion)
      .where(eq(recepcion.distribuidorId, distribuidorId));
    return filas
      .filter((r) => r.estado !== 'DESCARTADA' && r.albaran && clave(r.albaran) === clave(numero))
      .map((r) => ({ id: r.id, albaran: r.albaran, fechaCompra: r.fechaCompra, estado: r.estado }));
  }

  /** Distribuidor de la app (o proveedor de Siweb360) que mejor encaja con el proveedor leído del documento. */
  private async distribuidorSugerido(proveedor: string | null) {
    if (!proveedor) return null;
    const palabras = (x: string) =>
      new Set(
        normalizeText(x)
          .replace(/[^a-z0-9 ]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 2 && !['s l', 'sl', 'sa', 'slu', 'the'].includes(w)),
      );
    const leido = palabras(proveedor);
    let mejor: { nombre: string; parecido: number } | null = null;
    for (const p of (await this.proveedores()).proveedores) {
      const otro = palabras(p.nombre);
      const comunes = [...otro].filter((w) => leido.has(w)).length;
      const parecido = otro.size ? comunes / Math.min(otro.size, leido.size || 1) : 0;
      if (parecido >= 0.5 && (!mejor || parecido > mejor.parecido)) mejor = { nombre: p.nombre, parecido };
    }
    if (!mejor) return null;
    const todos = await this.d.db.select().from(distribuidor);
    const local = todos.find((x) => normalizeText(x.nombre) === normalizeText(mejor!.nombre));
    return { nombre: mejor.nombre, id: local?.id ?? null };
  }

  /**
   * Primer paso de una recepción desde el documento: lee el albarán o la factura (número, proveedor, fecha y
   * líneas con lote y caducidad), lo guarda con su foto en el contenedor `albaranes` y avisa si ya hay una
   * recepción del mismo albarán y distribuidor (o si este mismo fichero ya se registró). No crea la recepción:
   * la persona revisa la cabecera y la crea con `documentoId`.
   */
  async leerAlbaran(paginas: { bytes: Uint8Array; mime: string }[], c: ContextoPeticion) {
    if (!this.d.lectorAlbaranes)
      throw new DomainError(
        'EXTRACTOR_NO_CONFIGURADO',
        'La lectura de albaranes no está configurada (Document Intelligence): registra la recepción a mano',
      );
    if (paginas.length < 1 || paginas.length > MAX_PAGINAS_DOCUMENTO)
      throw new DomainError('VALIDACION', `Un albarán admite de 1 a ${MAX_PAGINAS_DOCUMENTO} páginas`);
    const total = paginas.reduce((n, p) => n + p.bytes.length, 0);
    if (total > MAX_BYTES_ALBARAN)
      throw new DomainError(
        'VALIDACION',
        `El albarán pesa demasiado: ${MAX_BYTES_ALBARAN / 1024 / 1024} MB como máximo entre todas las páginas`,
      );
    // Con una sola página es el hash del fichero, como antes; con varias, el de todas seguidas (sin copiarlas).
    const h = createHash('sha256');
    for (const p of paginas) h.update(p.bytes);
    const hash = h.digest('hex');
    // Envío repetido (doble pulsación, reintento de red): se devuelve la lectura que ya hay, sin leer otra vez.
    const [repetida] = await this.d.db
      .select({ id: albaranDocumento.id })
      .from(albaranDocumento)
      .where(
        and(
          eq(albaranDocumento.sha256, hash),
          eq(albaranDocumento.creadoPor, c.usuario.id),
          isNull(albaranDocumento.recepcionId),
        ),
      )
      .limit(1);
    if (repetida) return this.lectura(repetida.id);
    const lectura = unirLecturas(
      await Promise.all(paginas.map((p) => this.d.lectorAlbaranes!.leer(p.bytes, p.mime))),
    );
    const guardada = {
      proveedor: lectura.proveedor,
      numero: lectura.numero,
      fecha: lectura.fecha,
      totales: lectura.totales,
      modelo: lectura.modelo,
      simulada: this.d.lectorAlbaranes.simulado,
      lineas: await this.proponerLineas(lectura),
    };
    const base = `lecturas/${Date.now()}-${hash.slice(0, 12)}`;
    const ficheros: { path: string; mime: string }[] = [];
    for (const [i, p] of paginas.entries())
      ficheros.push({ path: await this.guardarFichero(p, `${base}-p${i + 1}`), mime: p.mime });
    const [fila] = await this.d.db
      .insert(albaranDocumento)
      .values({
        sha256: hash,
        documentoPath: ficheros[0]!.path,
        mime: ficheros[0]!.mime,
        paginas: ficheros,
        lectura: guardada,
        creadoPor: c.usuario.id,
      })
      .returning();
    await appendAudit(this.d.db, {
      actor: c.usuario.id,
      accion: 'albaran_leer',
      entidad: 'albaran_documento',
      entidadId: fila!.id,
      despues: { lineas: guardada.lineas.length, paginas: paginas.length, modelo: lectura.modelo },
      ip: c.ip,
      userAgent: c.userAgent,
    });
    return this.lectura(fila!.id);
  }

  /**
   * Lo leído de un albarán que aún no tiene recepción, con el distribuidor sugerido y los posibles duplicados
   * (se calculan al consultar). Lo usan la subida desde el ordenador y la que llega desde el móvil.
   */
  async lectura(documentoId: string) {
    const [fila] = await this.d.db
      .select()
      .from(albaranDocumento)
      .where(eq(albaranDocumento.id, documentoId));
    if (!fila) throw new DomainError('NO_ENCONTRADO');
    if (fila.recepcionId)
      throw new DomainError('VALIDACION', 'El documento leído no existe o ya pertenece a otra recepción', {
        campo: 'documentoId',
      });
    const lectura = fila.lectura as { proveedor: string | null; numero: string | null };
    const [mismo] = await this.d.db
      .select({ recepcionId: albaranDocumento.recepcionId })
      .from(albaranDocumento)
      .where(and(eq(albaranDocumento.sha256, fila.sha256), isNotNull(albaranDocumento.recepcionId)))
      .limit(1);
    const sugerido = await this.distribuidorSugerido(lectura.proveedor);
    return {
      documentoId: fila.id,
      lectura: fila.lectura,
      distribuidorSugerido: sugerido?.nombre ?? null,
      duplicados: sugerido?.id && lectura.numero ? await this.duplicados(sugerido.id, lectura.numero) : [],
      mismoFichero: mismo?.recepcionId ? { recepcionId: mismo.recepcionId } : null,
    };
  }

  /** Páginas guardadas del albarán de una recepción; nulo en los albaranes antiguos (una sola página). */
  private async paginasDelDocumento(recepcionId: string) {
    const [d] = await this.d.db
      .select({ paginas: albaranDocumento.paginas })
      .from(albaranDocumento)
      .where(eq(albaranDocumento.recepcionId, recepcionId))
      .limit(1);
    return d?.paginas ?? null;
  }

  /** Foto o PDF del albarán de una recepción. */
  async documento(id: string, pagina = 1) {
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r?.documentoPath) throw new DomainError('NO_ENCONTRADO');
    let path = r.documentoPath;
    if (pagina > 1) {
      const p = (await this.paginasDelDocumento(id))?.[pagina - 1];
      if (!p) throw new DomainError('NO_ENCONTRADO');
      path = p.path;
    }
    const b = await this.d.blob.get('albaranes', path.replace(/^albaranes\//, ''));
    if (!b) throw new DomainError('NO_ENCONTRADO');
    return b;
  }

  async listar(limite = 50) {
    return this.d.db
      .select()
      .from(recepcion)
      .where(ne(recepcion.estado, 'DESCARTADA'))
      .orderBy(desc(recepcion.createdAt))
      .limit(limite);
  }

  /**
   * Cambia la cabecera de una recepción abierta (distribuidor, nº de albarán, fechas, régimen). Si cambia el
   * régimen se recalcula el recargo de las líneas. Mismo aviso de duplicados que al crearla.
   */
  async editar(
    id: string,
    b: {
      distribuidor?: string | undefined;
      albaran?: string | null | undefined;
      fechaCompra?: string | undefined;
      fechaRecepcion?: string | null | undefined;
      regimen?: 'recargo_equivalencia' | 'nacional' | undefined;
      confirmarDuplicado?: boolean | undefined;
    },
    c: ContextoPeticion,
  ) {
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    if (r.estado !== 'ABIERTA') throw new DomainError('RECEPCION_NO_EDITABLE');
    const dist = b.distribuidor ? await this.distribuidorPorNombre(b.distribuidor, c) : null;
    const distribuidorId = dist?.id ?? r.distribuidorId;
    const albaran = b.albaran !== undefined ? b.albaran?.trim() || null : r.albaran;
    if (albaran && !b.confirmarDuplicado && (albaran !== r.albaran || distribuidorId !== r.distribuidorId)) {
      const dup = (await this.duplicados(distribuidorId, albaran)).filter((x) => x.id !== id);
      if (dup.length)
        throw new DomainError(
          'CONFLICTO',
          `Ya hay una recepción del albarán ${albaran} de ese distribuidor (compra del ${fechaEs(dup[0]!.fechaCompra)}). Si es otro albarán distinto, confírmalo.`,
          { duplicados: dup },
        );
    }
    const fechaCompra = b.fechaCompra ?? r.fechaCompra;
    const fechaRecepcion = b.fechaRecepcion !== undefined ? b.fechaRecepcion : r.fechaRecepcion;
    if (fechaRecepcion && fechaRecepcion < fechaCompra)
      throw new DomainError('VALIDACION', 'La mercancía no puede llegar antes de comprarla', {
        campo: 'fechaRecepcion',
      });
    const regimen = b.regimen ?? r.regimen;
    await this.d.db.transaction(async (tx) => {
      await tx
        .update(recepcion)
        .set({ distribuidorId, albaran, fechaCompra, fechaRecepcion, regimen })
        .where(eq(recepcion.id, id));
      if (regimen !== r.regimen) {
        const lineas = await tx.select().from(recepcionLinea).where(eq(recepcionLinea.recepcionId, id));
        for (const l of lineas) {
          const imp = this.importes(regimen, {
            bruto: l.precioBruto,
            descuentoPct: l.descuentoPct,
            neto: l.precioNetoCompra,
            iva: l.ivaPct !== null ? Number(l.ivaPct) : null,
          });
          await tx.update(recepcionLinea).set(imp).where(eq(recepcionLinea.id, l.id));
        }
      }
      await appendAudit(tx, {
        actor: c.usuario.id,
        accion: 'recepcion_editar',
        entidad: 'recepcion',
        entidadId: id,
        despues: { distribuidor: dist?.nombre ?? null, albaran, fechaCompra, fechaRecepcion, regimen },
        ip: c.ip,
        userAgent: c.userAgent,
      });
    });
    return this.detalle(id);
  }

  /** Descarta una recepción abierta que no hace falta: no se borra (queda con quién, cuándo y por qué). */
  async descartar(id: string, motivo: string, c: ContextoPeticion) {
    if (motivo.trim().length < 5)
      throw new DomainError('VALIDACION', 'Indica por qué se descarta (5 caracteres como mínimo)', {
        campo: 'motivo',
      });
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    if (r.estado !== 'ABIERTA')
      throw new DomainError(
        'RECEPCION_NO_EDITABLE',
        'Solo se puede descartar una recepción abierta: una finalizada se corrige con ajustes',
      );
    await this.d.db.transaction(async (tx) => {
      await tx
        .update(recepcion)
        .set({
          estado: 'DESCARTADA',
          descartadaAt: new Date(this.d.clock.now().epochMilliseconds),
          descartadaPor: c.usuario.id,
          motivoDescarte: motivo.trim(),
        })
        .where(eq(recepcion.id, id));
      await appendAudit(tx, {
        actor: c.usuario.id,
        accion: 'recepcion_descartar',
        entidad: 'recepcion',
        entidadId: id,
        despues: { motivo: motivo.trim() },
        ip: c.ip,
        userAgent: c.userAgent,
      });
    });
  }

  /**
   * Corrige la cabecera de una recepción ya finalizada (distribuidor, nº de albarán, fechas) cuando se registró
   * mal. Las líneas no cambian (son de solo inserción) ni el régimen (recalcularía sus importes). Pide motivo y
   * deja en la auditoría los valores de antes y de después.
   */
  async corregir(
    id: string,
    b: {
      distribuidor?: string | undefined;
      albaran?: string | null | undefined;
      fechaCompra?: string | undefined;
      fechaRecepcion?: string | null | undefined;
      motivo: string;
      confirmarDuplicado?: boolean | undefined;
    },
    c: ContextoPeticion,
  ) {
    const motivo = b.motivo.trim();
    if (motivo.length < 5)
      throw new DomainError('VALIDACION', 'Indica por qué se corrige (5 caracteres como mínimo)', {
        campo: 'motivo',
      });
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    if (r.estado === 'ABIERTA')
      throw new DomainError('VALIDACION', 'La recepción está abierta: modifícala directamente');
    if (r.estado === 'DESCARTADA')
      throw new DomainError('RECEPCION_NO_EDITABLE', 'Una recepción descartada no se corrige');
    const [distAntes] = await this.d.db
      .select()
      .from(distribuidor)
      .where(eq(distribuidor.id, r.distribuidorId));
    const nombreNuevo = b.distribuidor?.trim().replace(/\s+/g, ' ');
    const cambiaDist = !!nombreNuevo && normalizeText(nombreNuevo) !== normalizeText(distAntes?.nombre ?? '');
    const dist = cambiaDist ? await this.distribuidorPorNombre(nombreNuevo, c) : null;
    const distribuidorId = dist?.id ?? r.distribuidorId;
    const albaran = b.albaran !== undefined ? b.albaran?.trim() || null : r.albaran;
    const fechaCompra = b.fechaCompra ?? r.fechaCompra;
    const fechaRecepcion = b.fechaRecepcion !== undefined ? b.fechaRecepcion : r.fechaRecepcion;
    const hoy = hoyDe(this.d);
    if (fechaCompra > hoy)
      throw new DomainError('VALIDACION', 'La fecha de compra no puede ser posterior a hoy', {
        campo: 'fechaCompra',
      });
    if (fechaRecepcion && fechaRecepcion > hoy)
      throw new DomainError('VALIDACION', 'La fecha de recepción no puede ser posterior a hoy', {
        campo: 'fechaRecepcion',
      });
    if (fechaRecepcion && fechaRecepcion < fechaCompra)
      throw new DomainError('VALIDACION', 'La mercancía no puede llegar antes de comprarla', {
        campo: 'fechaRecepcion',
      });
    const antes = {
      distribuidor: distAntes?.nombre ?? null,
      albaran: r.albaran,
      fechaCompra: r.fechaCompra,
      fechaRecepcion: r.fechaRecepcion,
    };
    const despues = {
      distribuidor: dist?.nombre ?? antes.distribuidor,
      albaran,
      fechaCompra,
      fechaRecepcion,
    };
    const cambios = (Object.keys(antes) as Array<keyof typeof antes>).filter((k) => antes[k] !== despues[k]);
    if (!cambios.length) throw new DomainError('VALIDACION', 'No has cambiado ningún dato');
    if (albaran && !b.confirmarDuplicado && (albaran !== r.albaran || distribuidorId !== r.distribuidorId)) {
      const dup = (await this.duplicados(distribuidorId, albaran)).filter((x) => x.id !== id);
      if (dup.length)
        throw new DomainError(
          'CONFLICTO',
          `Ya hay una recepción del albarán ${albaran} de ese distribuidor (compra del ${fechaEs(dup[0]!.fechaCompra)}). Si es otro albarán distinto, confírmalo.`,
          { duplicados: dup },
        );
    }
    await this.d.db.transaction(async (tx) => {
      await tx
        .update(recepcion)
        .set({ distribuidorId, albaran, fechaCompra, fechaRecepcion })
        .where(eq(recepcion.id, id));
      await appendAudit(tx, {
        actor: c.usuario.id,
        accion: 'recepcion_corregir',
        entidad: 'recepcion',
        entidadId: id,
        antes: Object.fromEntries(cambios.map((k) => [k, antes[k]])),
        despues: { ...Object.fromEntries(cambios.map((k) => [k, despues[k]])), motivo },
        ip: c.ip,
        userAgent: c.userAgent,
      });
    });
    return this.detalle(id);
  }

  /** Correcciones de la cabecera tras finalizar (de la auditoría), de la más reciente a la más antigua. */
  private async correcciones(id: string) {
    const filas = await this.d.db
      .select({
        at: auditEvent.at,
        actor: auditEvent.actor,
        antes: auditEvent.antes,
        despues: auditEvent.despues,
      })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.entidad, 'recepcion'),
          eq(auditEvent.entidadId, id),
          eq(auditEvent.accion, 'recepcion_corregir'),
        ),
      )
      .orderBy(desc(auditEvent.seq));
    return filas.map((f) => {
      const { motivo, ...despues } = (f.despues ?? {}) as Record<string, string | null>;
      return {
        at: f.at,
        actor: f.actor,
        motivo: motivo ?? null,
        antes: (f.antes ?? {}) as Record<string, string | null>,
        despues,
      };
    });
  }

  async detalle(id: string) {
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    const [dist] = await this.d.db.select().from(distribuidor).where(eq(distribuidor.id, r.distribuidorId));
    const lineas = await this.d.db
      .select()
      .from(recepcionLinea)
      .where(eq(recepcionLinea.recepcionId, id))
      .orderBy(asc(recepcionLinea.numero));
    const cns = [...new Set(lineas.map((l) => l.cn).filter((x): x is string => !!x))];
    const mapeos = cns.length
      ? await this.d.db.select().from(siwebVariantMap).where(inArray(siwebVariantMap.cn, cns))
      : [];
    const skuDe = (variantId: number | null) =>
      variantId === null ? null : (mapeos.find((m) => m.variantId === variantId)?.sku ?? null);
    const totales = totalesCompra(
      lineas.map((l) => ({
        neto: l.precioNetoCompra,
        unidades: l.unidades,
        ivaPct: l.ivaPct,
        rePct: l.rePct,
      })),
    );
    return {
      ...r,
      totales,
      distribuidor: dist?.nombre ?? null,
      correcciones: r.estado === 'ABIERTA' ? [] : await this.correcciones(id),
      lectura: r.lecturaDocumento ?? null,
      documento: r.documentoPath
        ? {
            url: `/api/recepciones/${id}/documento`,
            pdf: r.documentoPath.endsWith('.pdf'),
            paginas: (await this.paginasDelDocumento(id))?.length ?? 1,
          }
        : null,
      fechaCorte: this.d.config.ENTRY_CUTOVER_DATE ?? null,
      escrituraStock: this.d.config.SIWEB_STOCK_WRITE_MODE,
      lineas: lineas.map((l) => ({
        ...l,
        siwebSku: skuDe(l.siwebVariantId),
        faltan: camposFaltantes(this.aEntrada(l)),
        avisos: avisosEntrada(
          this.aEntrada(l),
          hoyDe(this.d),
          this.d.config.ENTRY_MIN_SHELF_LIFE_DAYS,
          politica(this.d),
        ),
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
    this.comprobarCaducidad(b.caducidad, b.lote);
    const cn = b.cn ? normalizarCn(b.cn) : null;
    if (b.tipo === 'medicamento' && cn && b.cnEscaneado && normalizarCn(b.cnEscaneado) !== cn) {
      throw new DomainError(
        'VALIDACION',
        'El código nacional escaneado no coincide con el medicamento seleccionado',
        { cnEscaneado: b.cnEscaneado, cnSeleccionado: cn },
      );
    }
    const lineas = await this.d.db.select().from(recepcionLinea).where(eq(recepcionLinea.recepcionId, id));
    const existente = lineas.find(
      (l) => l.cn === cn && l.lote === b.lote && l.tipo === b.tipo && cn !== null,
    );
    if (existente) {
      const { linea, duplicado } = acumularEscaneo(
        { ...this.aEntrada(existente), unidades: existente.unidades },
        b.serie,
      );
      if (duplicado) return { linea: existente, duplicado: true };
      const extra = b.unidades - 1;
      const [u] = await this.d.db
        .update(recepcionLinea)
        .set({ unidades: (linea.unidades ?? 0) + extra, seriales: linea.seriales })
        .where(eq(recepcionLinea.id, existente.id))
        .returning();
      return { linea: u!, duplicado: false };
    }

    const { datos, siwebVariantId } = await this.datosProducto(b.tipo, cn, b.nombre);
    const imp = this.importes(r.regimen, {
      bruto: b.precioBruto,
      descuentoPct: b.descuentoPct,
      neto: b.precioNetoCompra,
      iva: b.ivaPct,
    });
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
        ...imp,
        origenDatos: datos.origen,
        siwebVariantId,
        actualizarStock: b.actualizarStock ?? true,
        actualizarPrecio: b.actualizarPrecio ?? true,
        empleado: c.usuario.id,
      })
      .returning();
    return { linea: nueva!, duplicado: false };
  }

  /** Un producto caducado no se recibe (se comprueba antes de guardar la línea). */
  private comprobarCaducidad(caducidad: string | null | undefined, lote: string | null | undefined) {
    if (caducidad && entradaCaducada(caducidad, hoyDe(this.d))) {
      throw new DomainError(
        'ENTRADA_CADUCADA',
        `${lote ? `El lote ${lote}` : 'El producto'} caducó el ${fechaEs(caducidad)}: no se puede dar entrada a un producto caducado.`,
        {
          campo: 'caducidad',
        },
      );
    }
  }

  /**
   * Importes de una línea: el neto sale del precio del documento menos el descuento (o se da directamente), y el
   * coste añade el recargo de equivalencia salvo en régimen «nacional» (solo IVA).
   */
  private importes(
    regimen: string,
    v: {
      bruto: string | null | undefined;
      descuentoPct: number | string | null | undefined;
      neto: string | null | undefined;
      iva: number | null | undefined;
    },
  ) {
    const bruto = v.bruto ?? null;
    const dto =
      v.descuentoPct !== null && v.descuentoPct !== undefined && Number(v.descuentoPct) > 0
        ? String(v.descuentoPct)
        : null;
    let neto = v.neto ?? null;
    if (bruto) {
      try {
        neto = precioConDescuento(bruto, dto);
      } catch (e) {
        throw new DomainError('VALIDACION', (e as Error).message, { campo: 'descuentoPct' });
      }
    }
    if (!neto)
      return {
        precioBruto: bruto,
        descuentoPct: dto,
        precioNetoCompra: null,
        ivaPct: v.iva !== null && v.iva !== undefined ? String(v.iva) : null,
        rePct: null,
        precioCoste: null,
      };
    const p = calcularPrecioCoste(neto, v.iva ?? null, this.d.rules.bundle.precios, {
      conRecargo: regimen !== 'nacional',
    });
    return {
      precioBruto: bruto,
      descuentoPct: dto,
      precioNetoCompra: neto,
      ivaPct: p.ivaPct.toString(),
      rePct: p.rePct.toString(),
      precioCoste: p.costeAlmacen,
    };
  }

  /**
   * Datos del producto: de un medicamento, SIEMPRE de CIMAVet (principio activo y forma). Si el código nacional
   * no está en CIMAVet se avisa de que no se ha encontrado (se puede registrar como «otro producto»).
   */
  private async datosProducto(tipo: 'medicamento' | 'producto', cn: string | null, nombre: string | null) {
    let datos = {
      nregistro: null as string | null,
      nombre,
      pa: null as string | null,
      forma: null as string | null,
      origen: 'manual' as 'cimavet' | 'manual',
    };
    let siwebVariantId: number | null = null;
    if (tipo === 'medicamento' && cn) {
      const pres = await this.med.presentacion(cn);
      const m = pres ? await this.med.info(pres.nregistro) : null;
      if (!pres || !m) {
        if (!nombre)
          throw new DomainError(
            'MEDICAMENTO_NO_EN_SISTEMA',
            `No se ha encontrado ningún medicamento con el código nacional ${cn} en CIMAVet. Comprueba el código o regístralo como «otro producto».`,
            { campo: 'cn' },
          );
      } else {
        datos = {
          nregistro: m.nregistro,
          nombre: pres.nombre,
          pa: this.med.textoPrincipiosActivos(m),
          forma: await this.med.nombreMaestra(MAESTRA.FORMAS, m.formaId),
          origen: 'cimavet',
        };
        if (this.d.siweb) {
          try {
            const res = await this.d.siweb.resolver.resolver(cn, {
              nombre: m.nombre,
              labtitular: m.labtitular,
            });
            if (res.estado === 'MAPEADO') siwebVariantId = res.variantes[0]?.variantId ?? null;
          } catch {
            // Siweb360 no responde: la línea quedará PENDIENTE_ALTA_SIWEB al finalizar y se podrá mapear después.
          }
        }
      }
    }
    const nombreFinal = datos.nombre;
    if (!nombreFinal)
      throw new DomainError(
        'VALIDACION',
        tipo === 'medicamento'
          ? 'Elige el medicamento (búscalo por nombre o escanea su código)'
          : 'Indica el nombre del producto',
        { campo: tipo === 'medicamento' ? 'cn' : 'nombre' },
      );
    return { datos: { ...datos, nombre: nombreFinal }, siwebVariantId };
  }

  /**
   * Modifica una línea mientras la recepción está abierta (después de finalizar, las líneas no se modifican:
   * las correcciones son contramovimientos). Queda auditado qué campos cambian.
   */
  async editarLinea(
    id: string,
    lineaId: string,
    b: {
      cn?: string | null | undefined;
      nombre?: string | null | undefined;
      lote?: string | null | undefined;
      caducidad?: string | null | undefined;
      unidades?: number | undefined;
      precioNetoCompra?: string | null | undefined;
      ivaPct?: number | null | undefined;
      precioBruto?: string | null | undefined;
      descuentoPct?: number | null | undefined;
      actualizarStock?: boolean | undefined;
      actualizarPrecio?: boolean | undefined;
      /** Variante de Siweb360 elegida para esta línea (tras relacionar el CN con su SKU). */
      siwebVariantId?: number | null | undefined;
    },
    c: ContextoPeticion,
  ) {
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r) throw new DomainError('NO_ENCONTRADO');
    if (r.estado !== 'ABIERTA') throw new DomainError('RECEPCION_NO_EDITABLE');
    const [l] = await this.d.db
      .select()
      .from(recepcionLinea)
      .where(and(eq(recepcionLinea.id, lineaId), eq(recepcionLinea.recepcionId, id)));
    if (!l) throw new DomainError('NO_ENCONTRADO');
    const lote = b.lote !== undefined ? b.lote : l.lote;
    const caducidad = b.caducidad !== undefined ? b.caducidad : l.caducidad;
    this.comprobarCaducidad(caducidad, lote);
    const cn = b.cn !== undefined ? (b.cn ? normalizarCn(b.cn) : null) : l.cn;
    const cambiaProducto =
      cn !== l.cn || (b.nombre !== undefined && b.nombre !== l.nombreFarmaco && l.tipo === 'producto');
    const producto = cambiaProducto
      ? await this.datosProducto(
          l.tipo as 'medicamento' | 'producto',
          cn,
          b.nombre ?? (l.tipo === 'producto' ? l.nombreFarmaco : null),
        )
      : null;
    const iva = b.ivaPct !== undefined ? b.ivaPct : l.ivaPct !== null ? Number(l.ivaPct) : null;
    const bruto =
      b.precioBruto !== undefined ? b.precioBruto : b.precioNetoCompra !== undefined ? null : l.precioBruto;
    const dto =
      b.descuentoPct !== undefined
        ? b.descuentoPct
        : b.precioNetoCompra !== undefined
          ? null
          : l.descuentoPct;
    const neto = b.precioNetoCompra !== undefined ? b.precioNetoCompra : l.precioNetoCompra;
    const imp = this.importes(r.regimen, { bruto, descuentoPct: dto, neto, iva });
    const cambios = {
      lote,
      caducidad,
      unidades: b.unidades ?? l.unidades,
      ...imp,
      actualizarStock: b.actualizarStock ?? l.actualizarStock,
      actualizarPrecio: b.actualizarPrecio ?? l.actualizarPrecio,
      ...(b.siwebVariantId !== undefined ? { siwebVariantId: b.siwebVariantId } : {}),
      ...(producto
        ? {
            cn,
            nregistro: producto.datos.nregistro,
            nombreFarmaco: producto.datos.nombre,
            principioActivoTxt: producto.datos.pa,
            formaTxt: producto.datos.forma,
            origenDatos: producto.datos.origen,
            siwebVariantId: producto.siwebVariantId,
          }
        : {}),
    };
    const [u] = await this.d.db.transaction(async (tx) => {
      const res = await tx
        .update(recepcionLinea)
        .set(cambios)
        .where(eq(recepcionLinea.id, lineaId))
        .returning();
      const campos = Object.keys(cambios).filter(
        (k) =>
          String((cambios as Record<string, unknown>)[k] ?? '') !==
          String((l as Record<string, unknown>)[k] ?? ''),
      );
      await appendAudit(tx, {
        actor: c.usuario.id,
        accion: 'recepcion_linea_editar',
        entidad: 'recepcion',
        entidadId: id,
        despues: { linea: l.numero, campos },
        ip: c.ip,
        userAgent: c.userAgent,
      });
      return res;
    });
    return { linea: u! };
  }

  async eliminarLinea(id: string, lineaId: string) {
    const [r] = await this.d.db.select().from(recepcion).where(eq(recepcion.id, id));
    if (!r || r.estado !== 'ABIERTA') throw new DomainError('RECEPCION_NO_EDITABLE');
    await this.d.db
      .delete(recepcionLinea)
      .where(and(eq(recepcionLinea.id, lineaId), eq(recepcionLinea.recepcionId, id)));
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
    if (incompletas.length)
      throw new DomainError('RECEPCION_INCOMPLETA', undefined, {
        lineas: incompletas.map((l) => ({ numero: l.numero, faltan: l.faltan })),
      });
    const res = await this.d.db.transaction(async (tx) => {
      // Solo si sigue abierta: un doble envío no vuelve a encolar ni devuelve las líneas sincronizadas a ENCOLADA.
      const [abierta] = await tx
        .update(recepcion)
        .set({ estado: 'FINALIZADA', finalizadaAt: new Date(this.d.clock.now().epochMilliseconds) })
        .where(and(eq(recepcion.id, id), eq(recepcion.estado, 'ABIERTA')))
        .returning({ id: recepcion.id });
      if (!abierta) throw new DomainError('RECEPCION_NO_EDITABLE');
      const enc = this.d.siweb
        ? await this.d.siweb.outbox.encolarRecepcion(tx, id)
        : { encoladas: 0, pendientesAlta: 0, escrituraDesactivada: true };
      if (!this.d.siweb)
        await tx.update(recepcion).set({ syncEstado: 'ESCRITURA_DESACTIVADA' }).where(eq(recepcion.id, id));
      const cns = det.lineas.map((l) => l.cn).filter((x): x is string => !!x);
      const pedidos = cns.length
        ? await tx
            .update(pedidoPendiente)
            .set({ estado: 'recibido' })
            .where(and(inArray(pedidoPendiente.cn, cns), eq(pedidoPendiente.estado, 'pendiente')))
            .returning({ id: pedidoPendiente.id })
        : [];
      await appendAudit(tx, {
        actor: c.usuario.id,
        accion: 'recepcion_finalizar',
        entidad: 'recepcion',
        entidadId: id,
        despues: { lineas: det.lineas.length, ...enc, pedidosRecibidos: pedidos.length },
        ip: c.ip,
        userAgent: c.userAgent,
      });
      return { ...enc, pedidosRecibidos: pedidos.length };
    });
    // Disparo inmediato del dispatcher (sin bloquear la respuesta).
    if (this.d.siweb && !res.escrituraDesactivada) void this.d.siweb.outbox.despachar().catch(() => {});
    return res;
  }
}
