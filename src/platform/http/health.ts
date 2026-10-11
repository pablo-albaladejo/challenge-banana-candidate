import { config } from '../config';
import { activeProvider, lastModelFallbackAt } from '../model/gateway';
import { json } from './respond';
import type { PublicHandler } from './context';
/**
 * `modelProvider`: who answers chat calls now; `searchMode`: lexical when Claude (no embeddings);
 * `lastFallbackAt`: when OpenAI last ran out of quota and `auto` fell back, or null.
 */
export const health: PublicHandler = async () => {
  const modelProvider = await activeProvider();
  return json({
    ok: true,
    service: 'banana-app',
    chatModel: config.chatModel,
    embeddingModel: config.embeddingModel,
    keyConfigured: !!process.env.OPENAI_API_KEY,
    modelProvider,
    searchMode: modelProvider === 'claude-cli' ? 'lexical' : 'semantic',
    lastFallbackAt: lastModelFallbackAt() ?? null,
  });
};
