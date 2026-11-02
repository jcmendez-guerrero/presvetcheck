import { SalidaModelo, type FuenteCitada, type SimulacionGuardada } from '@mmx/shared';
import { limpiarDatosPersonales } from './pii';

/**
 * Validación determinista de la salida del modelo (contracts/salida-modelo.md, V1–V7). Lo que el modelo cita
 * tiene que proceder de las herramientas llamadas en ese mismo turno.
 */
export interface EstadoTurno {
  fuentes: ReadonlyMap<string, FuenteCitada>;
  simulaciones: ReadonlyMap<string, SimulacionGuardada>;
  llamoContextoLinea: boolean;
}

export type CodigoValidacion = 'V1' | 'V2' | 'V3' | 'V4';

export interface ErrorValidacion {
  codigo: CodigoValidacion;
  detalle: string;
}

export interface ResultadoValidacion {
  ok: boolean;
  /** Salida con las correcciones automáticas (V5–V7) aplicadas; null si no cumple V1. */
  salida: SalidaModelo | null;
  errores: ErrorValidacion[];
}

export function validarSalida(
  bruta: unknown,
  turno: EstadoTurno,
  conocidos: readonly string[] = [],
): ResultadoValidacion {
  const json = typeof bruta === 'string' ? seguro(bruta) : bruta;
  const parsed = SalidaModelo.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      salida: null,
      errores: [
        {
          codigo: 'V1',
          detalle: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      ],
    };
  }
  const errores: ErrorValidacion[] = [];
  const s = { ...parsed.data };

  // V2: fuentes devueltas por herramientas en este turno
  const invalidas = s.fuentes.filter((f) => !turno.fuentes.has(f));
  if (invalidas.length) errores.push({ codigo: 'V2', detalle: `fuente no válida: ${invalidas.join(', ')}` });
  // V3: una respuesta sobre reglas cita al menos una fuente
  if (s.tipo === 'respondida' && s.fuentes.length === 0) {
    errores.push({ codigo: 'V3', detalle: 'una respuesta «respondida» debe citar al menos una fuente' });
  }
  // V4: simulaciones existentes
  const simInvalidas = s.simulaciones.filter((id) => !turno.simulaciones.has(id));
  if (simInvalidas.length)
    errores.push({ codigo: 'V4', detalle: `simulación inexistente: ${simInvalidas.join(', ')}` });

  // V5: toda simulación del turno se muestra
  for (const id of turno.simulaciones.keys()) if (!s.simulaciones.includes(id)) s.simulaciones.push(id);
  // V6: el contexto de la línea solo si se consultó
  if (s.usaContextoLinea && !turno.llamoContextoLinea) s.usaContextoLinea = false;
  // V7: ningún dato personal en el texto
  s.texto = limpiarDatosPersonales(s.texto, conocidos).texto;

  return { ok: errores.length === 0, salida: s, errores };
}

function seguro(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}
