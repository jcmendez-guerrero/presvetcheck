import { Mensaje } from '../componentes/ui';

/**
 * Aviso en el detalle de una recepción cuando hay costes de proveedor esperando a que se vincule el proveedor del
 * distribuidor en Siweb360 (specs/016). No afecta al stock ni al estado de la recepción.
 */
export function AvisoCosteProveedor({ pendientes }: { pendientes: number }) {
  if (pendientes <= 0) return null;
  return (
    <Mensaje tipo="info">
      Coste de proveedor pendiente: falta vincular a este distribuidor con su proveedor en Siweb360. El stock no se ve
      afectado. Pide a administración que lo vincule (Administración → Outbox) y el coste se enviará solo.
    </Mensaje>
  );
}
