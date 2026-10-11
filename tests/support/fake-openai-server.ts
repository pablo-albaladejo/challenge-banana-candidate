// Standalone fake model for the E2E stack. A browser journey cannot script turns ahead of time,
// so this answers with a small deterministic policy:
// - after a tool result, summarize it;
// - when the customer mentions accounts, call list_accounts;
// - otherwise reply with a fixed sentence.
// The case brief's two structured calls (`case_claims`, `case_brief`) get answers built from their
// own data: the claims pattern matching finds, and a draft that states the corrected fact.
import { reply, startFakeOpenAI, toolCall } from './openai';
import { e2e } from './e2e-env';
import { regexClaims } from '../../src/support/domain/regex-claims';
type Item = { type?: string; role?: string; content?: unknown; output?: string };
function lastUserText(input: Item[]) {
  const last = [...input].reverse().find((i) => i.role === 'user');
  return typeof last?.content === 'string' ? last.content : '';
}
const STATUSES = ['completed', 'not_completed', 'pending'];

/** `case_claims`: the unambiguous pattern-matched claims of every fenced assistant message. */
function caseClaims(data: string) {
  const messages = [
    ...data.matchAll(/<<<assistant id=(\S+)>>>\n([\s\S]*?)\n<<<end assistant id=\1>>>/g),
  ].map(([, id, content]) => ({ id, role: 'assistant', content }));
  const claims = regexClaims(messages)
    .filter((c) => c.kind !== 'operation_status' || STATUSES.includes(c.status))
    .map((c) => ({
      messageId: c.messageId,
      quote: c.quote,
      kind: c.kind,
      amountCents: 'amountCents' in c ? c.amountCents : null,
      reference: 'reference' in c ? c.reference : null,
      status: c.kind === 'operation_status' ? c.status : null,
      policy: c.kind === 'policy_amount' ? c.policy : null,
      product: c.kind === 'policy_amount' ? c.product : null,
    }));
  return { claims };
}

/** `case_brief`: a greeting, the corrected fact (or the first one), and the retry advice. */
function caseBrief(data: string) {
  const name = /<<<customer name>>>\n(.*)\n/.exec(data)?.[1] ?? 'there';
  const facts = [...data.matchAll(/^(F\d+) \[\w+\] [^:]*: (.*)$/gm)];
  const correct = /the correct fact is (F\d+)/.exec(data)?.[1];
  const fact = facts.find(([, id]) => id === correct) ?? facts[0];
  const retry = /^- retry_advice/m.test(data)
    ? ' Please do not send this payment again: it has already been completed.'
    : '';
  return {
    summary: 'The assistant told the customer something the bank record does not support.',
    nextStep: 'Reply to the customer with the corrected fact.',
    draftReply: `Hello ${name}, thank you for your patience. ${fact?.[2] ?? ''}${retry} Banana Bank support`,
    usedFactIds: fact ? [fact[1]] : [],
  };
}

await startFakeOpenAI({
  port: e2e.openaiPort,
  policy: (body) => {
    const input: Item[] = Array.isArray(body.input) ? body.input : [];
    const format = body.text?.format?.name;
    if (format === 'case_claims') return reply(JSON.stringify(caseClaims(lastUserText(input))));
    if (format === 'case_brief') return reply(JSON.stringify(caseBrief(lastUserText(input))));
    const last = input.at(-1);
    if (last?.type === 'function_call_output') {
      const output = JSON.parse(last.output || '{}');
      if (Array.isArray(output.accounts))
        return reply(
          `You have ${output.accounts.length} accounts: ${output.accounts.map((a: { label: string }) => a.label).join(' and ')}.`,
        );
      return reply('Done.');
    }
    if (/account/i.test(lastUserText(input))) return toolCall('list_accounts', {});
    return reply('I can help with that.');
  },
});
console.log(`Fake OpenAI listening on ${e2e.openaiPort}`);
