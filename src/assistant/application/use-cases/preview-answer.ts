import { knowledgeInstructions } from '../../domain/prompt';
import type { SearchResult } from '../../../types';
import type { ModelPort } from '../ports/model-port';
export type PreviewAnswerCommand = { question: string; sources: SearchResult[] };
/** The model's answer to a question grounded only on the given sources (operators' preview). */
export const makePreviewAnswer =
  ({ model }: { model: ModelPort }) =>
  ({ question, sources }: PreviewAnswerCommand) =>
    model.evidenceAnswer({ instructions: knowledgeInstructions(sources), question });
