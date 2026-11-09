import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ratioContraste } from '../estilos.test';
import { Boton, Campo, Cargando, Etiqueta, Info, Mensaje, Tarjeta } from './ui';

describe('Primitivas de UI (apps/web/src/componentes/ui.tsx)', () => {
  describe('Tarjeta', () => {
    it('renderiza estructura estándar con clases de elevación, bordes y temas claro/oscuro', () => {
      const html = renderToString(
        <Tarjeta titulo="Título de Prueba" subtitulo="Subtítulo informativo">
          <p>Contenido interno</p>
        </Tarjeta>,
      );

      // Elemento raíz semántico section
      expect(html).toContain('<section');
      expect(html).toContain('rounded-2xl');
      expect(html).toContain('bg-superficie');

      // Elevación modo claro: borde slate suave y sombra ligera
      expect(html).toContain('border-slate-200/90');
      expect(html).toContain('shadow-sm');

      // Elevación modo oscuro: borde sutil blanco, rim-light superior y sombra de profundidad
      expect(html).toContain('dark:border-white/10');
      expect(html).toContain('dark:border-t-white/15');
      expect(html).toContain('dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.45)]');

      // Encabezados y contraste
      expect(html).toContain('text-marca');
      expect(html).toContain('dark:text-acento');
      expect(html).toContain('text-texto-muted');
      expect(html).toContain('Título de Prueba');
      expect(html).toContain('Subtítulo informativo');
      expect(html).toContain('Contenido interno');
    });

    it('renderiza variante destacada con borde de acento y sombra pronunciada', () => {
      const html = renderToString(
        <Tarjeta destacada titulo="Tarjeta Destacada">
          <span>Contenido destacado</span>
        </Tarjeta>,
      );

      expect(html).toContain('border-2');
      expect(html).toContain('border-marca/40');
      expect(html).toContain('shadow-md');
      expect(html).toContain('dark:border-acento/50');
      expect(html).toContain('dark:border-t-acento/70');
      expect(html).toContain('dark:shadow-[0_8px_32px_-4px_rgba(96,171,184,0.25)]');
    });

    it('renderiza contenedor de acciones cuando se proporcionan', () => {
      const html = renderToString(
        <Tarjeta acciones={<button type="button">Acción</button>}>
          <div>Cuerpo</div>
        </Tarjeta>,
      );

      expect(html).toContain('mt-4 flex flex-wrap items-center gap-3');
      expect(html).toContain('Acción');
    });
  });

  describe('Boton', () => {
    it('variante principal: usa estilos de alto contraste en claro y oscuro', () => {
      const html = renderToString(<Boton variante="principal">Guardar</Boton>);

      // En claro: fondo marca con texto blanco
      expect(html).toContain('bg-marca');
      expect(html).toContain('text-white');
      expect(html).toContain('hover:bg-marca-hover');

      // En oscuro: píldora marca (turquesa) con texto azul noche oscuro (WCAG AA >= 4.5:1)
      expect(html).toContain('dark:bg-marca');
      expect(html).toContain('dark:text-mmx-noche');
      expect(html).toContain('dark:hover:bg-marca-hover');

      // No debe suprimir el outline accesible por defecto
      expect(html).not.toContain('outline-none');
      expect(html).not.toContain('focus:outline-none');
    });

    it('variantes secundario, contorno, peligro y texto aplican sus clases respectivas', () => {
      const secundario = renderToString(<Boton variante="secundario">Secundario</Boton>);
      expect(secundario).toContain('bg-white text-marca border-2 border-marca');
      expect(secundario).toContain('dark:bg-superficie dark:text-marca dark:border-marca');

      const contorno = renderToString(<Boton variante="contorno">Contorno</Boton>);
      expect(contorno).toContain('bg-transparent text-texto border border-borde');
      expect(contorno).toContain('dark:text-texto dark:border-borde');

      const peligro = renderToString(<Boton variante="peligro">Eliminar</Boton>);
      expect(peligro).toContain('text-noconforme border-2 border-noconforme');
      expect(peligro).toContain('dark:bg-superficie');

      const texto = renderToString(<Boton variante="texto">Cancelar</Boton>);
      expect(texto).toContain('text-marca underline hover:text-marca-hover');
    });

    it('tallas sm, md, lg respetan clases de dimensionamiento ergonómico', () => {
      const sm = renderToString(<Boton tamano="sm">Pequeño</Boton>);
      expect(sm).toContain('min-h-10 px-3 py-1.5 text-sm rounded-lg');

      const md = renderToString(<Boton tamano="md">Medio</Boton>);
      expect(md).toContain('min-h-11 px-5 py-2.5 text-base rounded-xl');

      const lg = renderToString(<Boton tamano="lg">Grande</Boton>);
      expect(lg).toContain('min-h-12 px-6 py-3 text-lg rounded-2xl');
    });

    it('estado cargando desactiva el botón y muestra spinner accesible', () => {
      const html = renderToString(<Boton cargando>Procesando</Boton>);

      expect(html).toContain('disabled=""');
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('animate-spin');
    });
  });

  describe('Info y Accesibilidad de Foco', () => {
    it('Info incluye anillo accesible focus-visible:ring-2 focus-visible:ring-dorado y rol tooltip', () => {
      const html = renderToString(<Info texto="Texto de aclaración legal" />);

      // Elemento interactivo para teclado
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('aria-label="Ayuda"');
      expect(html).toContain('focus-visible:ring-2');
      expect(html).toContain('focus-visible:ring-dorado');

      // Tooltip accesible
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('Texto de aclaración legal');
    });

    it('tooltip de Info mantiene alto contraste (>= 4.5:1) con fondo oscuro invariable en claro y oscuro', () => {
      const html = renderToString(<Info texto="Texto de aclaración legal" />);

      // Debe utilizar bg-mmx-noche con text-white para asegurar alto contraste (16.97:1) en ambos temas
      expect(html).toContain('bg-mmx-noche');
      expect(html).toContain('text-white');
      // No debe usar bg-texto que en modo oscuro cambiaría a #f2f8f9 causando colisión de contraste (1.07:1)
      expect(html).not.toContain('bg-texto');

      // Verificación matemática del ratio de contraste W3C WCAG 2.1
      const fondoTooltip = '#002028'; // --color-mmx-noche
      const textoTooltip = '#ffffff'; // text-white
      const contraste = ratioContraste(fondoTooltip, textoTooltip);
      expect(contraste).toBeGreaterThanOrEqual(4.5);
      expect(contraste).toBeGreaterThanOrEqual(7.0); // Cumple AAA (16.97:1)
    });
  });

  describe('Etiqueta', () => {
    it('renderiza texto base y soporte para ayuda', () => {
      const html = renderToString(<Etiqueta texto="Dosis prescrita" />);
      expect(html).toContain('font-medium text-texto');
      expect(html).toContain('Dosis prescrita');
    });

    it('renderiza badge "Revisar" con dorado accesible en ambos modos cuando dudoso=true', () => {
      const html = renderToString(<Etiqueta texto="Código Nacional" dudoso />);

      expect(html).toContain('Revisar');
      expect(html).toContain('bg-dorado-bg');
      expect(html).toContain('text-dorado');
      expect(html).toContain('ring-1 ring-dorado/30');
      expect(html).toContain('dark:bg-dorado-bg');
      expect(html).toContain('dark:text-dorado');
      expect(html).toContain('dark:ring-dorado/40');
    });
  });

  describe('Campo', () => {
    it('renderiza input con etiqueta y borde estándar', () => {
      const html = renderToString(<Campo etiqueta="Número de colegiado" placeholder="12345" />);

      expect(html).toContain('Número de colegiado');
      expect(html).toContain('border-borde');
      expect(html).toContain('bg-superficie');
      expect(html).toContain('placeholder="12345"');
    });

    it('renderiza estado de error accesible con aria-invalid y texto no conforme', () => {
      const html = renderToString(<Campo etiqueta="Firma" error="Firma no válida" />);

      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('border-noconforme');
      expect(html).toContain('bg-noconforme-bg');
      expect(html).toContain('Firma no válida');
    });

    it('renderiza estado dudoso con borde y fondo dorado', () => {
      const html = renderToString(<Campo etiqueta="Lote" dudoso />);

      expect(html).toContain('border-dorado');
      expect(html).toContain('bg-dorado-bg/50');
      expect(html).toContain('Revisar');
    });
  });

  describe('Mensaje y Cargando', () => {
    it('Mensaje aplica clases regulatorias y roles ARIA apropiados', () => {
      const error = renderToString(<Mensaje tipo="error">Error crítico</Mensaje>);
      expect(error).toContain('role="alert"');
      expect(error).toContain('bg-noconforme-bg');
      expect(error).toContain('text-noconforme');

      const aviso = renderToString(<Mensaje tipo="aviso">Aviso importante</Mensaje>);
      expect(aviso).toContain('role="status"');
      expect(aviso).toContain('bg-sustituir-bg');
      expect(aviso).toContain('text-sustituir');

      const ok = renderToString(<Mensaje tipo="ok">Completado</Mensaje>);
      expect(ok).toContain('role="status"');
      expect(ok).toContain('bg-dispensar-bg');
      expect(ok).toContain('text-dispensar');

      const info = renderToString(<Mensaje tipo="info">Nota informativa</Mensaje>);
      expect(info).toContain('role="status"');
      expect(info).toContain('bg-pedir-bg');
      expect(info).toContain('text-pedir');
    });

    it('Cargando muestra animación accesible y texto', () => {
      const html = renderToString(<Cargando texto="Verificando receta…" />);
      expect(html).toContain('role="status"');
      expect(html).toContain('animate-spin');
      expect(html).toContain('Verificando receta…');
    });
  });
});
