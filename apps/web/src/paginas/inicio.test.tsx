import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { Inicio } from './inicio';

// Mock de TanStack Router Link
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    className,
    ...props
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
    className?: string;
    [k: string]: unknown;
  }) => {
    const searchStr = search ? `?${new URLSearchParams(search).toString()}` : '';
    return (
      <a href={`${to}${searchStr}`} className={className} {...props}>
        {children}
      </a>
    );
  },
}));

// Mock de useAuth
let mockUsuario: { id: string; nombre: string; roles: string[]; mfa: boolean } | null = {
  id: 'dev-empleado',
  nombre: 'Empleada',
  roles: ['empleado'],
  mfa: true,
};
let mockTiene = vi.fn((...roles: string[]) => mockUsuario?.roles.some((r) => roles.includes(r)) ?? false);

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    usuario: mockUsuario,
    tiene: mockTiene,
  }),
}));

// Mock de useQuery para simular contadores de /api/inicio
let mockQueryData: {
  sustitucionesPendientes: number;
  recetasNoConformes: number;
  discrepanciasAbiertas: number;
  outboxIncidencias: number;
  pedidosRecibidosPendientesEntrega: number;
  registrosPendientes: number;
} | null = {
  sustitucionesPendientes: 0,
  recetasNoConformes: 0,
  discrepanciasAbiertas: 0,
  outboxIncidencias: 0,
  pedidosRecibidosPendientesEntrega: 0,
  registrosPendientes: 0,
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: mockQueryData,
    isLoading: false,
    error: null,
  }),
}));

