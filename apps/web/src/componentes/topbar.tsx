import { useEffect, useState } from 'react';
import { Laptop, LogOut, Menu, Moon, Search, ShieldCheck, Sun } from 'lucide-react';
import { USUARIOS_DEV, useAuth } from '../lib/auth';
import { useMovil } from '../lib/movil';
import { BotonMovil } from './movil-pc';
import { ComandoBuscar } from './comando-buscar';

export type ModoTema = 'claro' | 'oscuro' | 'sistema';

interface PropsTopbar {
  alAbrirMenuMovil: () => void;
  tema: ModoTema;
  alCambiarTema: (tema: ModoTema) => void;
}

export function Topbar({ alAbrirMenuMovil, tema, alCambiarTema }: PropsTopbar) {
  const { config, usuario, cambiarUsuarioDev, mfaDev, cambiarMfaDev, tiene, cerrarSesion } = useAuth();
  const movil = useMovil();
  const [comandoAbierto, setComandoAbierto] = useState(false);

  // Atajo de teclado global: ⌘K / Ctrl+K para abrir paleta de comandos
  useEffect(() => {
    const manejarTecladoGlobal = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setComandoAbierto((prev) => !prev);
      }
    };
    window.addEventListener('keydown', manejarTecladoGlobal);
    return () => window.removeEventListener('keydown', manejarTecladoGlobal);
  }, []);

  const salir = async () => {
    await movil?.cerrar().catch(() => {});
    cerrarSesion();
  };

  return (
    <>
      <header className="h-16 sticky top-0 z-30 flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-6 bg-white/95 dark:bg-superficie/95 backdrop-blur-md border-b border-slate-200/90 dark:border-white/10 shrink-0">
        {/* Zona Izquierda: Botón hamburguesa en móvil/tablet (< 1024px) o contexto en escritorio */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            className="inline-flex lg:hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-texto hover:bg-slate-100 dark:border-superficie-borde dark:text-acento cursor-pointer"
            aria-label="Abrir menú de navegación"
            onClick={alAbrirMenuMovil}
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Contexto normativo en escritorio (>= 1024px) */}
          <div className="hidden lg:flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-400">
            <span>Farmacia Veterinaria</span>
            <span className="text-slate-300 dark:text-white/20">/</span>
            <span className="text-marca dark:text-acento font-bold">Mundo Mascotix</span>
          </div>

          {/* Identidad móvil compacta (< 1024px) */}
          <div className="flex lg:hidden items-center gap-2">
            <img src="/favicon.png" alt="Mascotix" className="h-6 w-6" />
            <span className="font-titulo text-sm font-bold text-marca dark:text-acento hidden xs:inline">
              Mascotix
            </span>
          </div>
        </div>

        {/* Zona Central: Buscador rápido / Paleta de comandos ⌘K */}
        <div className="hidden md:flex flex-1 justify-center max-w-[180px] lg:max-w-xs mx-1 sm:mx-2">
          <button
            type="button"
            data-testid="busqueda-rapida"
            onClick={() => setComandoAbierto(true)}
            aria-label="Buscar o saltar a pantalla (⌘K)"
            className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50/80 hover:bg-slate-100 hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 text-xs font-medium text-slate-500 dark:text-slate-400 transition-all cursor-pointer shadow-2xs"
          >
            <span className="flex items-center gap-2 truncate">
              <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-400" aria-hidden="true" />
              <span className="truncate">Ir a una pantalla…</span>
            </span>
            <kbd className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 shadow-2xs dark:border-white/10 dark:bg-superficie dark:text-slate-400 shrink-0">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Zona Derecha: Selector de tema, Móvil, Usuario/Sesión y Salir */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 ml-auto">
          {/* Selector de tema de 3 posiciones */}
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
              onClick={() => alCambiarTema('claro')}
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
              onClick={() => alCambiarTema('oscuro')}
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
              onClick={() => alCambiarTema('sistema')}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all cursor-pointer ${
                tema === 'sistema'
                  ? 'bg-white text-marca shadow-xs dark:bg-superficie dark:text-acento'
                  : 'text-slate-500 hover:text-texto dark:text-slate-400'
              }`}
            >
              <Laptop className="h-4 w-4" />
            </button>
          </div>

          {/* Botón de emparejamiento con móvil */}
          {usuario && tiene('empleado', 'veterinaria_responsable') && (
            <div className="hidden sm:flex items-center">
              <BotonMovil />
            </div>
          )}

          {/* Selector de desarrollo / Perfil de usuario */}
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
            usuario && (
              <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-100/70 dark:bg-white/5 border border-slate-200/60 dark:border-white/10">
                <span className="text-xs font-semibold text-texto dark:text-slate-200">{usuario.nombre}</span>
                {usuario.roles && usuario.roles.length > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
                    {usuario.roles.join(', ')}
                  </span>
                )}
              </div>
            )
          )}

          {/* Indicador de MFA */}
          {usuario?.mfa && (
            <ShieldCheck aria-label="Sesión con MFA" className="h-5 w-5 text-dorado shrink-0" />
          )}

          {/* Botón de cierre de sesión (modo Entra) */}
          {usuario && config?.authMode === 'entra' && (
            <button
              type="button"
              onClick={() => void salir()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-texto hover:bg-slate-100 dark:hover:bg-superficie-borde/40 cursor-pointer transition-colors"
              title="Cerrar la sesión en este equipo"
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              <span className="hidden xl:inline">Cerrar sesión</span>
            </button>
          )}
        </div>
      </header>

      {/* Diálogo modal de búsqueda accesible */}
      <ComandoBuscar abierto={comandoAbierto} alCerrar={() => setComandoAbierto(false)} />
    </>
  );
}
