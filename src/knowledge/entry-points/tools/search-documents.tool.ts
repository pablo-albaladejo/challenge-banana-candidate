import { z } from 'zod';
import { knowledge } from '../dependencies';
import type { Tool } from '../../../assistant';
const input = z.object({ query: z.string().max(2000) });
export const searchDocumentsTool: Tool = {
  name: 'search_documents',
  description: "Search the bank's documentation for policies and procedures.",
  input,
  // The agent always searches as a customer: internal documents stay out of its answers.
  execute: async (args) => ({
    sources: (
      await knowledge().searchDocuments({ query: input.parse(args).query, role: 'customer' })
    ).sources,
  }),
};
