import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ModalSustitucionManual } from './resultado';

describe('ModalSustitucionManual (US6, FR-017)', () => {
  it('renderiza el modal con el nombre del candidato, campo de motivo obligatorio y aviso del garante en modo POST', () => {
    const html = renderToString(
      <ModalSustitucionManual
        candidatoNombre="Clavusan 50/12,5 mg"
        candidatoCn="570001"
        onCancelar={vi.fn()}
        onConfirmar={vi.fn()}
      />,
    );

    expect(html).toContain('Confirmar sustitución por falta de existencias');
    expect(html).toContain('Clavusan 50/12,5 mg');
    expect(html).toContain('570001');
    expect(html).toContain('Razón / Justificación de la sustitución');
    expect(html).toContain('modo POST');
    expect(html).toContain('Mínimo 5 caracteres');
    expect(html).toContain('Confirmar y sustituir');
  });
});
