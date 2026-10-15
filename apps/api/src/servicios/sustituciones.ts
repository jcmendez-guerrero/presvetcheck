import { and, eq } from 'drizzle-orm';
import { appendAudit, procedimientoAprobado, receta, recetaLinea, sustitucion } from '@mmx/db';
import {
  fechaEs,
  nuevaSustitucion,
  plantillaAvisoVeterinario,
  puedeDispensarSustitucion,
  textoAnotacionDorso,
  transicionSustitucion,
  type EstadoSustitucionCompleto,
  type EventoSustitucion,
  type Sustituto,
} from '@mmx/domain';
import { DomainError, type ModoSustitucion } from '@mmx/shared';
import { ahoraDe, hoyDe, type AppDeps } from '../deps';
import { RecetasService, type ContextoPeticion } from './recetas';

/** Reconstruye el estado de la máquina a partir de la fila. */
export function estadoSustitucion(s: typeof sustitucion.$inferSelect): EstadoSustitucionCompleto {
  const aut = s.autorizacion as { previa?: EstadoSustitucionCompleto['autorizacionPrevia']; firma?: EstadoSustitucionCompleto['firma'] } | null;
  return {
    estado: s.estado as EstadoSustitucionCompleto['estado'],
    modo: s.modo as ModoSustitucion,
    consentimiento: s.consentimientoTutor as EstadoSustitucionCompleto['consentimiento'],
    avisoVeterinario: s.avisoVeterinario as EstadoSustitucionCompleto['avisoVeterinario'],
    urgencia: s.urgencia as EstadoSustitucionCompleto['urgencia'],
    autorizacionPrevia: aut?.previa ?? null,
    firma: aut?.firma ?? null,
    rechazo: s.rechazo as EstadoSustitucionCompleto['rechazo'],
    indicacionProbable: (s.equivalencia as { equivalencia?: { indicacion?: string } }).equivalencia?.indicacion === 'PROBABLE',
  };
}

/** Procedimiento de sustitución vigente (evidencia de la instrucción del garante, D-01). */
export async function procedimientoVigente(d: Pick<AppDeps, 'db'>) {
  const [p] = await d.db.select().from(procedimientoAprobado).where(and(eq(procedimientoAprobado.codigo, 'SUSTITUCION'), eq(procedimientoAprobado.vigente, true)));
  return p ?? null;
}

export type AccionSustitucion = 'consentimiento' | 'aviso-veterinario' | 'autorizacion-garante' | 'anotacion' | 'firma-garante' | 'rechazar';

export class SustitucionesService {
  private readonly recetas: RecetasService;
  constructor(private readonly d: AppDeps) {
    this.recetas = new RecetasService(d);
  }

