import { z } from 'zod';
import { BadRequestError, ConflictError, ForbiddenError } from '../../shared/domain/errors';
import type { TransferInput } from '../../types';
import type { IntentRow } from './intent';
export const transferSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amountCents: z.number().int().positive().max(10000000),
    concept: z.string().max(200),
  })
  .strict()
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: 'Source and destination accounts must differ.',
    path: ['toAccountId'],
  });
/** Validates raw transfer arguments (strict: no smuggled fields); throws the `ZodError`. */
export const parseTransfer = (args: unknown): TransferInput => transferSchema.parse(args);
/** The stored JSON of a transfer, in schema key order (the order `parseTransfer` returns). */
export const payloadOf = (input: TransferInput) =>
  JSON.stringify({
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amountCents: input.amountCents,
    concept: input.concept,
  });
export const DIFFERENT_PAYLOAD_MESSAGE = 'This intent belongs to a different payload.';
/** An intent id is bound to one customer and one payload. */
export function assertSameIntent(previous: IntentRow | undefined, userId: string, payload: string) {
  if (previous && (previous.user_id !== userId || previous.payload !== payload))
    throw new ConflictError(DIFFERENT_PAYLOAD_MESSAGE);
}
export const FOREIGN_SOURCE_MESSAGE = 'This account does not belong to this person.';
export function assertOwnsSource(accounts: { id: string }[], input: TransferInput) {
  if (!accounts.some((a) => a.id === input.fromAccountId))
    throw new ForbiddenError(FOREIGN_SOURCE_MESSAGE);
}
export const UNKNOWN_DESTINATION_MESSAGE = 'The destination account does not exist.';
/** The destination is one of the customer's own accounts or one of their contacts. */
export function assertKnownDestination(
  accounts: { id: string }[],
  contacts: { id: string }[],
  input: TransferInput,
) {
  const destinations = [...accounts.map((a) => a.id), ...contacts.map((c) => c.id)];
  if (!destinations.includes(input.toAccountId))
    throw new BadRequestError(UNKNOWN_DESTINATION_MESSAGE);
}
