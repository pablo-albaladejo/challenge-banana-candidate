import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyClaim } from './claim-verification';
import { regexClaims } from './regex-claims';
import type { Claim } from './claims';
import {
  amountClaimFactory,
  caseEvidenceFactory,
  evidenceIntentFactory,
  evidenceMessageFactory,
  policyClaimFactory,
  statusClaimFactory,
  windowOperationFactory,
} from '../../../tests/fixtures/factories';
import { accounts, historicTransfer } from '../../../tests/fixtures/world';

describe('verifyClaim', () => {
  it('should contradict a not-completed claim with the operation the bank booked', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build();
    // Act
    const verdict = verifyClaim(statusClaimFactory.build({ status: 'not_completed' }), evidence);
    // Assert
    assert.equal(verdict.verdict, 'contradicted');
    assert.equal(verdict.reason, 'contradicted_by_operation');
    assert.deepEqual(verdict.verdict === 'contradicted' && verdict.evidence.map((e) => e.id), [
      historicTransfer.intentId,
      historicTransfer.operationId,
    ]);
  });

  it('should verify a completed claim against an operation no intent holds', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [],
      allOperations: [windowOperationFactory.build({ linkedIntentId: null })],
    });
    // Act
    const verdict = verifyClaim(statusClaimFactory.build({ status: 'completed' }), evidence);
    // Assert
    assert.equal(verdict.verdict, 'verified');
    assert.equal(verdict.reason, 'matches_operation');
  });

  it('should leave a claim unverifiable when nothing in the case is about a transfer', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({ intents: [], allOperations: [] });
    // Act
    const verdict = verifyClaim(statusClaimFactory.build({ status: 'not_completed' }), evidence);
    // Assert
    assert.equal(verdict.verdict, 'unverifiable');
    assert.equal(verdict.reason, 'no_subject_found');
  });

  it('should report an unreachable bank instead of trusting a stored failed status', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({ allOperations: null, accounts: null });
    // Act
    const verdict = verifyClaim(statusClaimFactory.build({ status: 'not_completed' }), evidence);
    // Assert
    assert.equal(verdict.verdict, 'unverifiable');
    assert.equal(verdict.reason, 'bank_unreachable');
  });

  it('should report an unreachable bank when no intent could stand in for its operations', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({ intents: [], allOperations: null });
    // Act
    const verdict = verifyClaim(statusClaimFactory.build({ status: 'completed' }), evidence);
    // Assert
    assert.equal(verdict.reason, 'bank_unreachable');
  });

  it('should leave the claim unverifiable while the bank has not confirmed the outcome', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [evidenceIntentFactory.build({ status: 'unknown' })],
      allOperations: [],
    });
    // Act
    const verdict = verifyClaim(statusClaimFactory.build({ status: 'not_completed' }), evidence);
    // Assert
    assert.equal(verdict.reason, 'outcome_unknown');
  });

  it('should verify a not-completed claim on a transfer that was never sent', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [
        evidenceIntentFactory.build({ status: 'requires_confirmation', bank_reference: null }),
      ],
      allOperations: [],
    });
    // Act
    const verdict = verifyClaim(statusClaimFactory.build({ status: 'not_completed' }), evidence);
    // Assert
    assert.equal(verdict.verdict, 'verified');
    assert.equal(verdict.reason, 'never_dispatched');
  });

  it('should contradict an amount the booked operation does not match', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build();
    const claim = amountClaimFactory.build({
      amountCents: 9000,
      quote: 'Your transfer of EUR 90 was completed.',
    });
    // Act
    const verdict = verifyClaim(claim, evidence);
    // Assert
    assert.equal(verdict.verdict, 'contradicted');
    assert.equal(
      verdict.verdict === 'contradicted' && verdict.correctFactId,
      `amount:${historicTransfer.operationId}`,
    );
  });

  it('should verify a reference one of the customer transfers holds', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build();
    const claim: Claim = {
      ...statusClaimFactory.build(),
      kind: 'reference',
      reference: historicTransfer.reference,
    };
    // Act
    const verdict = verifyClaim(claim, evidence);
    // Assert
    assert.equal(verdict.verdict, 'verified');
  });

  it('should leave a reference no transfer holds unverifiable', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build();
    const claim: Claim = {
      ...statusClaimFactory.build(),
      kind: 'reference',
      reference: 'ref-made-up',
    };
    // Act
    const verdict = verifyClaim(claim, evidence);
    // Assert
    assert.equal(verdict.reason, 'no_subject_found');
  });

  it('should judge the Aurora fee as conditional and name the salary the ledger shows', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      movements: [
        {
          id: 'movement-carla-0',
          accountId: accounts.carla,
          amountCents: 175000,
          description: 'September salary',
          createdAt: '2026-09-02T10:00:00.000Z',
        },
      ],
    });
    // Act
    const verdict = verifyClaim(
      policyClaimFactory.build({ policy: 'monthly_fee', product: 'aurora', amountCents: 600 }),
      evidence,
    );
    // Assert
    assert.equal(verdict.verdict, 'unverifiable');
    assert.equal(verdict.reason, 'conditional_policy');
    assert.match(
      verdict.verdict === 'unverifiable' ? verdict.detail : '',
      /holds \(EUR 1,750\.00 received, movement-carla-0\)/,
    );
  });

  it('should contradict a fee the policy in force does not state', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build();
    // Act
    const verdict = verifyClaim(
      policyClaimFactory.build({ policy: 'monthly_fee', product: 'horizon', amountCents: 400 }),
      evidence,
    );
    // Assert
    assert.equal(verdict.reason, 'contradicted_by_policy');
  });

  it('should verify a transfer limit the policy states', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build();
    // Act
    const verdict = verifyClaim(
      policyClaimFactory.build({
        policy: 'per_transfer_limit',
        product: null,
        amountCents: 10_000_000,
      }),
      evidence,
    );
    // Assert
    assert.equal(verdict.reason, 'matches_policy');
  });

  it('should contradict a referral reward the documentation never publishes', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build();
    // Act
    const verdict = verifyClaim(
      policyClaimFactory.build({ policy: 'referral_reward', product: null, amountCents: 3000 }),
      evidence,
    );
    // Assert
    assert.equal(verdict.verdict, 'contradicted');
    assert.equal(verdict.reason, 'policy_unpublished');
  });
});

