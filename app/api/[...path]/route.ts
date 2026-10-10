// Every /api/* endpoint enters here; routing and auth live in src/server/handle.ts and src/server/routes.ts.
import { handle } from '../../../src/server/handle';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handle;
export const POST = handle;
