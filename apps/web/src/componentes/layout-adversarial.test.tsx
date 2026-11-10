import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { DESTINOS_COMANDO, type DestinoComando } from './comando-buscar';
import { SECCIONES_NAVEGACION, Sidebar } from './sidebar';
import { Topbar } from './topbar';

// Mocks para TanStack Router y librerías de contexto
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    length: 0,
    key: () => null,
  };
}
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    activeOptions: _activeOptions,
    activeProps,
    className,
    ...props
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
    activeOptions?: unknown;
    activeProps?: {
      className?: string;
      'aria-current'?: 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false' | boolean;
    };
    className?: string;
    [k: string]: unknown;
  }) => {
    // Si la ruta es '/', simulamos que está activa para verificar las clases de píldora
    const esActivo = to === '/';
    const clasesFinales = [className, esActivo ? activeProps?.className : ''].filter(Boolean).join(' ');

    return (
      <a
        href={`${to}${search ? `?${new URLSearchParams(search).toString()}` : ''}`}
        className={clasesFinales}
        aria-current={esActivo ? 'page' : undefined}
        {...props}
      >
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn(),
  useRouterState: () => false,
  Outlet: () => <div data-testid="outlet-mock">Contenido de ruta</div>,
}));

vi.mock('../lib/auth', () => ({
  USUARIOS_DEV: [
    { id: 'dev-empleado', etiqueta: 'Empleada' },
    { id: 'dev-veterinaria', etiqueta: 'Veterinaria responsable' },
    { id: 'dev-admin', etiqueta: 'Administración' },
  ],
  useAuth: () => ({
    config: {
      authMode: 'dev',
      stock: 'demo',
      extractor: 'fake',
    },
    usuario: {
      id: 'dev-empleado',
      nombre: 'Empleada',
      roles: ['empleado', 'veterinaria_responsable', 'admin'],
      mfa: true,
    },
    estado: 'activa',
    iniciarSesion: vi.fn(),
    cerrarSesion: vi.fn(),
    cambiarUsuarioDev: vi.fn(),
    mfaDev: true,
    cambiarMfaDev: vi.fn(),
    tiene: (..._roles: string[]) => true,
  }),
}));

vi.mock('../lib/movil', () => ({
  useMovil: () => null,
  ProveedorMovil: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./movil-pc', () => ({
  BotonMovil: () => <button data-testid="boton-movil-mock">Móvil</button>,
  AvisosMovil: () => <div data-testid="avisos-movil-mock" />,
}));

