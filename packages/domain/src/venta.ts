import { DomainError, type Canal } from '@mmx/shared';
import { dniNieValido } from './dni';
import { incidencia, type PoliticaSeveridad } from './severidad';
import type { Incidencia, MedicamentoInfo } from './tipos';

/**
 * Venta sin receta y pedidos online (SPEC §4.7). Sujeto a prescripción → bloqueo (online) o
 * redirección al flujo de receta (presencial). Online: datos del propietario obligatorios y DNI/NIE
 * válido (D-07).
 */
export interface PropietarioVenta {
  nombre: string | null;
  movil: string | null;
  direccion: string | null;
  dni: string | null;
}

export function validarVentaSinReceta(
  canal: Canal,
  medicamento: Pick<MedicamentoInfo, 'receta' | 'nombre' | 'estupefaciente'>,
  pol: PoliticaSeveridad,
): Incidencia[] {
  const out: Incidencia[] = [];
  const params = { medicamento: medicamento.nombre };
  if (medicamento.estupefaciente) out.push(incidencia('ESTUPEFACIENTE_NO_DISPENSABLE', pol, { params }));
  if (medicamento.receta)
    out.push(incidencia(canal === 'online' ? 'ONLINE_CON_RECETA' : 'RECETA_REQUERIDA', pol, { params }));
  return out;
}

/** Lanza si faltan datos del propietario en online o el DNI/NIE no es válido. */
export function validarPropietario(canal: Canal, p: PropietarioVenta | null): void {
  const vacio = (s: string | null | undefined) => !s || s.trim() === '';
  if (canal === 'online') {
    if (!p || vacio(p.nombre) || vacio(p.movil) || vacio(p.direccion) || vacio(p.dni)) {
      throw new DomainError('DATOS_PROPIETARIO_ONLINE');
    }
  }
  if (p && !vacio(p.dni) && !dniNieValido(p.dni)) throw new DomainError('DNI_INVALIDO');
}

/**
 * Especie para el registro de una venta sin receta (§4.8): la que indica el cliente o, si no la
 * indica, las especies de destino autorizadas del medicamento.
 */
export function especieVentaSinReceta(especieCliente: string | null, especiesAutorizadas: string[]): string {
  return especieCliente?.trim() || especiesAutorizadas.join(', ');
}
