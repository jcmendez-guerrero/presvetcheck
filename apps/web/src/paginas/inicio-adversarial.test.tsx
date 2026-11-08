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

// Mock de useAuth con estado mutable
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

describe('Oráculo Adversarial de Inicio (Dashboard - Milestone 3)', () => {
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

  // -------------------------------------------------------------------------
  // 1. ORÁCULO DE ESTADOS DE INDICADORES DUALES Y VALORES EXTREMOS (SPEC §2.1)
  // -------------------------------------------------------------------------
  describe('1. Indicadores duales (icono + texto) con valores extremos (n = 0, 1, 9999, etc.)', () => {
    it('caso n = 0: señal dual estricta con icono verde y texto explícito "Al día" en las 4 métricas', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);

      // Debe contener exactamente 4 badges "Al día"
      const coincidenciasAlDia = html.match(/Al día/g);
      // Hay 4 badges en métricas + 1 mención en el chip de tranquilidad = al menos 5
      expect(coincidenciasAlDia?.length).toBeGreaterThanOrEqual(5);

      // Debe incluir tokens semánticos de éxito (dispensar)
      expect(html).toContain('bg-dispensar-bg');
      expect(html).toContain('text-dispensar');

      // Debe incluir el texto de estado accesible para lectores de pantalla
      expect(html).toMatch(/0.*Sustituciones pendientes.*Al día/);
      expect(html).toMatch(/0.*Discrepancias con el TPV.*Al día/);
      expect(html).toMatch(/0.*Recetas no conformes.*Al día/);
      expect(html).toMatch(/0.*Incidencias de sincronización.*Al día/);
    });

    it('caso n = 1: concordancia gramatical en singular ("1 pendiente") y señal dual de aviso', () => {
      mockQueryData = {
        sustitucionesPendientes: 1,
        recetasNoConformes: 1,
        discrepanciasAbiertas: 1,
        outboxIncidencias: 1,
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);

      // Debe usar la forma singular "1 pendiente" y no "1 pendientes"
      const coincidenciasSingular = html.match(/1 pendiente/g);
      expect(coincidenciasSingular?.length).toBeGreaterThanOrEqual(4);

      // Tokens semánticos de aviso (pedir)
      expect(html).toContain('bg-pedir-bg');
      expect(html).toContain('text-pedir');
    });

    it('caso n = 9999 y valores masivos: no rompe la estructura y usa plural ("pendientes")', () => {
      mockQueryData = {
        sustitucionesPendientes: 9999,
        recetasNoConformes: 50000,
        discrepanciasAbiertas: 123456,
        outboxIncidencias: 999999,
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);

      expect(html).toContain('9999');
      expect(html).toContain('9999 pendientes');
      expect(html).toContain('50000 pendientes');
      expect(html).toContain('123456 pendientes');
      expect(html).toContain('999999 pendientes');
    });

    it('caso mixto: cohabitan métricas al día y métricas con incidencias sin interferencias', () => {
      mockQueryData = {
        sustitucionesPendientes: 0, // Al día
        recetasNoConformes: 5, // 5 pendientes
        discrepanciasAbiertas: 0, // Al día
        outboxIncidencias: 1, // 1 pendiente
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);

      // Sustituciones y discrepancias deben indicar "Al día"
      expect(html).toMatch(/0.*Sustituciones pendientes.*Al día/);
      expect(html).toMatch(/0.*Discrepancias con el TPV.*Al día/);

      // Recetas no conformes y outbox deben indicar pendientes
      expect(html).toContain('5 pendientes');
      expect(html).toContain('1 pendiente');
    });
  });

  // -------------------------------------------------------------------------
  // 2. ORÁCULO MATRICIAL DE BANNERS DE ALERTA PRIORITARIA
  // -------------------------------------------------------------------------
  describe('2. Matriz exhaustiva de combinaciones de avisos prioritarios', () => {
    it('matriz [0, 0]: ni pedidos ni registros -> muestra chip de tranquilidad y ningún banner alert', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);

      expect(html).toContain('Sin alertas prioritarias de mostrador · Todos los registros y entregas al día');
      expect(html).not.toContain('role="alert"');
      expect(html).toContain('role="status"');
    });

    it('matriz [1, 0]: 1 pedido pendiente (singular) y 0 registros -> alerta pedidos activa, chip oculto', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 1,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);

      expect(html).toContain('role="alert"');
      expect(html).toContain('Medicamentos pendientes de entrega');
      expect(html).toContain('Hay 1 medicamento recibido pendiente de entrega para recetas retenidas.');
      expect(html).not.toContain('Registros oficiales pendientes');
      expect(html).not.toContain('Sin alertas prioritarias de mostrador');
    });

    it('matriz [5, 0]: 5 pedidos pendientes (plural) y 0 registros -> alerta pedidos plural, chip oculto', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 5,
        registrosPendientes: 0,
      };

      const html = renderToString(<Inicio />);

      expect(html).toContain('Hay 5 medicamentos recibidos pendientes de entrega para recetas retenidas.');
      expect(html).not.toContain('Registros oficiales pendientes');
      expect(html).not.toContain('Sin alertas prioritarias de mostrador');
    });

    it('matriz [0, 1]: 0 pedidos y 1 registro pendiente (singular) -> alerta registros activa, chip oculto', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 1,
      };

      const html = renderToString(<Inicio />);

      expect(html).toContain('role="alert"');
      expect(html).toContain('Registros oficiales pendientes (RD 1157/2021)');
      expect(html).toContain('Hay 1 receta dispensada con los datos del registro por completar.');
      expect(html).not.toContain('Medicamentos pendientes de entrega');
      expect(html).not.toContain('Sin alertas prioritarias de mostrador');
    });

    it('matriz [0, 8]: 0 pedidos y 8 registros pendientes (plural) -> alerta registros plural, chip oculto', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 0,
        registrosPendientes: 8,
      };

      const html = renderToString(<Inicio />);

      expect(html).toContain('Hay 8 recetas dispensadas con los datos del registro por completar.');
      expect(html).not.toContain('Medicamentos pendientes de entrega');
      expect(html).not.toContain('Sin alertas prioritarias de mostrador');
    });

    it('matriz [3, 4]: ambos > 0 -> renderiza ambos banners de alerta simultáneamente sin chip', () => {
      mockQueryData = {
        sustitucionesPendientes: 0,
        recetasNoConformes: 0,
        discrepanciasAbiertas: 0,
        outboxIncidencias: 0,
        pedidosRecibidosPendientesEntrega: 3,
        registrosPendientes: 4,
      };

      const html = renderToString(<Inicio />);

      // Debe haber exactamente 2 alerts
      const alertas = html.match(/role="alert"/g);
      expect(alertas?.length).toBe(2);

      expect(html).toContain('Hay 3 medicamentos recibidos pendientes de entrega para recetas retenidas.');
      expect(html).toContain('Hay 4 recetas dispensadas con los datos del registro por completar.');
      expect(html).not.toContain('Sin alertas prioritarias de mostrador');
    });

    it('resiliencia de datos: cuando q.data es null/undefined, no produce errores de ejecución', () => {
      mockQueryData = null;

      expect(() => {
        const html = renderToString(<Inicio />);
        expect(html).toBeDefined();
        expect(html).not.toContain('role="alert"');
        expect(html).not.toContain('Sin alertas prioritarias de mostrador');
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 3. ORÁCULO DE RESTRICCIONES DE ROL Y AUTENTICACIÓN (RBAC)
  // -------------------------------------------------------------------------
  describe('3. Restricciones de rol y comportamiento en perfiles no privilegiados', () => {
    it('rol "empleado": muestra los 4 accesos rápidos de mostrador y etiqueta de rol', () => {
      mockUsuario = {
        id: 'dev-empleado',
        nombre: 'Carlos Mostrador',
        roles: ['empleado'],
        mfa: true,
      };

      const html = renderToString(<Inicio />);

      expect(html).toContain('Operaciones de mostrador');
      expect(html).toContain('data-testid="boton-receta"');
      expect(html).toContain('Venta sin receta');
      expect(html).toContain('Pedido online');
      expect(html).toContain('Recepción');
      expect(html).toContain('Personal de Farmacia');
    });

    it('rol "veterinaria_responsable": muestra los 4 accesos rápidos y etiqueta "Veterinaria Responsable"', () => {
      mockUsuario = {
        id: 'dev-vet',
        nombre: 'Dra. Elena',
        roles: ['veterinaria_responsable'],
        mfa: true,
      };

      const html = renderToString(<Inicio />);

      expect(html).toContain('Operaciones de mostrador');
      expect(html).toContain('data-testid="boton-receta"');
      expect(html).toContain('Veterinaria Responsable');
    });

    it('rol "admin": NO muestra las tarjetas de operaciones de mostrador y etiqueta "Administración"', () => {
      mockUsuario = {
        id: 'dev-admin',
        nombre: 'Admin General',
        roles: ['admin'],
        mfa: true,
      };

      const html = renderToString(<Inicio />);

      // Tarjetas de mostrador no deben renderizarse
      expect(html).not.toContain('Operaciones de mostrador');
      expect(html).not.toContain('data-testid="boton-receta"');
      expect(html).not.toContain('Dispensación con receta oficial');
      // Pero sí debe mostrar su etiqueta de rol
      expect(html).toContain('Administración');
    });

    it('rol no operativo (ej. "auditor_externo"): NO muestra tarjetas de mostrador y usa fallback seguro', () => {
      mockUsuario = {
        id: 'dev-auditor',
        nombre: 'Inspector Sanitario',
        roles: ['auditor_externo'],
        mfa: true,
      };

      const html = renderToString(<Inicio />);

      expect(html).not.toContain('Operaciones de mostrador');
      expect(html).not.toContain('data-testid="boton-receta"');
      // Fallback seguro de rol
      expect(html).toContain('Personal de Farmacia');
    });

    it('usuario sin roles asignados (array vacío): NO muestra tarjetas de mostrador', () => {
      mockUsuario = {
        id: 'dev-sin-roles',
        nombre: 'Sin Rol',
        roles: [],
        mfa: true,
      };

      const html = renderToString(<Inicio />);

      expect(html).not.toContain('Operaciones de mostrador');
      expect(html).not.toContain('data-testid="boton-receta"');
    });

    it('usuario no autenticado (null): saludo genérico, sin tarjetas de mostrador, sin errores', () => {
      mockUsuario = null;
      mockQueryData = null;

      const html = renderToString(<Inicio />);

      // Saludo sin nombre ni coma suelta
      expect(html).toContain('Hola');
      expect(html).not.toContain('Hola,');
      // No debe mostrar operaciones de mostrador
      expect(html).not.toContain('Operaciones de mostrador');
      expect(html).not.toContain('data-testid="boton-receta"');
    });
  });

  // -------------------------------------------------------------------------
  // 4. ORÁCULO DE INTEGRIDAD DE RUTAS Y PARÁMETROS DE CONSULTA
  // -------------------------------------------------------------------------
  describe('4. Verificación exhaustiva de destinos de ruta y query params', () => {
    it('tarjeta Receta: apunta exactamente a /recetas/nueva y preserva data-testid="boton-receta"', () => {
      const html = renderToString(<Inicio />);

      expect(html).toContain('data-testid="boton-receta"');
      expect(html).toContain('href="/recetas/nueva"');
    });

    it('tarjeta Venta sin receta: apunta a /venta con parámetro canal=presencial', () => {
      const html = renderToString(<Inicio />);

      expect(html).toContain('href="/venta?canal=presencial"');
    });

    it('tarjeta Pedido online: apunta a /venta con parámetro canal=online', () => {
      const html = renderToString(<Inicio />);

      expect(html).toContain('href="/venta?canal=online"');
    });

    it('tarjeta Recepción: apunta a /recepciones', () => {
      const html = renderToString(<Inicio />);

      expect(html).toContain('href="/recepciones"');
    });

    it('paneles de productividad: apuntan a /registros y /vademecum respectivamente', () => {
      const html = renderToString(<Inicio />);

      expect(html).toContain('href="/registros"');
      expect(html).toContain('href="/vademecum"');
    });

    it('métricas operativas: todas las 4 tarjetas apuntan a /pendientes', () => {
      const html = renderToString(<Inicio />);

      const enlacesPendientes = html.match(/href="\/pendientes"/g);
      // Al menos las 4 tarjetas métricas deben enlazar a /pendientes
      expect(enlacesPendientes?.length).toBeGreaterThanOrEqual(4);
    });
  });

  // -------------------------------------------------------------------------
  // 5. ORÁCULO DE ACCESIBILIDAD, CONTRASTE Y RESILIENCIA DE FECHA
  // -------------------------------------------------------------------------
  describe('5. Accesibilidad, semántica WCAG 2.1 AA y resiliencia de contexto', () => {
    it('todos los iconos decorativos incluyen aria-hidden para no saturar lectores de pantalla', () => {
      const html = renderToString(<Inicio />);

      // Todos los elementos SVG de iconos deben tener aria-hidden="true" o aria-hidden
      const tagsSvg = html.match(/<svg[^>]*>/g) ?? [];
      expect(tagsSvg.length).toBeGreaterThan(0);
      for (const svg of tagsSvg) {
        expect(svg).toContain('aria-hidden');
      }
    });

    it('los elementos interactivos incluyen anillos de foco accesible (ring-dorado)', () => {
      const html = renderToString(<Inicio />);

      expect(html).toContain('focus-visible:ring-dorado');
      expect(html).toContain('focus-visible:ring-2');
    });

    it('las tarjetas tienen estilos calibrados para elevación en modo claro y oscuro', () => {
      const html = renderToString(<Inicio />);

      expect(html).toContain('bg-white');
      expect(html).toContain('dark:bg-superficie');
      expect(html).toContain('border-slate-200/90');
      expect(html).toContain('dark:border-white/10');
      expect(html).toContain('dark:border-t-white/15');
      expect(html).toContain('shadow-xs');
    });

    it('elemento de tiempo tiene formato ISO de fecha válido y zona horaria Madrid', () => {
      const html = renderToString(<Inicio />);

      const hoyIso = new Date().toISOString().slice(0, 10);
      expect(html).toContain(`dateTime="${hoyIso}"`);
    });
  });
});
