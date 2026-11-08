import {
  evaluarEquivalencia,
  sustitucionPermitida,
  type ContextoPrescripcion,
  type MedicamentoInfo,
} from '@mmx/domain';
import { ArgsBuscarSustitutos, type FuenteCitada } from '@mmx/shared';
import type { z } from 'zod';
import type { DepsHerramientas } from './contexto';
import type { Herramienta, ResultadoHerramienta } from './registry';

type ArgsSustitutos = z.infer<typeof ArgsBuscarSustitutos>;

const MOTIVOS_BLOQUEO_TEXTO: Record<string, string> = {
  SUSTITUCION_PROHIBIDA_INMUNOLOGICO:
    'Medicamento inmunológico: las vacunas y productos inmunológicos no pueden ser sustituidos por normativa.',
  SUSTITUCION_PROHIBIDA_BIOLOGICO:
    'Medicamento biológico: los productos biológicos no admiten sustitución por normativa.',
  SUSTITUCION_PROHIBIDA_EXCEPCIONAL:
    'Prescripción excepcional: no se permite la sustitución en tratamientos en cascada.',
  SUSTITUCION_PROHIBIDA_EXCLUSION:
    'Medicamento incluido en la lista de exclusión de sustitución por estrecho margen terapéutico o biodisponibilidad.',
  SUSTITUCION_PROHIBIDA_CLASE_NO_INDICADA:
    'Clase de prescripción no indicada: por precaución se bloquea la sustitución.',
};

const OBLIGACIONES_LEGALES = [
  'Conformidad previa del tutor del animal (recabar consentimiento antes de dispensar).',
  'Comunicación preceptiva al veterinario prescriptor (o registrar la justificación documental de urgencia).',
  'Anotación al dorso de la receta física y separarla en la bandeja de sustituciones para su firma por el farmacéutico garante (modo posterior POST).',
];

