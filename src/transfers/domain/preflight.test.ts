import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import {
  FIRST_TIME_RECONCILE_LIMIT,
  firstTimeReconcileCandidates,
  preflightChecks,
  type PreflightCheck,
  type PreflightInput,
} from './preflight';
import {
  accountFactory,
  intentFactory,
  storedIntent,
  transferInputFactory,
} from '../../../tests/fixtures/factories';
import { accounts } from '../../../tests/fixtures/world';

/** The input every case starts from: lucia's main account, a contact, no history, no twin. */
const inputOf = (overrides: Partial<PreflightInput> = {}): PreflightInput => ({
  transfer: transferInputFactory.build(),
  accounts: [accountFactory.build()],
  contacts: [{ id: accounts.bruno, name: faker.person.fullName() }],
  intents: [],
  movements: [],
  overriddenTwin: null,
  asOf: new Date().toISOString(),
  ...overrides,
});
const checkOf = (checks: PreflightCheck[], id: PreflightCheck['id']) =>
  checks.find((c) => c.id === id);
/** A stored intent of the customer to `toAccountId` in `status`. */
const intentTo = (toAccountId: string, status: 'completed' | 'failed' | 'unknown' | 'processing') =>
  storedIntent(
    intentFactory.build({ status, payload: transferInputFactory.build({ toAccountId }) }),
  );
/** Outgoing payments of these amounts, as the bank lists them (negative cents). */
const paymentsOf = (amounts: number[]) => amounts.map((a) => ({ amountCents: -a }));

