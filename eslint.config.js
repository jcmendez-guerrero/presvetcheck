import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const nodeBuiltins = [
  'fs', 'fs/promises', 'path', 'http', 'https', 'net', 'child_process', 'os', 'crypto', 'stream', 'url', 'worker_threads',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.turbo/**', 'fixtures/**', 'docs/ref/**',
      'apps/web/dev-dist/**', 'packages/db/migrations/**', '**/playwright-report/**', '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.node }, ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Scripts de línea de comandos que imprimen por consola de forma intencionada.
    files: ['**/scripts/**', 'apps/worker/src/spikes/**', 'packages/extraction/src/eval/**', 'packages/db/src/cli/**', 'apps/api/src/cli/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // packages/domain es PURO: sin I/O, sin infraestructura (SPEC §3, AGENTS.md).
    files: ['packages/domain/src/**/*.ts'],
    ignores: ['packages/domain/src/**/*.test.ts', 'packages/domain/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltins.flatMap((m) => [m, `node:${m}`]).map((name) => ({ name, message: 'domain es puro: sin I/O.' })),
          patterns: [
            { group: ['@mmx/db', '@mmx/db/*', '@mmx/cimavet', '@mmx/siweb', '@mmx/extraction', '@mmx/reports', '@mmx/shared/node'], message: 'domain no depende de infraestructura.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'domain es puro: sin I/O.' },
        { name: 'process', message: 'domain no lee el entorno: recibe la configuración.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Usa el Clock inyectado.' },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Usa el Clock inyectado.' },
        { selector: "MemberExpression[object.name='Temporal'][property.name='Now']", message: 'Usa el Clock inyectado.' },
      ],
    },
  },
);
