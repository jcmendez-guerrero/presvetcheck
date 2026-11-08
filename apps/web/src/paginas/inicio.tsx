import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, Globe, PackageOpen, ShoppingBag } from 'lucide-react';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Pagina } from '../componentes/layout';
import { Mensaje } from '../componentes/ui';

interface Contadores {
  sustitucionesPendientes: number;
  recetasNoConformes: number;
  discrepanciasAbiertas: number;
  outboxIncidencias: number;
  pedidosRecibidosPendientesEntrega: number;
  registrosPendientes: number;
}

export function Inicio() {
  const { usuario, tiene } = useAuth();
  const q = useQuery({
    queryKey: ['inicio', usuario?.id],
    queryFn: () => get<Contadores>('/api/inicio'),
    enabled: !!usuario,
  });
  const opera = tiene('empleado', 'veterinaria_responsable');

  const B =
    'group flex min-h-36 flex-col items-center justify-center gap-3 rounded-2xl bg-white p-6 text-center text-xl font-bold text-marca ring-1 ring-slate-200 shadow-xs hover:ring-2 hover:ring-marca hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 dark:bg-superficie dark:ring-superficie-borde dark:text-acento dark:hover:ring-acento cursor-pointer';

  return (
    <Pagina titulo={`Hola${usuario ? `, ${usuario.nombre}` : ''}`}>
      {q.data && q.data.pedidosRecibidosPendientesEntrega > 0 && (
        <Mensaje tipo="info">
          Hay medicamentos pendientes de entrega para recetas retenidas (
          {q.data.pedidosRecibidosPendientesEntrega}).
        </Mensaje>
      )}
      {q.data && q.data.registrosPendientes > 0 && (
        <Mensaje tipo="aviso">
          Hay {q.data.registrosPendientes}{' '}
          {q.data.registrosPendientes === 1 ? 'receta dispensada' : 'recetas dispensadas'} con los datos del
          registro por completar.{' '}
          <Link to="/pendientes" className="font-semibold underline hover:no-underline">
            Completar registro
          </Link>
        </Mensaje>
      )}

      {opera && (
        <div>
          <h2 className="sr-only">Acciones rápidas de mostrador</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link to="/recetas/nueva" className={B} data-testid="boton-receta">
              <FileText
                aria-hidden
                className="h-10 w-10 text-marca group-hover:scale-110 transition-transform duration-200 dark:text-acento"
              />
              <span>Receta</span>
            </Link>
            <Link to="/venta" search={{ canal: 'presencial' }} className={B}>
              <ShoppingBag
                aria-hidden
                className="h-10 w-10 text-marca group-hover:scale-110 transition-transform duration-200 dark:text-acento"
              />
              <span>Venta sin receta</span>
            </Link>
            <Link to="/venta" search={{ canal: 'online' }} className={B}>
              <Globe
                aria-hidden
                className="h-10 w-10 text-marca group-hover:scale-110 transition-transform duration-200 dark:text-acento"
              />
              <span>Pedido online</span>
            </Link>
            <Link to="/recepciones" className={B}>
              <PackageOpen
                aria-hidden
                className="h-10 w-10 text-marca group-hover:scale-110 transition-transform duration-200 dark:text-acento"
              />
              <span>Recepción de mercancía</span>
            </Link>
          </div>
        </div>
      )}

      {q.data && (
        <div className="mt-2">
          <h2 className="mb-3 text-lg font-bold text-marca dark:text-acento">Estado operativo</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Contador n={q.data.sustitucionesPendientes} t="Sustituciones pendientes" enlace="/pendientes" />
            <Contador n={q.data.discrepanciasAbiertas} t="Discrepancias con el TPV" enlace="/pendientes" />
            <Contador n={q.data.recetasNoConformes} t="Recetas no conformes" enlace="/pendientes" />
            <Contador n={q.data.outboxIncidencias} t="Incidencias de sincronización" enlace="/pendientes" />
          </div>
        </div>
      )}
    </Pagina>
  );
}

function Contador({ n, t, enlace }: { n: number; t: string; enlace?: string }) {
  const contenido = (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/80 shadow-xs hover:shadow-sm transition-all duration-150 dark:bg-superficie dark:ring-superficie-borde">
      <p className="text-3xl font-extrabold text-marca dark:text-acento tracking-tight">{n}</p>
      <p className="mt-1 text-sm font-medium text-texto dark:text-slate-200">{t}</p>
      <span role="status" aria-atomic="true" className="sr-only">
        {n} {t}
      </span>
    </div>
  );

  return enlace ? (
    <Link to={enlace} className="block transition-transform hover:-translate-y-0.5">
      {contenido}
    </Link>
  ) : (
    contenido
  );
}
