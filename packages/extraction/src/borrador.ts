import { normalizeText, type CampoExtraido, type ExtractionResult, type RecetaConfirmadaInput } from '@mmx/shared';

/**
 * Convierte el resultado de la extracción en el borrador de la pantalla de revisión (SPEC §4.1.1).
 * La IA propone, la persona decide: la firma manuscrita en el original y la casilla "He comprobado
 * los datos" NUNCA se rellenan desde la IA.
 */

const v = (c: CampoExtraido | undefined): string | null => (c?.valor === null || c?.valor === undefined ? null : String(c.valor).trim() || null);
const n = (c: CampoExtraido | undefined): number | null => {
  const s = v(c);
  if (s === null) return null;
  const x = Number.parseInt(s.replace(/\D/g, ''), 10);
  return Number.isFinite(x) && x > 0 ? x : null;
};

export function fechaIso(s: string | null): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s.trim());
  if (!m) return null;
  const y = (m[3] as string).length === 2 ? `20${m[3]}` : (m[3] as string);
  return `${y}-${(m[2] as string).padStart(2, '0')}-${(m[1] as string).padStart(2, '0')}`;
}

export function tipoDispensacion(s: string | null): 'dispensacion' | 'botiquin' | 'no_dispensacion' | null {
  if (!s) return null;
  const t = normalizeText(s);
  if (t.includes('botiquin')) return 'botiquin';
  if (t.includes('no dispensacion') || t === 'no_dispensacion') return 'no_dispensacion';
  if (t.includes('dispensacion')) return 'dispensacion';
  return null;
}

const enumDe = <T extends string>(s: string | null, opciones: readonly T[]): T | null => {
  if (!s) return null;
  const t = normalizeText(s);
  return opciones.find((o) => t.startsWith(normalizeText(o).slice(0, 5))) ?? null;
};

export function plazo(s: string | null): { cantidad: number; unidad: 'dias' | 'meses' } | null {
  if (!s) return null;
  const m = /(\d+)\s*(d[ií]as?|mes(?:es)?)/i.exec(s);
  if (!m) return null;
  return { cantidad: Number(m[1]), unidad: /^d/i.test(m[2] as string) ? 'dias' : 'meses' };
}

export interface Borrador {
  receta: RecetaConfirmadaInput;
  /** Campos que exigen confirmación individual (confianza < umbral o ausentes). */
  dudosos: string[];
}

export function borradorDesdeExtraccion(ext: ExtractionResult, umbral: number): Borrador {
  const r = ext.receta;
  const dudosos: string[] = [];
  for (const [k, c] of Object.entries(r)) if (c.valor === null || c.confianza < umbral) dudosos.push(`receta.${k}`);
  ext.lineas.forEach((l, i) => {
    for (const [k, c] of Object.entries(l)) if (c.valor === null || c.confianza < umbral) dudosos.push(`lineas.${i}.${k}`);
  });
  const tipo = v(r.tipo) === 'electronica' || v(r.qrDetectado) === 'true' ? 'electronica' : 'papel';
  return {
    dudosos,
    receta: {
      tipo,
      plataformaId: null,
      idPlataforma: v(r.idPlataforma),
      numero: v(r.numero),
      fechaEmision: fechaIso(v(r.fechaEmision)),
      tipoDispensacion: tipoDispensacion(v(r.tipoDispensacion)),
      clasePrescripcion: enumDe(v(r.clasePrescripcion), ['ordinaria', 'excepcional'] as const),
      tipoTratamiento: enumDe(v(r.tipoTratamiento), ['agudo', 'cronico', 'preventivo'] as const),
      titular: { nombre: v(r.titularNombre), telefono: v(r.titularTelefono) },
      rega: v(r.rega),
      especie: { texto: v(r.especie), especieId: null },
      especieProduccion: false,
      animalIdentificacion: v(r.animalIdentificacion),
      numAnimales: n(r.numAnimales),
      veterinario: {
        nombre: v(r.veterinarioNombre),
        telefono: v(r.veterinarioTelefono),
        email: v(r.veterinarioEmail),
        numColegiado: v(r.veterinarioNumColegiado),
        colegio: v(r.veterinarioColegio),
        clinica: v(r.veterinarioClinica),
        direccion: v(r.veterinarioDireccion),
      },
      talonarioColegial: false,
      firmaConfirmada: false,
      indicacion: v(r.indicacion),
      plazoValidezDeclarado: plazo(v(r.plazoValidez)),
      advertencias: v(r.advertencias),
      comprobadoConOriginal: false,
      lineas: (ext.lineas.length ? ext.lineas : [{} as Record<string, CampoExtraido>]).map((l, i) => ({
        orden: i + 1,
        medicamentoTexto: v(l.medicamento),
        principioActivoTexto: v(l.principioActivo),
        formaTexto: v(l.forma),
        concentracionTexto: v(l.concentracion),
        cantidadEnvases: n(l.cantidadEnvases),
        formatoTexto: v(l.formato),
        posologia: { via: v(l.via), dosis: v(l.dosis), duracionDias: n(l.duracionDias), porcentajeEnvase: null },
        tiempoEsperaTexto: v(l.tiempoEspera),
        declaracionAntimicrobiano: l.declaracionAntimicrobiano?.valor === true || v(l.declaracionAntimicrobiano) === 'true' ? { declarada: true, finalidad: null } : null,
        // El código nacional es opcional: si la receta lo trae se propone; si no, se busca por nombre.
        nregistro: null,
        cn: /^\d{6}$/.test(v(l.cn) ?? '') ? v(l.cn) : null,
      })),
    },
  };
}
