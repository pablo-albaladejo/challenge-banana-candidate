import { z } from 'zod';
import { json } from '../../../platform/http/respond';
import { identity } from '../dependencies';
import type { Handler, PublicHandler } from '../../../platform/http/context';
const selectSchema = z.object({ userId: z.string() });
/** The body is parsed first (400 `Invalid request data.`), then `StartSession` (400 `Unknown person.`). */
export const selectPerson: PublicHandler = async ({ request }) => {
  const { userId } = selectSchema.parse(await request.json());
  const { person, token } = identity().startSession({ userId });
  return json({ person }, 200, {
    'Set-Cookie': `banana_actor=${token}; Path=/; HttpOnly; SameSite=Strict`,
  });
};
export const currentSession: Handler = ({ actor }) => json({ person: actor });
