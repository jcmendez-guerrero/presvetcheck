import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useNavigate } from '@tanstack/react-router';
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
import { useAuth } from '../lib/auth';

export interface DestinoComando {
  id: string;
  titulo: string;
  seccion: string;
  descripcion?: string;
  ruta: string;
  busqueda?: Record<string, string>;
  icono: ComponentType<{ className?: string }>;
  roles?: string[];
}

export const DESTINOS_COMANDO: DestinoComando[] = [
  {
    id: 'inicio',
    titulo: 'Inicio',
    seccion: 'Dispensación / Recetas',
    descripcion: 'Panel principal de mostrador y estado operativo',
    ruta: '/',
    icono: Home,
  },
  {
    id: 'nueva-receta',
    titulo: 'Nueva Receta',
    seccion: 'Dispensación / Recetas',
    descripcion: 'Carga de receta veterinaria para extracción y validación',
    ruta: '/recetas/nueva',
    icono: FileText,
    roles: ['empleado', 'veterinaria_responsable'],
  },
  {
    id: 'venta-mostrador',
    titulo: 'Venta Mostrador',
    seccion: 'Dispensación / Recetas',
    descripcion: 'Dispensación directa de medicamentos sin receta (OTC)',
    ruta: '/venta',
    busqueda: { canal: 'presencial' },
    icono: ShoppingBag,
    roles: ['empleado', 'veterinaria_responsable'],
  },
  {
    id: 'pedido-online',
    titulo: 'Pedido Online',
    seccion: 'Dispensación / Recetas',
    descripcion: 'Validación de pedidos web de medicamentos sin receta',
    ruta: '/venta',
    busqueda: { canal: 'online' },
    icono: Globe,
    roles: ['empleado', 'veterinaria_responsable'],
  },
  {
    id: 'recepciones',
    titulo: 'Recepciones',
    seccion: 'Operaciones / Recepción y Stock',
    descripcion: 'Albaranes de entrada de distribuidor y cotejo CIMAVet',
    ruta: '/recepciones',
    icono: Package,
    roles: ['empleado', 'veterinaria_responsable'],
  },
  {
    id: 'pendientes',
    titulo: 'Pendientes',
    seccion: 'Operaciones / Recepción y Stock',
    descripcion: 'Cola unificada de sustituciones, discrepancias y outbox',
    ruta: '/pendientes',
    icono: Clock,
    roles: ['empleado', 'veterinaria_responsable'],
  },
  {
    id: 'registros',
    titulo: 'Libros y Registros',
    seccion: 'Registros y Consultas',
    descripcion: 'Libro oficial de entradas y salidas (RD 1157/2021)',
    ruta: '/registros',
    icono: BookOpen,
    roles: ['empleado', 'veterinaria_responsable', 'admin'],
  },
  {
    id: 'vademecum',
    titulo: 'Vademécum',
    seccion: 'Registros y Consultas',
    descripcion: 'Catálogo de medicamentos veterinarios AEMPS / CIMAVet',
    ruta: '/vademecum',
    icono: Search,
    roles: ['empleado', 'veterinaria_responsable', 'admin'],
  },
  {
    id: 'asistente-historico',
    titulo: 'Histórico Asistente',
    seccion: 'Registros y Consultas',
    descripcion: 'Auditoría de consultas y respuestas del asistente IA',
    ruta: '/asistente/historico',
    icono: MessageSquare,
    roles: ['empleado', 'veterinaria_responsable', 'admin'],
  },
  {
    id: 'admin',
    titulo: 'Administración',
    seccion: 'Sistema / Administración',
    descripcion: 'Configuración de reglas, lectores, almacén e integraciones',
    ruta: '/admin',
    icono: Settings,
    roles: ['admin'],
  },
  {
    id: 'ayuda',
    titulo: 'Ayuda',
    seccion: 'Sistema / Administración',
    descripcion: 'Guía operativa, glosario normativo y atajos de teclado',
    ruta: '/ayuda',
    icono: HelpCircle,
  },
];

interface Props {
  abierto: boolean;
  alCerrar: () => void;
}

