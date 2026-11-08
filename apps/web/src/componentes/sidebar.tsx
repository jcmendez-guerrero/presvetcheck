import { useRef, type ComponentType } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  BookOpen,
  Clock,
  FileText,
  Globe,
  HelpCircle,
  Home,
  MessageSquare,
  Package,
  Search,
  Settings,
  ShoppingBag,
  X,
} from 'lucide-react';
import { useFocusTrap } from '../lib/a11y';
import { USUARIOS_DEV, useAuth } from '../lib/auth';

export type ItemNavegacion =
  | {
      id: string;
      texto: string;
      a: '/venta';
      busqueda: { canal: 'presencial' | 'online' };
      icono: ComponentType<{ className?: string }>;
      roles?: string[];
      exacto?: boolean;
    }
  | {
      id: string;
      texto: string;
      a: string;
      busqueda?: never;
      icono: ComponentType<{ className?: string }>;
      roles?: string[];
      exacto?: boolean;
    };

export interface SeccionNavegacion {
  id: string;
  titulo: string;
  items: ItemNavegacion[];
}

export const SECCIONES_NAVEGACION: SeccionNavegacion[] = [
  {
    id: 'dispensacion',
    titulo: 'Dispensación / Recetas',
    items: [
      { id: 'inicio', texto: 'Inicio', a: '/', icono: Home, exacto: true },
      {
        id: 'nueva-receta',
        texto: 'Nueva Receta',
        a: '/recetas/nueva',
        icono: FileText,
        roles: ['empleado', 'veterinaria_responsable'],
      },
      {
        id: 'venta-mostrador',
        texto: 'Venta Mostrador',
        a: '/venta',
        busqueda: { canal: 'presencial' },
        icono: ShoppingBag,
        roles: ['empleado', 'veterinaria_responsable'],
      },
      {
        id: 'pedido-online',
        texto: 'Pedido Online',
        a: '/venta',
        busqueda: { canal: 'online' },
        icono: Globe,
        roles: ['empleado', 'veterinaria_responsable'],
      },
    ],
  },
  {
    id: 'operaciones',
    titulo: 'Operaciones / Recepción y Stock',
    items: [
      {
        id: 'recepciones',
        texto: 'Recepciones',
        a: '/recepciones',
        icono: Package,
        roles: ['empleado', 'veterinaria_responsable'],
      },
      {
        id: 'pendientes',
        texto: 'Pendientes',
        a: '/pendientes',
        icono: Clock,
        roles: ['empleado', 'veterinaria_responsable'],
      },
    ],
  },
  {
    id: 'registros',
    titulo: 'Registros y Consultas',
    items: [
      {
        id: 'registros',
        texto: 'Libros y Registros',
        a: '/registros',
        icono: BookOpen,
        roles: ['empleado', 'veterinaria_responsable', 'admin'],
      },
      {
        id: 'vademecum',
        texto: 'Vademécum',
        a: '/vademecum',
        icono: Search,
        roles: ['empleado', 'veterinaria_responsable', 'admin'],
      },
      {
        id: 'asistente-historico',
        texto: 'Histórico Asistente',
        a: '/asistente/historico',
        icono: MessageSquare,
        roles: ['empleado', 'veterinaria_responsable', 'admin'],
      },
    ],
  },
  {
    id: 'sistema',
    titulo: 'Sistema / Administración',
    items: [
      {
        id: 'admin',
        texto: 'Administración',
        a: '/admin',
        icono: Settings,
        roles: ['admin'],
      },
      {
        id: 'ayuda',
        texto: 'Ayuda',
        a: '/ayuda',
        icono: HelpCircle,
      },
    ],
  },
];

interface PropsSidebar {
  abiertoMovil: boolean;
  alCerrarMovil: () => void;
}

