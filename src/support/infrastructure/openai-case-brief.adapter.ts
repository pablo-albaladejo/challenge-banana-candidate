import { z } from 'zod';
import { config } from '../../platform/config';
import { createResponse, MissingOpenAIKeyError } from '../../platform/model/gateway';
import {
  ModelUnavailable,
  type CaseBriefModel,
  type DegradedReason,
} from '../application/ports/case-brief-model';
import { extractionRequest, writingRequest } from './case-brief-prompts';

/** Each model step gives up after this long; one retry on a transport error only (plan §4.A.6). */
export const BRIEF_TIMEOUT_MS = 30_000;

// zod mirrors of the strict schemas in ./case-brief-prompts.
const caseClaims = z
  .object({
    claims: z.array(
      z
        .object({
          messageId: z.string(),
          quote: z.string(),
          kind: z.enum(['amount', 'reference', 'operation_status', 'policy_amount']),
          amountCents: z.number().int().nullable(),
          reference: z.string().nullable(),
          status: z.enum(['completed', 'not_completed', 'pending']).nullable(),
          policy: z
            .enum([
              'monthly_fee',
              'internal_transfer_fee',
              'per_transfer_limit',
              'referral_reward',
              'other',
            ])
            .nullable(),
          product: z
            .enum([
              'aurora',
              'horizon',
              'cloud',
              'family',
              'community',
              'professional',
              'young',
              'travel',
            ])
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();
const caseBrief = z
  .object({
    summary: z.string(),
    nextStep: z.string(),
    draftReply: z.string().min(1).max(2000),
    usedFactIds: z.array(z.string()),
  })
  .strict();

const reasonOf = (error: unknown): DegradedReason =>
  error instanceof MissingOpenAIKeyError ? 'missing_key' : 'model_error';

/**
 * Builds and sends one structured call and parses its answer; every failure is a
 * `ModelUnavailable` (a fence label that cannot be written is a `model_error`).
 */
async function structured<T>(
  build: () => Parameters<typeof createResponse>[0],
  schema: z.ZodType<T>,
  timeoutMs: number,
): Promise<T> {
  let text: string;
  try {
    text = (await createResponse(build(), { timeout: timeoutMs, maxRetries: 1 })).output_text;
  } catch (error) {
    throw new ModelUnavailable(reasonOf(error));
  }
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new ModelUnavailable('invalid_output');
  }
}

/**
 * The brief's model steps over the gateway (`createResponse`, `config.chatModel` read at call
 * time). The prompts go as `instructions`; the fenced data as one user item. A missing key, a
 * provider error, a timeout and an answer that fails the schema are all `ModelUnavailable`.
 */
export const makeOpenAICaseBriefModel = ({
  timeoutMs = BRIEF_TIMEOUT_MS,
}: { timeoutMs?: number } = {}): CaseBriefModel => ({
  extractClaims: async ({ messages }) =>
    (await structured(() => extractionRequest(messages, config.chatModel), caseClaims, timeoutMs))
      .claims,
  writeBrief: (input) =>
    structured(() => writingRequest(input, config.chatModel), caseBrief, timeoutMs),
});

export const openaiCaseBriefModel = makeOpenAICaseBriefModel();
