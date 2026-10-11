// The model access a real subject gets: the app's own gateway (so MODEL_PROVIDER, the quota
// fallback and the timeouts behave as in production), recording which provider and model answered
// so every reported number states where it came from (design §7.5).
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { createAttributedResponse, type createResponse } from '../src/platform/model/gateway';
import type { ModelInfo } from './report';

export type ModelAccess = {
  createResponse: typeof createResponse;
  /**
   * The distinct providers and models seen so far; empty when the subject never called one. It
   * also counts a call a timed-out subject made after its run was abandoned (subjects must honour
   * `signal` so there is none).
   */
  observed: () => ModelInfo;
};

export function gatewayModel(): ModelAccess {
  const providers = new Set<string>();
  const models = new Set<string>();
  return {
    createResponse: async (body: ResponseCreateParamsNonStreaming) => {
      // The gateway names the provider that answered this call, quota fallback included, so a
      // concurrent call cannot misattribute it.
      const { provider, response } = await createAttributedResponse(body);
      providers.add(provider);
      if (response.model) models.add(response.model);
      return response;
    },
    observed: () => ({ providers: [...providers], models: [...models] }),
  };
}
