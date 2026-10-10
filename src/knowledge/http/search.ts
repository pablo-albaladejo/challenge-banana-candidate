import { z } from 'zod';
import { searchDocuments } from '../search/search';
import { json } from '../../platform/http/respond';
import type { Handler } from '../../platform/http/context';
const searchSchema = z.object({ query: z.string().min(1).max(2000) });
export const search: Handler = async ({ request, actor }) => {
  const { query } = searchSchema.parse(await request.json());
  return json({ sources: await searchDocuments(query, actor.role) });
};