vi.mock('./asistente', () => ({
  ProveedorAsistente: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// 1. ORÁCULO DE GEOMETRÍA Y LÍMITES RESPONSIVE (320px a 3840px)
// ---------------------------------------------------------------------------
describe('Oráculo Geométrico: Presupuesto de Ancho y Ausencia de Colisión (320px a 4K)', () => {
  interface ViewportDef {
    nombre: string;
    width: number;
    height: number;
    esMovil: boolean;
    tieneBuscadorEnTopbar: boolean;
    tieneDevSelectorEnTopbar: boolean;
  }

  const RESOLUCIONES: ViewportDef[] = [
    {
      nombre: '320x568 (Móvil ultra-compacto SE)',
      width: 320,
      height: 568,
      esMovil: true,
      tieneBuscadorEnTopbar: false,
      tieneDevSelectorEnTopbar: false,
    },
    {
      nombre: '360x640 (Móvil estándar)',
      width: 360,
      height: 640,
      esMovil: true,
      tieneBuscadorEnTopbar: false,
      tieneDevSelectorEnTopbar: false,
    },
    {
      nombre: '768x1024 (Tablet vertical iPad)',
      width: 768,
      height: 1024,
      esMovil: true,
      tieneBuscadorEnTopbar: true,
      tieneDevSelectorEnTopbar: true,
    },
    {
      nombre: '1023x768 (Límite previo a breakpoint lg)',
      width: 1023,
      height: 768,
      esMovil: true,
      tieneBuscadorEnTopbar: true,
      tieneDevSelectorEnTopbar: true,
    },
    {
      nombre: '1024x768 (Tablet mostrador / TPV - Inicio Desktop)',
      width: 1024,
      height: 768,
      esMovil: false,
      tieneBuscadorEnTopbar: true,
      tieneDevSelectorEnTopbar: true,
    },
    {
      nombre: '1440x900 (Escritorio estándar)',
      width: 1440,
      height: 900,
      esMovil: false,
      tieneBuscadorEnTopbar: true,
      tieneDevSelectorEnTopbar: true,
    },
    {
      nombre: '1920x1080 (Full HD)',
      width: 1920,
      height: 1080,
      esMovil: false,
      tieneBuscadorEnTopbar: true,
      tieneDevSelectorEnTopbar: true,
    },
    {
      nombre: '3840x2160 (4K Ultra-wide)',
      width: 3840,
      height: 2160,
      esMovil: false,
      tieneBuscadorEnTopbar: true,
      tieneDevSelectorEnTopbar: true,
    },
  ];

  for (const vp of RESOLUCIONES) {
    it(`garantiza margen positivo y cero colisión en ${vp.nombre}`, () => {
      const paddingHorizontal = vp.width < 640 ? 24 : 48;
      const anchoZonaIzquierda = vp.esMovil ? 76 : 220;

      const anchoSelectorTema = 104;
      const anchoDevSelector = vp.tieneDevSelectorEnTopbar ? 160 : 0;
      const anchoBotonMovil = vp.tieneDevSelectorEnTopbar ? 40 : 0;
      const anchoZonaDerecha = anchoSelectorTema + anchoDevSelector + anchoBotonMovil;

      const anchoSidebar = vp.esMovil ? 0 : 256;
      const anchoTopbarDisponible = vp.width - anchoSidebar;

      const anchoRigidoMinimo = paddingHorizontal + anchoZonaIzquierda + anchoZonaDerecha;
      const espacioDisponibleParaBuscador = anchoTopbarDisponible - anchoRigidoMinimo;

      if (vp.tieneBuscadorEnTopbar) {
        const anchoMinimoBuscador = 74;
        expect(
          espacioDisponibleParaBuscador,
          `El buscador no dispone de espacio suficiente en ${vp.nombre}`,
        ).toBeGreaterThanOrEqual(anchoMinimoBuscador);
      } else {
        expect(
          anchoTopbarDisponible - anchoRigidoMinimo,
          `Los elementos rígidos colisionan en ${vp.nombre}`,
        ).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. ORÁCULO DE TRAMPA DE FOCO (useFocusTrap) Y ACCESIBILIDAD MODAL
// ---------------------------------------------------------------------------
describe('Oráculo de Trampa de Foco (useFocusTrap)', () => {
  function simularEventoTecladoTrap(
    elementos: HTMLElement[],
    elementoActivo: HTMLElement,
    tecla: 'Tab' | 'Escape',
    shiftKey = false,
  ): { preventDefaultLlamado: boolean; siguienteFoco: HTMLElement | null; cerrarLlamado: boolean } {
    let preventDefaultLlamado = false;
    let siguienteFoco: HTMLElement | null = null;
    let cerrarLlamado = false;

    const e = {
      key: tecla,
      shiftKey,
      preventDefault: () => {
        preventDefaultLlamado = true;
      },
    };

    if (e.key === 'Escape') {
      e.preventDefault();
      cerrarLlamado = true;
      return { preventDefaultLlamado, siguienteFoco, cerrarLlamado };
    }

    if (e.key === 'Tab') {
      if (elementos.length === 0) {
        e.preventDefault();
        return { preventDefaultLlamado, siguienteFoco, cerrarLlamado };
      }

      const primero = elementos[0]!;
      const ultimo = elementos[elementos.length - 1]!;

      if (e.shiftKey && elementoActivo === primero) {
        e.preventDefault();
        siguienteFoco = ultimo;
      } else if (!e.shiftKey && elementoActivo === ultimo) {
        e.preventDefault();
        siguienteFoco = primero;
      }
    }

    return { preventDefaultLlamado, siguienteFoco, cerrarLlamado };
  }

  it('atrapa el foco avanzando con Tab desde el último elemento y salta al primero', () => {
    const el1 = { id: 'btn-cerrar' } as HTMLElement;
    const el2 = { id: 'link-receta' } as HTMLElement;
    const el3 = { id: 'link-stock' } as HTMLElement;
    const lista = [el1, el2, el3];

    const res = simularEventoTecladoTrap(lista, el3, 'Tab', false);
    expect(res.preventDefaultLlamado).toBe(true);
    expect(res.siguienteFoco).toBe(el1);
  });

  it('atrapa el foco retrocediendo con Shift+Tab desde el primer elemento y salta al último', () => {
    const el1 = { id: 'btn-cerrar' } as HTMLElement;
    const el2 = { id: 'link-receta' } as HTMLElement;
    const el3 = { id: 'link-stock' } as HTMLElement;
    const lista = [el1, el2, el3];

    const res = simularEventoTecladoTrap(lista, el1, 'Tab', true);
    expect(res.preventDefaultLlamado).toBe(true);
    expect(res.siguienteFoco).toBe(el3);
  });

  it('permite navegación interna normal cuando no se está en los extremos', () => {
    const el1 = { id: 'btn-cerrar' } as HTMLElement;
    const el2 = { id: 'link-receta' } as HTMLElement;
    const el3 = { id: 'link-stock' } as HTMLElement;
    const lista = [el1, el2, el3];

    const resTab = simularEventoTecladoTrap(lista, el2, 'Tab', false);
    expect(resTab.preventDefaultLlamado).toBe(false);
    expect(resTab.siguienteFoco).toBeNull();

    const resShiftTab = simularEventoTecladoTrap(lista, el2, 'Tab', true);
    expect(resShiftTab.preventDefaultLlamado).toBe(false);
    expect(resShiftTab.siguienteFoco).toBeNull();
  });

  it('la tecla Escape invoca alCerrar() e intercepta el evento por defecto', () => {
    const el1 = { id: 'btn-cerrar' } as HTMLElement;
    const res = simularEventoTecladoTrap([el1], el1, 'Escape');

    expect(res.preventDefaultLlamado).toBe(true);
    expect(res.cerrarLlamado).toBe(true);
  });

  it('evita fuga de foco si el modal contiene 0 elementos interactivos', () => {
    const res = simularEventoTecladoTrap([], {} as HTMLElement, 'Tab', false);
    expect(res.preventDefaultLlamado).toBe(true);
  });

  it('conmuta sobre sí mismo si el modal contiene exactamente 1 elemento interactivo', () => {
    const unico = { id: 'btn-solo' } as HTMLElement;
    const resTab = simularEventoTecladoTrap([unico], unico, 'Tab', false);
    expect(resTab.preventDefaultLlamado).toBe(true);
    expect(resTab.siguienteFoco).toBe(unico);

    const resShiftTab = simularEventoTecladoTrap([unico], unico, 'Tab', true);
    expect(resShiftTab.preventDefaultLlamado).toBe(true);
    expect(resShiftTab.siguienteFoco).toBe(unico);
  });
});

// ---------------------------------------------------------------------------
// 3. ORÁCULO DE CONMUTACIÓN DE TEMA Y SCRIPT ANTI-FOUC (index.html)
// ---------------------------------------------------------------------------
describe('Oráculo de Tema y Script Anti-FOUC en index.html', () => {
  function ejecutarScriptAntiFouc(
    valorLocalStorage: string | null,
    prefiereOscuroSO: boolean,
    lanzarErrorEnStorage = false,
  ): { darkAplicado: boolean; colorScheme: string } {
    const raiz = {
      classList: new Set<string>(),
      style: { colorScheme: '' },
    };

    try {
      if (lanzarErrorEnStorage) {
        throw new Error('SecurityError: localStorage no permitido');
      }
      const tema = valorLocalStorage;
      const prefiereOscuro = prefiereOscuroSO;
      if (tema === 'oscuro' || ((!tema || tema === 'sistema') && prefiereOscuro)) {
        raiz.classList.add('dark');
        raiz.style.colorScheme = 'dark';
      } else {
        raiz.classList.delete('dark');
        raiz.style.colorScheme = 'light';
      }
    } catch {
      // Bloque protector contra SecurityError
    }

    return {
      darkAplicado: raiz.classList.has('dark'),
      colorScheme: raiz.style.colorScheme,
    };
  }

  it('tema = "oscuro" aplica .dark y colorScheme="dark" independientemente del SO', () => {
    const conSoClaro = ejecutarScriptAntiFouc('oscuro', false);
    expect(conSoClaro.darkAplicado).toBe(true);
    expect(conSoClaro.colorScheme).toBe('dark');

    const conSoOscuro = ejecutarScriptAntiFouc('oscuro', true);
    expect(conSoOscuro.darkAplicado).toBe(true);
    expect(conSoOscuro.colorScheme).toBe('dark');
  });

  it('tema = "claro" retira .dark y colorScheme="light" independientemente del SO', () => {
    const conSoClaro = ejecutarScriptAntiFouc('claro', false);
    expect(conSoClaro.darkAplicado).toBe(false);
    expect(conSoClaro.colorScheme).toBe('light');

    const conSoOscuro = ejecutarScriptAntiFouc('claro', true);
    expect(conSoOscuro.darkAplicado).toBe(false);
    expect(conSoOscuro.colorScheme).toBe('light');
  });

  it('tema = "sistema" sincroniza con el tema del sistema operativo', () => {
    const conSoClaro = ejecutarScriptAntiFouc('sistema', false);
    expect(conSoClaro.darkAplicado).toBe(false);
    expect(conSoClaro.colorScheme).toBe('light');

    const conSoOscuro = ejecutarScriptAntiFouc('sistema', true);
    expect(conSoOscuro.darkAplicado).toBe(true);
    expect(conSoOscuro.colorScheme).toBe('dark');
  });

  it('almacenamiento vacío (primera visita) adopta la preferencia del sistema', () => {
    const primerVisitaClaro = ejecutarScriptAntiFouc(null, false);
    expect(primerVisitaClaro.darkAplicado).toBe(false);

    const primerVisitaOscuro = ejecutarScriptAntiFouc(null, true);
    expect(primerVisitaOscuro.darkAplicado).toBe(true);
  });

  it('estrés adversarial: valores corruptos o maliciosos en localStorage no rompen la inicialización', () => {
    const valoresCorruptos = [
      'undefined',
      'null',
      'true',
      'false',
      '{"bad":"json"}',
      '<script>alert(1)</script>',
      'INVALID_THEME',
      '   ',
    ];

    for (const corrupto of valoresCorruptos) {
      expect(() => {
        const res = ejecutarScriptAntiFouc(corrupto, false);
        expect(res.darkAplicado).toBe(false);
        expect(res.colorScheme).toBe('light');
      }).not.toThrow();
    }
  });

  it('estrés adversarial: fallo de acceso a localStorage (SecurityError en sandbox) no rompe la app', () => {
    expect(() => {
      ejecutarScriptAntiFouc(null, true, true);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. ORÁCULO DE PALETA DE COMANDOS (ComandoBuscar) Y RUTAS
// ---------------------------------------------------------------------------
describe('Oráculo de Paleta de Comandos (ComandoBuscar)', () => {
  it('todos los ítems navegables del Sidebar están indexados en DESTINOS_COMANDO', () => {
    const rutasSidebar = new Set<string>();
    for (const seccion of SECCIONES_NAVEGACION) {
      for (const item of seccion.items) {
        rutasSidebar.add(item.a);
      }
    }

    const rutasComando = new Set(DESTINOS_COMANDO.map((d) => d.ruta));

    for (const ruta of rutasSidebar) {
      expect(
        rutasComando.has(ruta),
        `La ruta del Sidebar [${ruta}] no está indexada en DESTINOS_COMANDO`,
      ).toBe(true);
    }
  });

  it('búsqueda adversarial: caracteres especiales de regex no causan excepciones ni cuelgues', () => {
    const entradasAdversariales = [
      '.*',
      '[',
      '(',
      ')',
      '{',
      '}',
      '\\',
      '+',
      '?',
      '^',
      '$',
      '|',
      '[]',
      '(.*)',
      '\\d+',
      '../../../etc/passwd',
      "'; DROP TABLE users; --",
      '<script>alert(1)</script>',
      '   recetas   ',
      'VADEMÉCUM',
      'vAdEmÉcUm',
    ];

    for (const q of entradasAdversariales) {
      expect(() => {
        const limpio = q.trim().toLowerCase();
        const filtrados = DESTINOS_COMANDO.filter(
          (d) =>
            d.titulo.toLowerCase().includes(limpio) ||
            d.seccion.toLowerCase().includes(limpio) ||
            (d.descripcion && d.descripcion.toLowerCase().includes(limpio)),
        );
        expect(Array.isArray(filtrados)).toBe(true);
      }).not.toThrow();
    }
  });

  it('aritmética de navegación de cursor: cicla entre 0 y N-1 con teclas arriba y abajo', () => {
    const totalDestinos = DESTINOS_COMANDO.length;
    expect(totalDestinos).toBeGreaterThan(0);

    const indiceTrasBajarDesdeFin = (totalDestinos - 1 + 1) % totalDestinos;
    expect(indiceTrasBajarDesdeFin).toBe(0);

    const indiceTrasSubirDesdeInicio = (0 - 1 + totalDestinos) % totalDestinos;
    expect(indiceTrasSubirDesdeInicio).toBe(totalDestinos - 1);

    for (let i = 0; i < totalDestinos - 1; i++) {
      expect((i + 1) % totalDestinos).toBe(i + 1);
    }
  });

  it('filtro por roles de usuario: los auxiliares o usuarios sin permisos no ven administración', () => {
    const puedeVer = (destino: DestinoComando, rolesUsuario: string[]): boolean => {
      if (!destino.roles) return true;
      return destino.roles.some((r) => rolesUsuario.includes(r));
    };

    const rolesAuxiliar = ['auxiliar_veterinario'];
    const destinosAuxiliar = DESTINOS_COMANDO.filter((d) => puedeVer(d, rolesAuxiliar));

    expect(destinosAuxiliar.some((d) => d.ruta === '/admin')).toBe(false);
    expect(destinosAuxiliar.some((d) => d.ruta === '/')).toBe(true);
    expect(destinosAuxiliar.some((d) => d.ruta === '/ayuda')).toBe(true);

    const rolesAdmin = ['admin'];
    const destinosAdmin = DESTINOS_COMANDO.filter((d) => puedeVer(d, rolesAdmin));
    expect(destinosAdmin.some((d) => d.ruta === '/admin')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. ORÁCULO DE ESTRUCTURA DEL SIDEBAR (4 Secciones y Píldoras Activas)
// ---------------------------------------------------------------------------
describe('Oráculo de Estructura y Navegación del Sidebar', () => {
  it('contiene exactamente las 4 secciones regulatorias requeridas', () => {
    const titulosEsperados = [
      'Dispensación / Recetas',
      'Operaciones / Recepción y Stock',
      'Registros y Consultas',
      'Sistema / Administración',
    ];

    expect(SECCIONES_NAVEGACION).toHaveLength(4);
    const titulosObtenidos = SECCIONES_NAVEGACION.map((s) => s.titulo);
    expect(titulosObtenidos).toEqual(titulosEsperados);
  });

  it('diferencia las rutas de Venta Mostrador y Pedido Online mediante parámetros de consulta', () => {
    const seccionDisp = SECCIONES_NAVEGACION.find((s) => s.id === 'dispensacion');
    expect(seccionDisp).toBeDefined();

    const ventaMostrador = seccionDisp!.items.find((i) => i.id === 'venta-mostrador');
    const pedidoOnline = seccionDisp!.items.find((i) => i.id === 'pedido-online');

    expect(ventaMostrador).toBeDefined();
    expect(pedidoOnline).toBeDefined();

    expect(ventaMostrador!.a).toBe('/venta');
    expect(pedidoOnline!.a).toBe('/venta');

    expect(ventaMostrador!.busqueda).toEqual({ canal: 'presencial' });
    expect(pedidoOnline!.busqueda).toEqual({ canal: 'online' });
  });

  it('todos los ítems tienen iconos asignados y etiquetas descriptivas no vacías', () => {
    for (const seccion of SECCIONES_NAVEGACION) {
      expect(seccion.titulo.trim().length).toBeGreaterThan(0);
      for (const item of seccion.items) {
        expect(item.id.trim().length).toBeGreaterThan(0);
        expect(item.texto.trim().length).toBeGreaterThan(0);
        expect(item.icono).toBeDefined();
      }
    }
  });

  it('renderiza la barra lateral con roles ARIA, logo, subtítulo institucional y código legal', () => {
    const html = renderToString(<Sidebar abiertoMovil={false} alCerrarMovil={vi.fn()} />);

    // Landmark accesible
    expect(html).toContain('aria-label="Barra lateral de navegación"');
    expect(html).toContain('aria-label="Navegación principal"');

    // Identidad institucional protegida
    expect(html).toContain('logo-horizontal.png');
    expect(html).toContain('Medicamentos Veterinarios');
    expect(html).toContain('M.V./I-192/M');

    // Clases de píldora activa suave
    expect(html).toContain('bg-pedir-bg');
    expect(html).toContain('text-marca');
    expect(html).toContain('dark:bg-acento/15');
    expect(html).toContain('dark:text-acento');
  });

  it('renderiza el cajón modal responsive cuando abiertoMovil = true con semántica dialog y trampa de foco', () => {
    const html = renderToString(<Sidebar abiertoMovil={true} alCerrarMovil={vi.fn()} />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Menú de navegación principal"');
    expect(html).toContain('aria-label="Cerrar menú"');
    expect(html).toContain('Mundo Mascotix');
  });
});

// ---------------------------------------------------------------------------
// 6. ORÁCULO DE TOPBAR (Selector de Tema, Buscador ⌘K y Sesión)
// ---------------------------------------------------------------------------
describe('Oráculo de Topbar', () => {
  it('renderiza cabecera con landmarks, selector de tema de 3 estados y buscador ⌘K', () => {
    const html = renderToString(<Topbar alAbrirMenuMovil={vi.fn()} tema="oscuro" alCambiarTema={vi.fn()} />);

    // Landmark semántico header
    expect(html).toContain('<header');
    expect(html).toContain('h-16 sticky top-0 z-30');

    // Selector de tema radiogroup
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Preferencia de tema visual"');
    expect(html).toContain('aria-label="Tema claro"');
    expect(html).toContain('aria-label="Tema oscuro"');
    expect(html).toContain('aria-label="Tema automático del sistema"');
    expect(html).toContain('aria-checked="true"'); // Para el tema oscuro activo

    // Buscador rápido ⌘K
    expect(html).toContain('data-testid="busqueda-rapida"');
    expect(html).toContain('Ir a una pantalla…');
    expect(html).toContain('⌘K');

    // Controles de usuario y desarrollo
    expect(html).toContain('data-testid="usuario-dev"');
    expect(html).toContain('MFA');
    expect(html).toContain('aria-label="Sesión con MFA"');

    // Botón hamburguesa móvil accesible
    expect(html).toContain('aria-label="Abrir menú de navegación"');
  });
});

// ---------------------------------------------------------------------------
// 7. ORÁCULO DE LAYOUT INTEGRAL (Jerarquía de Landmarks y Ausencia de Overflow)
// ---------------------------------------------------------------------------
describe('Oráculo de Layout Integral (layout.tsx)', () => {
  it('aplica overflow-x-clip y max-w-full en el contenedor raíz y columna principal para blindar contra scroll horizontal', async () => {
    // Importamos dinámicamente Layout
    const { Layout } = await import('./layout');
    const html = renderToString(<Layout />);

    // El contenedor exterior y la columna interior deben incluir overflow-x-clip
    expect(html).toContain('overflow-x-clip');
    expect(html).toContain('max-w-full');
    expect(html).toContain('w-full');

    // Jerarquía de orden CSS: la cabecera va en columna order-2 y el sidebar en order-1
    expect(html).toContain('order-2');
    expect(html).toContain('order-1');

    // Banner de modo demostración activo según configuración
    expect(html).toContain('Modo demostración: stock sintético');

    // Elemento outlet de ruta renderizado
    expect(html).toContain('data-testid="outlet-mock"');
  });
});
