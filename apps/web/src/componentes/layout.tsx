import type { ReactNode } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import { USUARIOS_DEV, useAuth } from '../lib/auth';
import { ProveedorMovil } from '../lib/movil';
import { AvisosMovil, BotonMovil } from './movil-pc';

const NAV = [
  { a: '/', t: 'Inicio', roles: null },
  { a: '/recepciones', t: 'Recepciones', roles: ['empleado', 'veterinaria_responsable'] },
  { a: '/pendientes', t: 'Pendientes', roles: ['empleado', 'veterinaria_responsable'] },
  { a: '/registros', t: 'Registros', roles: ['empleado', 'veterinaria_responsable', 'admin'] },
  { a: '/admin', t: 'Administración', roles: ['admin'] },
] as const;

export function Layout() {
  const { config, usuario, cambiarUsuarioDev, mfaDev, cambiarMfaDev, tiene } = useAuth();
  return (
    <ProveedorMovil>
      <div className="min-h-screen">
        <header className="bg-marca text-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
            <Link to="/" className="font-titulo text-xl font-bold">
              Mundo Mascotix <span className="font-normal text-acento">· Medicamentos Veterinarios</span>
            </Link>
            <nav className="flex flex-wrap gap-1" aria-label="Principal">
              {NAV.filter((n) => !n.roles || tiene(...n.roles)).map((n) => (
                <Link
                  key={n.a}
                  to={n.a}
                  className="rounded-lg px-3 py-2 hover:bg-marca-2 [&.active]:bg-marca-2"
                  activeOptions={{ exact: n.a === '/' }}
                >
                  {n.t}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2 text-sm">
              {usuario && tiene('empleado', 'veterinaria_responsable') && <BotonMovil />}
              {config?.authMode === 'dev' ? (
                <>
                  <label className="sr-only" htmlFor="usuario-dev">
                    Usuario de prueba
                  </label>
                  <select
                    id="usuario-dev"
                    data-testid="usuario-dev"
                    className="rounded-lg bg-white px-2 text-texto"
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
                    className="flex items-center gap-1"
                    title="Simula la autenticación multifactor (solo desarrollo)"
                  >
                    <input
                      type="checkbox"
                      checked={mfaDev}
                      onChange={(e) => cambiarMfaDev(e.target.checked)}
                    />{' '}
                    MFA
                  </label>
                </>
              ) : (
                <span>{usuario?.nombre}</span>
              )}
              {usuario?.mfa && <ShieldCheck aria-label="Sesión con MFA" className="h-5 w-5 text-dorado" />}
            </div>
          </div>
          {config?.stock === 'demo' && (
            <p className="bg-dorado px-4 py-1 text-center text-sm font-semibold text-texto">
              Modo demostración: stock sintético, sin conexión con Siweb360 ·{' '}
              {config.extractor === 'fake'
                ? 'lectura de recetas SIMULADA (EXTRACTOR=fake)'
                : 'lectura de recetas real (Document Intelligence)'}
            </p>
          )}
          <AvisosMovil />
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">
          {/* Nada pide datos hasta tener sesión (cabeceras de autenticación configuradas). */}
          {usuario ? (
            <Outlet />
          ) : (
            <p className="animate-pulse text-slate-600">
              {config ? 'Iniciando sesión…' : 'Conectando con el servidor…'}
            </p>
          )}
        </main>
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
        <h1 className="text-3xl font-bold">{titulo}</h1>
        {acciones}
      </div>
      {children}
    </div>
  );
}
