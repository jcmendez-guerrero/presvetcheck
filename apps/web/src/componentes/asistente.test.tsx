import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { SimulacionGuardada } from '@mmx/shared';
import { TarjetaSimulacion } from './asistente';

describe('TarjetaSimulacion', () => {
  it('renderiza la tabla comparativa de criterios de sustitución con badges de coincidencia y discrepancia (US5, FR-016)', () => {
    const simulacion: SimulacionGuardada = {
      simulacionId: 'sim-123',
      herramienta: 'simular_equivalencia',
      decision: 'NO_EQUIVALENTE',
      motivos: [{ code: 'VIA_NO_AUTORIZADA', mensaje: 'No está autorizado para la vía de administración prescrita.' }],
      reglaVersion: 'equivalencia.v1@21dfa268',
      supuestos: { prescrito: '3738 ESP', candidato: '3313 ESP' },
      evidencias: {
        indicacion: 'COINCIDE',
        revisarManual: false,
        requiereAprobacionPrevia: false,
        comparativa: [
          {
            criterio: 'Principio activo',
            prescrito: 'Prednisolona',
            candidato: 'Prednisolona',
            coincide: true,
          },
          {
            criterio: 'Concentración',
            prescrito: '5 mg',
            candidato: '5 mg',
            coincide: true,
          },
          {
            criterio: 'Forma farmacéutica',
            prescrito: 'Comprimido',
            candidato: 'Comprimido',
            coincide: true,
          },
          {
            criterio: 'Vía de administración',
            prescrito: 'VÍA ORAL',
            candidato: 'Vía tópica',
            coincide: false,
            detalle: 'Vía de administración no autorizada en el candidato',
          },
          {
            criterio: 'Especie de destino',
            prescrito: 'Perros',
            candidato: 'Perros, Gatos',
            coincide: true,
          },
          {
            criterio: 'Indicación',
            prescrito: 'Tratamiento antiinflamatorio',
            candidato: 'Autorizada para la misma indicación',
            coincide: true,
          },
          {
            criterio: 'Tiempo de espera',
            prescrito: 'No aplica (animal de compañía)',
            candidato: 'No aplica (animal de compañía)',
            coincide: true,
          },
        ],
      },
    };

    const html = renderToString(<TarjetaSimulacion s={simulacion} />);

    expect(html).toContain('data-testid="asistente-simulacion"');
    expect(html).toMatch(/Simulación:.*No equivalente/);
    expect(html).toContain('data-testid="tabla-comparativa-sustitucion"');
    expect(html).toContain('Criterio');
    expect(html).toContain('Prescrito');
    expect(html).toContain('Candidato');
    expect(html).toContain('Estado');

    // Filas de criterios
    expect(html).toContain('Principio activo');
    expect(html).toContain('Prednisolona');
    expect(html).toContain('Concentración');
    expect(html).toContain('Forma farmacéutica');
    expect(html).toContain('Vía de administración');
    expect(html).toContain('VÍA ORAL');
    expect(html).toContain('Vía tópica');

    // Badges de coincidencia y discrepancia
    expect(html).toContain('✓ Coincide');
    expect(html).toContain('✗ Discrepancia');
    expect(html).toContain('bg-noconforme-bg/40');
  });

  it('no renderiza la tabla si no existen evidencias de comparativa', () => {
    const simulacion: SimulacionGuardada = {
      simulacionId: 'sim-456',
      herramienta: 'simular_validez',
      decision: 'VALIDA_HASTA',
      motivos: [],
      reglaVersion: 'validez.v1@f1d413ec',
      supuestos: { fechaEmision: '2026-10-12' },
      evidencias: { validezEfectiva: '2026-11-12' },
    };

    const html = renderToString(<TarjetaSimulacion s={simulacion} />);

    expect(html).toContain('data-testid="asistente-simulacion"');
    expect(html).toMatch(/Simulación:.*Receta válida/);
    expect(html).not.toContain('data-testid="tabla-comparativa-sustitucion"');
  });
});
