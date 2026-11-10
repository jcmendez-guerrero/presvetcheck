import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import './estilos.css';
import { ProveedorAuth } from './lib/auth';
import { Layout } from './componentes/layout';
import { Inicio } from './paginas/inicio';
import { NuevaReceta } from './paginas/nueva-receta';
import { AltaManual } from './paginas/alta-manual';
import { Revision } from './paginas/revision';
import { Registro } from './paginas/registro';
import { Resultado } from './paginas/resultado';
import { Dispensacion } from './paginas/dispensacion';
import { Sustitucion } from './paginas/sustitucion';
import { Venta } from './paginas/venta';
import { RecepcionDetalle, Recepciones } from './paginas/recepciones';
import { PaginaPendientes } from './paginas/pendientes';
import { Registros } from './paginas/registros';
import { Admin } from './paginas/admin';
import { PaginaMovil } from './paginas/movil';
import { Ayuda } from './paginas/ayuda';
import { AsistenteHistorico } from './paginas/asistente-historico';
import { Vademecum } from './paginas/vademecum';

const raiz = createRootRoute({ component: Layout });
const r0 = createRoute({ getParentRoute: () => raiz, path: '/', component: Inicio });
const r1 = createRoute({ getParentRoute: () => raiz, path: '/recetas/nueva', component: NuevaReceta });
const rAltaManual = createRoute({
  getParentRoute: () => raiz,
  path: '/recetas/manual/nueva',
  component: AltaManual,
});
const r2 = createRoute({
  getParentRoute: () => raiz,
  path: '/recetas/$id/revision',
  component: Revision,
  staticData: { anchoCompleto: true },
});
const rRegistro = createRoute({
  getParentRoute: () => raiz,
  path: '/recetas/$id/registro',
  component: Registro,
  staticData: { anchoCompleto: true },
});
const r3 = createRoute({
  getParentRoute: () => raiz,
  path: '/recetas/$id/resultado',
  component: Resultado,
  staticData: { anchoCompleto: true },
});
const r4 = createRoute({
  getParentRoute: () => raiz,
  path: '/sustituciones/$id',
  component: Sustitucion,
  staticData: { anchoCompleto: true },
});
const r5 = createRoute({ getParentRoute: () => raiz, path: '/recepciones', component: Recepciones });
// Documento al lado de los datos: ocupa todo el ancho de la ventana para poder leerlo.
const r6 = createRoute({
  getParentRoute: () => raiz,
  path: '/recepciones/$id',
  component: RecepcionDetalle,
  staticData: { anchoCompleto: true },
});
const r7 = createRoute({ getParentRoute: () => raiz, path: '/pendientes', component: PaginaPendientes });
const r8 = createRoute({ getParentRoute: () => raiz, path: '/registros', component: Registros });
const r9 = createRoute({ getParentRoute: () => raiz, path: '/admin', component: Admin });
const rAyuda = createRoute({ getParentRoute: () => raiz, path: '/ayuda', component: Ayuda });
const rAsistente = createRoute({
  getParentRoute: () => raiz,
  path: '/asistente/historico',
  component: AsistenteHistorico,
});
const rDisp = createRoute({
  getParentRoute: () => raiz,
  path: '/recetas/$id/dispensar/$linea',
  component: Dispensacion,
  staticData: { anchoCompleto: true },
  validateSearch: (
    s: Record<string, unknown>,
  ): { pendientes?: string; forzado?: string; sustitucion?: string } => ({
    ...(typeof s.pendientes === 'string' ? { pendientes: s.pendientes } : {}),
    ...(s.forzado ? { forzado: String(s.forzado) } : {}),
    ...(typeof s.sustitucion === 'string' ? { sustitucion: s.sustitucion } : {}),
  }),
});
const rVenta = createRoute({
  getParentRoute: () => raiz,
  path: '/venta',
  component: Venta,
  validateSearch: (s: Record<string, unknown>) => ({
    canal: s.canal === 'online' ? ('online' as const) : ('presencial' as const),
  }),
});
const rVademecum = createRoute({
  getParentRoute: () => raiz,
  path: '/vademecum',
  component: Vademecum,
});
const rutas = [
  r0,
  r1,
  rAltaManual,
  r2,
  rRegistro,
  r3,
  r4,
  r5,
  r6,
  r7,
  r8,
  r9,
  rDisp,
  rVenta,
  rAyuda,
  rAsistente,
  rVademecum,
];
const router = createRouter({ routeTree: raiz.addChildren(rutas) });
declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** La página usa todo el ancho de la ventana (no el máximo de lectura). */
    anchoCompleto?: boolean;
  }
  interface Register {
    router: typeof router;
  }
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });
// El móvil emparejado (QR del PC) no inicia sesión: página propia, sin router ni autenticación.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname.startsWith('/movil') ? (
      <PaginaMovil />
    ) : (
      <QueryClientProvider client={qc}>
        <ProveedorAuth>
          <RouterProvider router={router} />
        </ProveedorAuth>
      </QueryClientProvider>
    )}
  </StrictMode>,
);
