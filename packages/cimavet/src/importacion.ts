import { MAESTRA } from '@mmx/db';
import { nombreComercial } from '@mmx/domain';
import { normalizeText } from '@mmx/shared';
import type { CimavetRepository } from './repo';

/**
 * Datos de CIMAVet para las filas importadas (entradas y salidas anteriores a la app, ADR-14). Lo importado se
 * guarda con el nombre, el principio activo y la forma de CIMAVet, no con lo escrito a mano en el Excel; lo
 * usan la importación (API) y el job `importaciones-corregir` (worker) para que den lo mismo.
 */
export interface DatosCimavetFila {
  /** Cómo se ha identificado: por el código nacional (seguro) o por el nombre (con aviso). */
  por: 'cn' | 'nombre';
  /** Por CN, el de la presentación; por nombre, el del medicamento (no se sabe el formato del envase). */
  nombre: string;
  /** "amoxicilina 400 mg; ácido clavulánico 100 mg" (SPEC §4.8). */
  principioActivo: string | null;
  forma: string | null;
  /** Primera palabra del nombre comercial (3+ letras) para avisar si el nombre del fichero no la lleva. */
  marca: string | null;
}

const palabras = (s: string) =>
  normalizeText(s)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/);

/** ¿Lleva el nombre escrito la marca del medicamento? ("PROPALIN 100 ML" y PROPALIN 40 mg/ml…). */
export function llevaMarca(nombre: string, marca: string | null): boolean {
  return marca === null || palabras(nombre).includes(marca);
}

const marcaDe = (nombre: string) => {
  const m = normalizeText(nombreComercial(nombre)).split(' ')[0] ?? '';
  return m.length >= 3 ? m : null;
};

/** Consultas a la caché local de CIMAVet, con memoria (un fichero repite mucho los mismos medicamentos). */
export function datosCimavetImportacion(repo: CimavetRepository) {
  const porCn = new Map<string, Promise<DatosCimavetFila | null>>();
  const porNombre = new Map<string, Promise<DatosCimavetFila | null>>();

  async function delMedicamento(nregistro: string, nombre: string, por: DatosCimavetFila['por']) {
    const m = await repo.medicamento(nregistro);
    if (!m) return null;
    const formas = m.formaId !== null ? await repo.nombresMaestra(MAESTRA.FORMAS, [m.formaId]) : new Map<number, string>();
    return {
      por,
      nombre,
      principioActivo:
        m.composicion.pas.map((p) => [p.nombre.toLowerCase(), p.cantidad, p.unidad].filter(Boolean).join(' ')).join('; ') || null,
      forma: m.formaId !== null ? (formas.get(m.formaId) ?? null) : null,
      marca: marcaDe(m.nombre),
    };
  }

  return {
    /** Por código nacional (6 cifras; se ignora el dígito de control). Null si no está en CIMAVet. */
    cn(cn: string): Promise<DatosCimavetFila | null> {
      const k = cn.replace(/\D/g, '').slice(0, 6);
      if (!porCn.has(k))
        porCn.set(
          k,
          repo.presentacion(k).then((p) => (p ? delMedicamento(p.nregistro, p.nombre, 'cn') : null)),
        );
      return porCn.get(k)!;
    },
    /**
     * Por nombre, solo si hay un candidato claro (puntuación ≥ 0,5) cuya marca aparece en el nombre escrito.
     * Null si no se reconoce como medicamento de CIMAVet.
     */
    nombre(nombre: string): Promise<DatosCimavetFila | null> {
      const k = normalizeText(nombre);
      if (!porNombre.has(k))
        porNombre.set(
          k,
          repo.buscar(nombre, { limite: 3 }).then((cs) => {
            const c = cs.find((x) => x.puntuacion >= 0.5 && marcaDe(x.medicamento) !== null && llevaMarca(nombre, marcaDe(x.medicamento)));
            return c ? delMedicamento(c.nregistro, c.medicamento, 'nombre') : null;
          }),
        );
      return porNombre.get(k)!;
    },
  };
}

/**
 * Sustituye en la fila el nombre, el principio activo y la forma por los de CIMAVet (si CIMAVet no tiene alguno
 * de ellos, se queda el del fichero). El código nacional y el resto de columnas no se tocan.
 */
export function aplicarDatosCimavet<T extends { nombreFarmaco: string; principioActivo: string | null; forma: string | null }>(
  fila: T,
  c: DatosCimavetFila,
): T {
  return { ...fila, nombreFarmaco: c.nombre, principioActivo: c.principioActivo ?? fila.principioActivo, forma: c.forma ?? fila.forma };
}
