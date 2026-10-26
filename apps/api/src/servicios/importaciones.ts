import { desc, eq } from 'drizzle-orm';
import { appendAudit, entradaImportada, importacion, salidaImportada } from '@mmx/db';
import { analizarEntradas, analizarSalidas, leerHoja, sha256 } from '@mmx/reports';
import { DomainError, normalizeText } from '@mmx/shared';
import { MAESTRA } from '@mmx/db';
import { ahoraDe, type AppDeps } from '../deps';
import { marcaPresente } from './identificacion';
import { MedicamentosService } from './medicamentos';
import type { ContextoPeticion } from './recetas';

type FilaMedicamento = { fila: number; cn: string | null; nombreFarmaco: string; principioActivo: string | null; forma: string | null };
type Incidencias = { fila: number; mensajes: string[] }[];

const MAX_FILAS = 20_000;
const MUESTRA = 5;

/**
 * Importación de entradas y salidas anteriores a la app. Dos pasos: «analizar» (sin guardar: columnas
 * reconocidas, errores por fila y una muestra) e «importar» (solo si no hay errores). Lo importado aparece en los
 * registros e informes marcado como «importado»; se puede anular la importación entera (no se modifica ni borra).
 * Los datos del propietario de las salidas se guardan cifrados y nunca se devuelven en la muestra.
 */
export class ImportacionesService {
  private readonly med: MedicamentosService;
  constructor(private readonly d: AppDeps) {
    this.med = new MedicamentosService(d);
  }

