import { describe, expect, it } from 'vitest';
import { calcularValidez, casoLinea, recetaCaducada, textoPlazo, type LineaValidez } from '../src/validez';
import { RULES } from './builders';

const linea = (o: Partial<LineaValidez> = {}): LineaValidez => ({
  orden: 1,
  resuelta: true,
  antimicrobiano: false,
  estupefaciente: false,
  psicotropo: false,
  excluidaAmpliada: false,
  ...o,
});

describe('validez temporal (SPEC §4.1.3)', () => {
  it.each`
    caso                                    | emision         | tipo            | produccion | l                                       | efectiva
    ${'general, 1 mes'}                     | ${'2026-10-12'} | ${'agudo'}      | ${false}   | ${{}}                                   | ${'2026-11-12'}
    ${'fin de mes: 31/01 + 1 mes'}          | ${'2026-01-31'} | ${'agudo'}      | ${false}   | ${{}}                                   | ${'2026-02-28'}
    ${'fin de mes bisiesto'}                | ${'2028-01-31'} | ${'agudo'}      | ${false}   | ${{}}                                   | ${'2028-02-29'}
    ${'antimicrobiano, 5 días'}             | ${'2026-10-08'} | ${'agudo'}      | ${false}   | ${{ antimicrobiano: true }}             | ${'2026-10-13'}
    ${'crónico no productora, 3 meses'}     | ${'2026-10-12'} | ${'cronico'}    | ${false}   | ${{}}                                   | ${'2027-01-12'}
    ${'preventivo no productora, 6 meses'}  | ${'2026-10-12'} | ${'preventivo'} | ${false}   | ${{}}                                   | ${'2027-04-12'}
    ${'crónico en productora → general'}    | ${'2026-10-12'} | ${'cronico'}    | ${true}    | ${{}}                                   | ${'2026-11-12'}
    ${'crónico no resuelto → general'}      | ${'2026-10-12'} | ${'cronico'}    | ${false}   | ${{ resuelta: false }}                  | ${'2026-11-12'}
    ${'crónico gas medicinal → general'}    | ${'2026-10-12'} | ${'cronico'}    | ${false}   | ${{ excluidaAmpliada: true }}           | ${'2026-11-12'}
    ${'crónico con antimicrobiano → 5 días'} | ${'2026-10-12'} | ${'cronico'}   | ${false}   | ${{ antimicrobiano: true }}             | ${'2026-10-17'}
    ${'estupefaciente, 10 días'}            | ${'2026-10-12'} | ${'agudo'}      | ${false}   | ${{ estupefaciente: true }}             | ${'2026-10-22'}
    ${'psicótropo crónico, 1 mes'}          | ${'2026-10-12'} | ${'cronico'}    | ${false}   | ${{ psicotropo: true }}                 | ${'2026-11-12'}
    ${'psicótropo preventivo, 1 mes'}       | ${'2026-10-12'} | ${'preventivo'} | ${false}   | ${{ psicotropo: true }}                 | ${'2026-11-12'}
    ${'sin tipo de tratamiento → agudo'}    | ${'2026-10-12'} | ${null}         | ${false}   | ${{}}                                   | ${'2026-11-12'}
  `('$caso', ({ emision, tipo, produccion, l, efectiva }) => {
    const r = calcularValidez({
      fechaEmision: emision,
      plazoDeclarado: null,
      tipoTratamiento: tipo,
      especieProduccion: produccion,
      lineas: [linea(l)],
      rules: RULES.validez,
    });
    expect(r.efectiva).toBe(efectiva);
    expect(r.plazoDeclaradoSuperior).toBe(false);
  });

  it('se aplica la línea más restrictiva a la receta', () => {
    const r = calcularValidez({
      fechaEmision: '2026-10-12',
      plazoDeclarado: null,
      tipoTratamiento: 'cronico',
      especieProduccion: false,
      lineas: [linea({ orden: 1 }), linea({ orden: 2, antimicrobiano: true })],
      rules: RULES.validez,
    });
    expect(r.caso).toBe('antimicrobiano');
    expect(r.efectiva).toBe('2026-10-17');
    expect(r.porLinea.map((x) => x.caso)).toEqual(['cronico_no_productora', 'antimicrobiano']);
  });

  it('plazo declarado de 6 meses en tratamiento agudo → validez de 1 mes y aviso', () => {
    const r = calcularValidez({
      fechaEmision: '2026-10-12',
      plazoDeclarado: { cantidad: 6, unidad: 'meses' },
      tipoTratamiento: 'agudo',
      especieProduccion: false,
      lineas: [linea()],
      rules: RULES.validez,
    });
    expect(r.efectiva).toBe('2026-11-12');
    expect(r.plazoDeclaradoSuperior).toBe(true);
    expect(textoPlazo(r.plazoMaximo)).toBe('1 mes');
  });

  it('plazo declarado más corto que el máximo legal → se aplica el declarado', () => {
    const r = calcularValidez({
      fechaEmision: '2026-10-12',
      plazoDeclarado: { cantidad: 7, unidad: 'dias' },
      tipoTratamiento: 'agudo',
      especieProduccion: false,
      lineas: [linea()],
      rules: RULES.validez,
    });
    expect(r.efectiva).toBe('2026-10-19');
    expect(r.plazoDeclaradoSuperior).toBe(false);
  });

  it('sin líneas se aplica el plazo general', () => {
    const r = calcularValidez({ fechaEmision: '2026-10-12', plazoDeclarado: null, tipoTratamiento: null, especieProduccion: false, lineas: [], rules: RULES.validez });
    expect(r.efectiva).toBe('2026-11-12');
  });

  it.each`
    efectiva        | referencia      | caducada
    ${'2026-10-13'} | ${'2026-10-13'} | ${false}
    ${'2026-10-13'} | ${'2026-10-14'} | ${true}
    ${'2026-10-13'} | ${'2026-10-12'} | ${false}
  `('recetaCaducada($efectiva, $referencia) = $caducada', ({ efectiva, referencia, caducada }) => {
    expect(recetaCaducada(efectiva, referencia)).toBe(caducada);
  });

  it('textos de plazo', () => {
    expect(textoPlazo({ meses: 3 })).toBe('3 meses');
    expect(textoPlazo({ dias: 1 })).toBe('1 día');
    expect(textoPlazo({ dias: 5 })).toBe('5 días');
  });

  it('caso de línea: estupefaciente prevalece sobre antimicrobiano', () => {
    expect(casoLinea(linea({ estupefaciente: true, antimicrobiano: true }), 'agudo', false)).toBe('estupefaciente');
  });
});
