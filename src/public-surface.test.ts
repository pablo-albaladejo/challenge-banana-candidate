// Frozen import paths (plan §2): the simulator, scripts and external checks import these modules,
// so a refactor must keep each path and each named export. Type-only modules are checked to load.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const frozen: Record<string, string[]> = {
  './db': ['appDb', 'closeAppDb'],
  './config': ['config', 'referenceDate'],
  './auth': ['sign', 'equal', 'sessionToken', 'actor', 'sameOrigin', 'HttpError'],
  './people': ['people', 'person'],
  './types': [],
  './seed': ['seedApp'],
  './ingestion/pipeline': ['documents', 'readDocument', 'ingest', 'saveInitialIndex'],
  './retrieval/store': ['allChunks', 'replaceChunks', 'exportIndex', 'restoreIndex'],
  './retrieval/embeddings': [
    'dimensions',
    'vectorBuffer',
    'readVector',
    'embeddingKey',
    'MissingOpenAIKeyError',
    'openai',
    'embedTexts',
  ],
  './banking/client': ['bankRequest', 'BankError'],
  './banking/actions': ['transferMoney', 'transferSchema'],
  './agent/run': ['sendMessage', 'answerWithEvidence'],
  './agent/tools': ['toolDefinitions', 'runTool'],
  '../app/api/[...path]/route': ['GET', 'POST', 'runtime', 'dynamic'],
};
const configKeys = [
  'dataDir',
  'bankDataDir',
  'bankUrl',
  'bankPort',
  'appPort',
  'serviceSecret',
  'adminSecret',
  'sessionSecret',
  'chatModel',
  'embeddingModel',
  'bankTimeoutMs',
];

describe('public surface', () => {
  for (const [path, exports] of Object.entries(frozen))
    it(`should keep the exports of ${path}`, async () => {
      // Arrange
      // Act
      const loaded = await import(path);
      // Assert
      for (const name of exports) assert.notEqual(loaded[name], undefined, `${path} ${name}`);
    });
  it('should keep every configuration key', async () => {
    // Arrange
    const { config } = await import('./config');
    // Act
    const keys = Object.keys(config);
    // Assert
    assert.deepEqual(keys, configKeys);
  });
});
