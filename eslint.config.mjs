import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Screaming-architecture boundaries (src/AGENTS.md). Import specifiers are relative, so every
// regex is anchored to the exact number of `../` that climbs from a file back to `src/`: a file
// `depth` folders below `src/` reaches a top-level folder with `'../'.repeat(depth)`.
const features = 'transfers|accounts|assistant|conversations|knowledge|support|identity';
const up = (depth) => '\\.\\./'.repeat(depth);
const frozenShims = (depth) => ({
  regex: `^${up(depth)}((config|db|seed|auth|people)(\\.ts)?|(agent|banking|ingestion|retrieval)(/.*)?)$`,
  message: 'Frozen shims are for external callers only; import the module from its new path.',
});
const alias = { regex: '^@/src/', message: 'Inside src/, import relatively.' };
const rules = {
  // A feature reaches another feature only through its index.ts, and never the composition root.
  feature: (depth, test) => [
    {
      regex: `^${up(depth)}(${features})/(?!index(\\.ts)?$).+`,
      message: "Import another feature only through its index.ts ('../<feature>').",
    },
    ...(test
      ? []
      : [{ regex: `^${up(depth)}server(/.*)?$`, message: 'Only tests may import src/server.' }]),
    frozenShims(depth),
    alias,
  ],
  // platform/ is the bottom layer: no feature, no composition root.
  platform: (depth) => [
    {
      regex: `^${up(depth)}(${features}|server)(/.*)?$`,
      message: 'platform/ never imports a feature or src/server.',
    },
    frozenShims(depth),
    alias,
  ],
  // The composition root may deep-import feature internals (their http/ handlers).
  server: (depth) => [frozenShims(depth), alias],
};
const areaGlob = {
  feature: `src/{${features.replaceAll('|', ',')}}/`,
  platform: 'src/platform/',
  server: 'src/server/',
};
const boundaries = Object.keys(rules).flatMap((area) =>
  [1, 2, 3].flatMap((depth) => {
    const dir = areaGlob[area] + '*/'.repeat(depth - 1);
    return [
      {
        files: [`${dir}*.{ts,tsx}`],
        ignores: ['**/*.test.ts'],
        rules: { 'no-restricted-imports': ['error', { patterns: rules[area](depth, false) }] },
      },
      {
        files: [`${dir}*.test.ts`],
        rules: { 'no-restricted-imports': ['error', { patterns: rules[area](depth, true) }] },
      },
    ];
  }),
);
// `import()` with a literal source; `\x2F` is `/` (esquery regexes cannot contain a slash).
const dynamicImport = (targets, message) => ({
  selector: `ImportExpression[source.value=/^(\\.\\.\\x2F)+${targets}/]`,
  message,
});

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
  ...boundaries,
  {
    files: [`src/{${features.replaceAll('|', ',')}}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-syntax': [
        'error',
        dynamicImport(
          `(${features})\\x2F(?!index)`,
          'Import another feature only through its index.ts.',
        ),
      ],
    },
  },
  {
    files: ['src/platform/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        dynamicImport(
          `(${features}|server)(\\x2F|$)`,
          'platform/ never imports a feature or src/server.',
        ),
      ],
    },
  },
  // A tool may take only the `Tool` type from assistant: a value import would bring back the
  // runtime cycle registry -> feature index -> tool -> registry.
  {
    files: ['src/*/tools/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(\\.\\./)+assistant(/.*)?$',
              allowTypeImports: true,
              message: 'Tools import only types from assistant (`import type { Tool }`).',
            },
          ],
        },
      ],
    },
  },
  // Outside src/, only src/server may reach a feature's http/ handlers.
  {
    files: ['app/**/*.{ts,tsx}', 'scripts/**/*.ts', 'tests/**/*.ts', '*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: `(^|/)src/(${features})/http(/|$)`,
              message: "A feature's http/ handlers are wired only by src/server/routes.ts.",
            },
          ],
        },
      ],
    },
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
