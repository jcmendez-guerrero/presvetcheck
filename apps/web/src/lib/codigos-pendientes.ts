/**
 * Códigos leídos con el móvil que llegan al PC sin ningún campo de escaneo abierto (spec 016). Lógica pura, con el
 * reloj inyectado, para probarla sin React. Un código pendiente nunca se aplica solo: la persona lo usa con «Usar el
 * código recibido». Se conservan hasta 5, en orden de llegada, y cada uno caduca a los 5 minutos.
 */
export const MAX_PENDIENTES = 5;
export const CADUCIDAD_PENDIENTE_MS = 5 * 60_000;

export interface Pendiente {
  raw: string;
  /** Milisegundos desde 1970 (reloj inyectado). */
  recibidoAt: number;
}
/** Por qué se descartó un código sin usar: caducó o llegó un sexto y se quitó el más antiguo. */
export type AvisoDescarte = 'caducado' | 'exceso' | null;
export interface Instantanea {
  pendientes: readonly Pendiente[];
  aviso: AvisoDescarte;
}

export class CodigosPendientes {
  private lista: Pendiente[] = [];
  private aviso: AvisoDescarte = null;

  constructor(private readonly ahora: () => number = Date.now) {}

  recibir(raw: string): void {
    this.purgar();
    this.lista.push({ raw, recibidoAt: this.ahora() });
    if (this.lista.length > MAX_PENDIENTES) {
      this.lista.shift();
      this.aviso = 'exceso';
    } else this.aviso = null; // un código nuevo sustituye al aviso anterior
  }

  /** Entrega el más antiguo vigente, una sola vez (lo quita de la cola). */
  usar(): string | null {
    this.purgar();
    return this.lista.shift()?.raw ?? null;
  }

  descartarAviso(): void {
    this.aviso = null;
  }

  /** Estado actual (ya sin los caducados), listo para guardarlo en el estado de React. */
  instantanea(): Instantanea {
    this.purgar();
    return { pendientes: [...this.lista], aviso: this.aviso };
  }

  private purgar(): void {
    const limite = this.ahora() - CADUCIDAD_PENDIENTE_MS;
    const vigentes = this.lista.filter((p) => p.recibidoAt > limite);
    if (vigentes.length !== this.lista.length) {
      this.lista = vigentes;
      this.aviso = 'caducado';
    }
  }
}

/** Segundos que le quedan a un código pendiente (para la cuenta atrás del aviso). */
export const segundosRestantes = (p: Pendiente, ahora: number): number =>
  Math.max(0, Math.ceil((p.recibidoAt + CADUCIDAD_PENDIENTE_MS - ahora) / 1000));
