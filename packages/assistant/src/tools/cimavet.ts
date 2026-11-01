import { esAntimicrobiano } from '@mmx/domain';
import { ArgsBuscarMedicamento, ArgsFichaMedicamento, type FuenteCitada } from '@mmx/shared';
import type { z } from 'zod';
import type { DepsHerramientas } from './contexto';
import type { Herramienta } from './registry';

const HORA_MS = 3_600_000;

/** Busca medicamentos en la caché local de CIMAVet. Nunca elige: devuelve candidatos para que la persona elija (FR-017). */
export function herramientaBuscarMedicamento(d: DepsHerramientas): Herramienta<z.infer<typeof ArgsBuscarMedicamento>> {
  return {
    nombre: 'buscar_medicamento',
    descripcion:
      'Busca un medicamento veterinario por nombre en los datos de CIMAVet de la aplicación. Devuelve candidatos (nregistro, presentaciones y código nacional). Si hay más de uno, preséntalos y pide que la persona elija; nunca elijas tú.',
    args: ArgsBuscarMedicamento,
    async ejecutar({ nombre, especie }) {
      const especieId = especie ? await d.cimavet.especiePorTexto(especie) : null;
      const filas = await d.cimavet.buscar(nombre, { especieId, limite: 30 });
      const porRegistro = new Map<string, { nregistro: string; nombre: string; laboratorio: string | null; presentaciones: { cn: string; nombre: string }[]; puntuacion: number }>();
      for (const f of filas) {
        const c = porRegistro.get(f.nregistro) ?? { nregistro: f.nregistro, nombre: f.medicamento, laboratorio: f.labtitular, presentaciones: [], puntuacion: f.puntuacion };
        c.presentaciones.push({ cn: f.cn, nombre: f.nombre });
        c.puntuacion = Math.max(c.puntuacion, f.puntuacion);
        porRegistro.set(f.nregistro, c);
      }
      const candidatos = [...porRegistro.values()].sort((a, b) => b.puntuacion - a.puntuacion).slice(0, 10);
      const sync = await d.cimavet.ultimaSyncCorrecta();
      const fuente: FuenteCitada = { fuenteId: 'cimavet:busqueda', tipo: 'cimavet', titulo: 'Búsqueda en los datos de CIMAVet', version: sync ? sync.toISOString() : 'sin-sincronizar' };
      return {
        datos: {
          fuenteId: fuente.fuenteId,
          version: fuente.version,
          candidatos,
          ...(candidatos.length === 0 ? { aviso: 'No hay ningún medicamento veterinario con ese nombre en los datos de CIMAVet.' } : {}),
          ...(candidatos.length > 1 ? { aviso: 'Hay varios candidatos: preséntalos y pide que la persona elija uno (tipo aclaracion).' } : {}),
        },
        fuentes: [fuente],
      };
    },
  };
}

/** Ficha de un medicamento con los atributos que importan para prescribir y sustituir. */
export function herramientaFichaMedicamento(d: DepsHerramientas): Herramienta<z.infer<typeof ArgsFichaMedicamento>> {
  return {
    nombre: 'ficha_medicamento',
    descripcion:
      'Devuelve la ficha de un medicamento (nregistro) con los datos de CIMAVet de la aplicación: si necesita receta, si es antimicrobiano, psicótropo, estupefaciente o inmunológico, comercialización, problemas de suministro, exclusión de la sustitución y la fecha de la última sincronización. Si desactualizado es true, díselo a la persona.',
    args: ArgsFichaMedicamento,
    async ejecutar({ nregistro }) {
      const m = await d.cimavet.medicamento(nregistro);
      if (!m) {
        return {
          datos: {
            encontrado: false,
            aviso: 'No consta en los datos de medicamentos veterinarios de CIMAVet. Busca en la Ayuda qué hacer con un medicamento que puede ser de uso humano.',
          },
        };
      }
      const fuente: FuenteCitada = { fuenteId: `cimavet:${nregistro}`, tipo: 'cimavet', titulo: m.nombre, version: m.fetchedAt.toISOString() };
      const edadH = (d.clock.now().epochMilliseconds - m.fetchedAt.getTime()) / HORA_MS;
      const nombres = await d.cimavet.nombresFicha({ especies: m.especieIds, formas: m.formaId ? [m.formaId] : [], vias: m.viaIds });
      const presentaciones = await d.cimavet.presentacionesDe([nregistro]);
      const pas = new Set(m.composicion.pas.map((p) => p.paId));
      const exclusion = d.rules.exclusiones.exclusiones.find((e) => e.nregistro === nregistro || (e.pa_id !== null && pas.has(e.pa_id)));
      return {
        datos: {
          encontrado: true,
          fuenteId: fuente.fuenteId,
          version: fuente.version,
          desactualizado: edadH > d.maxEdadCimavetH,
          ultimaSincronizacion: m.fetchedAt.toISOString(),
          nombre: m.nombre,
          laboratorio: m.labtitular,
          estado: m.estado,
          comercializado: m.comerc,
          sujetoPrescripcion: m.receta,
          antimicrobiano: esAntimicrobiano(m, d.rules.recetaCampos),
          psicotropo: m.psicotropo,
          estupefaciente: m.estupefaciente,
          inmunologico: m.inmunologico,
          problemaSuministro: m.psum,
          excluidoSustitucion: exclusion ? { excluido: true, motivo: exclusion.motivo, fuenteId: 'regla:sustitucion_exclusiones' } : { excluido: false },
          principiosActivos: m.composicion.pas.map((p) => ({ nombre: p.nombre, cantidad: p.cantidad, unidad: p.unidad })),
          forma: m.formaId ? (nombres.formas.get(m.formaId) ?? null) : null,
          vias: m.viaIds.map((v) => nombres.vias.get(v)).filter(Boolean),
          especies: m.especieIds.map((e) => nombres.especies.get(e)).filter(Boolean),
          presentaciones: presentaciones.map((p) => ({ cn: p.cn, nombre: p.nombre, comercializada: p.comerc })),
        },
        fuentes: [fuente],
      };
    },
  };
}
