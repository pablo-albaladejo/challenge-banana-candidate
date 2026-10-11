import { embedTexts } from '../src/knowledge/search/embeddings';
import { activeProvider, createResponse } from '../src/platform/model/gateway';
import { config } from '../src/platform/config';
try {
  const response = await createResponse({
    model: config.chatModel,
    input: 'Reply with only: connection successful',
    reasoning: { effort: 'none' },
    max_output_tokens: 100,
    store: false,
  });
  // The provider that actually answered: claude-cli marks its responses (also after a fallback).
  const provider = response.metadata?.provider ?? 'openai';
  const embeddings =
    provider === 'claude-cli'
      ? {
          searchMode: 'lexical',
          note: 'Claude has no embeddings API: document search uses SQLite FTS5 (BM25).',
        }
      : {
          searchMode: 'semantic',
          embeddingModel: config.embeddingModel,
          dimensions: (await embedTexts(['Banana simulator connection check.']))[0].length,
        };
  console.log(
    JSON.stringify(
      {
        provider,
        chatModel: response.model,
        reply: response.output_text,
        ...embeddings,
        keyConfigured: !!process.env.OPENAI_API_KEY?.trim(),
      },
      null,
      2,
    ),
  );
} catch (e) {
  const error = e as { status?: number; code?: string };
  console.error(
    JSON.stringify({
      ok: false,
      provider: await activeProvider().catch(() => null),
      status: error.status || null,
      code: error.code || 'connection_or_configuration_error',
      hint: 'Check OPENAI_API_KEY, access to both models, quota, and connectivity, or set MODEL_PROVIDER=claude-cli with a logged-in claude binary.',
    }),
  );
  process.exitCode = 1;
}
