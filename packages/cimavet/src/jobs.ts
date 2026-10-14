import type { CimavetClient } from './client';
import { importarNomenclator, fechaListado, type InformeCarga } from './nomenclator';
import { registroDesdeApi } from './normalizar';
import type { CimavetRepository } from './repo';
import { fechaCimavet, idNum } from './schemas';

/** Dependencias comunes de los jobs (el reloj es inyectable para los tests). */
export interface DepsCimavet {
  client: CimavetClient;
  repo: CimavetRepository;
  now?: () => Date;
  log?: (msg: string, datos?: Record<string, unknown>) => void;
}

const DIA = 24 * 3600 * 1000;
const isoDia = (d: Date) => d.toISOString().slice(0, 10);

/** Refresca un medicamento desde la API (medicamento + presentaciones). Devuelve false si no existe. */
export async function refrescarDesdeApi(deps: DepsCimavet, nregistro: string): Promise<boolean> {
  const now = (deps.now ?? (() => new Date()))();
  const med = await deps.client.medicamento({ nregistro });
  if (!med) return false;
  const pres = med.data.presentaciones?.length ? undefined : (await deps.client.presentaciones({ nregistro })).map((p) => p.data);
  await deps.repo.upsert([registroDesdeApi(med.data, med.raw, now, pres)]);
  if (med.data.notas) {
    const notas = await deps.client.notas(nregistro);
    await deps.repo.guardarNotas(
      nregistro,
      notas.map((n) => ({ num: n.data.num, ref: n.data.ref ?? null, asunto: n.data.asunto ?? null, fecha: fechaCimavet(n.data.fecha), url: n.data.url ?? null })),
    );
  }
  return true;
}

/**
 * Sincronización incremental diaria (job `cimavet-delta`, 06:30): `registroCambios` desde la
 * última sincronización − 1 día; para cada nregistro cambiado, medicamento + presentaciones.
 * Bajas (tipoCambio 2) → se marca el estado; nunca se borra.
 */
export async function jobCimavetDelta(deps: DepsCimavet) {
  const now = deps.now ?? (() => new Date());
  const inicio = now();
  const runId = await deps.repo.iniciarSync('delta', inicio);
  const contadores = { cambios: 0, actualizados: 0, bajas: 0, errores: 0, desde: '' };
  try {
    const ultima = (await deps.repo.ultimaSyncCorrecta()) ?? new Date(inicio.getTime() - 7 * DIA);
    contadores.desde = isoDia(new Date(ultima.getTime() - DIA));
    const cambios = await deps.client.registroCambios(contadores.desde);
    const porNreg = new Map(cambios.map((c) => [c.data.nregistro, c.data]));
    contadores.cambios = porNreg.size;
    for (const [nregistro, c] of porNreg) {
      try {
        const existe = await refrescarDesdeApi(deps, nregistro);
        if (c.tipocambio === 2 || !existe) {
          await deps.repo.marcarBaja(nregistro, fechaCimavet(c.fecha), now());
          contadores.bajas++;
        } else contadores.actualizados++;
      } catch (e) {
        contadores.errores++;
        deps.log?.('cimavet-delta: error en un medicamento', { nregistro, error: (e as Error).message });
      }
    }
    await deps.repo.finalizarSync(runId, now(), contadores, contadores.errores ? `${contadores.errores} errores` : null);
    return contadores;
  } catch (e) {
    await deps.repo.finalizarSync(runId, now(), contadores, (e as Error).message);
    throw e;
  }
}

/** Maestras de la API que se reimportan en el refresco completo. */
export const MAESTRAS_REFRESCO = [1, 2, 3, 4, 5, 7, 11] as const;

/**
 * Refresco completo semanal (job `cimavet-full`, domingo 03:00): refresca los nregistro con más de
 * 7 días en caché y reimporta las maestras. Si se aporta un Nomenclátor nuevo se usa en su lugar.
 */
export async function jobCimavetFull(deps: DepsCimavet & { nomenclatorPath?: string; limite?: number }) {
  const now = deps.now ?? (() => new Date());
  if (deps.nomenclatorPath) return jobNomenclatorImport({ repo: deps.repo, path: deps.nomenclatorPath, now });
  const inicio = now();
  const runId = await deps.repo.iniciarSync('full', inicio);
  const contadores = { refrescados: 0, noEncontrados: 0, errores: 0, maestras: 0 };
  try {
    for (const maestra of MAESTRAS_REFRESCO) {
      try {
        const items = await deps.client.maestras(maestra);
        contadores.maestras += await deps.repo.upsertMaestras(
          maestra,
          items
            .map((i) => ({ id: idNum(i.data.id), codigo: i.data.codigo ?? null, nombre: i.data.nombre ?? '' }))
            .filter((i) => i.nombre),
        );
      } catch (e) {
        contadores.errores++;
        deps.log?.('cimavet-full: error en maestra', { maestra, error: (e as Error).message });
      }
    }
    const antiguos = await deps.repo.nregistrosAntiguos(new Date(inicio.getTime() - 7 * DIA), deps.limite ?? 5000);
    for (const nregistro of antiguos) {
      try {
        if (await refrescarDesdeApi(deps, nregistro)) contadores.refrescados++;
        else contadores.noEncontrados++;
      } catch (e) {
        contadores.errores++;
        deps.log?.('cimavet-full: error en un medicamento', { nregistro, error: (e as Error).message });
      }
    }
    await deps.repo.finalizarSync(runId, now(), contadores, contadores.errores ? `${contadores.errores} errores` : null);
    return contadores;
  } catch (e) {
    await deps.repo.finalizarSync(runId, now(), contadores, (e as Error).message);
    throw e;
  }
}

/** Carga inicial desde el Nomenclátor (job manual `nomenclator-import`). */
export async function jobNomenclatorImport(deps: { repo: CimavetRepository; path: string; now?: () => Date }): Promise<InformeCarga> {
  const now = deps.now ?? (() => new Date());
  const runId = await deps.repo.iniciarSync('nomenclator', now());
  try {
    const dic = await deps.repo.diccionarios();
    const informe = await importarNomenclator(deps.path, deps.repo, dic, { fetchedAt: now() });
    informe.listado = await fechaListado(deps.path);
    await deps.repo.finalizarSync(runId, now(), informe);
    return informe;
  } catch (e) {
    await deps.repo.finalizarSync(runId, now(), null, (e as Error).message);
    throw e;
  }
}

/**
 * Verificación en vivo al dispensar (SPEC §4.2.4): si la caché del registro tiene más de
 * `maxAgeH` horas se consulta CIMAVet; si no responde, se usa la caché y se informa de la fecha.
 */
export async function verificarEnVivo(
  deps: DepsCimavet,
  nregistro: string,
  maxAgeH: number,
): Promise<{ actualizado: boolean; cacheDesde: Date | null }> {
  const now = (deps.now ?? (() => new Date()))();
  const actual = await deps.repo.medicamento(nregistro);
  if (actual && now.getTime() - actual.fetchedAt.getTime() <= maxAgeH * 3600 * 1000) return { actualizado: false, cacheDesde: null };
  try {
    const ok = await refrescarDesdeApi(deps, nregistro);
    return { actualizado: ok, cacheDesde: ok ? null : (actual?.fetchedAt ?? null) };
  } catch (e) {
    deps.log?.('CIMAVet no responde: se usa la caché', { nregistro, error: (e as Error).message });
    return { actualizado: false, cacheDesde: actual?.fetchedAt ?? null };
  }
}