export function herramientaBuscarSustitutos(d: DepsHerramientas): Herramienta<ArgsSustitutos> {
  return {
    nombre: 'buscar_sustitutos',
    descripcion:
      'Busca medicamentos veterinarios autorizados equivalentes para sustituir un fármaco prescrito ante falta de existencias (RD 1157/2021). Comprueba la sustituibilidad legal, evalúa la equivalencia en CIMAVet (mismo principio activo, concentración, forma y especie) y verifica el stock disponible en la farmacia.',
    args: ArgsBuscarSustitutos,
    async ejecutar(args): Promise<ResultadoHerramienta> {
      const especieId = await d.cimavet.especiePorTexto(args.especie);
      if (especieId === null) {
        return {
          datos: {
            encontrado: false,
            aviso: `No se reconoce la especie «${args.especie}» en los registros de CIMAVet. Especifica la especie de destino (por ejemplo, perro o gato).`,
          },
        };
      }

      // 1. Localizar el medicamento prescrito
      let prescrito: (MedicamentoInfo & { fetchedAt?: Date }) | null = null;
      if (args.nregistro) {
        prescrito = await d.cimavet.medicamento(args.nregistro);
      } else if (args.nombre) {
        const candidatos = await d.cimavet.buscar(args.nombre, { especieId, limite: 5 });
        const elegibles =
          candidatos.length > 0 ? candidatos : await d.cimavet.buscar(args.nombre, { limite: 5 });
        if (elegibles.length > 0 && elegibles[0]) {
          prescrito = await d.cimavet.medicamento(elegibles[0].nregistro);
        }
      }

      if (!prescrito) {
        return {
          datos: {
            encontrado: false,
            aviso:
              'No se ha encontrado el medicamento prescrito en los datos de CIMAVet. Verifica el nombre o número de registro.',
          },
        };
      }

      const version = prescrito.fetchedAt ? prescrito.fetchedAt.toISOString() : d.clock.now().toString();
      const fuente: FuenteCitada = {
        fuenteId: `cimavet:sustitucion:${prescrito.nregistro}`,
        tipo: 'cimavet',
        titulo: `Equivalencias y sustitución para ${prescrito.nombre}`,
        version,
      };

      // 2. Comprobar si el medicamento prescrito es legalmente sustituible
      const exclusiones = d.rules.exclusiones?.exclusiones ?? [];
      const permitida = sustitucionPermitida(prescrito, 'ordinaria', exclusiones);

      // Obtener nombre de forma y concentraciones legibles
      const nombres = await d.cimavet.nombresFicha({
        especies: [],
        formas: prescrito.formaId !== null ? [prescrito.formaId] : [],
        vias: [],
      });
      const formaNombre = prescrito.formaId !== null ? (nombres.formas.get(prescrito.formaId) ?? null) : null;
      const concentracionStr = prescrito.composicion.porCantidad
        ? `${prescrito.composicion.porCantidad} ${prescrito.composicion.porUnidad ?? ''}`.trim()
        : prescrito.composicion.pas
            .map((p) => (p.cantidad ? `${p.cantidad} ${p.unidad ?? ''}`.trim() : null))
            .filter((x): x is string => Boolean(x))
            .join(' + ') || null;

      // Comprobar existencias del propio medicamento prescrito
      let stockPrescrito = 0;
      let tieneStockPrescrito = false;
      const presPrescrito = await d.cimavet.presentacionesDe([prescrito.nregistro]);
      if (d.stock && presPrescrito.length > 0) {
        for (const p of presPrescrito) {
          try {
            const st = await d.stock.lotes(p.cn, null);
            if (st.estado === 'OK') {
              const u = st.lotes.reduce((acc, l) => acc + (l.disponible ?? 0), 0);
              stockPrescrito += u;
            }
          } catch {
            // ignore
          }
        }
        tieneStockPrescrito = stockPrescrito > 0;
      }

      const infoPrescrito = {
        nregistro: prescrito.nregistro,
        nombre: prescrito.nombre,
        principiosActivos: prescrito.composicion.pas.map((p) => p.nombre ?? `PA ${p.paId}`),
        forma: formaNombre,
        concentracion: concentracionStr,
        stockDisponible: d.stock ? stockPrescrito : null,
        tieneStock: tieneStockPrescrito,
      };

      if (!permitida.permitida) {
        const motivos = permitida.motivos.map((m) => MOTIVOS_BLOQUEO_TEXTO[m] ?? m);
        return {
          datos: {
            fuenteId: fuente.fuenteId,
            version: fuente.version,
            prescrito: infoPrescrito,
            sustitucionPermitida: false,
            motivosBloqueo: motivos,
            candidatosConStock: [],
            candidatosSinStock: [],
            aviso:
              'La normativa sanitaria prohíbe la sustitución de este medicamento (biológico, inmunológico o en lista de exclusión). Si no hay existencias en farmacia, debe tramitarse un pedido al distribuidor (PEDIR).',
          },
          fuentes: [fuente],
        };
      }

      // 3. Buscar medicamentos con los mismos principios activos
      const nregs = await d.cimavet.nregistrosMismosPa(prescrito.nregistro);
      const nregsCandidatos = nregs.filter((n) => n !== prescrito!.nregistro);

      if (nregsCandidatos.length === 0) {
        return {
          datos: {
            fuenteId: fuente.fuenteId,
            version: fuente.version,
            prescrito: infoPrescrito,
            sustitucionPermitida: true,
            candidatosConStock: [],
            candidatosSinStock: [],
            aviso:
              'No existen otros medicamentos veterinarios autorizados en CIMAVet con el mismo principio activo. Si no hay existencias, solicita un pedido al distribuidor (PEDIR) o consulta con el veterinario prescriptor si procede emitir una nueva prescripción.',
          },
          fuentes: [fuente],
        };
      }

      const [meds, presentaciones] = await Promise.all([
        d.cimavet.medicamentos(nregsCandidatos),
        d.cimavet.presentacionesDe(nregsCandidatos),
      ]);

      const requiereAclaracionIndicacion = !args.indicacion?.trim();

      const indicacionEfectiva =
        args.indicacion ??
        prescrito.indicaciones.find((i) => i.especieId === null || i.especieId === especieId)?.texto ??
        prescrito.indicaciones[0]?.texto ??
        null;

      const ctx: ContextoPrescripcion = {
        especieId,
        especieProduccion: false,
        clase: 'ordinaria',
        indicacion: indicacionEfectiva,
        viaPrescritaId: null,
        duracionDias: null,
      };

      interface CandidatoInfo {
        cn: string;
        nregistro: string;
        nombre: string;
        laboratorio: string | null;
        stockDisponible: number;
        tieneStock: boolean;
      }

      const candidatosConStock: CandidatoInfo[] = [];
      const candidatosSinStock: CandidatoInfo[] = [];

      for (const p of presentaciones) {
        const med = meds.get(p.nregistro);
        if (!med || med.usoHumano) continue;

        const eq = evaluarEquivalencia(prescrito, med, ctx, d.rules.equivalencia);
        const aptoPreliminar =
          eq.equivalente ||
          (requiereAclaracionIndicacion &&
            eq.motivos.every((m) => m === 'INDICACION_NO_COINCIDE' || m === 'INDICACION_PROBABLE'));
        if (!aptoPreliminar) continue;

        let disponible = 0;
        let tieneStock = false;

        if (d.stock) {
          try {
            const st = await d.stock.lotes(p.cn, null);
            if (st.estado === 'OK') {
              disponible = st.lotes.reduce((acc, l) => acc + (l.disponible ?? 0), 0);
              tieneStock = disponible > 0;
            }
          } catch {
            // error en lectura de stock
          }
        }

        const cand: CandidatoInfo = {
          cn: p.cn,
          nregistro: p.nregistro,
          nombre: p.nombre,
          laboratorio: med.labtitular,
          stockDisponible: disponible,
          tieneStock,
        };

        if (tieneStock) {
          candidatosConStock.push(cand);
        } else {
          candidatosSinStock.push(cand);
        }
      }

      candidatosConStock.sort((a, b) => b.stockDisponible - a.stockDisponible);

      let avisoStock = '';
      if (tieneStockPrescrito) {
        avisoStock =
          'ATENCIÓN: El medicamento prescrito sí dispone de existencias en el almacén de la farmacia. Por normativa (RD 1157/2021), la sustitución solo es procedente cuando no haya existencias del medicamento prescrito en el establecimiento.';
      } else if (candidatosConStock.length === 0 && candidatosSinStock.length > 0) {
        avisoStock =
          'Existen medicamentos equivalentes autorizados en CIMAVet, pero ninguno dispone de existencias en la farmacia en este momento. Se recomienda tramitar un pedido al distribuidor (PEDIR).';
      }

      return {
        datos: {
          fuenteId: fuente.fuenteId,
          version: fuente.version,
          prescrito: infoPrescrito,
          sustitucionPermitida: true,
          ...(requiereAclaracionIndicacion ? { requiereAclaracionIndicacion: true } : {}),
          candidatosConStock,
          candidatosSinStock,
          obligacionesDispensador: OBLIGACIONES_LEGALES,
          ...(avisoStock ? { aviso: avisoStock } : {}),
        },
        fuentes: [fuente],
      };
    },
  };
}
