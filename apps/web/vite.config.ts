import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icono.svg'],
      manifest: {
        name: 'Mundo Mascotix · Medicamentos Veterinarios',
        short_name: 'MMX Recetas',
        description: 'Verificación de recetas veterinarias, dispensación y registro de entradas y salidas',
        lang: 'es-ES',
        theme_color: '#016581',
        background_color: '#F2F8F9',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [{ src: 'icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        // Nunca se cachean respuestas de la API (datos regulatorios y personales).
        navigateFallbackDenylist: [/^\/api\//, /^\/\.auth\//],
        globPatterns: ['**/*.{js,css,html,svg,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': API, '/.auth': API } },
  preview: { port: 4173, proxy: { '/api': API } },
  optimizeDeps: { exclude: ['zxing-wasm'] },
  test: { include: ['src/**/*.test.ts'] },
} as never);
