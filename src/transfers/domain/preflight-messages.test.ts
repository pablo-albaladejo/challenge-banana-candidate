import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eur, preflightMessages, timeOf } from './preflight-messages';

describe('eur', () => {
  it('should write cents as euros with thousands separators and two decimals', () => {
    // Arrange
    const cents = [380_750, 8_500, 0, 10_000_000];
    // Act
    const written = cents.map(eur);
    // Assert
    assert.deepEqual(written, ['EUR 3,807.50', 'EUR 85.00', 'EUR 0.00', 'EUR 100,000.00']);
  });
});

describe('timeOf', () => {
  it('should write a timestamp as a 24-hour time in Europe/Madrid', () => {
    // Arrange
    const summer = '2026-09-24T14:05:00.000Z';
    const winter = '2026-12-01T14:05:00.000Z';
    // Act
    const written = [timeOf(summer), timeOf(winter)];
    // Assert
    assert.deepEqual(written, ['16:05', '15:05']);
  });
});

describe('preflightMessages', () => {
  it('should state the shortfall of a transfer larger than the balance', () => {
    // Arrange
    const [label, balance, short] = ['Horizon account', 7_500, 12_500];
    // Act
    const message = preflightMessages.balanceShort(label, balance, short);
    // Assert
    assert.equal(
      message,
      'Your Horizon account has EUR 75.00; this transfer would leave it EUR 125.00 short.',
    );
  });
  it('should state the balance left after the transfer', () => {
    // Arrange
    const [label, after] = ['Aurora account', 380_750];
    // Act
    const message = preflightMessages.balanceAfter(label, after);
    // Assert
    assert.equal(message, 'After this transfer, your Aurora account will have EUR 3,807.50.');
  });
  it('should limit the first-time claim to what the app knows', () => {
    // Arrange
    const name = 'Bruno Vidal';
    // Act
    const message = preflightMessages.firstTimeRecipient(name);
    // Assert
    assert.equal(
      message,
      "You have not sent money to Bruno Vidal through Banana Bank's app before. Check the account details.",
    );
  });
  it('should name the largest recent payment for an unusual amount', () => {
    // Arrange
    const largest = 8_500;
    // Act
    const message = preflightMessages.unusualAmount(largest);
    // Assert
    assert.equal(
      message,
      'This is larger than any payment from your accounts in your recent activity (largest EUR 85.00).',
    );
  });
  it('should say the amount was not compared when the history is missing', () => {
    // Arrange
    // Act
    const message = preflightMessages.historyUnavailable();
    // Assert
    assert.equal(
      message,
      'Your recent activity could not be loaded, so this amount was not compared with it.',
    );
  });
  it('should warn that sending past a pending twin may pay twice', () => {
    // Arrange
    const createdAt = '2026-09-24T08:41:00.000Z';
    // Act
    const message = preflightMessages.pendingTwin(createdAt);
    // Assert
    assert.equal(
      message,
      'An identical transfer from 10:41 is still being verified with the bank. You chose to send this one anyway; if both complete, you will pay twice.',
    );
  });
});
