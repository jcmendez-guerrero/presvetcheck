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
  outboxIncidencias: number;
  pedidosRecibidosPendientesEntrega: number;
}

export function Inicio() {
  const { usuario, tiene } = useAuth();
  const q = useQuery({ queryKey: ['inicio', usuario?.id], queryFn: () => get<Contadores>('/api/inicio'), enabled: !!usuario });
  const opera = tiene('empleado', 'veterinaria_responsable', 'farmaceutico_garante');
  const B = 'flex min-h-36 flex-col items-center justify-center gap-3 rounded-2xl bg-white p-6 text-center text-xl font-bold text-marca shadow-sm ring-2 ring-marca/20 hover:ring-marca';
  return (
    <Pagina titulo={`Hola${usuario ? `, ${usuario.nombre}` : ''}`}>
      {q.data && q.data.pedidosRecibidosPendientesEntrega > 0 && <Mensaje tipo="info">Hay medicamentos pendientes de entrega para recetas retenidas ({q.data.pedidosRecibidosPendientesEntrega}).</Mensaje>}
      {opera && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link to="/recetas/nueva" className={B} data-testid="boton-receta">
            <FileText aria-hidden className="h-10 w-10" /> Receta
          </Link>
          <Link to="/venta" search={{ canal: 'presencial' }} className={B}>
            <ShoppingBag aria-hidden className="h-10 w-10" /> Venta sin receta
          </Link>
          <Link to="/venta" search={{ canal: 'online' }} className={B}>
            <Globe aria-hidden className="h-10 w-10" /> Pedido online
          </Link>
          <Link to="/recepciones" className={B}>
            <PackageOpen aria-hidden className="h-10 w-10" /> Recepción de mercancía
          </Link>
        </div>
      )}
      {q.data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Contador n={q.data.sustitucionesPendientes} t="Sustituciones pendientes de firma" />
          <Contador n={q.data.recetasNoConformes} t="Recetas no conformes" />
          <Contador n={q.data.outboxIncidencias} t="Incidencias de sincronización" />
        </div>
      )}
    </Pagina>
  );
}

function Contador({ n, t }: { n: number; t: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <p className="text-3xl font-bold text-marca">{n}</p>
      <p>{t}</p>
    </div>
  );
}
