import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/tipos.ts'],
      reporter: ['text-summary', 'text', 'json-summary'],
      // SPEC §12.1 punto 3: cobertura ≥ 90 % de líneas y ramas.
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
