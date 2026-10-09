import { z } from 'zod';
import { HttpError } from '../auth';
import { BankError } from '../banking/client';
import { MissingOpenAIKeyError } from '../retrieval/embeddings';
import { json } from './respond';
/**
 * Maps anything thrown while handling a request to its JSON response. Unknown errors log only
 * their name and answer a generic 500. `requestId` is accepted for later correlation (unused).
 */
export function toErrorResponse(e: unknown, requestId?: string) {
  void requestId;
  if (e instanceof MissingOpenAIKeyError)
    return json({ error: e.message, code: 'missing_openai_api_key' }, 503);
  if (e instanceof HttpError || e instanceof BankError) return json({ error: e.message }, e.status);
  if (e instanceof z.ZodError || e instanceof SyntaxError)
    return json({ error: 'Invalid request data.' }, 400);
  console.error('app_request_failed', e instanceof Error ? e.name : 'unknown');
  return json(
    { error: 'The request could not be completed. Check the service and configuration.' },
    500,
  );
}
