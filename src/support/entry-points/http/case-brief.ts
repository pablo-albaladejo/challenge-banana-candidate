import { z } from 'zod';
import { json } from '../../../platform/http/respond';
import { support } from '../dependencies';
import { requireOperator } from './incidents';
import type { Handler } from '../../../platform/http/context';

const briefSchema = z.object({}).strict();
/**
 * `POST incidents/:id/brief`: the verified case brief. The session role is gated before the body is
 * read; `GenerateCaseBrief` checks the person behind `actor.id` again, before the case.
 */
export const generateBrief: Handler = async ({ request, params, actor }) => {
  requireOperator(actor.role);
  briefSchema.parse(await request.json());
  return json(await support().generateCaseBrief({ operatorId: actor.id, incidentId: params.id }));
};
