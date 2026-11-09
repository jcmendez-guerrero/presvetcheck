# Data Model & Component Interfaces: Modernización de la Interfaz de Usuario (UI/UX)

**Feature Branch**: `007-modernizacion-frontend-ui` | **Date**: 2026-11-08  
**Spec Reference**: [spec.md](./spec.md)

---

## 1. Tokens de Diseño y Variables CSS

### 1.1 Estructura de Tokens Institucionales

```typescript
export interface TokensMarcaMundoMascotix {
  // Paleta oficial de 5 colores (Manual de Identidad Visual)
  colores: {
    marcaPrincipal: '#016581';     // Azul petróleo (cruz, títulos, botones clave)
    marcaApoyo: '#2F8198';         // Azul medio (subtítulos, enlaces, iconos)
    marcaAcento: '#60ABB8';        // Turquesa (huella, detalles, bordes activos)
    marcaTexto: '#002028';         // Azul noche (texto corrido de alto contraste)
    marcaFondo: '#F2F8F9';         // Blanco hielo (fondo general y tarjetas)
  };
  // Colores semánticos de estado (SPEC §2.1)
  semanticos: {
    dispensar: { texto: '#047857'; fondo: '#D1FAE5' };
    sustituir: { texto: '#B45309'; fondo: '#FEF3C7' };
    noConforme: { texto: '#B91C1C'; fondo: '#FEE2E2' };
    pedir: { texto: '#016581'; fondo: '#E0F2F7' };
    psicotropo: { texto: '#6B21A8'; fondo: '#F3E8FF' };
    revisionFoco: { acento: '#E3A857'; fondo: '#FEF9C3' };
  };
  // Tipografías normativas
  tipografia: {
    titulos: 'Bricolage Grotesque Variable, sans-serif';
    cuerpo: 'Inter Variable, system-ui, sans-serif';
    mono: 'JetBrains Mono, ui-monospace, monospace';
  };
  // Métricas ergonómicas de mostrador
  ergonomia: {
    minTouchTargetPx: 44;
    minTouchGapPx: 8;
    bordeRadioTarjeta: '1rem'; // 16px
    bordeRadioBoton: '0.75rem'; // 12px
  };
}
```

---

## 2. Interfaces de Componentes UI Renovados

### 2.1 Botón (`Boton`)
```typescript
export type VarianteBoton = 
  | 'principal'     // Azul petróleo (#016581), texto blanco, hover azul medio
  | 'secundario'    // Blanco, borde y texto en azul petróleo, hover fondo pedir
  | 'contorno'      // Transparente, borde turquesa/azul medio, hover sutil
  | 'peligro'       // Blanco, borde y texto no conforme (#B91C1C), hover fondo rojo suave
  | 'texto';        // Sin borde, texto azul petróleo subrayado en hover

export type TamanoBoton = 'sm' | 'md' | 'lg';

export interface BotonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  cargando?: boolean;
  textoCarga?: string;
  icono?: React.ReactNode;
}
```

### 2.2 Tarjeta (`Tarjeta`)
```typescript
export interface TarjetaProps extends React.HTMLAttributes<HTMLElement> {
  titulo?: React.ReactNode;
  subtitulo?: React.ReactNode;
  acciones?: React.ReactNode;
  destacada?: boolean;      // Aplica borde acentuado en Azul medio / Turquesa
  varianteFondo?: 'blanco' | 'hielo';
  children: React.ReactNode;
}
```

### 2.3 Módulo HUD de Lote Recomendado (`HUDLoteRecomendado`)
```typescript
export interface HUDLoteRecomendadoProps {
  cn: string;
  nombreMedicamento: string;
  lote: string;
  caducidad: string | null;
  caducidadDiasRestantes?: number;
  unidadesDisponibles: number;
  ubicacionAlmacen?: string | null;
  esPsicotropo?: boolean;
  onCopiarLote?: (lote: string) => void;
}
```

### 2.4 Recordatorio TPV con Microinteracción (`RecordatorioTpv`)
```typescript
export interface ItemTpv {
  cn: string;
  lote: string;
  unidades: number;
}

export interface RecordatorioTpvProps {
  items: ItemTpv[];
  onLoteCopiado?: (lote: string) => void;
}

export interface EstadoCopiaLote {
  [lote: string]: boolean; // True durante 2 segundos tras la copia exitosa
}
```

### 2.5 Visor de Recetas Documental 2.0 (`VisorReceta`)
```typescript
export interface ImagenDocumentoReceta {
  pagina: number;
  url: string;
  mime: string;
}

export interface VisorRecetaProps {
  imagenes: ImagenDocumentoReceta[];
  ocrTexto?: string | null;
  dividido?: boolean;
  campoActivoId?: string | null;
  onCampoSeleccionado?: (campoId: string) => void;
}

export interface EstadoVisor {
  zoom: number;                 // Rango: 0.5x a 3.0x (default 1.0)
  rotacion: 0 | 90 | 180 | 270; // Rotación en grados
  paginaActiva: number;         // Índice base 0
  modoAjuste: 'ancho' | 'alto' | 'original';
}
```

### 2.6 Insignia y Tarjeta de Decisión Regulatoria (`EstadoDecision`, `TarjetaDefecto`)
```typescript
export type SeveridadDefecto = 'AVISO' | 'BLOQUEANTE_FORMA' | 'BLOQUEANTE_DURO';

export interface MotivoRegulatorio {
  code: string;
  severidad: SeveridadDefecto;
  params?: Record<string, string | number>;
  linea?: number;
}

export interface DetalleDefectoEstructurado {
  titulo: string;
  donde?: string;
  accion?: string;
  bloquea: boolean;
  esDuro: boolean; // Si es true, NUNCA puede forzarse (Principio III)
}
```
