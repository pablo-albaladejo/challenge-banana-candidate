import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Boundaries (src/AGENTS.md, plan §10.6). Import specifiers are relative, so every regex is
// anchored to the exact number of `../` that climbs from a file back to `src/` (`toSrc`) or to the
// root of its own vertical (`toV`): a file `depth` folders below `src/` reaches a top-level folder
// with `'../'.repeat(depth)`. Fixed-depth strings only (no `(\.\./)+`, which backtracks). Every
// file is matched by exactly one `no-restricted-imports` object: one per area x depth x test-or-not.
const features = 'transfers|accounts|assistant|conversations|knowledge|support|identity';
const verticals = features.split('|');
/** Vertical rank (plan §10.1): a vertical value-imports only verticals of a lower rank. */
const rank = {
  identity: 0,
  knowledge: 0,
  conversations: 0,
  transfers: 1,
  support: 2,
  accounts: 3,
  assistant: 4,
};
const up = (depth) => '\\.\\./'.repeat(depth);
const frozenShims = (depth) => ({
  regex: `^${up(depth)}((config|db|seed|auth|people)(\\.ts)?|(agent|banking|ingestion|retrieval)(/.*)?)$`,
  message: 'Frozen shims are for external callers only; import the module from its new path.',
});
const alias = { regex: '^@/src/', message: 'Inside src/, import relatively.' };
const noServer = (depth) => ({
  regex: `^${up(depth)}server(/.*)?$`,
  message: 'Only tests may import src/server.',
});
// A feature reaches another feature only through its index.ts, and never the composition root.
const feature = (depth, test) => [
  {
    regex: `^${up(depth)}(${features})/(?!index(\\.ts)?$).+`,
    message: "Import another feature only through its index.ts ('../<feature>').",
  },
  ...(test ? [] : [noServer(depth)]),
  frozenShims(depth),
  alias,
];
/** Value imports of a vertical of the same or a higher rank (types are erased, so allowed). */
const rankEntries = (v, depth) => {
  const higher = verticals.filter((o) => o !== v && rank[o] >= rank[v]);
  return higher.length
    ? [
        {
          regex: `^${up(depth)}(${higher.join('|')})(/|$)`,
          allowTypeImports: true,
          message: `${v} (rank ${rank[v]}) value-imports only verticals of a lower rank (plan §10.1); \`import type\` is allowed.`,
        },
      ]
    : [];
};
// Purity of domain/, application/ and shared/: no I/O packages; `node:crypto` only for createHash.
const impure = (packages) => ({
  regex: `^(${packages})(/|$)`,
  message: 'Pure layer: no I/O packages here; reach I/O through a port.',
});
const nodeIo = {
  regex: '^(node:)?(fs|path|os|zlib|http|https|net|dns|child_process|worker_threads)(/.*)?$',
  message: 'Pure layer: no I/O modules here; reach I/O through a port.',
};
const cryptoPaths = ['node:crypto', 'crypto'].map((name) => ({
  name,
  allowImportNames: ['createHash'],
  message: 'Pure layer: only createHash; ids come from the Ids port.',
}));
const layers = {
  domain: (depth) => [
    {
      regex: `^${up(depth)}(?!shared/domain(/|$)|types(\\.ts)?$)`,
      message: 'domain/ imports only its own vertical, shared/domain and types.',
    },
    {
      regex: `^${up(depth - 1)}(application|infrastructure|entry-points|index)(/|\\.ts|$)`,
      message: 'domain/ never imports application, infrastructure, entry-points or the index.',
    },
    impure('better-sqlite3|openai|next|dotenv'),
    nodeIo,
    alias,
  ],
  application: (depth) => [
    {
      regex: `^${up(depth)}(?!shared/|types(\\.ts)?$)`,
      message: 'application/ imports only its own vertical, shared/ and types (no platform/).',
    },
    {
      regex: `^${up(depth - 1)}(infrastructure|entry-points|index)(/|\\.ts|$)`,
      message: 'application/ never imports infrastructure, entry-points or the index.',
    },
    impure('better-sqlite3|next|dotenv'),
    {
      regex: '^openai(/|$)',
      allowTypeImports: true,
      message: 'application/ takes only types from openai; the client lives in infrastructure/.',
    },
    nodeIo,
    alias,
  ],
  infrastructure: (depth) => [
    {
      regex: `^${up(depth)}(?!platform/|shared/|types(\\.ts)?$)`,
      message: 'infrastructure/ imports only platform/, shared/ and types (no other vertical).',
    },
    {
      regex: `^${up(depth - 1)}(application/(use-cases|services)|entry-points|index)(/|\\.ts|$)`,
      message: 'infrastructure/ implements its own ports over platform/; no use cases or services.',
    },
    alias,
  ],
  wiring: (v, depth) => [
    {
      regex: `^${up(depth)}platform/(?!http/|config(\\.ts)?$|runtime(\\.ts)?$)`,
      message: 'Entry-points reach platform/ only for http/, config and runtime.',
    },
    {
      regex: `^${up(depth)}(${features})/.+`,
      message: "Import another vertical only through its index.ts ('../<vertical>').",
    },
    ...rankEntries(v, depth),
    noServer(depth),
    frozenShims(depth),
    alias,
  ],
  'entry-points': (v, depth) => [
    ...layers.wiring(v, depth),
    {
      regex: `^${up(depth - 1)}application/services(/|$)`,
      message: 'Only dependencies.ts wires services; call a use case.',
    },
    {
      regex: `^${up(depth - 1)}application/ports(/|$)`,
      allowTypeImports: true,
      message: 'Entry-points take only port types; dependencies.ts wires the adapters.',
    },
    {
      regex: `^${up(depth - 1)}infrastructure(/|$)`,
      message: 'Only dependencies.ts and legacy.ts touch infrastructure/.',
    },
  ],
  // Until the flat layout is gone (7d), the index may still re-export today's flat files, but
  // never the new layer folders: it re-exports entry-points only.
  index: (v) => [
    {
      regex: '^\\./(domain|application|infrastructure)(/|$)',
      message: 'index.ts re-exports only ./entry-points/.',
    },
    ...rankEntries(v, 1),
    ...feature(1, false),
  ],
  // Today's files, outside the layer folders: the Phase 6 rules plus the vertical rank.
  flat: (v, depth) => [...feature(depth, false), ...rankEntries(v, depth)],
  shared: (depth) => [
    {
      regex: `^${up(depth)}(?!shared/)`,
      message: 'shared/ is the kernel: it imports nothing outside shared/.',
    },
    impure('better-sqlite3|openai|next|dotenv'),
    nodeIo,
    alias,
  ],
  // platform/ is the bottom layer under the verticals: no feature, no composition root.
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
// Up to six folders below src/ (today's deepest file is two below), so no source file escapes.
const depths = [1, 2, 3, 4, 5, 6];
const ts = '*.{ts,tsx}';
const at = (dir, depth, from) => `${dir}${'*/'.repeat(depth - from)}${ts}`;
const restrict = (files, patterns, extra = {}) => ({
  files,
  ignores: ['**/*.test.ts', ...(extra.ignores ?? [])],
  rules: {
    'no-restricted-imports': [
      'error',
      { ...(extra.paths ? { paths: extra.paths } : {}), patterns },
    ],
  },
});
const layerGlobs = [
  'src/*/domain/**',
  'src/*/application/**',
  'src/*/infrastructure/**',
  'src/*/entry-points/**',
  'src/*/index.ts',
];
const wiringFiles = (v) => [
  `src/${v}/entry-points/dependencies.ts`,
  `src/${v}/entry-points/legacy.ts`,
];
const boundaries = [
  // Pure and inner layers: the same rules in every vertical. Layer roots sit at depth 2.
  ...['domain', 'application', 'infrastructure'].flatMap((layer) =>
    depths
      .filter((d) => d >= 2)
      .map((d) =>
        restrict(
          [at(`src/{${verticals.join(',')}}/${layer}/`, d, 2)],
          layers[layer](d),
          layer === 'infrastructure' ? {} : { paths: cryptoPaths },
        ),
      ),
  ),
  // Entry-points, wiring, index and the flat layout carry the rank of their vertical.
  ...verticals.flatMap((v) => [
    restrict(wiringFiles(v), layers.wiring(v, 2)),
    ...depths
      .filter((d) => d >= 2)
      .map((d) =>
        restrict([at(`src/${v}/entry-points/`, d, 2)], layers['entry-points'](v, d), {
          ignores: wiringFiles(v),
        }),
      ),
    restrict([`src/${v}/index.ts`], layers.index(v)),
    ...depths.map((d) =>
      restrict([at(`src/${v}/`, d, 1)], layers.flat(v, d), { ignores: layerGlobs }),
    ),
  ]),
  ...depths.map((d) =>
    restrict([at('src/shared/', d, 1)], layers.shared(d), { paths: cryptoPaths }),
  ),
  ...depths.map((d) => restrict([at('src/platform/', d, 1)], layers.platform(d))),
  ...depths.map((d) => restrict([at('src/server/', d, 1)], layers.server(d))),
  // Tests: only the cross-vertical index rule, the shim rule and the alias rule (no layer rules,
  // so a use-case test may import its vertical's wiring and tests/support/*).
  ...depths.flatMap((d) => [
    {
      files: [`src/{${verticals.join(',')},shared}/${'*/'.repeat(d - 1)}*.test.ts`],
      rules: { 'no-restricted-imports': ['error', { patterns: feature(d, true) }] },
    },
    {
      files: [`src/platform/${'*/'.repeat(d - 1)}*.test.ts`],
      rules: { 'no-restricted-imports': ['error', { patterns: layers.platform(d) }] },
    },
    {
      files: [`src/server/${'*/'.repeat(d - 1)}*.test.ts`],
      rules: { 'no-restricted-imports': ['error', { patterns: layers.server(d) }] },
    },
  ]),
  // Catch-all for every other src/ file (the root files, the frozen shims, any new top-level
  // folder), tests included: they re-export deep paths on purpose, so only the alias rule applies.
  {
    files: [
      'src/*.{ts,tsx}',
      `src/!(${[...verticals, 'shared', 'platform', 'server'].join('|')})/**/*.{ts,tsx}`,
    ],
    rules: { 'no-restricted-imports': ['error', { patterns: [alias] }] },
  },
];
// No ambient clock, randomness or crypto global in the pure layers: use the Clock and Ids ports.
const purity = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Use the Clock port.',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'Use the Clock port.',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'Use the Ids port.',
  },
  {
    selector: "MemberExpression[object.name='globalThis'][property.name='crypto']",
    message: 'Use the Ids port.',
  },
];
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
  // The pure layers: the same dynamic-import selector (the last object wins) plus the purity bans.
  {
    files: [
      `src/{${verticals.join(',')}}/{domain,application}/**/*.ts`,
      'src/shared/domain/**/*.ts',
    ],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'crypto', message: 'Use the Ids port.' }],
      'no-restricted-syntax': [
        'error',
        dynamicImport(
          `(${features})\\x2F(?!index)`,
          'Import another feature only through its index.ts.',
        ),
        ...purity,
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
  // Outside src/, only src/server may reach a feature's http/ handlers.
  {
    files: ['app/**/*.{ts,tsx}', 'scripts/**/*.ts', 'tests/**/*.ts', '*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: `(^|/)src/(${features})/(http|entry-points/http)(/|$)`,
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
