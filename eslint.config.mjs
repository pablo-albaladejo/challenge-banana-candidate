import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // The starter types JSON payloads and SQLite rows as `any`; keep that debt visible, not blocking.
  { rules: { '@typescript-eslint/no-explicit-any': 'warn' } },
  // Tests read untyped JSON responses and fake API bodies.
  {
    files: ['**/*.test.ts', '**/*.e2e.ts', 'tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  globalIgnores([
    // External bank stand-in: not application code (see simulator/AGENTS.md).
    'simulator/**',
    '.next/**',
    '.next-e2e/**',
    '.data/**',
    '.e2e/**',
    '.omc/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'playwright-report/**',
    'test-results/**',
  ]),
]);
