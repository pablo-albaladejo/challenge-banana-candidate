// Ports and paths of the isolated E2E stack, shared by playwright.config.ts and the journeys.
// They differ from the defaults (3000/4001, .data/, .next/) so a running `npm run dev` is untouched.
export const e2e = {
  appUrl: 'http://127.0.0.1:3100',
  appPort: 3100,
  bankUrl: 'http://127.0.0.1:4101',
  bankPort: 4101,
  openaiPort: 4102,
  dataDir: '.e2e/data',
  distDir: '.next-e2e',
  adminSecret: 'banana-e2e-admin',
};
