import type { NextConfig } from 'next';
// NEXT_DIST_DIR lets the E2E stack run its own `next dev` beside a regular one: Next 16 locks
// one dev server per output directory.
const config: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
};
export default config;
