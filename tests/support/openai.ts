// A local stand-in for the OpenAI API (Responses + Embeddings). Tests script the model's turns,
// so agent behavior is deterministic, free, and inspectable: every request is recorded.
import http from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
type OutputItem = Record<string, unknown>;
export type ScriptedTurn = OutputItem[] | { status: number; error: string };
export type RecordedRequest = { path: string; body: any };
let counter = 0;
const id = (prefix: string) => `${prefix}_${++counter}`;
/** A model turn that calls one tool. */
export function toolCall(name: string, args: unknown, callId = id('call')): OutputItem[] {
  return [
    {
      type: 'function_call',
      id: id('fc'),
      call_id: callId,
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
      status: 'completed',
    },
  ];
}
/** A model turn that answers with text. */
export function reply(text: string): OutputItem[] {
  return [
    {
      type: 'message',
      id: id('msg'),
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  ];
}
/** Deterministic unit vector for a text, so search ranks stably without a real model. */
export function fakeEmbedding(text: string, dimensions = 1536) {
  const seed = createHash('sha256').update(text).digest();
  const vector = Array.from(
    { length: dimensions },
    (_, i) => (seed[i % seed.length] - 127.5) / 128,
  );
  const norm = Math.hypot(...vector);
  return vector.map((v) => v / norm);
}
export type FakeOpenAI = {
  url: string;
  requests: RecordedRequest[];
  /** Queues model turns for /v1/responses, consumed in order. */
  script: (...turns: ScriptedTurn[]) => void;
  /** Overrides the vector returned for an exact embedding input. */
  embed: (text: string, vector: number[]) => void;
  /** Answers every /v1/embeddings request after the first `succeeding` ones with a 400. */
  failEmbeddingsAfter: (succeeding: number) => void;
  reset: () => void;
  close: () => Promise<void>;
};
export type FakeOpenAIOptions = {
  /** Fixed port, for a fake shared with other processes (E2E). Defaults to a free port. */
  port?: number;
  /** Decides the model turn when no scripted turn is queued (E2E cannot script ahead). */
  policy?: (body: any) => ScriptedTurn;
};
/** Starts the fake and points the OpenAI SDK at it through OPENAI_BASE_URL. */
export async function startFakeOpenAI(options: FakeOpenAIOptions = {}): Promise<FakeOpenAI> {
  const turns: ScriptedTurn[] = [];
  const vectors = new Map<string, number[]>();
  const requests: RecordedRequest[] = [];
  let embeddingBudget = Infinity;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const path = (req.url || '').replace(/\?.*$/, '');
    requests.push({ path, body });
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (path === '/health') return send(200, { ok: true });
    if (path.endsWith('/embeddings')) {
      // A 400 is not retried by the SDK, so the failure surfaces at once.
      if (embeddingBudget-- <= 0)
        return send(400, { error: { message: 'Scripted embeddings failure.' } });
      const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
      return send(200, {
        object: 'list',
        model: body.model,
        data: inputs.map((text, index) => ({
          object: 'embedding',
          index,
          embedding: vectors.get(text) ?? fakeEmbedding(text, body.dimensions),
        })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
      });
    }
    if (path.endsWith('/responses')) {
      const turn = turns.shift() ?? options.policy?.(body);
      if (!turn) return send(500, { error: { message: 'No scripted model turn left.' } });
      if (!Array.isArray(turn)) return send(turn.status, { error: { message: turn.error } });
      return send(200, {
        id: id('resp'),
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model: body.model,
        output: turn,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      });
    }
    send(404, { error: { message: `Fake OpenAI has no route ${path}` } });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.OPENAI_BASE_URL = url;
  process.env.OPENAI_API_KEY = 'test-key';
  return {
    url,
    requests,
    script: (...next) => turns.push(...next),
    embed: (text, vector) => vectors.set(text, vector),
    failEmbeddingsAfter: (succeeding) => {
      embeddingBudget = succeeding;
    },
    reset: () => {
      embeddingBudget = Infinity;
      turns.length = 0;
      vectors.clear();
      requests.length = 0;
    },
    close: () =>
      new Promise((resolve) => {
        process.env.OPENAI_API_KEY = '';
        delete process.env.OPENAI_BASE_URL;
        server.close(() => resolve());
      }),
  };
}
