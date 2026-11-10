import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Vademecum } from './vademecum';

describe('Vademecum (US7, FR-018)', () => {
  it('renderiza la página con los buscadores de referencia A y candidato B, selector de especie y botón comparar', () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <Vademecum />
      </QueryClientProvider>,
    );

    expect(html).toContain('Vademécum · Comparador de sustitución');
    expect(html).toContain('1. Medicamento prescrito o de referencia (A)');
    expect(html).toContain('2. Medicamento candidato o sustituto (B)');
    expect(html).toContain('3. Parámetros de destino');
    expect(html).toContain('Especie animal');
    expect(html).toContain('Indicación o patología clínica (opcional)');
    expect(html).toContain('Comparar medicamentos');
    expect(html).toContain('Perro');
    expect(html).toContain('Gato');
  });
});
