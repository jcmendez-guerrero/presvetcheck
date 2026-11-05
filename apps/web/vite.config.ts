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
      includeAssets: ['favicon.png', 'logo-horizontal.png'],
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
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // Nunca se cachean respuestas de la API (datos regulatorios y personales).
        navigateFallbackDenylist: [/^\/api\//, /^\/\.auth\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  // WEB_HOST=1: accesible desde la red local (móvil emparejado por QR en `pnpm demo`).
  server: {
    port: 5173,
    host: process.env.WEB_HOST === '1' ? true : 'localhost',
    proxy: { '/api': API, '/.auth': API },
  },
  preview: { port: 4173, proxy: { '/api': API } },
  optimizeDeps: { exclude: ['zxing-wasm'] },
  test: { include: ['src/**/*.test.{ts,tsx}'] },
} as never);
