import { z } from 'zod';
import { searchDocuments } from '../../retrieval/search';
import type { Tool } from './registry';
const input = z.object({ query: z.string().max(2000) });
export const searchDocumentsTool: Tool = {
  name: 'search_documents',
  description: "Search the bank's documentation for policies and procedures.",
  input,
  execute: async (args) => ({ sources: await searchDocuments(input.parse(args).query) }),
};
