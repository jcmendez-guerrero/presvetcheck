import { useEffect, useState, type ReactNode } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { useAuth } from '../lib/auth';
import { ProveedorMovil } from '../lib/movil';
import { AvisosMovil } from './movil-pc';
import { ProveedorAsistente } from './asistente';
import { Sidebar } from './sidebar';
import { Topbar, type ModoTema } from './topbar';

export type { ModoTema };

export function Layout() {
  const { config, usuario } = useAuth();
  const anchoCompleto = useRouterState({
    select: (s) => s.matches.some((m) => m.staticData?.anchoCompleto),
  });

  const [tema, setTema] = useState<ModoTema>(() => {
    return (localStorage.getItem('mmx-tema-ui') as ModoTema) || 'sistema';
  });

  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);

  // Aplicar tema en <html> según selección y preferencias del sistema
  useEffect(() => {
    const aplicarTema = () => {
      const raiz = document.documentElement;
      const prefiereOscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const esOscuro = tema === 'oscuro' || (tema === 'sistema' && prefiereOscuro);

      if (esOscuro) {
        raiz.classList.add('dark');
        raiz.style.colorScheme = 'dark';
      } else {
        raiz.classList.remove('dark');
        raiz.style.colorScheme = 'light';
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
      <div className="min-h-screen flex bg-fondo text-texto dark:bg-fondo dark:text-texto transition-colors duration-150 w-full max-w-full overflow-x-clip">
        {/* Columna principal de contenido con Topbar primero en el DOM */}
        <div className="flex flex-1 flex-col min-w-0 order-2 w-full max-w-full overflow-x-clip">
          <Topbar alAbrirMenuMovil={() => setMenuMovilAbierto(true)} tema={tema} alCambiarTema={setTema} />

          {/* Banner de modo demostración */}
          {config?.stock === 'demo' && (
            <p className="bg-dorado/90 px-4 py-1 text-center text-xs font-bold text-texto shrink-0">
              Modo demostración: stock sintético, sin conexión con Siweb360 ·{' '}
              {config.extractor === 'fake'
                ? 'lectura de recetas SIMULADA (EXTRACTOR=fake)'
                : 'lectura de recetas real (Document Intelligence)'}
            </p>
          )}

          <AvisosMovil />

          <main
            className={`flex-1 px-4 py-6 ${anchoCompleto ? 'w-full max-w-none xl:px-6' : 'mx-auto w-full max-w-6xl'}`}
          >
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

        {/* Barra lateral por 4 secciones + drawer móvil (posicionada a la izquierda en pantalla con order-1) */}
        <Sidebar abiertoMovil={menuMovilAbierto} alCerrarMovil={() => setMenuMovilAbierto(false)} />
      </div>
    </ProveedorMovil>
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