export function Sidebar({ abiertoMovil, alCerrarMovil }: PropsSidebar) {
  const { tiene, config, usuario, cambiarUsuarioDev } = useAuth();
  const navigate = useNavigate();
  const cajonRef = useRef<HTMLDivElement>(null);

  useFocusTrap(cajonRef, abiertoMovil, alCerrarMovil);

  return (
    <>
      {/* 1. Barra lateral fija en escritorio (>= 1024px) */}
      <aside
        className="hidden lg:flex order-1 w-64 xl:w-72 sticky top-0 h-screen flex-col bg-white dark:bg-superficie border-r border-slate-200/90 dark:border-white/10 shrink-0 z-20"
        aria-label="Barra lateral de navegación"
      >
        {/* Cabecera institucional con espacio normativo garantizado */}
        <div className="p-5 border-b border-slate-200/90 dark:border-white/10 flex flex-col gap-1.5 shrink-0">
          <div
            role="button"
            tabIndex={0}
            onClick={() => void navigate({ to: '/' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void navigate({ to: '/' });
              }
            }}
            className="logo-clearspace -m-2 cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-dorado outline-hidden transition-opacity hover:opacity-90"
            aria-label="Mundo Mascotix · Inicio"
          >
            <img
              src="/logo-horizontal.png"
              alt="Mundo Mascotix"
              className="h-9 xl:h-10 w-auto object-contain dark:brightness-110"
            />
          </div>
          <div className="px-1 pt-1">
            <p className="font-titulo text-sm xl:text-base font-bold text-marca-apoyo dark:text-acento tracking-tight">
              Medicamentos Veterinarios
            </p>
            <p className="text-[11px] font-semibold tracking-wider text-slate-400 dark:text-slate-400">
              M.V./I-192/M
            </p>
          </div>
        </div>

        {/* Navegación vertical categorizada por 4 secciones */}
        <nav className="flex-1 overflow-y-auto px-3.5 py-4 space-y-6" aria-label="Navegación principal">
          {SECCIONES_NAVEGACION.map((seccion) => {
            const itemsVisibles = seccion.items.filter((item) => !item.roles || tiene(...item.roles));
            if (itemsVisibles.length === 0) return null;

            return (
              <div key={seccion.id} className="space-y-1">
                <h2 className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
                  {seccion.titulo}
                </h2>
                <div className="space-y-0.5 pt-1">
                  {itemsVisibles.map((item) => {
                    const Icono = item.icono;
                    const propsComunes = {
                      activeOptions: { exact: item.exacto ?? false },
                      className:
                        'min-h-[44px] flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 hover:text-marca dark:hover:bg-white/5 dark:hover:text-acento transition-all cursor-pointer [&.active]:bg-pedir-bg [&.active]:text-marca [&.active]:font-bold [&.active]:shadow-xs dark:[&.active]:bg-acento/15 dark:[&.active]:text-acento',
                      activeProps: {
                        'aria-current': 'page' as const,
                        className:
                          'bg-pedir-bg text-marca font-bold shadow-xs dark:bg-acento/15 dark:text-acento active',
                      },
                    };
                    const contenido = (
                      <>
                        <Icono className="h-5 w-5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.texto}</span>
                      </>
                    );

                    return item.busqueda ? (
                      <Link key={item.id} to="/venta" search={item.busqueda} {...propsComunes}>
                        {contenido}
                      </Link>
                    ) : (
                      <Link key={item.id} to={item.a} {...propsComunes}>
                        {contenido}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* 2. Cajón modal responsive para dispositivos móviles y tabletas (< 1024px) */}
      {abiertoMovil && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menú de navegación principal"
          className="fixed inset-0 z-50 flex justify-start bg-black/60 backdrop-blur-xs lg:hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) alCerrarMovil();
          }}
        >
          <div
            ref={cajonRef}
            className="flex h-full w-4/5 max-w-sm flex-col bg-white p-5 shadow-2xl dark:bg-superficie dark:text-texto overflow-y-auto"
          >
            {/* Cabecera del drawer con botón de cierre accesible */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-superficie-borde shrink-0">
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  void navigate({ to: '/' });
                  alCerrarMovil();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void navigate({ to: '/' });
                    alCerrarMovil();
                  }
                }}
                className="flex items-center gap-2 cursor-pointer outline-hidden"
              >
                <img src="/favicon.png" alt="Mascotix" className="h-7 w-7" />
                <span className="font-titulo text-base font-bold text-marca dark:text-acento">
                  Mundo Mascotix
                </span>
              </div>
              <button
                type="button"
                className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10 cursor-pointer"
                onClick={alCerrarMovil}
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Navegación por secciones dentro del drawer móvil */}
            <nav className="mt-4 flex flex-col gap-5 flex-1" aria-label="Navegación móvil">
              {SECCIONES_NAVEGACION.map((seccion) => {
                const itemsVisibles = seccion.items.filter((item) => !item.roles || tiene(...item.roles));
                if (itemsVisibles.length === 0) return null;

                return (
                  <div key={seccion.id} className="space-y-1">
                    <h3 className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
                      {seccion.titulo}
                    </h3>
                    <div className="space-y-1 pt-1">
                      {itemsVisibles.map((item) => {
                        const Icono = item.icono;
                        const propsComunes = {
                          onClick: alCerrarMovil,
                          activeOptions: { exact: item.exacto ?? false },
                          className:
                            'min-h-[44px] flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-base font-semibold text-slate-700 dark:text-slate-200 hover:bg-pedir-bg hover:text-marca dark:hover:bg-pedir-bg/20 dark:hover:text-acento [&.active]:bg-pedir-bg [&.active]:text-marca dark:[&.active]:bg-acento/20 dark:[&.active]:text-acento',
                          activeProps: {
                            'aria-current': 'page' as const,
                            className: 'bg-pedir-bg text-marca dark:bg-acento/20 dark:text-acento active',
                          },
                        };
                        const contenido = (
                          <>
                            <Icono className="h-5 w-5 shrink-0" aria-hidden="true" />
                            <span>{item.texto}</span>
                          </>
                        );

                        return item.busqueda ? (
                          <Link key={item.id} to="/venta" search={item.busqueda} {...propsComunes}>
                            {contenido}
                          </Link>
                        ) : (
                          <Link key={item.id} to={item.a} {...propsComunes}>
                            {contenido}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>

            {/* Selector de desarrollo en móvil */}
            {config?.authMode === 'dev' && (
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-superficie-borde flex flex-col gap-2 shrink-0">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Usuario de prueba
                </span>
                <select
                  className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-texto dark:bg-superficie dark:border-superficie-borde"
                  value={usuario?.id ?? ''}
                  onChange={(e) => cambiarUsuarioDev(e.target.value)}
                >
                  {USUARIOS_DEV.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