  /**
   * Validación contra CIMAVet (la caché local del Nomenclátor y la API):
   * - con código nacional: tiene que existir en CIMAVet (si no, error de la fila). El principio activo y la forma
   *   vacíos se completan con los de CIMAVet; si el nombre no lleva la marca del medicamento, aviso;
   * - sin código nacional: si el nombre corresponde a un medicamento de CIMAVet, se importa con aviso y con su
   *   principio activo y forma; si no, no es un medicamento y no va al registro (se omite y se informa).
   */
  private async validarCimavet<T extends FilaMedicamento>(filas: T[]): Promise<{ filas: T[]; errores: Incidencias; avisos: Incidencias; omitidas: { fila: number; nombre: string }[] }> {
    const out: T[] = [];
    const errores: Incidencias = [];
    const avisos: Incidencias = [];
    const omitidas: { fila: number; nombre: string }[] = [];
    const porCn = new Map<string, Awaited<ReturnType<typeof this.datosCn>>>();
    const porNombre = new Map<string, Awaited<ReturnType<typeof this.datosNombre>>>();
    for (const f of filas) {
      if (f.cn) {
        const cn = f.cn.replace(/\D/g, '').slice(0, 6);
        if (!porCn.has(cn)) porCn.set(cn, await this.datosCn(cn));
        const c = porCn.get(cn);
        if (!c) {
          errores.push({ fila: f.fila, mensajes: [`El código nacional ${f.cn} no está en CIMAVet: revísalo`] });
          continue;
        }
        if (c.marca && !normalizeText(f.nombreFarmaco).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).includes(c.marca))
          avisos.push({ fila: f.fila, mensajes: [`El nombre no coincide con el del código nacional ${cn} en CIMAVet («${c.nombre}»)`] });
        out.push({ ...f, cn, principioActivo: f.principioActivo ?? c.pa, forma: f.forma ?? c.forma });
        continue;
      }
      const clave = normalizeText(f.nombreFarmaco);
      if (!porNombre.has(clave)) porNombre.set(clave, await this.datosNombre(f.nombreFarmaco));
      const m = porNombre.get(clave);
      if (!m) {
        omitidas.push({ fila: f.fila, nombre: f.nombreFarmaco });
        continue;
      }
      avisos.push({ fila: f.fila, mensajes: [`Sin código nacional: se identifica como ${m.nombre} en CIMAVet`] });
      out.push({ ...f, principioActivo: f.principioActivo ?? m.pa, forma: f.forma ?? m.forma });
    }
    return { filas: out, errores, avisos, omitidas };
  }

  private async datosCn(cn: string) {
    const pres = await this.med.presentacion(cn);
    const m = pres ? await this.med.info(pres.nregistro) : null;
    if (!pres || !m) return null;
    const marca = normalizeText(pres.nombre).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)[0] ?? '';
    return { nombre: pres.nombre, marca: marca.length >= 3 ? marca : null, pa: this.med.textoPrincipiosActivos(m), forma: await this.med.nombreMaestra(MAESTRA.FORMAS, m.formaId) };
  }

  private async datosNombre(nombre: string) {
    const c = (await this.d.cimavet.buscar(nombre, { limite: 3 })).find((x) => x.puntuacion >= 0.5 && marcaPresente(nombre, x));
    if (!c) return null;
    const m = await this.med.info(c.nregistro);
    return { nombre: c.nombre, pa: m ? this.med.textoPrincipiosActivos(m) : null, forma: m ? await this.med.nombreMaestra(MAESTRA.FORMAS, m.formaId) : null };
  }

  private async hoja(fichero: { nombre: string; bytes: Uint8Array }) {
    if (!/\.(xlsx|csv)$/i.test(fichero.nombre)) throw new DomainError('VALIDACION', 'El fichero debe ser Excel (.xlsx) o CSV', { campo: 'fichero' });
    let hoja;
    try {
      hoja = await leerHoja(fichero.bytes, fichero.nombre);
    } catch {
      throw new DomainError('VALIDACION', 'No se ha podido leer el fichero: comprueba que es un Excel (.xlsx) o un CSV', { campo: 'fichero' });
    }
    if (hoja.filas.length > MAX_FILAS) throw new DomainError('VALIDACION', `El fichero tiene más de ${MAX_FILAS} filas: divídelo en varios`);
    return hoja;
  }

  /** Formato del fichero (pura) y después CIMAVet. Las filas ya con error de formato no se consultan. */
  private async analizar(tipo: 'entradas' | 'salidas', fichero: { nombre: string; bytes: Uint8Array }, plantilla: 'A' | 'B' | 'C' | null) {
    const h = await this.hoja(fichero);
    const ent = tipo === 'entradas' ? analizarEntradas(h.cabecera, h.filas) : null;
    const sal = tipo === 'salidas' ? analizarSalidas(h.cabecera, h.filas, plantilla) : null;
    const base = (ent ?? sal)!;
    const vEnt = ent ? await this.validarCimavet(ent.filas) : null;
    const vSal = sal ? await this.validarCimavet(sal.filas) : null;
    const v = (vEnt ?? vSal)!;
    const errores = [...base.errores, ...v.errores].sort((a, b) => a.fila - b.fila);
    return { reconocidas: base.reconocidas, ignoradas: base.ignoradas, ent: vEnt?.filas ?? null, sal: vSal?.filas ?? null, errores, avisos: v.avisos, omitidas: v.omitidas };
  }

  /**
   * Vista previa: columnas, filas válidas (medicamentos validados en CIMAVet), errores y avisos por fila, filas
   * omitidas (no son medicamentos) y una muestra (sin datos del propietario).
   */
  async vistaPrevia(tipo: 'entradas' | 'salidas', fichero: { nombre: string; bytes: Uint8Array }, plantilla: 'A' | 'B' | 'C' | null) {
    const a = await this.analizar(tipo, fichero, plantilla);
    const filas: object[] = a.ent ?? a.sal ?? [];
    const muestra = filas.slice(0, MUESTRA).map((f) => ('propietario' in f ? { ...f, propietario: f.propietario ? '(datos del propietario)' : null } : f));
    return {
      tipo,
      reconocidas: a.reconocidas,
      ignoradas: a.ignoradas,
      validas: filas.length,
      errores: a.errores.slice(0, 200),
      totalErrores: a.errores.length,
      avisos: a.avisos.slice(0, 200),
      totalAvisos: a.avisos.length,
      omitidas: a.omitidas.slice(0, 200),
      totalOmitidas: a.omitidas.length,
      muestra,
    };
  }

  async importar(tipo: 'entradas' | 'salidas', fichero: { nombre: string; bytes: Uint8Array }, plantilla: 'A' | 'B' | 'C' | null, c: ContextoPeticion) {
    const a = await this.analizar(tipo, fichero, plantilla);
    const ent = a.ent ? { filas: a.ent } : null;
    const sal = a.sal ? { filas: a.sal } : null;
    const errores = a.errores;
    const n = ent?.filas.length ?? sal?.filas.length ?? 0;
    if (errores.length) throw new DomainError('VALIDACION', `El fichero tiene ${errores.length} fila(s) con errores: corrígelas y vuelve a importarlo`, { errores: errores.slice(0, 50) });
    if (!n) throw new DomainError('VALIDACION', a.omitidas.length ? 'El fichero no tiene medicamentos que importar (las filas no están en CIMAVet)' : 'El fichero no tiene filas que importar');
    const hash = sha256(fichero.bytes);
    const [repetida] = await this.d.db.select().from(importacion).where(eq(importacion.sha256, hash));
    if (repetida && !repetida.anuladaAt) throw new DomainError('CONFLICTO', `Este fichero ya se importó el ${repetida.createdAt.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' })}`);
    const cf = this.d.cipher;
    const id = await this.d.db.transaction(async (tx) => {
      const [imp] = await tx.insert(importacion).values({ tipo, fichero: fichero.nombre.slice(0, 200), sha256: hash, filas: n, creadaPor: c.usuario.id, createdAt: ahoraDe(this.d) }).returning();
      const impId = imp!.id;
      const lote = 500;
      if (ent) {
        for (let i = 0; i < ent.filas.length; i += lote) await tx.insert(entradaImportada).values(ent.filas.slice(i, i + lote).map((f) => ({ ...f, importacionId: impId })));
      }
      if (sal) {
        const filas = sal.filas.map(({ propietario, ...resto }) => ({
          ...resto,
          importacionId: impId,
          propietarioNombreEnc: cf.encrypt(propietario?.nombre ?? null),
          propietarioMovilEnc: cf.encrypt(propietario?.movil ?? null),
          propietarioDniEnc: cf.encrypt(propietario?.dni ?? null),
          propietarioDireccionEnc: cf.encrypt(propietario?.direccion ?? null),
        }));
        for (let i = 0; i < filas.length; i += lote) await tx.insert(salidaImportada).values(filas.slice(i, i + lote));
      }
      await appendAudit(tx, { actor: c.usuario.id, accion: 'importar_registros', entidad: 'importacion', entidadId: impId, despues: { tipo, filas: n, omitidas: a.omitidas.length, sha256: hash }, ip: c.ip, userAgent: c.userAgent });
      return impId;
    });
    return { id, filas: n, omitidas: a.omitidas.length };
  }

  listar() {
    return this.d.db.select().from(importacion).orderBy(desc(importacion.createdAt)).limit(100);
  }

  /** Anula una importación: sus filas dejan de contar en registros e informes (siguen guardadas y auditadas). */
  async anular(id: string, motivo: string, c: ContextoPeticion) {
    if (motivo.trim().length < 10) throw new DomainError('VALIDACION', 'Explica el motivo de la anulación (10 caracteres como mínimo)', { campo: 'motivo' });
    const [imp] = await this.d.db.select().from(importacion).where(eq(importacion.id, id));
    if (!imp) throw new DomainError('NO_ENCONTRADO');
    if (imp.anuladaAt) throw new DomainError('ANULACION_DUPLICADA', 'Esta importación ya está anulada');
    await this.d.db.transaction(async (tx) => {
      await tx.update(importacion).set({ anuladaAt: ahoraDe(this.d), anuladaPor: c.usuario.id, motivoAnulacion: motivo.trim() }).where(eq(importacion.id, id));
      await appendAudit(tx, { actor: c.usuario.id, accion: 'anular_importacion', entidad: 'importacion', entidadId: id, despues: { motivo: motivo.trim() }, ip: c.ip, userAgent: c.userAgent });
    });
  }
}

