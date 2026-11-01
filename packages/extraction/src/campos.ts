import { CAMPOS_EXTRAIDOS_LINEA, CAMPOS_EXTRAIDOS_RECETA } from '@mmx/shared';

/**
 * Esquema de campos del modelo personalizado de Document Intelligence. Los nombres de campo del modelo
 * son EXACTAMENTE los de `CAMPOS_EXTRAIDOS_*` (`numero`, `fechaEmision`, …) y las líneas de medicamento
 * van en un campo tabla dinámica `lineas`. Versionado: si cambia la lista hay que reetiquetar y reentrenar.
 */
export const ESQUEMA_CAMPOS_VERSION = 'docintel-campos.v1';
export const CAMPO_LINEAS = 'lineas';

export const CAMPOS_NUMERICOS = new Set(['numAnimales', 'cantidadEnvases', 'duracionDias']);
export const CAMPOS_BOOLEANOS = new Set([
  'firmaDetectada',
  'selloDetectado',
  'qrDetectado',
  'declaracionAntimicrobiano',
  'antimicrobianos',
]);
/** Campos que se etiquetan como fecha (Document Intelligence los normaliza a AAAA-MM-DD). */
export const CAMPOS_FECHA = new Set(['fechaEmision']);

type TipoStudio = 'string' | 'number' | 'date' | 'selectionMark' | 'signature';
const tipo = (c: string): TipoStudio =>
  c === 'firmaDetectada'
    ? 'signature'
    : CAMPOS_BOOLEANOS.has(c)
      ? 'selectionMark'
      : CAMPOS_NUMERICOS.has(c)
        ? 'number'
        : CAMPOS_FECHA.has(c)
          ? 'date'
          : 'string';

/**
 * `fields.json` para el proyecto de etiquetado de Document Intelligence Studio (modelo personalizado
 * neuronal). Se genera desde el código para que los nombres no se desincronicen: `pnpm docintel:campos`.
 */
export function camposDocIntelStudio() {
  const campo = (fieldKey: string) => ({ fieldKey, fieldType: tipo(fieldKey), fieldFormat: 'not-specified' });
  return {
    $schema: 'https://schema.cognitiveservices.azure.com/formrecognizer/2021-03-01/fields.json',
    fields: [
      ...CAMPOS_EXTRAIDOS_RECETA.map(campo),
      {
        fieldKey: CAMPO_LINEAS,
        fieldType: 'array',
        fieldFormat: 'not-specified',
        itemType: `${CAMPO_LINEAS}_fila`,
      },
    ],
    definitions: {
      [`${CAMPO_LINEAS}_fila`]: {
        fieldKey: `${CAMPO_LINEAS}_fila`,
        fieldType: 'object',
        fieldFormat: 'not-specified',
        fields: CAMPOS_EXTRAIDOS_LINEA.map(campo),
      },
    },
  };
}

/** Convierte el valor de texto al tipo del campo. */
export function convertir(campo: string, valor: string | null): string | number | boolean | null {
  if (valor === null) return null;
  if (CAMPOS_NUMERICOS.has(campo)) {
    // Primer número del texto, con coma o punto decimal ("1,00" → 1; "21 Vía…" → 21).
    const m = /\d+(?:[.,]\d+)?/.exec(valor);
    if (!m) return null;
    let n = Math.trunc(Number(m[0].replace(',', '.')));
    // Duración expresada en semanas o meses (conservador: el mes como 30 días).
    if (campo === 'duracionDias' && /mes/i.test(valor)) n *= 30;
    else if (campo === 'duracionDias' && /semana/i.test(valor)) n *= 7;
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (campo === 'cn') {
    const m = /\b(\d{6})(?:\.\d)?\b/.exec(valor);
    return m ? (m[1] as string) : null;
  }
  if (CAMPOS_BOOLEANOS.has(campo)) return /^(true|s[ií]|1|x|selected|:selected:|signed)$/i.test(valor.trim());
  return valor;
}
