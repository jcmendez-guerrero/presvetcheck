import { eq } from 'drizzle-orm';
import { MAESTRA, propietario, receta, recetaLinea } from '@mmx/db';
import { limpiarDatosPersonales } from '@mmx/assistant';
import { ContextoLineaDto, RecetaConfirmada, textoDefecto, type CodigoIncidencia } from '@mmx/shared';
import type { AppDeps } from '../deps';

type Linea = typeof recetaLinea.$inferSelect;
type Receta = typeof receta.$inferSelect;

interface MotivoGuardado {
  code: CodigoIncidencia;
  severidad: string;
  params?: Record<string, string | number>;
}

/**
 * Contexto de una línea de receta para el asistente (FR-014, aclaración Q1): el resultado que ya calculó la
 * aplicación y los campos NO personales de la receta. Es una lista blanca: aquí no se lee ni el titular ni la identidad
 * del veterinario para el DTO. Los datos personales solo se descifran en memoria para poder eliminarlos de lo que
 * escribe el empleado y de lo que responde el modelo (`conocidos`).
 */
export type DepsContexto = Pick<AppDeps, 'db' | 'cipher' | 'cimavet' | 'rules'>;

export class ContextoLineaService {
  constructor(private readonly d: DepsContexto) {}

  private async fila(recetaLineaId: string): Promise<{ linea: Linea; receta: Receta } | null> {
    const filas = await this.d.db
      .select({ linea: recetaLinea, receta })
      .from(recetaLinea)
      .innerJoin(receta, eq(receta.id, recetaLinea.recetaId))
      .where(eq(recetaLinea.id, recetaLineaId));
    return filas[0] ?? null;
  }

  /** La línea existe y la aplicación ya la ha evaluado. */
  async existe(recetaLineaId: string): Promise<boolean> {
    const f = await this.fila(recetaLineaId);
    return !!f && f.linea.decision !== null;
  }

  /** Valores del titular y del veterinario de la receta (descifrados solo en memoria, nunca guardados). */
  async conocidos(recetaLineaId: string): Promise<string[]> {
    const f = await this.fila(recetaLineaId);
    if (!f) return [];
    const out = new Set<string>();
    const anadir = (v: string | null | undefined) => {
      const t = v?.trim();
      if (t && t.length >= 3) out.add(t);
    };
    const conf = this.confirmacion(f.receta.confirmacion);
    if (conf) {
      const t = conf.titular;
      [t.nombre, t.telefono, t.direccion, t.dni].forEach(anadir);
      const v = conf.veterinario;
      [v.nombre, v.telefono, v.email, v.numColegiado, v.clinica, v.direccion].forEach(anadir);
    }
    if (f.receta.propietarioId) {
      const [p] = await this.d.db
        .select()
        .from(propietario)
        .where(eq(propietario.id, f.receta.propietarioId));
      if (p)
        [p.nombreEnc, p.movilEnc, p.dniEnc, p.direccionEnc].forEach((x) => anadir(this.d.cipher.decrypt(x)));
    }
    return [...out];
  }

  private confirmacion(raw: unknown): RecetaConfirmada | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as RecetaConfirmada & { _cifrado?: boolean };
    const titular = r._cifrado
      ? Object.fromEntries(
          Object.entries(r.titular ?? {}).map(([k, v]) => [k, this.d.cipher.decrypt(v as string | null)]),
        )
      : r.titular;
    const { _cifrado, ...resto } = r;
    void _cifrado;
    const parsed = RecetaConfirmada.safeParse({ ...resto, titular });
    return parsed.success ? parsed.data : null;
  }

  /** DTO de lista blanca de la línea; null si no existe o aún no está evaluada. */
  async cargar(recetaLineaId: string): Promise<ContextoLineaDto | null> {
    const f = await this.fila(recetaLineaId);
    if (!f || f.linea.decision === null) return null;
    const { linea, receta: r } = f;
    const conocidos = await this.conocidos(recetaLineaId);
    // Texto libre de la receta: por si una lectura incorrecta dejó un dato personal dentro.
    const limpio = (t: string | null | undefined) => (t ? limpiarDatosPersonales(t, conocidos).texto : null);

    const motivos = ((linea.motivos ?? []) as MotivoGuardado[]).map((m) => ({
      code: m.code,
      severidad: m.severidad,
      mensaje: textoDefecto(m.code, m.params).titulo,
    }));
    const ev = (linea.evidencias ?? {}) as {
      forzable?: boolean;
      sustitutos?: {
        nregistro: string;
        cn: string;
        nombre: string;
        labtitular: string | null;
        disponible: number;
      }[];
      alternativaFormato?: { envases: number; nota: string | null; formato: { tipo: string } };
    };
    const validez =
      (r.evaluacion as { validez?: { efectiva: string; caso: string; maximoLegal: string } | null } | null)
        ?.validez ?? null;
    const especie = r.especieId
      ? ((await this.d.cimavet.nombresMaestra(MAESTRA.ESPECIES, [r.especieId])).get(r.especieId) ?? null)
      : null;
    const pos = linea.posologia as {
      via?: string | null;
      dosis?: string | null;
      duracionDias?: number | null;
      porcentajeEnvase?: string | null;
    } | null;
    const posologia = pos
      ? [
          pos.via && `vía ${pos.via}`,
          pos.dosis && `dosis ${pos.dosis}`,
          pos.duracionDias && `${pos.duracionDias} días`,
          pos.porcentajeEnvase && `${pos.porcentajeEnvase} del envase`,
        ]
          .filter(Boolean)
          .join(', ')
      : null;
    const cantidad = [linea.cantidadEnvases ? `${linea.cantidadEnvases} envase(s)` : null, linea.formatoTexto]
      .filter(Boolean)
      .join(' · ');

    return ContextoLineaDto.parse({
      fuenteId: `motor:linea/${linea.id}`,
      version: r.reglaVersion ?? this.d.rules.bundle.version,
      resultado: {
        decision: linea.decision,
        motivos,
        forzable: ev.forzable ?? false,
        equivalentes: (ev.sustitutos ?? []).map((s) => ({
          nregistro: s.nregistro,
          cn: s.cn ?? null,
          nombre: s.nombre,
          laboratorio: s.labtitular ?? null,
          stock: s.disponible > 0,
        })),
        ...(ev.alternativaFormato
          ? {
              alternativaFormato: {
                tipo: ev.alternativaFormato.formato.tipo,
                envases: ev.alternativaFormato.envases ?? null,
                notaAdministracion: ev.alternativaFormato.nota ?? null,
              },
            }
          : {}),
        ...(validez ? { validez } : {}),
      },
      receta: {
        especie,
        numeroAnimales: r.numAnimales ?? null,
        fechaEmision: r.fechaEmision ?? null,
        tipoReceta: r.tipo,
        clasePrescripcion: r.clasePrescripcion ?? null,
        tipoTratamiento: r.tipoTratamiento ?? null,
        indicacion: limpio(r.indicacion),
        posologia: limpio(posologia),
        forma: limpio(linea.formaTexto),
        concentracion: limpio(linea.concentracionTexto),
        cantidad: limpio(cantidad || null),
      },
      medicamento: {
        nregistro: linea.nregistro ?? null,
        nombre: limpio(linea.textoMedicamento) ?? '',
        cn: linea.cnPrescrito ?? null,
      },
    });
  }
}
