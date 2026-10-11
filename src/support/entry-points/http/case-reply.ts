import { z } from 'zod';
import { json } from '../../../platform/http/respond';
import { support } from '../dependencies';
import { requireOperator } from './incidents';
import type { Handler } from '../../../platform/http/context';

const replySchema = z
  .object({
    content: z.string().trim().min(1).max(2000),
    acknowledgeUnverified: z.boolean().optional(),
  })
  .strict();
/**
 * `POST incidents/:id/reply`: sends the operator's reply to the customer and closes the case. The
 * session role is gated before the body is read; `ReplyAndCloseCase` checks the person behind
 * `actor.id` again, before the case. Unacknowledged flags answer 409 with them; the conflict 409 of
 * a case already closed carries no `flags`.
 */
export const replyAndClose: Handler = async ({ request, params, actor }) => {
  requireOperator(actor.role);
  const { content, acknowledgeUnverified } = replySchema.parse(await request.json());
  const result = await support().replyAndCloseCase({
    operatorId: actor.id,
    incidentId: params.id,
    content,
    acknowledgeUnverified,
  });
  if (result.status === 'needs_acknowledgement')
    return json(
      result.bankUnreachable
        ? {
            error:
              'The bank could not be reached, so amounts, references and statuses in the reply could not be checked.',
            bankUnreachable: true,
            flags: result.flags,
          }
        : {
            error: 'The reply contains statements that could not be verified.',
            flags: result.flags,
          },
      409,
    );
  return json({ incident: result.incident, message: result.message });
};