describe('preflightChecks', () => {
  describe('balance_after', () => {
    it('should inform the customer of the balance left after the transfer', () => {
      // Arrange
      const account = accountFactory.build({ balanceCents: 400_750 });
      const input = inputOf({
        accounts: [account],
        transfer: transferInputFactory.build({ amountCents: 20_000 }),
      });
      // Act
      const check = checkOf(preflightChecks(input), 'balance_after');
      // Assert
      assert.deepEqual(check, {
        id: 'balance_after',
        severity: 'info',
        message: 'After this transfer, your Aurora account will have EUR 3,807.50.',
        source: { kind: 'bank', what: 'balance', asOf: input.asOf },
      });
    });
    it('should inform the customer that a transfer of the whole balance leaves EUR 0.00', () => {
      // Arrange
      const account = accountFactory.build();
      const input = inputOf({
        accounts: [account],
        transfer: transferInputFactory.build({ amountCents: account.balanceCents }),
      });
      // Act
      const check = checkOf(preflightChecks(input), 'balance_after');
      // Assert
      assert.equal(check?.severity, 'info');
      assert.equal(check?.message, 'After this transfer, your Aurora account will have EUR 0.00.');
    });
    it('should block a transfer larger than the balance and name the shortfall', () => {
      // Arrange
      const account = accountFactory.build({ label: 'Horizon account', balanceCents: 7_500 });
      const input = inputOf({
        accounts: [account],
        transfer: transferInputFactory.build({ amountCents: 20_000 }),
      });
      // Act
      const check = checkOf(preflightChecks(input), 'balance_after');
      // Assert
      assert.equal(check?.severity, 'blocker');
      assert.equal(
        check?.message,
        'Your Horizon account has EUR 75.00; this transfer would leave it EUR 125.00 short.',
      );
    });
  });

  describe('first_time_recipient', () => {
    it('should leave out the first-time warning for a transfer between the customer own accounts', () => {
      // Arrange
      const savings = accountFactory.build({
        id: accounts.luciaSavings,
        label: 'Personal savings',
      });
      const input = inputOf({
        accounts: [accountFactory.build(), savings],
        transfer: transferInputFactory.build({ toAccountId: savings.id }),
      });
      // Act
      const checks = preflightChecks(input);
      // Assert
      assert.equal(checkOf(checks, 'first_time_recipient'), undefined);
    });
    it('should warn about a recipient the customer never paid through the app, naming the contact', () => {
      // Arrange
      const input = inputOf({ intents: [intentTo(accounts.carla, 'completed')] });
      // Act
      const check = checkOf(preflightChecks(input), 'first_time_recipient');
      // Assert
      assert.deepEqual(check, {
        id: 'first_time_recipient',
        severity: 'warning',
        message: `You have not sent money to ${input.contacts[0].name} through Banana Bank's app before. Check the account details.`,
        source: { kind: 'history', what: 'completed_transfers', sampleSize: 1 },
      });
    });
    it('should warn about a recipient whose only intents are failed, unknown or in flight', () => {
      // Arrange
      const input = inputOf({
        intents: [
          intentTo(accounts.bruno, 'failed'),
          intentTo(accounts.bruno, 'unknown'),
          intentTo(accounts.bruno, 'processing'),
        ],
      });
      // Act
      const check = checkOf(preflightChecks(input), 'first_time_recipient');
      // Assert
      assert.equal(check?.severity, 'warning');
      assert.deepEqual(check?.source, {
        kind: 'history',
        what: 'completed_transfers',
        sampleSize: 0,
      });
    });
    it('should name the recipient generically when the contact has no name', () => {
      // Arrange
      const input = inputOf({ contacts: [{ id: accounts.bruno }] });
      // Act
      const check = checkOf(preflightChecks(input), 'first_time_recipient');
      // Assert
      assert.equal(
        check?.message,
        "You have not sent money to this recipient through Banana Bank's app before. Check the account details.",
      );
    });
    it('should trust a recipient the customer already paid through the app', () => {
      // Arrange
      const input = inputOf({
        intents: [intentTo(accounts.bruno, 'failed'), intentTo(accounts.bruno, 'completed')],
      });
      // Act
      const checks = preflightChecks(input);
      // Assert
      assert.equal(checkOf(checks, 'first_time_recipient'), undefined);
    });
  });

  describe('unusual_amount', () => {
    it('should warn about an amount above three times the median and above the largest payment', () => {
      // Arrange: lucia's seeded history, H = {1175, 1350, 1525, 1700, 8500}.
      const input = inputOf({
        movements: [{ amountCents: 175_000 }, ...paymentsOf([1_175, 1_350, 1_525, 1_700, 8_500])],
        transfer: transferInputFactory.build({ amountCents: 20_000 }),
      });
      // Act
      const check = checkOf(preflightChecks(input), 'unusual_amount');
      // Assert
      assert.deepEqual(check, {
        id: 'unusual_amount',
        severity: 'warning',
        message:
          'This is larger than any payment from your accounts in your recent activity (largest EUR 85.00).',
        source: { kind: 'history', what: 'outgoing_movements', sampleSize: 5 },
      });
    });
    it('should accept any amount while fewer than three payments are known', () => {
      // Arrange
      const input = inputOf({
        movements: paymentsOf([100, 200]),
        transfer: transferInputFactory.build({ amountCents: 100_000 }),
      });
      // Act
      const checks = preflightChecks(input);
      // Assert
      assert.equal(checkOf(checks, 'unusual_amount'), undefined);
    });
    it('should accept an amount above three times the median that a past payment already exceeded', () => {
      // Arrange
      const input = inputOf({
        movements: paymentsOf([1_000, 1_000, 1_000, 50_000]),
        transfer: transferInputFactory.build({ amountCents: 10_000 }),
      });
      // Act
      const checks = preflightChecks(input);
      // Assert
      assert.equal(checkOf(checks, 'unusual_amount'), undefined);
    });
    it('should accept an amount above the largest payment but within three times the median', () => {
      // Arrange
      const input = inputOf({
        movements: paymentsOf([1_000, 1_000, 1_000]),
        transfer: transferInputFactory.build({ amountCents: 2_000 }),
      });
      // Act
      const checks = preflightChecks(input);
      // Assert
      assert.equal(checkOf(checks, 'unusual_amount'), undefined);
    });
    it('should take the floored mean of the two middle payments as the median of an even history', () => {
      // Arrange: median floor((200 + 301) / 2) = 250, so 751 > 750 warns; 250.5 would not.
      const input = inputOf({
        movements: paymentsOf([100, 200, 301, 400]),
        transfer: transferInputFactory.build({ amountCents: 751 }),
      });
      // Act
      const check = checkOf(preflightChecks(input), 'unusual_amount');
      // Assert
      assert.equal(check?.severity, 'warning');
      assert.deepEqual(check?.source, {
        kind: 'history',
        what: 'outgoing_movements',
        sampleSize: 4,
      });
    });
    it('should compare the amount with outgoing payments only', () => {
      // Arrange: incoming money is not a payment, so only three payments count.
      const input = inputOf({
        movements: [{ amountCents: 900_000 }, ...paymentsOf([1_000, 1_000, 1_000])],
        transfer: transferInputFactory.build({ amountCents: 5_000 }),
      });
      // Act
      const check = checkOf(preflightChecks(input), 'unusual_amount');
      // Assert
      assert.equal(check?.message.endsWith('(largest EUR 10.00).'), true);
    });
    it('should say the amount was not compared when the activity could not be loaded', () => {
      // Arrange
      const input = inputOf({ movements: null });
      // Act
      const checks = preflightChecks(input);
      // Assert
      assert.equal(checkOf(checks, 'unusual_amount'), undefined);
      assert.deepEqual(checkOf(checks, 'history_unavailable'), {
        id: 'history_unavailable',
        severity: 'info',
        message:
          'Your recent activity could not be loaded, so this amount was not compared with it.',
        source: { kind: 'bank', what: 'movements', asOf: input.asOf },
      });
    });
  });

  describe('pending_twin', () => {
    it('should warn that both transfers may complete when the customer sent past a pending twin', () => {
      // Arrange
      const input = inputOf({ overriddenTwin: { created_at: '2026-09-24T08:41:00.000Z' } });
      // Act
      const check = checkOf(preflightChecks(input), 'pending_twin');
      // Assert
      assert.deepEqual(check, {
        id: 'pending_twin',
        severity: 'warning',
        message:
          'An identical transfer from 10:41 is still being verified with the bank. You chose to send this one anyway; if both complete, you will pay twice.',
        source: { kind: 'safeguard', id: 'P0-4' },
      });
    });
    it('should leave out the pending-twin warning when no hold was overridden', () => {
      // Arrange
      const input = inputOf();
      // Act
      const checks = preflightChecks(input);
      // Assert
      assert.equal(checkOf(checks, 'pending_twin'), undefined);
    });
  });

  it('should list the checks in rule order: balance, recipient, amount, twin', () => {
    // Arrange
    const input = inputOf({
      accounts: [accountFactory.build({ balanceCents: 100 })],
      movements: null,
      overriddenTwin: { created_at: new Date().toISOString() },
    });
    // Act
    const checks = preflightChecks(input);
    // Assert
    assert.deepEqual(
      checks.map((c) => c.id),
      ['balance_after', 'first_time_recipient', 'history_unavailable', 'pending_twin'],
    );
  });
});

describe('firstTimeReconcileCandidates', () => {
  it('should pick the newest failed or unknown intents to the recipient, up to the limit', () => {
    // Arrange: newest first, as the repository lists them.
    const toBruno = [
      intentTo(accounts.bruno, 'failed'),
      intentTo(accounts.bruno, 'processing'),
      intentTo(accounts.bruno, 'unknown'),
      intentTo(accounts.bruno, 'failed'),
      intentTo(accounts.bruno, 'unknown'),
    ];
    const intents = [intentTo(accounts.carla, 'failed'), ...toBruno];
    // Act
    const ids = firstTimeReconcileCandidates(intents, accounts.bruno);
    // Assert
    assert.equal(ids.length, FIRST_TIME_RECONCILE_LIMIT);
    assert.deepEqual(ids, [toBruno[0].id, toBruno[2].id, toBruno[3].id]);
  });
  it('should reconcile nothing once a completed intent to the recipient exists', () => {
    // Arrange
    const intents = [intentTo(accounts.bruno, 'failed'), intentTo(accounts.bruno, 'completed')];
    // Act
    const ids = firstTimeReconcileCandidates(intents, accounts.bruno);
    // Assert
    assert.deepEqual(ids, []);
  });
});
