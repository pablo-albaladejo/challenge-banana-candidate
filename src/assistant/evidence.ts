import { createResponse } from '../platform/model/gateway';
import { knowledgeInstructions } from './prompt';
import { config } from '../platform/config';
import type { SearchResult } from '../types';
export async function answerWithEvidence(question: string, sources: SearchResult[]) {
  const response = await createResponse({
    model: config.chatModel,
    instructions: knowledgeInstructions(sources),
    input: question,
    reasoning: { effort: 'low' },
    max_output_tokens: 1200,
    store: false,
  });
  return { answer: response.output_text, model: response.model, usage: response.usage };
}
