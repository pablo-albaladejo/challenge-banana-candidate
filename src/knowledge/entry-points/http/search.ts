import { z } from 'zod';
import { json } from '../../../platform/http/respond';
import { knowledge } from '../dependencies';
import type { Handler } from '../../../platform/http/context';
const searchSchema = z.object({ query: z.string().min(1).max(2000) });
export const search: Handler = async ({ request, actor }) => {
  const { query } = searchSchema.parse(await request.json());
  const { sources, mode } = await knowledge().searchDocuments({ query, role: actor.role });
  return json({ sources, mode });
};
