import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VisorReceta, TextoReconocido, type ImagenReceta } from './visor-receta';

describe('VisorReceta y TextoReconocido', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const imagenesPrueba: ImagenReceta[] = [
    { pagina: 1, url: '/api/recetas/123/imagen/1', mime: 'image/jpeg' },
    { pagina: 2, url: '/api/recetas/123/imagen/2', mime: 'image/jpeg' },
  ];

  it('TextoReconocido muestra el contenido OCR y el botón de copiar', () => {
    const html = renderToString(<TextoReconocido texto="BONQAT 50 mg/ml SOLUCION ORAL\nLote: 3038691" />);
    expect(html).toContain('Texto reconocido (OCR)');
    expect(html).toContain('BONQAT 50 mg/ml SOLUCION ORAL');
    expect(html).toContain('Lote: 3038691');
    expect(html).toContain('Copiar todo');
  });

  it('VisorReceta dispone imagen y texto OCR en panel dividido (xl:grid-cols-2) si hay ocrTexto', () => {
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <VisorReceta
          imagenes={imagenesPrueba}
          ocrTexto="Texto detectado por OCR contiguo"
          dividido={true}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain('data-testid="visor-receta"');
    expect(html).toContain('xl:grid-cols-2');
    expect(html).toMatch(/Página.*1/);
    expect(html).toMatch(/Página.*2/);
    expect(html).toContain('Texto detectado por OCR contiguo');
  });

  it('VisorReceta no usa panel de dos columnas si ocrTexto es nulo o indefinido', () => {
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <VisorReceta
          imagenes={imagenesPrueba}
          ocrTexto={null}
          dividido={true}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain('data-testid="visor-receta"');
    expect(html).not.toContain('xl:grid-cols-2');
    expect(html).toContain('flex flex-col gap-4');
  });
});