export function ComandoBuscar({ abierto, alCerrar }: Props) {
  const { tiene } = useAuth();
  const navigate = useNavigate();
  const [consulta, setConsulta] = useState('');
  const [indiceActivo, setIndiceActivo] = useState(0);
  const dialogoRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useFocusTrap(dialogoRef, abierto, alCerrar);

  // Filtrar destinos accesibles para el usuario según sus roles
  const destinosAutorizados = useMemo(() => {
    return DESTINOS_COMANDO.filter((d) => !d.roles || tiene(...d.roles));
  }, [tiene]);

  // Filtrar por término de búsqueda
  const destinosFiltrados = useMemo(() => {
    const q = consulta.trim().toLowerCase();
    if (!q) return destinosAutorizados;
    return destinosAutorizados.filter(
      (d) =>
        d.titulo.toLowerCase().includes(q) ||
        d.seccion.toLowerCase().includes(q) ||
        (d.descripcion && d.descripcion.toLowerCase().includes(q)),
    );
  }, [destinosAutorizados, consulta]);

  // Resetear índice y foco al abrir
  useEffect(() => {
    if (abierto) {
      setConsulta('');
      setIndiceActivo(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(timer);
    }
  }, [abierto]);

  // Manejar selección de destino
  const ejecutarDestino = (destino: DestinoComando) => {
    alCerrar();
    if (destino.busqueda) {
      void navigate({ to: destino.ruta, search: destino.busqueda });
    } else {
      void navigate({ to: destino.ruta });
    }
  };

  // Manejar teclas de navegación en la lista
  const manejarTeclado = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndiceActivo((prev) => (prev + 1) % Math.max(destinosFiltrados.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndiceActivo(
        (prev) => (prev - 1 + destinosFiltrados.length) % Math.max(destinosFiltrados.length, 1),
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const seleccionado = destinosFiltrados[indiceActivo];
      if (seleccionado) {
        ejecutarDestino(seleccionado);
      }
    }
  };

  if (!abierto) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ir a una pantalla"
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 sm:pt-24 bg-black/60 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) alCerrar();
      }}
    >
      <div
        ref={dialogoRef}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-superficie-borde dark:bg-superficie dark:text-texto flex flex-col"
      >
        {/* Cabecera del buscador */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3.5 dark:border-superficie-borde">
          <Search className="h-5 w-5 text-slate-400 dark:text-slate-400 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              setIndiceActivo(0);
            }}
            onKeyDown={manejarTeclado}
            placeholder="Ir a una pantalla o buscar comando… (ej. Recetas, Stock, Libros)"
            className="flex-1 bg-transparent text-sm sm:text-base font-medium outline-hidden placeholder:text-slate-400 dark:placeholder:text-slate-400"
            aria-label="Buscar pantalla"
          />
          <button
            type="button"
            onClick={alCerrar}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-texto dark:hover:bg-white/10 cursor-pointer"
            aria-label="Cerrar diálogo de búsqueda"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Lista de resultados */}
        <div className="max-h-[60vh] overflow-y-auto p-2" role="listbox" aria-label="Pantallas encontradas">
          {destinosFiltrados.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No se han encontrado pantallas que coincidan con «{consulta}».
            </div>
          ) : (
            destinosFiltrados.map((d, idx) => {
              const Icono = d.icono;
              const activo = idx === indiceActivo;
              return (
                <div
                  key={d.id}
                  role="option"
                  aria-selected={activo}
                  onClick={() => ejecutarDestino(d)}
                  onMouseEnter={() => setIndiceActivo(idx)}
                  className={`flex items-center gap-3.5 rounded-xl px-3.5 py-3 transition-colors cursor-pointer text-left ${
                    activo
                      ? 'bg-pedir-bg text-marca dark:bg-acento/15 dark:text-acento'
                      : 'text-texto hover:bg-slate-100/70 dark:text-slate-200 dark:hover:bg-white/5'
                  }`}
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      activo
                        ? 'bg-marca/10 text-marca dark:bg-acento/20 dark:text-acento'
                        : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'
                    }`}
                  >
                    <Icono className="h-5 w-5" />
                  </div>
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate">{d.titulo}</span>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-400 shrink-0">
                        {d.seccion}
                      </span>
                    </div>
                    {d.descripcion && (
                      <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {d.descripcion}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pie con atajos informativos */}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400 dark:border-superficie-borde dark:text-slate-400 bg-slate-50/50 dark:bg-black/10">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-2xs dark:border-white/10 dark:bg-superficie">
                ↑
              </kbd>{' '}
              <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-2xs dark:border-white/10 dark:bg-superficie">
                ↓
              </kbd>{' '}
              Navegar
            </span>
            <span>
              <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-2xs dark:border-white/10 dark:bg-superficie">
                ↵
              </kbd>{' '}
              Seleccionar
            </span>
          </div>
          <span>
            <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-2xs dark:border-white/10 dark:bg-superficie">
              esc
            </kbd>{' '}
            Cerrar
          </span>
        </div>
      </div>
    </div>
  );
}