describe('verifyClaim on the evidence the brief could not read', () => {
  it('should leave a pending claim unverifiable on a processing transfer while the bank is down', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [evidenceIntentFactory.build({ status: 'processing' })],
      allOperations: null,
      accounts: null,
    });
    // Act
    const verdict = verifyClaim(statusClaimFactory.build({ status: 'pending' }), evidence);
    // Assert
    assert.equal(verdict.verdict, 'unverifiable');
    assert.equal(verdict.reason, 'bank_unreachable');
  });

  it('should say the bank answered with an error when it refused the request', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      allOperations: null,
      accounts: null,
      bankFailure: 'refused',
    });
    // Act
    const verdict = verifyClaim(statusClaimFactory.build(), evidence);
    // Assert
    assert.deepEqual(verdict, {
      claimId: verdict.claimId,
      verdict: 'unverifiable',
      reason: 'bank_unreachable',
      detail: 'The bank answered with an error, so it could not be checked.',
    });
  });

  it("should name the unreachable bank when a fee claim needs the customer's product", () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({ allOperations: null, accounts: null });
    // Act
    const verdict = verifyClaim(policyClaimFactory.build({ product: null }), evidence);
    // Assert
    assert.equal(verdict.verdict, 'unverifiable');
    assert.equal(verdict.reason, 'bank_unreachable');
  });

  it('should cite the customer intent of another conversation that holds a reference', () => {
    // Arrange
    const evidence = caseEvidenceFactory.build({
      intents: [],
      allOperations: [],
      customerReferences: [{ id: 'intent-elsewhere', bank_reference: 'ref-elsewhere' }],
    });
    const claim: Claim = {
      ...statusClaimFactory.build(),
      kind: 'reference',
      reference: 'ref-elsewhere',
    };
    // Act
    const verdict = verifyClaim(claim, evidence);
    // Assert
    assert.deepEqual(verdict, {
      claimId: claim.id,
      verdict: 'verified',
      reason: 'matches_intent',
      evidence: [{ kind: 'intent', id: 'intent-elsewhere', citation: 'intent-elsewhere (app)' }],
    });
  });
});

