import { useEffect, useRef } from 'react';
import { useAuth } from '../lib/auth';
import type { EstadoSesion } from '../lib/sesion';
import { Boton, Cargando } from './ui';

/** Pantalla sin cabecera ni menú mientras no hay sesión activa (no se muestra nada de la aplicación). */
export function PaginaAcceso({ estado }: { estado: EstadoSesion }) {
  const { config, iniciarSesion, cerrarSesion } = useAuth();
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => caja.current?.querySelector('button')?.focus(), [estado]);

  let contenido;
  if (estado === 'sin-sesion' && config?.authMode === 'dev') {
    contenido = (
      <>
        <h1 className="text-2xl font-extrabold text-marca dark:text-acento">No se ha podido iniciar sesión</h1>
        <Boton onClick={() => location.reload()}>
          Reintentar
        </Boton>
      </>
    );
  } else if (estado === 'sin-sesion') {
    contenido = (
      <>
        <h1 className="text-2xl font-extrabold text-marca dark:text-acento">Tu sesión ha terminado</h1>
        <p>Vuelve a entrar con tu cuenta de trabajo de Microsoft.</p>
        <Boton onClick={iniciarSesion}>
          Iniciar sesión con Microsoft
        </Boton>
      </>
    );
  } else if (estado === 'sin-acceso') {
    contenido = (
      <>
        <h1 className="text-2xl font-extrabold text-marca dark:text-acento">Sin acceso</h1>
        <p>Tu cuenta no tiene acceso a esta aplicación. Pide a Administración que te asigne un rol.</p>
        <Boton onClick={cerrarSesion}>
          Cerrar sesión
        </Boton>
      </>
    );
  } else {
    contenido = (
      <>
        <h1 className="sr-only">Mundo Mascotix</h1>
        <Cargando texto={estado === 'conectando' ? 'Conectando con el servidor…' : 'Iniciando sesión…'} />
      </>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-fondo text-texto px-4">
      <div ref={caja} className="flex max-w-md flex-col items-center gap-5 text-center">
        <img src="/logo-horizontal.png" alt="Mundo Mascotix" className="h-12 w-auto" />
        {contenido}
      </div>
    </main>
  );
}
