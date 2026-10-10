import { config } from '../config';
import { json } from './respond';
import type { PublicHandler } from './context';
export const health: PublicHandler = () =>
  json({
    ok: true,
    service: 'banana-app',
    chatModel: config.chatModel,
    embeddingModel: config.embeddingModel,
    keyConfigured: !!process.env.OPENAI_API_KEY,
  });
