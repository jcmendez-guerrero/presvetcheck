import { desc, eq } from 'drizzle-orm';
import { appendAudit, entradaImportada, importacion, salidaImportada } from '@mmx/db';
import { analizarEntradas, analizarSalidas, leerHoja, sha256 } from '@mmx/reports';
import { DomainError } from '@mmx/shared';
import { ahoraDe, type AppDeps } from '../deps';
import type { ContextoPeticion } from './recetas';

const MAX_FILAS = 20_000;
const MUESTRA = 5;

/**
 * Importación de entradas y salidas anteriores a la app. Dos pasos: «analizar» (sin guardar: columnas
 * reconocidas, errores por fila y una muestra) e «importar» (solo si no hay errores). Lo importado aparece en los
 * registros e informes marcado como «importado»; se puede anular la importación entera (no se modifica ni borra).
 * Los datos del propietario de las salidas se guardan cifrados y nunca se devuelven en la muestra.
 */
export class ImportacionesService {
  constructor(private readonly d: AppDeps) {}

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

  private async analizar(tipo: 'entradas' | 'salidas', fichero: { nombre: string; bytes: Uint8Array }, plantilla: 'A' | 'B' | 'C' | null) {
    const h = await this.hoja(fichero);
    return tipo === 'entradas' ? analizarEntradas(h.cabecera, h.filas) : analizarSalidas(h.cabecera, h.filas, plantilla);
  }

  /** Vista previa: columnas, nº de filas válidas, errores por fila y una muestra (sin datos del propietario). */
  async vistaPrevia(tipo: 'entradas' | 'salidas', fichero: { nombre: string; bytes: Uint8Array }, plantilla: 'A' | 'B' | 'C' | null) {
    const a = await this.analizar(tipo, fichero, plantilla);
    const muestra = a.filas.slice(0, MUESTRA).map((f) => ('propietario' in f ? { ...f, propietario: f.propietario ? '(datos del propietario)' : null } : f));
    return { tipo, reconocidas: a.reconocidas, ignoradas: a.ignoradas, validas: a.filas.length, errores: a.errores.slice(0, 200), totalErrores: a.errores.length, muestra };
  }

  async importar(tipo: 'entradas' | 'salidas', fichero: { nombre: string; bytes: Uint8Array }, plantilla: 'A' | 'B' | 'C' | null, c: ContextoPeticion) {
    const h = await this.hoja(fichero);
    const ent = tipo === 'entradas' ? analizarEntradas(h.cabecera, h.filas) : null;
    const sal = tipo === 'salidas' ? analizarSalidas(h.cabecera, h.filas, plantilla) : null;
    const errores = ent?.errores ?? sal?.errores ?? [];
    const n = ent?.filas.length ?? sal?.filas.length ?? 0;
    if (errores.length) throw new DomainError('VALIDACION', `El fichero tiene ${errores.length} fila(s) con errores: corrígelas y vuelve a importarlo`, { errores: errores.slice(0, 50) });
    if (!n) throw new DomainError('VALIDACION', 'El fichero no tiene filas que importar');
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
      await appendAudit(tx, { actor: c.usuario.id, accion: 'importar_registros', entidad: 'importacion', entidadId: impId, despues: { tipo, filas: n, sha256: hash }, ip: c.ip, userAgent: c.userAgent });
      return impId;
    });
    return { id, filas: n };
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

