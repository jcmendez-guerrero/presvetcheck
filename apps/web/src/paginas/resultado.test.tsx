import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AvisoFormacion, BloquePedido, ModalSustitucionManual, mostrarPedido } from './resultado';

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

describe('Modo formación en el resultado (specs/016)', () => {
  const pedido = { cn: '570016', nombre: 'Producto de prueba', labtitular: 'Lab', psum: false, equivalentes: [] };

  it('en formación no se propone pedir el producto, aunque no haya stock', () => {
    expect(mostrarPedido('PEDIR', pedido, '2026-09-15')).toBe(false);
  });

  it('en vivo se sigue proponiendo pedir lo que no tiene stock', () => {
    expect(mostrarPedido('PEDIR', pedido, null)).toBe(true);
    expect(mostrarPedido('DISPENSAR', pedido, null)).toBe(false);
    expect(mostrarPedido('PEDIR', null, null)).toBe(false);
  });

  it('el bloque de pedido en vivo conserva «Añadir a lista de pedido»', () => {
    const html = renderToString(<BloquePedido pedido={pedido} sustitucionBloqueada={false} onAnadir={vi.fn()} />);
    expect(html).toContain('Añadir a lista de pedido');
    expect(html).toContain('Producto de prueba');
  });

  it('el aviso de formación indica la fecha de la venta comprobada y no ofrece pedir', () => {
    const html = renderToString(<AvisoFormacion fecha="2026-09-15" />);
    expect(html).toContain('Modo formación');
    expect(html).toContain('2026');
    expect(html).not.toContain('Añadir a lista de pedido');
  });
});