describe('verifyClaim on pattern-matched claims', () => {
  /** The verdicts on what the assistant said in one message of the evidence's conversation. */
  const judge = (content: string, evidence = caseEvidenceFactory.build()) =>
    regexClaims([evidenceMessageFactory.build({ id: 'message-lucia-2', content })]).map((c) => {
      const v = verifyClaim(c, evidence);
      return [c.kind, v.verdict, v.reason];
    });
  /** Lucía's EUR 85 transfer stored as failed, with no bank operation in the window. */
  const failedOnly = () => caseEvidenceFactory.build({ allOperations: [] });

  it('should leave an ambiguous status claim unverifiable', () => {
    // Arrange
    const claim = statusClaimFactory.build({ status: 'ambiguous_status' });
    // Act
    const verdict = verifyClaim(claim, caseEvidenceFactory.build());
    // Assert
    assert.equal(verdict.verdict, 'unverifiable');
    assert.equal(verdict.reason, 'ambiguous_status');
  });

  it('should leave a negated failure unverifiable on a transfer the bank completed', () => {
    // Arrange
    const said = 'Your transfer has not failed.';
    // Act
    const verdicts = judge(said);
    // Assert
    assert.deepEqual(verdicts, [['operation_status', 'unverifiable', 'ambiguous_status']]);
  });

  it('should leave a negated failure unverifiable on a transfer stored as failed', () => {
    // Arrange
    const said = "Don't worry, your transfer hasn't failed; it is on its way.";
    // Act
    const verdicts = judge(said, failedOnly());
    // Assert
    assert.deepEqual(verdicts, [['operation_status', 'unverifiable', 'ambiguous_status']]);
  });

  it('should leave a hedged completion unverifiable instead of finding nothing', () => {
    // Arrange
    const said = 'The transfer has not yet been completed.';
    // Act
    const verdicts = judge(said);
    // Assert
    assert.deepEqual(verdicts, [['operation_status', 'unverifiable', 'ambiguous_status']]);
  });

  it('should contradict a contracted "not sent" with the operation the bank booked', () => {
    // Arrange
    const said = "The money wasn't sent.";
    // Act
    const verdicts = judge(said);
    // Assert
    assert.deepEqual(verdicts, [['operation_status', 'contradicted', 'contradicted_by_operation']]);
  });

  it('should leave a fee amount unverifiable rather than compare it with the transfer', () => {
    // Arrange
    const said = 'Your Aurora monthly fee is EUR 6.';
    // Act
    const verdicts = judge(said);
    // Assert
    assert.deepEqual(verdicts, [['amount', 'unverifiable', 'unanchored_amount']]);
  });

  it('should leave a balance unverifiable even when it equals the transfer amount', () => {
    // Arrange
    const said = 'Your balance is EUR 85.';
    // Act
    const verdicts = judge(said, failedOnly());
    // Assert
    assert.deepEqual(verdicts, [['amount', 'unverifiable', 'unanchored_amount']]);
  });

  it('should leave an amount with no transfer in the case unverifiable', () => {
    // Arrange
    const said = 'Your Aurora monthly fee is EUR 6.';
    // Act
    const verdicts = judge(said, caseEvidenceFactory.build({ intents: [], allOperations: [] }));
    // Assert
    assert.deepEqual(verdicts, [['amount', 'unverifiable', 'no_subject_found']]);
  });

  it('should still judge an amount stated beside a transfer status', () => {
    // Arrange
    const said = `Your transfer ${historicTransfer.reference} of EUR 90 was completed.`;
    // Act
    const verdicts = judge(said);
    // Assert
    assert.deepEqual(
      verdicts.find(([kind]) => kind === 'amount'),
      ['amount', 'contradicted', 'contradicted_by_operation'],
    );
  });

  it('should leave an amount no transfer of the case has unverifiable even beside a status', () => {
    // Arrange
    const said = 'Your transfer of EUR 90 was completed.';
    // Act
    const verdicts = judge(said);
    // Assert
    assert.deepEqual(verdicts, [
      ['amount', 'unverifiable', 'no_subject_found'],
      ['operation_status', 'unverifiable', 'no_subject_found'],
    ]);
  });
});

