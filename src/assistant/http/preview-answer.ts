import { z } from 'zod';
import { HttpError } from '../../platform/http/http-error';
import { answerWithEvidence } from '../evidence';
import { json } from '../../platform/http/respond';
import type { Handler } from '../../platform/http/context';
const previewSchema = z.object({
  question: z.string().min(1).max(8000),
  sources: z
    .array(
      z.object({
        id: z.string(),
        documentId: z.string(),
        text: z.string().max(12000),
        title: z.string().nullable(),
        version: z.number().nullable(),
        validFrom: z.string().nullable(),
        validTo: z.string().nullable(),
        audience: z.enum(['public', 'internal']),
        score: z.number(),
      }),
    )
    .max(10),
});
/** The role is checked before the body, so a customer never reaches validation or the model. */
export const previewAnswer: Handler = async ({ request, actor }) => {
  if (actor.role !== 'operator') throw new HttpError(403, 'Operator role required.');
  const body = previewSchema.parse(await request.json());
  return json(await answerWithEvidence(body.question, body.sources));
};
