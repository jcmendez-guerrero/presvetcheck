import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  FileText,
  Globe,
  PackageCheck,
  PackageOpen,
  ShoppingBag,
  Stethoscope,
} from 'lucide-react';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Pagina } from '../componentes/layout';

interface Contadores {
  sustitucionesPendientes: number;
  recetasNoConformes: number;
  discrepanciasAbiertas: number;
  outboxIncidencias: number;
  pedidosRecibidosPendientesEntrega: number;
  registrosPendientes: number;
}

function obtenerEtiquetaRol(roles?: string[]): string {
  if (!roles || roles.length === 0) return 'Personal de Farmacia';
  if (roles.includes('veterinaria_responsable')) return 'Veterinaria Responsable';
  if (roles.includes('empleado')) return 'Personal de Farmacia';
  if (roles.includes('admin')) return 'Administración';
  return 'Personal de Farmacia';
}

function obtenerFechaMadrid(): string {
  try {
    const formatter = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const formateada = formatter.format(new Date());
    return formateada.charAt(0).toUpperCase() + formateada.slice(1);
  } catch {
    return 'Hoy en Madrid';
  }
}

export function Inicio() {
  const { usuario, tiene } = useAuth();
  const q = useQuery({
    queryKey: ['inicio', usuario?.id],
    queryFn: () => get<Contadores>('/api/inicio'),
    enabled: !!usuario,
  });

  const opera = tiene('empleado', 'veterinaria_responsable');
  const fechaMadrid = obtenerFechaMadrid();
  const etiquetaRol = obtenerEtiquetaRol(usuario?.roles);

  return (
    <Pagina
      titulo={`Hola${usuario ? `, ${usuario.nombre}` : ''}`}
      acciones={
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {usuario && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-3 py-1 text-xs font-semibold text-texto dark:border-white/10 dark:bg-superficie dark:text-slate-200 shadow-xs">
              <span className="h-2 w-2 rounded-full bg-marca dark:bg-acento" aria-hidden />
              {etiquetaRol}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dispensar/20 bg-dispensar-bg px-3 py-1 text-xs font-semibold text-dispensar dark:border-dispensar/30 dark:bg-dispensar-bg">
            <span className="h-2 w-2 rounded-full bg-dispensar animate-pulse" aria-hidden />
            Mostrador activo
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-texto-muted dark:text-slate-300">
            <Calendar className="h-3.5 w-3.5 text-marca dark:text-acento shrink-0" aria-hidden />
            <time dateTime={new Date().toISOString().slice(0, 10)}>{fechaMadrid}</time>
          </span>
        </div>
      }
    >
      {/* ── Banners de Alerta Prioritaria (Feature 11) ── */}
      {q.data && q.data.pedidosRecibidosPendientesEntrega > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-pedir/20 bg-pedir-bg p-4 text-sm text-pedir dark:border-pedir/30 dark:bg-pedir-bg dark:text-acento shadow-xs"
        >
          <div className="flex items-center gap-3">
            <PackageCheck className="h-5 w-5 shrink-0 text-pedir dark:text-acento" aria-hidden />
            <div>
              <p className="font-bold">Medicamentos pendientes de entrega</p>
              <p className="text-xs opacity-90">
                {`Hay ${q.data.pedidosRecibidosPendientesEntrega} ${
                  q.data.pedidosRecibidosPendientesEntrega === 1
                    ? 'medicamento recibido pendiente de entrega para recetas retenidas.'
                    : 'medicamentos recibidos pendientes de entrega para recetas retenidas.'
                }`}
              </p>
            </div>
          </div>
          <Link
            to="/pendientes"
            className="inline-flex items-center gap-1.5 rounded-xl bg-marca px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-marca-hover dark:bg-marca dark:text-mmx-noche dark:hover:bg-marca-hover transition-colors shadow-xs"
          >
            <span>Gestionar entregas</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      )}

      {q.data && q.data.registrosPendientes > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sustituir/30 bg-sustituir-bg p-4 text-sm text-sustituir dark:border-sustituir/40 dark:bg-sustituir-bg dark:text-sustituir shadow-xs"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-sustituir" aria-hidden />
            <div>
              <p className="font-bold">Registros oficiales pendientes (RD 1157/2021)</p>
              <p className="text-xs opacity-90">
                {`Hay ${q.data.registrosPendientes} ${
                  q.data.registrosPendientes === 1 ? 'receta dispensada' : 'recetas dispensadas'
                } con los datos del registro por completar.`}
              </p>
            </div>
          </div>
          <Link
            to="/pendientes"
            className="inline-flex items-center gap-1.5 rounded-xl bg-sustituir px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-95 transition-opacity shadow-xs"
          >
            <span>Completar registro</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      )}

      {q.data && q.data.pedidosRecibidosPendientesEntrega === 0 && q.data.registrosPendientes === 0 && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-slate-200/90 bg-white px-4 py-2.5 text-xs font-medium text-texto-muted dark:border-white/10 dark:bg-superficie dark:text-slate-300 shadow-2xs"
        >
          <CheckCircle2 className="h-4 w-4 text-dispensar shrink-0" aria-hidden />
          <span>Sin alertas prioritarias de mostrador · Todos los registros y entregas al día</span>
        </div>
      )}

      {/* ── 4 Tarjetas Operativas Hero de Mostrador (Feature 12) ── */}
      {opera && (
        <section aria-labelledby="acciones-mostrador-titulo">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="acciones-mostrador-titulo" className="text-lg font-bold text-marca dark:text-acento">
              Operaciones de mostrador
            </h2>
            <span className="text-xs text-texto-muted dark:text-slate-400">Accesos rápidos del puesto</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Tarjeta 1: Receta (data-testid obligatorio: "boton-receta") */}
            <Link
              to="/recetas/nueva"
              data-testid="boton-receta"
              className="group relative flex flex-col justify-between rounded-2xl bg-white p-5 border border-slate-200/90 shadow-xs hover:border-marca/40 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 dark:bg-superficie dark:border-white/10 dark:border-t-white/15 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.45)] dark:hover:border-acento/50 text-marca font-bold dark:text-acento cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dorado"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-marca/10 text-marca group-hover:scale-110 group-hover:bg-marca group-hover:text-white transition-all duration-200 dark:bg-acento/15 dark:text-acento dark:group-hover:bg-acento dark:group-hover:text-mmx-noche">
                  <FileText className="h-6 w-6" aria-hidden />
                </div>
                <span className="text-xs font-semibold text-texto-muted dark:text-slate-400 group-hover:text-marca dark:group-hover:text-acento flex items-center gap-1 transition-colors">
                  Iniciar{' '}
                  <ArrowRight
                    className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform"
                    aria-hidden
                  />
                </span>
              </div>
              <div className="mt-4">
                <h3 className="text-lg font-bold text-marca dark:text-acento">Receta</h3>
                <p className="mt-1 text-xs font-medium text-texto-muted dark:text-slate-300 leading-relaxed">
                  Dispensación con receta oficial
                </p>
              </div>
            </Link>

            {/* Tarjeta 2: Venta sin receta */}
            <Link
              to="/venta"
              search={{ canal: 'presencial' }}
              className="group relative flex flex-col justify-between rounded-2xl bg-white p-5 border border-slate-200/90 shadow-xs hover:border-marca/40 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 dark:bg-superficie dark:border-white/10 dark:border-t-white/15 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.45)] dark:hover:border-acento/50 text-marca font-bold dark:text-acento cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dorado"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-marca/10 text-marca group-hover:scale-110 group-hover:bg-marca group-hover:text-white transition-all duration-200 dark:bg-acento/15 dark:text-acento dark:group-hover:bg-acento dark:group-hover:text-mmx-noche">
                  <ShoppingBag className="h-6 w-6" aria-hidden />
                </div>
                <span className="text-xs font-semibold text-texto-muted dark:text-slate-400 group-hover:text-marca dark:group-hover:text-acento flex items-center gap-1 transition-colors">
                  Venta{' '}
                  <ArrowRight
                    className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform"
                    aria-hidden
                  />
                </span>
              </div>
              <div className="mt-4">
                <h3 className="text-lg font-bold text-marca dark:text-acento">Venta sin receta</h3>
                <p className="mt-1 text-xs font-medium text-texto-muted dark:text-slate-300 leading-relaxed">
                  Mostrador presencial y zoosanitarios
                </p>
              </div>
            </Link>

            {/* Tarjeta 3: Pedido online */}
            <Link
              to="/venta"
              search={{ canal: 'online' }}
              className="group relative flex flex-col justify-between rounded-2xl bg-white p-5 border border-slate-200/90 shadow-xs hover:border-marca/40 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 dark:bg-superficie dark:border-white/10 dark:border-t-white/15 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.45)] dark:hover:border-acento/50 text-marca font-bold dark:text-acento cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dorado"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-marca/10 text-marca group-hover:scale-110 group-hover:bg-marca group-hover:text-white transition-all duration-200 dark:bg-acento/15 dark:text-acento dark:group-hover:bg-acento dark:group-hover:text-mmx-noche">
                  <Globe className="h-6 w-6" aria-hidden />
                </div>
                <span className="text-xs font-semibold text-texto-muted dark:text-slate-400 group-hover:text-marca dark:group-hover:text-acento flex items-center gap-1 transition-colors">
                  Entrega{' '}
                  <ArrowRight
                    className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform"
                    aria-hidden
                  />
                </span>
              </div>
              <div className="mt-4">
                <h3 className="text-lg font-bold text-marca dark:text-acento">Pedido online</h3>
                <p className="mt-1 text-xs font-medium text-texto-muted dark:text-slate-300 leading-relaxed">
                  Entrega de pedidos web y click &amp; collect
                </p>
              </div>
            </Link>

            {/* Tarjeta 4: Recepción */}
            <Link
              to="/recepciones"
              className="group relative flex flex-col justify-between rounded-2xl bg-white p-5 border border-slate-200/90 shadow-xs hover:border-marca/40 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 dark:bg-superficie dark:border-white/10 dark:border-t-white/15 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.45)] dark:hover:border-acento/50 text-marca font-bold dark:text-acento cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dorado"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-marca/10 text-marca group-hover:scale-110 group-hover:bg-marca group-hover:text-white transition-all duration-200 dark:bg-acento/15 dark:text-acento dark:group-hover:bg-acento dark:group-hover:text-mmx-noche">
                  <PackageOpen className="h-6 w-6" aria-hidden />
                </div>
                <span className="text-xs font-semibold text-texto-muted dark:text-slate-400 group-hover:text-marca dark:group-hover:text-acento flex items-center gap-1 transition-colors">
                  Albaranes{' '}
                  <ArrowRight
                    className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform"
                    aria-hidden
                  />
                </span>
              </div>
              <div className="mt-4">
                <h3 className="text-lg font-bold text-marca dark:text-acento">Recepción</h3>
                <p className="mt-1 text-xs font-medium text-texto-muted dark:text-slate-300 leading-relaxed">
                  Entrada de albaranes y verificación FEFO
                </p>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* ── 4 Tarjetas de Métricas Operativas (Feature 13 - SPEC §2.1) ── */}
      {q.data && (
        <section aria-labelledby="estado-operativo-titulo" className="mt-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="estado-operativo-titulo" className="text-lg font-bold text-marca dark:text-acento">
              Estado operativo
            </h2>
            <span className="text-xs text-texto-muted dark:text-slate-400">Monitoreo en tiempo real</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TarjetaMetrica
              n={q.data.sustitucionesPendientes}
              titulo="Sustituciones pendientes"
              subtitulo="Aprobación veterinaria diferida"
              enlace="/pendientes"
            />
            <TarjetaMetrica
              n={q.data.discrepanciasAbiertas}
              titulo="Discrepancias con el TPV"
              subtitulo="Tickets sin receta asociada"
              enlace="/pendientes"
            />
            <TarjetaMetrica
              n={q.data.recetasNoConformes}
              titulo="Recetas no conformes"
              subtitulo="Defectos formales o bloqueantes"
              enlace="/pendientes"
            />
            <TarjetaMetrica
              n={q.data.outboxIncidencias}
              titulo="Incidencias de sincronización"
              subtitulo="Movimientos pendientes Siweb360"
              enlace="/pendientes"
            />
          </div>
        </section>
      )}

      {/* ── Paneles de Productividad y Normativa (Feature 14) ── */}
      <section aria-labelledby="paneles-productividad-titulo" className="mt-2">
        <h2 id="paneles-productividad-titulo" className="sr-only">
          Herramientas normativas y de consulta
        </h2>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Panel 1: Libro Oficial de Registro (RD 1157/2021) */}
          <div className="flex flex-col justify-between rounded-2xl bg-white p-5 border border-slate-200/90 shadow-xs dark:bg-superficie dark:border-white/10 dark:border-t-white/15 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.45)]">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-marca/10 text-marca dark:bg-acento/15 dark:text-acento shrink-0">
                    <BookOpen className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-marca dark:text-acento">
                      Libro Oficial de Registro
                    </h3>
                    <p className="text-xs text-texto-muted dark:text-slate-400">
                      Trazabilidad legal de tratamientos veterinarios
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center rounded-md bg-marca/10 px-2.5 py-1 text-xs font-semibold text-marca dark:bg-acento/20 dark:text-acento border border-marca/20 dark:border-acento/30 shrink-0">
                  RD 1157/2021
                </span>
              </div>

              <div className="mt-4 space-y-2 text-xs text-texto dark:text-slate-200 leading-relaxed">
                <p className="flex items-start gap-2">
                  <span
                    className="mt-1 h-1.5 w-1.5 rounded-full bg-marca dark:bg-acento shrink-0"
                    aria-hidden
                  />
                  <span>
                    <strong>Custodia legal 5 años:</strong> Conservación obligatoria de recetas y apuntes
                    registrales para inspección oficial.
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <span
                    className="mt-1 h-1.5 w-1.5 rounded-full bg-marca dark:bg-acento shrink-0"
                    aria-hidden
                  />
                  <span>
                    <strong>Inalterabilidad de apuntes:</strong> Secuencia cronológica estricta con
                    contraasientos contables para cualquier corrección.
                  </span>
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-white/5">
              <span className="text-xs text-texto-muted dark:text-slate-400">
                Exportación mensual y trimestral
              </span>
              <Link
                to="/registros"
                className="inline-flex items-center gap-1.5 rounded-xl bg-marca px-3.5 py-2 text-xs font-semibold text-white hover:bg-marca-hover dark:bg-marca dark:text-mmx-noche dark:hover:bg-marca-hover transition-colors shadow-xs"
              >
                <span>Consultar Libro Oficial</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>

          {/* Panel 2: Vademécum CIMAVet & Consultas Rápidas */}
          <div className="flex flex-col justify-between rounded-2xl bg-white p-5 border border-slate-200/90 shadow-xs dark:bg-superficie dark:border-white/10 dark:border-t-white/15 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.45)]">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-marca/10 text-marca dark:bg-acento/15 dark:text-acento shrink-0">
                    <Stethoscope className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-marca dark:text-acento">
                      Vademécum Oficial CIMAVet
                    </h3>
                    <p className="text-xs text-texto-muted dark:text-slate-400">
                      Base oficial de la Agencia Española de Medicamentos (AEMPS)
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center rounded-md bg-marca/10 px-2.5 py-1 text-xs font-semibold text-marca dark:bg-acento/20 dark:text-acento border border-marca/20 dark:border-acento/30 shrink-0">
                  AEMPS
                </span>
              </div>

              <div className="mt-4 space-y-2 text-xs text-texto dark:text-slate-200 leading-relaxed">
                <p className="flex items-start gap-2">
                  <span
                    className="mt-1 h-1.5 w-1.5 rounded-full bg-marca dark:bg-acento shrink-0"
                    aria-hidden
                  />
                  <span>
                    <strong>Condiciones de dispensación:</strong> Verificación de psicótropos, estupefacientes
                    y medicamentos de prescripción obligatoria.
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <span
                    className="mt-1 h-1.5 w-1.5 rounded-full bg-marca dark:bg-acento shrink-0"
                    aria-hidden
                  />
                  <span>
                    <strong>Vacío terapéutico:</strong> Cascada prescriptiva y prescripción excepcional (Art.
                    112-114 Reglamento UE 2019/6).
                  </span>
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-white/5">
              <span className="text-xs text-texto-muted dark:text-slate-400">
                Fichas técnicas y prospectos oficiales
              </span>
              <Link
                to="/vademecum"
                className="inline-flex items-center gap-1.5 rounded-xl bg-marca px-3.5 py-2 text-xs font-semibold text-white hover:bg-marca-hover dark:bg-marca dark:text-mmx-noche dark:hover:bg-marca-hover transition-colors shadow-xs"
              >
                <span>Abrir Vademécum</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Pagina>
  );
}