/** The four evidence states a pattern-matched sentence is judged against (lucia's EUR 85 transfer). */
const STATES = {
  completed: () => caseEvidenceFactory.build(),
  failed: () => caseEvidenceFactory.build({ allOperations: [] }),
  processing: () =>
    caseEvidenceFactory.build({
      intents: [evidenceIntentFactory.build({ status: 'processing' })],
      allOperations: [],
    }),
  requiresConfirmation: () =>
    caseEvidenceFactory.build({
      intents: [
        evidenceIntentFactory.build({ status: 'requires_confirmation', bank_reference: null }),
      ],
      customerReferences: [],
      allOperations: [],
    }),
};
type State = keyof typeof STATES;
const SYMBOL = { verified: '✅', contradicted: '❌', unverifiable: '⚪' } as const;
/** Each regex claim of `content` as `kind symbol reason`, judged in one evidence state. */
const verdictsIn = (state: State, content: string) => {
  const evidence = STATES[state]();
  return regexClaims([evidenceMessageFactory.build({ id: 'message-lucia-2', content })]).map(
    (c) => {
      const v = verifyClaim(c, evidence);
      return `${c.kind === 'operation_status' ? 'status' : c.kind} ${SYMBOL[v.verdict]} ${v.reason}`;
    },
  );
};
/** The same expected verdicts in every state. */
const everywhere = (...expected: string[]): Record<State, string[]> => ({
  completed: expected,
  failed: expected,
  processing: expected,
  requiresConfirmation: expected,
});
/** A terminal failure: false once booked or still processing, true when failed or never sent. */
const terminalFailure = {
  completed: ['status ❌ contradicted_by_operation'],
  failed: ['status ✅ matches_intent'],
  processing: ['status ❌ contradicted_by_intent'],
  requiresConfirmation: ['status ✅ never_dispatched'],
};
/** A completion: true only once the bank booked it. */
const completion = (before: string[] = [], after: string[] = []) => ({
  completed: [...before, 'status ✅ matches_operation', ...after],
  failed: [...before, 'status ❌ contradicted_by_intent', ...after],
  processing: [...before, 'status ❌ contradicted_by_intent', ...after],
  requiresConfirmation: [...before, 'status ❌ contradicted_by_intent', ...after],
});
const ref = historicTransfer.reference;
const AMBIGUOUS = [
  'The transfer will be completed once you confirm.',
  'Your transfer is pending your confirmation.',
  'When it has been sent, you will get a notification.',
  "I can't confirm whether your transfer was completed.",
  "I don't know if it completed yet.",
  'I cannot tell you whether it went through.',
  'If the transfer failed, you will get the money back.',
  'Your transfer failed? Let me check.',
  'Has your transfer completed?',
  "It's not true that it hasn't been sent.",
  "Your transfer hasn't failed.",
  'Your transfer has not failed; it is on its way.',
  "Don't worry, your transfer hasn't failed; it is on its way.",
  'The payment is not pending anymore.',
  "It isn't pending.",
  'The transfer has not yet been completed.',
  'The transfer has not been completed.',
  "It hasn't been sent.",
  'It has never been completed.',
  'It has not been sent yet.',
  'Once you have completed the confirmation, it will be sent.',
  'Once completed, you will see it in your activity.',
];
const SENTENCES: [string, Record<State, string[]>][] = [
  // The seeded cases' own sentences (lucia, elena, diego, carla, ines).
  ['I could not complete the transfer. You can try again.', terminalFailure],
  ['Transfer completed.', completion()],
  ['The operation could not be completed.', terminalFailure],
  ['The Aurora monthly fee is EUR 6.', everywhere('amount ⚪ unanchored_amount')],
  ['It is common to receive EUR 30 for a referral.', everywhere('amount ⚪ unanchored_amount')],
  // Review probes.
  ["Your transfer wasn't completed.", terminalFailure],
  ["Sorry, your transfer wasn't completed.", terminalFailure],
  [
    'Your transfer of EUR 85 to Bruno went through, and remember the Aurora fee is EUR 6.',
    {
      completed: [
        'amount ✅ matches_operation',
        'status ✅ matches_operation',
        'amount ⚪ unanchored_amount',
      ],
      failed: [
        'amount ✅ matches_intent',
        'status ❌ contradicted_by_intent',
        'amount ⚪ unanchored_amount',
      ],
      processing: [
        'amount ✅ matches_intent',
        'status ❌ contradicted_by_intent',
        'amount ⚪ unanchored_amount',
      ],
      requiresConfirmation: [
        'amount ✅ matches_intent',
        'status ❌ contradicted_by_intent',
        'amount ⚪ unanchored_amount',
      ],
    },
  ],
  [
    'Your monthly fee of EUR 6 is pending.',
    everywhere('amount ⚪ unanchored_amount', 'status ⚪ no_subject_found'),
  ],
  [
    `Your fee is EUR 6 (${ref}).`,
    {
      completed: ['amount ⚪ unanchored_amount', 'reference ✅ matches_operation'],
      failed: ['amount ⚪ unanchored_amount', 'reference ✅ matches_intent'],
      processing: ['amount ⚪ unanchored_amount', 'reference ✅ matches_intent'],
      requiresConfirmation: ['amount ⚪ unanchored_amount', 'reference ⚪ no_subject_found'],
    },
  ],
  [
    'Your previous EUR 6 payment failed, but the EUR 85 transfer completed.',
    {
      completed: [
        'amount ⚪ no_subject_found',
        'status ⚪ no_subject_found',
        'amount ✅ matches_operation',
        'status ✅ matches_operation',
      ],
      failed: [
        'amount ⚪ no_subject_found',
        'status ⚪ no_subject_found',
        'amount ✅ matches_intent',
        'status ❌ contradicted_by_intent',
      ],
      processing: [
        'amount ⚪ no_subject_found',
        'status ⚪ no_subject_found',
        'amount ✅ matches_intent',
        'status ❌ contradicted_by_intent',
      ],
      requiresConfirmation: [
        'amount ⚪ no_subject_found',
        'status ⚪ no_subject_found',
        'amount ✅ matches_intent',
        'status ❌ contradicted_by_intent',
      ],
    },
  ],
  ...AMBIGUOUS.map((s): [string, Record<State, string[]>] => [
    s,
    everywhere('status ⚪ ambiguous_status'),
  ]),
  [
    'Your EUR 85 transfer was not rejected.',
    everywhere('amount ⚪ unanchored_amount', 'status ⚪ ambiguous_status'),
  ],
  ["It wasn't sent.", everywhere('status ⚪ no_subject_found')],
  ['Your identity verification is pending.', everywhere('status ⚪ no_subject_found')],
  ['Your card activation failed.', everywhere('status ⚪ no_subject_found')],
  [
    'Good news: your transfer did not fail, it went through.',
    everywhere('status ⚪ ambiguous_status'),
  ],
  ['Your Aurora monthly fee is EUR 6.', everywhere('amount ⚪ unanchored_amount')],
  ['Your balance is EUR 85.', everywhere('amount ⚪ unanchored_amount')],
  ['Your balance is EUR 4,007.50.', everywhere('amount ⚪ unanchored_amount')],
  [
    'Your Aurora monthly fee is EUR 6, and your transfer was completed.',
    completion(['amount ⚪ unanchored_amount']),
  ],
  [
    `The reference is ${ref}.`,
    {
      completed: ['reference ✅ matches_operation'],
      failed: ['reference ✅ matches_intent'],
      processing: ['reference ✅ matches_intent'],
      requiresConfirmation: ['reference ⚪ no_subject_found'],
    },
  ],
  ['Reference ref-zzz.', everywhere('reference ⚪ no_subject_found')],
  [
    'Your transfer of EUR 90 was completed.',
    everywhere('amount ⚪ no_subject_found', 'status ⚪ no_subject_found'),
  ],
  [
    `Your transfer ${ref} of EUR 90 was completed.`,
    {
      completed: [
        'reference ✅ matches_operation',
        'amount ❌ contradicted_by_operation',
        'status ✅ matches_operation',
      ],
      failed: [
        'reference ✅ matches_intent',
        'amount ❌ contradicted_by_intent',
        'status ❌ contradicted_by_intent',
      ],
      processing: [
        'reference ✅ matches_intent',
        'amount ❌ contradicted_by_intent',
        'status ❌ contradicted_by_intent',
      ],
      requiresConfirmation: [
        'reference ⚪ no_subject_found',
        'amount ⚪ no_subject_found',
        'status ⚪ no_subject_found',
      ],
    },
  ],
  [
    'Your transfer of EUR 85 is pending.',
    {
      completed: ['amount ✅ matches_operation', 'status ❌ contradicted_by_operation'],
      failed: ['amount ✅ matches_intent', 'status ❌ contradicted_by_intent'],
      processing: ['amount ✅ matches_intent', 'status ✅ matches_intent'],
      requiresConfirmation: ['amount ✅ matches_intent', 'status ❌ contradicted_by_intent'],
    },
  ],
];

