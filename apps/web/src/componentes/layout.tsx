import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Laptop, LogOut, Menu, Moon, ShieldCheck, Sun, X } from 'lucide-react';
import { useFocusTrap } from '../lib/a11y';
import { USUARIOS_DEV, useAuth } from '../lib/auth';
import { ProveedorMovil, useMovil } from '../lib/movil';
import { AvisosMovil, BotonMovil } from './movil-pc';
import { ProveedorAsistente } from './asistente';

const NAV = [
  { a: '/', t: 'Inicio', roles: null },
  { a: '/recepciones', t: 'Recepciones', roles: ['empleado', 'veterinaria_responsable'] },
  { a: '/pendientes', t: 'Pendientes', roles: ['empleado', 'veterinaria_responsable'] },
  { a: '/vademecum', t: 'Vademécum', roles: ['empleado', 'veterinaria_responsable', 'admin'] },
  { a: '/registros', t: 'Registros', roles: ['empleado', 'veterinaria_responsable', 'admin'] },
  { a: '/admin', t: 'Administración', roles: ['admin'] },
  { a: '/ayuda', t: 'Ayuda', roles: null },
] as const;

export type ModoTema = 'claro' | 'oscuro' | 'sistema';

export function Layout() {
  const { config, usuario, cambiarUsuarioDev, mfaDev, cambiarMfaDev, tiene } = useAuth();
  const anchoCompleto = useRouterState({
    select: (s) => s.matches.some((m) => m.staticData?.anchoCompleto),
  });

  const [tema, setTema] = useState<ModoTema>(() => {
    return (localStorage.getItem('mmx-tema-ui') as ModoTema) || 'sistema';
  });

  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const menuMovilRef = useRef<HTMLDivElement>(null);
  useFocusTrap(menuMovilRef, menuMovilAbierto, () => setMenuMovilAbierto(false));

  // Aplicar tema en <html> según selección y preferencias del sistema
  useEffect(() => {
    const aplicarTema = () => {
      const raiz = document.documentElement;
      const prefiereOscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const esOscuro = tema === 'oscuro' || (tema === 'sistema' && prefiereOscuro);

      if (esOscuro) {
        raiz.classList.add('dark');
      } else {
        raiz.classList.remove('dark');
      }
      localStorage.setItem('mmx-tema-ui', tema);
    };

    aplicarTema();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const cambioSistema = () => {
      if (tema === 'sistema') aplicarTema();
    };

    mediaQuery.addEventListener('change', cambioSistema);
    return () => mediaQuery.removeEventListener('change', cambioSistema);
  }, [tema]);

  return (
    <ProveedorMovil>
      <div className="min-h-screen bg-fondo text-texto dark:bg-fondo dark:text-texto transition-colors duration-150">
        <header className="sticky top-0 z-40 border-b border-acento/30 bg-white/95 backdrop-blur-md dark:bg-superficie/95 dark:border-superficie-borde shadow-xs">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
            {/* Logotipo con margen normativo */}
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="flex items-center gap-3 logo-clearspace -ml-2 rounded-xl focus-visible:ring-2 focus-visible:ring-dorado"
                aria-label="Mundo Mascotix · Inicio"
              >
                <img
                  src="/logo-horizontal.png"
                  alt="Mundo Mascotix"
                  className="h-9 w-auto sm:h-11 object-contain dark:brightness-110"
                />
                <span className="hidden font-titulo text-lg font-bold text-marca-apoyo dark:text-acento sm:inline">
                  Medicamentos Veterinarios
                </span>
              </Link>
            </div>

            {/* Navegación principal en escritorio */}
            <nav className="hidden lg:flex items-center gap-1" aria-label="Principal">
              {NAV.filter((n) => !n.roles || tiene(...n.roles)).map((n) => (
                <Link
                  key={n.a}
                  to={n.a}
                  className="rounded-xl px-3.5 py-2 font-medium text-sm text-texto transition-all hover:bg-pedir-bg hover:text-marca dark:text-slate-200 dark:hover:bg-pedir-bg/20 dark:hover:text-acento [&.active]:bg-pedir-bg [&.active]:text-marca [&.active]:font-bold dark:[&.active]:bg-acento/15 dark:[&.active]:text-acento"
                  activeOptions={{ exact: n.a === '/' }}
                >
                  {n.t}
                </Link>
              ))}
            </nav>

            {/* Controles de usuario, tema y móvil */}
            <div className="flex items-center gap-2.5">
              {/* Selector de tema (Claro / Oscuro / Sistema) */}
              <div
                className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:bg-black/30 dark:border-superficie-borde"
                role="radiogroup"
                aria-label="Preferencia de tema visual"
              >
                <button
                  type="button"
                  title="Modo claro"
                  aria-label="Tema claro"
                  aria-checked={tema === 'claro'}
                  role="radio"
                  onClick={() => setTema('claro')}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all cursor-pointer ${
                    tema === 'claro'
                      ? 'bg-white text-marca shadow-xs dark:bg-superficie dark:text-acento'
                      : 'text-slate-500 hover:text-texto dark:text-slate-400'
                  }`}
                >
                  <Sun className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Modo oscuro"
                  aria-label="Tema oscuro"
                  aria-checked={tema === 'oscuro'}
                  role="radio"
                  onClick={() => setTema('oscuro')}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all cursor-pointer ${
                    tema === 'oscuro'
                      ? 'bg-white text-marca shadow-xs dark:bg-superficie dark:text-acento'
                      : 'text-slate-500 hover:text-texto dark:text-slate-400'
                  }`}
                >
                  <Moon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Tema del sistema"
                  aria-label="Tema automático del sistema"
                  aria-checked={tema === 'sistema'}
                  role="radio"
                  onClick={() => setTema('sistema')}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all cursor-pointer ${
                    tema === 'sistema'
                      ? 'bg-white text-marca shadow-xs dark:bg-superficie dark:text-acento'
                      : 'text-slate-500 hover:text-texto dark:text-slate-400'
                  }`}
                >
                  <Laptop className="h-4 w-4" />
                </button>
              </div>

              {usuario && tiene('empleado', 'veterinaria_responsable') && <BotonMovil />}

              {/* Selector de desarrollo */}
              {config?.authMode === 'dev' ? (
                <div className="hidden sm:flex items-center gap-2">
                  <label className="sr-only" htmlFor="usuario-dev">
                    Usuario de prueba
                  </label>
                  <select
                    id="usuario-dev"
                    data-testid="usuario-dev"
                    className="h-9 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-semibold text-texto dark:bg-superficie dark:border-superficie-borde dark:text-texto cursor-pointer"
                    value={usuario?.id ?? ''}
                    onChange={(e) => cambiarUsuarioDev(e.target.value)}
                  >
                    {USUARIOS_DEV.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.etiqueta}
                      </option>
                    ))}
                  </select>
                  <label
                    className="flex items-center gap-1 text-xs font-medium cursor-pointer"
                    title="Simula la autenticación multifactor (solo desarrollo)"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={mfaDev}
                      onChange={(e) => cambiarMfaDev(e.target.checked)}
                    />{' '}
                    MFA
                  </label>
                </div>
              ) : (
                <span className="hidden sm:inline text-xs font-semibold">{usuario?.nombre}</span>
              )}

              {usuario?.mfa && (
                <ShieldCheck aria-label="Sesión con MFA" className="h-5 w-5 text-dorado shrink-0" />
              )}

              {usuario && config?.authMode === 'entra' && <BotonSalir />}

              {/* Botón hamburguesa para móviles/tabletas */}
              <button
                type="button"
                className="inline-flex lg:hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-texto hover:bg-slate-100 dark:border-superficie-borde dark:text-acento cursor-pointer"
                aria-label="Abrir menú de navegación"
                onClick={() => setMenuMovilAbierto(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Banner de modo demostración */}
          {config?.stock === 'demo' && (
            <p className="bg-dorado/90 px-4 py-1 text-center text-xs font-bold text-texto">
              Modo demostración: stock sintético, sin conexión con Siweb360 ·{' '}
              {config.extractor === 'fake'
                ? 'lectura de recetas SIMULADA (EXTRACTOR=fake)'
                : 'lectura de recetas real (Document Intelligence)'}
            </p>
          )}

          <AvisosMovil />
        </header>

        {/* Menú lateral desplegable para móvil */}
        {menuMovilAbierto && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs lg:hidden"
          >
            <div
              ref={menuMovilRef}
              className="flex h-full w-4/5 max-w-sm flex-col bg-white p-6 shadow-xl dark:bg-superficie dark:text-texto"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-superficie-borde">
                <div className="flex items-center gap-2">
                  <img src="/favicon.png" alt="Mascotix" className="h-7 w-7" />
                  <span className="font-titulo text-base font-bold text-marca dark:text-acento">
                    Mundo Mascotix
                  </span>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10 cursor-pointer"
                  onClick={() => setMenuMovilAbierto(false)}
                  aria-label="Cerrar menú"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <nav className="mt-4 flex flex-col gap-1.5" aria-label="Navegación móvil">
                {NAV.filter((n) => !n.roles || tiene(...n.roles)).map((n) => (
                  <Link
                    key={n.a}
                    to={n.a}
                    onClick={() => setMenuMovilAbierto(false)}
                    className="min-h-11 flex items-center rounded-xl px-4 text-base font-semibold text-texto hover:bg-pedir-bg hover:text-marca dark:text-slate-200 dark:hover:bg-pedir-bg/20 dark:hover:text-acento [&.active]:bg-pedir-bg [&.active]:text-marca dark:[&.active]:bg-acento/20 dark:[&.active]:text-acento"
                    activeOptions={{ exact: n.a === '/' }}
                  >
                    {n.t}
                  </Link>
                ))}
              </nav>

              {config?.authMode === 'dev' && (
                <div className="mt-6 border-t border-slate-100 pt-4 dark:border-superficie-borde flex flex-col gap-2">
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

        <main className={`mx-auto px-4 py-6 ${anchoCompleto ? 'max-w-none xl:px-6' : 'max-w-6xl'}`}>
          {usuario ? (
            <ProveedorAsistente>
              <Outlet />
            </ProveedorAsistente>
          ) : (
            <p className="animate-pulse text-slate-600 dark:text-slate-300">
              {config ? 'Iniciando sesión…' : 'Conectando con el servidor…'}
            </p>
          )}
        </main>
      </div>
    </ProveedorMovil>
  );
}

function BotonSalir() {
  const movil = useMovil();
  const salir = async () => {
    await movil?.cerrar().catch(() => {});
    window.location.href = `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent('/')}`;
  };
  return (
    <button
      type="button"
      onClick={() => void salir()}
      className="inline-flex min-h-10 items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-semibold text-texto hover:bg-slate-100 dark:hover:bg-superficie-borde/40 cursor-pointer"
      title="Cerrar la sesión en este equipo"
    >
      <LogOut aria-hidden className="h-4 w-4" />
      <span className="hidden md:inline">Cerrar sesión</span>
    </button>
  );
}

export function Pagina({
  titulo,
  children,
  acciones,
}: {
  titulo: string;
  children: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold text-marca dark:text-acento tracking-tight">{titulo}</h1>
        {acciones}
      </div>
      {children}
    </div>
  );
}