  /** Inicia la sustitución con uno de los sustitutos que propone el motor (solo si la línea está en SUSTITUIR). */
  async crear(recetaId: string, lineaOrden: number, cn: string, c: ContextoPeticion) {
    const ev = await this.recetas.evaluar(recetaId, c, {}, false);
    const l = ev.lineas.find((x) => x.orden === lineaOrden);
    if (!l || l.resultado.decision !== 'SUSTITUIR') throw new DomainError('CONFLICTO', 'La línea no está en SUSTITUIR: el prescrito está disponible o la sustitución no procede');
    const sustituto = l.resultado.evidencias.sustitutos.find((s: Sustituto) => s.cn === cn);
    if (!sustituto) throw new DomainError('VALIDACION', 'El medicamento elegido no es un sustituto propuesto');
    const proc = await procedimientoVigente(this.d);
    if (!proc && sustituto.modo === 'POST') throw new DomainError('PROCEDIMIENTO_NO_APROBADO');
    const [linea] = await this.d.db.select().from(recetaLinea).where(and(eq(recetaLinea.recetaId, recetaId), eq(recetaLinea.orden, lineaOrden)));
    const st = nuevaSustitucion(sustituto.modo, sustituto.equivalencia.indicacion === 'PROBABLE');
    const ahora = ahoraDe(this.d);
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(sustitucion)
        .values({
          recetaLineaId: linea!.id,
          cnPrescrito: linea!.cnPrescrito,
          cnPropuesto: cn,
          nregistroPropuesto: sustituto.nregistro,
          equivalencia: sustituto as never,
          estado: st.estado,
          modo: st.modo,
          procedimientoVersion: proc ? `${proc.codigo}@${proc.version}` : null,
          historial: [{ estado: st.estado, por: c.usuario.id, at: ahora.toISOString() }] as never,
        })
        .returning();
      await appendAudit(tx, { actor: c.usuario.id, accion: 'sustitucion_crear', entidad: 'sustitucion', entidadId: row!.id, despues: { cn, modo: st.modo, estado: st.estado }, ip: c.ip, userAgent: c.userAgent });
      return row!;
    });
  }

  async detalle(id: string) {
    const [s] = await this.d.db.select().from(sustitucion).where(eq(sustitucion.id, id));
    if (!s) throw new DomainError('NO_ENCONTRADO');
    const [l] = await this.d.db.select().from(recetaLinea).where(eq(recetaLinea.id, s.recetaLineaId));
    const [r] = l ? await this.d.db.select().from(receta).where(eq(receta.id, l.recetaId)) : [];
    const prescrito = s.cnPrescrito ? await this.recetas.med.presentacion(s.cnPrescrito) : null;
    const sustituto = await this.recetas.med.presentacion(s.cnPropuesto);
    const eq2 = s.equivalencia as Sustituto;
    const st = estadoSustitucion(s);
    return {
      ...s,
      puedeDispensar: puedeDispensarSustitucion(st),
      prescrito: prescrito ? { cn: prescrito.cn, nombre: prescrito.nombre } : null,
      sustituto: sustituto ? { cn: sustituto.cn, nombre: sustituto.nombre, laboratorio: eq2.labtitular } : null,
      plantillaAvisoVeterinario: plantillaAvisoVeterinario({
        prescrito: { nombre: prescrito?.nombre ?? '(prescrito)', cn: s.cnPrescrito ?? '' },
        sustituto: { nombre: sustituto?.nombre ?? eq2.nombre, cn: s.cnPropuesto, laboratorio: eq2.labtitular },
        lote: null,
        motivo: 'el medicamento prescrito no está disponible en la farmacia',
        numeroReceta: r?.numero ?? null,
        farmacia: this.d.nombreFarmacia,
      }),
      etiqueta: textoAnotacionDorso({ nombre: sustituto?.nombre ?? eq2.nombre, cn: s.cnPropuesto, lote: '__________', fecha: fechaEs(hoyDe(this.d)) }),
      recetaId: l?.recetaId ?? null,
      lineaOrden: l?.orden ?? null,
    };
  }

  /**
   * Transiciones de estado (SPEC §4.4.3). Todas las registra el empleado: lo que hace el garante
   * (autorizar antes, firmar la receta en papel, declarar no conforme) ocurre fuera de la app.
   */
  async accion(id: string, accion: AccionSustitucion, body: Record<string, unknown>, c: ContextoPeticion) {
    const [s] = await this.d.db.select().from(sustitucion).where(eq(sustitucion.id, id));
    if (!s) throw new DomainError('NO_ENCONTRADO');
    const st = estadoSustitucion(s);
    const ahora = ahoraDe(this.d).toISOString();
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
    let evento: EventoSustitucion;
    switch (accion) {
      case 'consentimiento':
        evento = { tipo: 'CONSENTIMIENTO', consiente: body.consiente === true, medio: str('medio') || 'presencial', fechaHora: ahora, empleado: c.usuario.id };
        break;
      case 'aviso-veterinario':
        evento = body.urgencia
          ? { tipo: 'URGENCIA', justificacion: str('justificacion'), fechaHora: ahora, empleado: c.usuario.id }
          : { tipo: 'AVISO_VETERINARIO', medio: str('medio') || 'teléfono', resultado: str('resultado') || 'avisado', fechaHora: ahora, empleado: c.usuario.id };
        break;
      case 'autorizacion-garante':
        evento = {
          tipo: 'AUTORIZAR_PREVIA',
          garante: str('garante'),
          medio: str('medio'),
          fechaHora: ahora,
          empleado: c.usuario.id,
          confirmaIndicacionProbable: body.confirmaIndicacionProbable === true,
        };
        break;
      case 'anotacion':
        evento = { tipo: 'APARTAR_RECETA' };
        break;
      case 'firma-garante':
        evento = { tipo: 'FIRMAR', garante: str('garante'), fechaHora: ahora, empleado: c.usuario.id };
        break;
      case 'rechazar':
        if (str('motivo').trim().length < 5) throw new DomainError('VALIDACION', 'Indica el motivo del rechazo');
        evento = { tipo: 'RECHAZAR', actor: c.usuario.id, motivo: str('motivo'), fechaHora: ahora };
        break;
    }
    const rol = c.usuario.roles[0] ?? 'empleado';
    const nuevo = transicionSustitucion(st, evento, rol);
    await this.d.db.transaction(async (tx) => {
      await tx
        .update(sustitucion)
        .set({
          estado: nuevo.estado,
          consentimientoTutor: nuevo.consentimiento as never,
          avisoVeterinario: nuevo.avisoVeterinario as never,
          urgencia: nuevo.urgencia as never,
          autorizacion: { previa: nuevo.autorizacionPrevia, firma: nuevo.firma } as never,
          rechazo: nuevo.rechazo as never,
          anotacion: accion === 'anotacion' ? ({ apartadaPor: c.usuario.id, at: ahora } as never) : s.anotacion,
          historial: [...((s.historial as unknown[]) ?? []), { estado: nuevo.estado, accion, por: c.usuario.id, at: ahora }] as never,
        })
        .where(eq(sustitucion.id, id));
      await appendAudit(tx, { actor: c.usuario.id, accion: `sustitucion_${accion}`, entidad: 'sustitucion', entidadId: id, antes: { estado: s.estado }, despues: { estado: nuevo.estado }, ip: c.ip, userAgent: c.userAgent });
    });
    return this.detalle(id);
  }
}
