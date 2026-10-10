import { z } from 'zod';
import { HttpError, sessionToken } from '../auth';
import { person } from '../people';
import { json } from '../../platform/http/respond';
import type { Handler, PublicHandler } from '../../platform/http/context';
const selectSchema = z.object({ userId: z.string() });
export const selectPerson: PublicHandler = async ({ request }) => {
  const { userId } = selectSchema.parse(await request.json());
  if (!person(userId)) throw new HttpError(400, 'Unknown person.');
  return json({ person: person(userId) }, 200, {
    'Set-Cookie': `banana_actor=${sessionToken(userId)}; Path=/; HttpOnly; SameSite=Strict`,
  });
};
export const currentSession: Handler = ({ actor }) => json({ person: actor });