describe('verifyClaim on pattern-matched sentences in each evidence state', () => {
  for (const [sentence, expected] of SENTENCES)
    for (const state of Object.keys(STATES) as State[])
      it(`should judge ${JSON.stringify(sentence)} on a ${state} transfer as ${expected[state].join(', ')}`, () => {
        // Arrange
        const content = sentence;
        // Act
        const verdicts = verdictsIn(state, content);
        // Assert
        assert.deepEqual(verdicts, expected[state]);
      });
});

describe('verifyClaim on every combination of the whitelisted shape', () => {
  // Each sentence varies one whitelist condition at a time: the transfer noun, a hedge before the
  // phrase, a negation in the clause, a question, and the amount against lucia's EUR 85 transfer.
  const combinations = [
    ['was completed', 'failed', 'is pending'].flatMap((phrase) =>
      ['transfer', 'card'].flatMap((noun) =>
        ['', 'I expect '].flatMap((hedge) =>
          ['', ' with no delay'].flatMap((negation) =>
            ['.', '?'].flatMap((end) =>
              [85, 6].map((euros) => ({
                sentence: `${hedge}your ${noun} of EUR ${euros} ${phrase}${negation}${end}`,
                whitelisted:
                  noun === 'transfer' && !hedge && !negation && end === '.' && euros === 85,
              })),
            ),
          ),
        ),
      ),
    ),
  ].flat();

  it('should judge an amount or a status only when its clause has the whitelisted shape', () => {
    // Arrange
    const judgedOutside: string[] = [];
    const unjudgedInside: string[] = [];
    // Act
    for (const { sentence, whitelisted } of combinations)
      for (const state of Object.keys(STATES) as State[])
        for (const verdict of verdictsIn(state, sentence)) {
          const judged = !verdict.includes('⚪');
          if (judged && !whitelisted) judgedOutside.push(`${state}: ${sentence} → ${verdict}`);
          if (!judged && whitelisted) unjudgedInside.push(`${state}: ${sentence} → ${verdict}`);
        }
    // Assert
    assert.equal(combinations.length, 96);
    assert.deepEqual(judgedOutside, []);
    assert.deepEqual(unjudgedInside, []);
  });
});