interface TarjetaMetricaProps {
  n: number;
  titulo: string;
  subtitulo: string;
  enlace: string;
}

function TarjetaMetrica({ n, titulo, subtitulo, enlace }: TarjetaMetricaProps) {
  const alDia = n === 0;

  return (
    <Link
      to={enlace}
      className="group relative flex flex-col justify-between rounded-2xl bg-white p-5 border border-slate-200/90 shadow-xs hover:shadow-md hover:border-marca/30 hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 dark:bg-superficie dark:border-white/10 dark:border-t-white/15 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.45)] dark:hover:border-acento/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dorado"
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="text-3xl font-extrabold tracking-tight text-marca dark:text-acento">{n}</p>
          {alDia ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-dispensar-bg px-2.5 py-1 text-xs font-semibold text-dispensar border border-dispensar/20 dark:bg-dispensar-bg dark:border-dispensar/30 shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Al día</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-pedir-bg px-2.5 py-1 text-xs font-semibold text-pedir border border-pedir/20 dark:bg-pedir-bg dark:border-pedir/30 dark:text-acento shrink-0">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-pedir dark:text-acento" aria-hidden />
              <span>
                {n} {n === 1 ? 'pendiente' : 'pendientes'}
              </span>
            </span>
          )}
        </div>

        <h3 className="mt-2 text-sm font-bold text-texto dark:text-slate-100">{titulo}</h3>
        <p className="mt-0.5 text-xs text-texto-muted dark:text-slate-400">{subtitulo}</p>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-2.5 dark:border-white/5">
        <span className="text-[11px] font-medium text-texto-muted dark:text-slate-400">
          Bandeja de pendientes
        </span>
        <span className="text-xs font-semibold text-marca dark:text-acento flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
          Revisar <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>

      <span role="status" aria-atomic="true" className="sr-only">
        {n} {titulo}: {alDia ? 'Al día' : `${n} pendientes`}
      </span>
    </Link>
  );
}
