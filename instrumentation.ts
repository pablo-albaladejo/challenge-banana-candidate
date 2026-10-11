// Next.js calls `register` once per server instance, before it serves any request (Next 16 docs:
// file-conventions/instrumentation, guides/self-hosting). A throw is not enough: `next start` logs
// "Failed to prepare server", keeps listening and answers 500 to everything. So a production
// server with weak, default or reused secrets (P1-5), or with the demo persona switcher on (P0-7),
// prints one line naming the variables (never the values, the Error object or its stack) and
// exits. Every check runs and every refusal goes on that one line, secrets first. In the built
// server webpack inlines NODE_ENV and NEXT_RUNTIME, so a production build always runs the checks
// in its Node.js runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { assertNoPersonaSwitcherInProduction, assertProductionSecrets, config, featureFlags } =
        await import('./src/platform/config');
      const checks = await Promise.allSettled([
        (async () => assertProductionSecrets(config, process.env.NODE_ENV))(),
        (async () => assertNoPersonaSwitcherInProduction(featureFlags, process.env.NODE_ENV))(),
      ]);
      const refusals = checks.flatMap((check) =>
        check.status === 'rejected' ? [(check.reason as Error).message] : [],
      );
      if (refusals.length) throw new Error(refusals.join(' '));
    } catch (e) {
      console.error(`Refusing to start in production: ${(e as Error).message}`);
      process.exit(1);
    }
  }
}
