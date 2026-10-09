// Standalone fake model for the E2E stack. A browser journey cannot script turns ahead of time,
// so this answers with a small deterministic policy:
// - after a tool result, summarize it;
// - when the customer mentions accounts, call list_accounts;
// - otherwise reply with a fixed sentence.
import { reply, startFakeOpenAI, toolCall } from './openai';
import { e2e } from './e2e-env';
type Item = { type?: string; role?: string; content?: unknown; output?: string };
function lastUserText(input: Item[]) {
  const last = [...input].reverse().find((i) => i.role === 'user');
  return typeof last?.content === 'string' ? last.content : '';
}
await startFakeOpenAI({
  port: e2e.openaiPort,
  policy: (body) => {
    const input: Item[] = Array.isArray(body.input) ? body.input : [];
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
