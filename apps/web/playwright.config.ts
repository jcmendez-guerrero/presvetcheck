import { defineConfig, devices } from '@playwright/test';

const NODE = process.execPath;

/** Test de humo de la UI (SPEC §12.1.8, AGENTS.md): API con EXTRACTOR=fake y PGlite, sin Docker. */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1024, height: 768 },
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
  ],
  webServer: [
    {
      command: `${NODE} ../../node_modules/tsx/dist/cli.mjs ../api/src/main.ts`,
      url: 'http://localhost:3101/api/ready',
      timeout: 120_000,
      reuseExistingServer: false,
      // Clave de cifrado de columnas solo de desarrollo (la misma de .env.example): sin ella la API no arranca en la CI,
      // donde no hay .env.
      env: {
        DEV_BOOTSTRAP: '1',
        DATABASE_URL: 'pglite://memory',
        BLOB_CONNECTION_STRING: 'memory',
        AUTH_MODE: 'dev',
        EXTRACTOR: 'fake',
        ASSISTANT: 'fake',
        // Alta manual de recetas activada para su prueba (specs/011); por defecto está desactivada.
        MANUAL_PRESCRIPTION_ENTRY: 'enabled',
        PORT: '3101',
        LOG_LEVEL: 'warn',
        NODE_ENV: 'development',
        COLUMN_ENCRYPTION_KEY: 'ZGV2LWtleS1ub3QtZm9yLXByb2R1Y3Rpb24tMzJiISE=',
      },
    },
    {
      command: `${NODE} node_modules/vite/bin/vite.js --port 5174 --strictPort`,
      url: 'http://localhost:5174',
      timeout: 60_000,
      reuseExistingServer: false,
      env: { VITE_API_PROXY: 'http://localhost:3101' },
    },
  ],
});
