// Next.js calls `register` once per server instance, before it serves any request (Next 16 docs:
// file-conventions/instrumentation, guides/self-hosting). A throw is not enough: `next start` logs
// "Failed to prepare server", keeps listening and answers 500 to everything. So a production
// server with weak, default or reused secrets prints one line naming the variables (never the
// values, the Error object or its stack) and exits. In the built server webpack inlines NODE_ENV
// and NEXT_RUNTIME, so a production build always runs the check in its Node.js runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { assertProductionSecrets, config } = await import('./src/platform/config');
      assertProductionSecrets(config, process.env.NODE_ENV);
    } catch (e) {
      console.error(`Refusing to start in production: ${(e as Error).message}`);
      process.exit(1);
    }
  }
}
