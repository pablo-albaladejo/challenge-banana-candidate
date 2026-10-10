import type { Person } from '../../types';
/** What a handler receives: the request, the `:params` of its pattern and, past auth, the actor. */
export type PublicContext = { request: Request; params: Record<string, string> };
export type RequestContext = PublicContext & { actor: Person };
export type PublicHandler = (c: PublicContext) => Response | Promise<Response>;
export type Handler = (c: RequestContext) => Response | Promise<Response>;
