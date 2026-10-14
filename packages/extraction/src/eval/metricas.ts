import { normalizeText, type ExtractionResult } from '@mmx/shared';

export interface MetricaCampo {
  campo: string;
  total: number;
  exactos: number;
  normalizados: number;
  bajoUmbral: number;
}

const s = (x: unknown) => (x === null || x === undefined ? '' : String(x));

/** Compara una extracción con la esperada campo a campo (exacta y normalizada). */
export function compararExtraccion(esperado: ExtractionResult, obtenido: ExtractionResult, umbral: number, acc = new Map<string, MetricaCampo>()) {
  const sumar = (campo: string, e: unknown, o: unknown, conf: number) => {
    const m = acc.get(campo) ?? { campo, total: 0, exactos: 0, normalizados: 0, bajoUmbral: 0 };
    m.total++;
    if (s(e) === s(o)) m.exactos++;
    if (normalizeText(s(e)) === normalizeText(s(o))) m.normalizados++;
    if (conf < umbral) m.bajoUmbral++;
    acc.set(campo, m);
  };
  for (const [k, c] of Object.entries(esperado.receta)) {
    const o = obtenido.receta[k as keyof typeof obtenido.receta];
    sumar(`receta.${k}`, c.valor, o?.valor ?? null, o?.confianza ?? 0);
  }
  esperado.lineas.forEach((l, i) => {
    for (const [k, c] of Object.entries(l)) {
      const o = obtenido.lineas[i]?.[k as keyof (typeof obtenido.lineas)[number]];
      sumar(`lineas.${k}`, c.valor, o?.valor ?? null, o?.confianza ?? 0);
    }
  });
  return acc;
}

/** Coste orientativo (validar con la calculadora de Azure): € por página OCR y por 1.000 tokens. */
export function costeEstimado(paginas: number, tokensEntrada: number, tokensSalida: number, precios = { paginaOcr: 0.0094, mil: { entrada: 0.0023, salida: 0.0092 } }) {
  return paginas * precios.paginaOcr + (tokensEntrada / 1000) * precios.mil.entrada + (tokensSalida / 1000) * precios.mil.salida;
}