describe('Modernización del Panel de Inicio (Dashboard - Milestone 3)', () => {
  beforeEach(() => {
    mockUsuario = {
      id: 'dev-empleado',
      nombre: 'Empleada',
      roles: ['empleado'],
      mfa: true,
    };
    mockTiene = vi.fn((...roles: string[]) => mockUsuario?.roles.some((r) => roles.includes(r)) ?? false);
    mockQueryData = {
      sustitucionesPendientes: 0,
      recetasNoConformes: 0,
      discrepanciasAbiertas: 0,
      outboxIncidencias: 0,
      pedidosRecibidosPendientesEntrega: 0,
      registrosPendientes: 0,
    };
  });

  describe('Feature 11: Encabezado operativo, contexto de turno y avisos prioritarios', () => {
    it('muestra saludo con nombre, insignia de rol y estado de mostrador activo', () => {
      const html = renderToString(<Inicio />);

      // Saludo y nombre de usuario
      expect(html).toContain('Hola, Empleada');

      // Rol del usuario mapeado
      expect(html).toContain('Personal de Farmacia');

      // Indicador de turno de mostrador activo
      expect(html).toContain('Mostrador activo');
    });

    it('mapea rol de veterinaria responsable adecuadamente', () => {
      mockUsuario = {
        id: 'dev-veterinaria',
        nombre: 'Dra. García',
        roles: ['veterinaria_responsable'],
        mfa: true,
      };

      const html = renderToString(<Inicio />);
      expect(html).toContain('Hola, Dra. García');
      expect(html).toContain('Veterinaria Responsable');
    });

    it('muestra chip de tranquilidad cuando hay 0 alertas prioritarias', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);
      expect(html).toContain('Sin alertas prioritarias de mostrador');
      expect(html).toContain('Todos los registros y entregas al día');
    });

    it('muestra aviso prioritario cuando hay pedidos recibidos pendientes de entrega', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 3,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);
      expect(html).toContain('Medicamentos pendientes de entrega');
      expect(html).toContain('Hay 3 medicamentos recibidos pendientes de entrega para recetas retenidas.');
      expect(html).toContain('Gestionar entregas');
    });

    it('muestra aviso prioritario normativo cuando hay registros pendientes (RD 1157/2021)', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 2,
      };

      const html = renderToString(<Inicio />);
      expect(html).toContain('Registros oficiales pendientes (RD 1157/2021)');
      expect(html).toContain('Hay 2 recetas dispensadas con los datos del registro por completar.');
      expect(html).toContain('Completar registro');
    });
  });

  describe('Feature 12: 4 Tarjetas Operativas Hero de Mostrador', () => {
    it('preserva obligatoriamente data-testid="boton-receta" en la tarjeta de Receta', () => {
      const html = renderToString(<Inicio />);
      expect(html).toContain('data-testid="boton-receta"');
      expect(html).toContain('href="/recetas/nueva"');
    });

    it('renderiza las 4 tarjetas operativas con elevación, bordes e iconos descriptivos', () => {
      const html = renderToString(<Inicio />);

      // Tarjeta 1: Receta
      expect(html).toContain('Receta');
      expect(html).toContain('Dispensación con receta oficial');
      expect(html).toContain('href="/recetas/nueva"');

      // Tarjeta 2: Venta sin receta
      expect(html).toContain('Venta sin receta');
      expect(html).toContain('Mostrador presencial y zoosanitarios');
      expect(html).toContain('href="/venta?canal=presencial"');

      // Tarjeta 3: Pedido online
      expect(html).toContain('Pedido online');
      expect(html).toContain('Entrega de pedidos web y click &amp; collect');
      expect(html).toContain('href="/venta?canal=online"');

      // Tarjeta 4: Recepción
      expect(html).toContain('Recepción');
      expect(html).toContain('Entrada de albaranes y verificación FEFO');
      expect(html).toContain('href="/recepciones"');

      // Clases de elevación y diseño para temas claro y oscuro
      expect(html).toContain('rounded-2xl');
      expect(html).toContain('bg-white');
      expect(html).toContain('dark:bg-superficie');
      expect(html).toContain('border-slate-200/90');
      expect(html).toContain('dark:border-white/10');
      expect(html).toContain('shadow-xs');
    });
  });

  describe('Feature 13: 4 Tarjetas de Métricas Operativas (SPEC §2.1 - Icono + Texto)', () => {
    it('muestra badge verde "Al día" con icono CheckCircle2 cuando el contador es 0', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);

      // Las 4 métricas deben indicar "Al día"
      expect(html).toContain('Sustituciones pendientes');
      expect(html).toContain('Discrepancias con el TPV');
      expect(html).toContain('Recetas no conformes');
      expect(html).toContain('Incidencias de sincronización');

      // Badge semántico dual con texto explícito "Al día" y clase de fondo y texto verde dispensar
      expect(html).toContain('bg-dispensar-bg');
      expect(html).toContain('text-dispensar');
      expect(html).toContain('Al día');
    });

    it('muestra badge de aviso con número y texto "${n} pendientes" cuando el contador es > 0', () => {
      mockQueryData = {
        sustitucionesPendientes: 4,
        recetasNoConformes: 1,
        discrepanciasAbiertas: 2,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);

      // Indicadores con cifra + texto sin depender exclusivamente del color
      expect(html).toContain('4 pendientes');
      expect(html).toContain('1 pendiente');
      expect(html).toContain('2 pendientes');
      expect(html).toContain('Al día'); // Para outboxIncidencias

      // Estilo de badge de aviso
      expect(html).toContain('bg-pedir-bg');
      expect(html).toContain('text-pedir');
    });
  });

  describe('Feature 14: Paneles de Productividad y Normativa', () => {
    it('renderiza el panel de Libro Oficial de Registro (RD 1157/2021)', () => {
      const html = renderToString(<Inicio />);

      expect(html).toContain('Libro Oficial de Registro');
      expect(html).toContain('RD 1157/2021');
      expect(html).toContain('Custodia legal 5 años');
      expect(html).toContain('Inalterabilidad de apuntes');
      expect(html).toContain('Consultar Libro Oficial');
      expect(html).toContain('href="/registros"');
    });

    it('renderiza el panel de Vademécum CIMAVet (AEMPS)', () => {
      const html = renderToString(<Inicio />);

      expect(html).toContain('Vademécum Oficial CIMAVet');
      expect(html).toContain('AEMPS');
      expect(html).toContain('Condiciones de dispensación');
      expect(html).toContain('Vacío terapéutico');
      expect(html).toContain('Abrir Vademécum');
      expect(html).toContain('href="/vademecum"');
    });
  });
});
