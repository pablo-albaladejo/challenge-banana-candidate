import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeOpenAICaseBriefModel, openaiCaseBriefModel } from './openai-case-brief.adapter';
import { EXTRACTION_INSTRUCTIONS } from './case-brief-prompts';
import { ModelUnavailable } from '../application/ports/case-brief-model';
import { reply, startFakeOpenAI, type FakeOpenAI } from '../../../tests/support/openai';
import { startFakeClaude, type FakeClaude } from '../../../tests/support/claude-cli';
import { caseEvidenceFactory, extractedClaimRowFactory } from '../../../tests/fixtures/factories';

const rejectsWith = (reason: string) => (e: unknown) => {
  assert.ok(e instanceof ModelUnavailable);
  assert.equal(e.reason, reason);
  return true;
};
const prose = {
  summary: 'The assistant was wrong.',
  nextStep: 'Confirm the transfer.',
  draftReply: 'Hello Lucía. Banana Bank support',
  usedFactIds: ['F1'],
};
const writeInput = () => ({
  firstName: 'Lucía',
  lastCustomerMessage: 'Could someone check?',
  facts: [],
  claims: [],
  verdicts: [],
  findings: [],
  procedures: [],
});
const extract = () => openaiCaseBriefModel.extractClaims(caseEvidenceFactory.build());

describe('openaiCaseBriefModel', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());

  it('should return the claim rows the model extracted', async () => {
    // Arrange
    const row = extractedClaimRowFactory.build();
    fake.script(reply(JSON.stringify({ claims: [row] })));
    // Act
    const rows = await extract();
    // Assert
    assert.deepEqual(rows, [row]);
  });

  it('should send the extraction prompt as instructions with the strict case_claims format', async () => {
    // Arrange
    fake.script(reply(JSON.stringify({ claims: [] })));
    // Act
    await extract();
    // Assert
    const body = fake.requests[0].body;
    assert.equal(body.instructions, EXTRACTION_INSTRUCTIONS);
    assert.equal(body.text.format.name, 'case_claims');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.store, false);
    assert.match(body.input[0].content, /<<<assistant id=message-lucia-2>>>/);
  });

  it('should return the prose the model wrote', async () => {
    // Arrange
    fake.script(reply(JSON.stringify(prose)));
    // Act
    const written = await openaiCaseBriefModel.writeBrief(writeInput());
    // Assert
    assert.deepEqual(written, prose);
    assert.equal(fake.requests[0].body.text.format.name, 'case_brief');
  });

  it('should report a missing key as missing_key', async () => {
    // Arrange
    const key = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    // Act & Assert
    try {
      await assert.rejects(extract(), rejectsWith('missing_key'));
    } finally {
      process.env.OPENAI_API_KEY = key;
    }
  });

  it('should report a provider error as model_error', async () => {
    // Arrange
    fake.script({ status: 500, error: 'Scripted outage.', code: 'server_error' });
    // Act & Assert
    await assert.rejects(extract(), rejectsWith('model_error'));
  });

  it('should report an answer that is not JSON as invalid_output', async () => {
    // Arrange
    fake.script(reply('Here are the claims: none.'));
    // Act & Assert
    await assert.rejects(extract(), rejectsWith('invalid_output'));
  });

  it('should report rows that break the schema as invalid_output', async () => {
    // Arrange
    fake.script(reply(JSON.stringify({ claims: [{ messageId: 'm1', verdict: 'verified' }] })));
    // Act & Assert
    await assert.rejects(extract(), rejectsWith('invalid_output'));
  });

  it('should report a draft reply too long to send as invalid_output', async () => {
    // Arrange
    fake.script(reply(JSON.stringify({ ...prose, draftReply: 'x'.repeat(2001) })));
    // Act & Assert
    await assert.rejects(
      openaiCaseBriefModel.writeBrief(writeInput()),
      rejectsWith('invalid_output'),
    );
  });

  it('should report a model that does not answer in time as model_error after one retry', async () => {
    // Arrange
    fake.script({ hang: true }, { hang: true });
    const model = makeOpenAICaseBriefModel({ timeoutMs: 50 });
    // Act & Assert
    await assert.rejects(
      model.extractClaims(caseEvidenceFactory.build()),
      rejectsWith('model_error'),
    );
    assert.equal(fake.requests.length, 2);
  });
});

describe('openaiCaseBriefModel under claude-cli', () => {
  let claude: FakeClaude;
  before(() => {
    claude = startFakeClaude();
  });
  after(() => claude.close());
  beforeEach(() => claude.reset());

  it('should give the prompt system authority and the fenced messages as data', async () => {
    // Arrange
    const provider = process.env.MODEL_PROVIDER;
    process.env.MODEL_PROVIDER = 'claude-cli';
    claude.script({ kind: 'result', structured: { claims: [] } });
    // Act
    try {
      await extract();
    } finally {
      process.env.MODEL_PROVIDER = provider;
    }
    // Assert
    const [call] = claude.calls();
    assert.ok(call.systemPrompt?.includes(EXTRACTION_INSTRUCTIONS));
    assert.ok(!call.stdin.includes('You extract factual claims'));
    assert.match(call.stdin, /<<<assistant id=message-lucia-2>>>/);
  });
});
