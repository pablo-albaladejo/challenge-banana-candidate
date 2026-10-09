// Every /api/* endpoint enters here; routing, auth and error mapping live in src/http/.
import { handle } from '../../../src/http/handle';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handle;
export const POST = handle;
