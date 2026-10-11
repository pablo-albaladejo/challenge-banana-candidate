import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { caseDateOf, eur, longDate, madridDate } from './case-format';

describe('eur', () => {
  it('should write cents as euros with two decimals and thousands separators', () => {
    // Arrange
    const cents = 175000;
    // Act
    const written = eur(cents);
    // Assert
    assert.equal(written, 'EUR 1,750.00');
  });

  it('should keep the cents of an amount below one euro', () => {
    // Arrange
    const cents = 5;
    // Act
    const written = eur(cents);
    // Assert
    assert.equal(written, 'EUR 0.05');
  });
});

describe('madridDate', () => {
  it('should give the calendar date in Madrid, not in UTC', () => {
    // Arrange
    const lateUtc = '2026-09-23T22:30:00.000Z';
    // Act
    const day = madridDate(lateUtc);
    // Assert
    assert.equal(day, '2026-09-24');
  });
});

describe('longDate', () => {
  it('should write the Madrid calendar date in words', () => {
    // Arrange
    const at = '2026-09-23T16:41:12.000Z';
    // Act
    const written = longDate(at);
    // Assert
    assert.equal(written, '23 September 2026');
  });
});

describe('caseDateOf', () => {
  it('should judge a case opened before the reference date on its own date', () => {
    // Arrange
    const openedAt = '2026-09-23T16:40:00.000Z';
    // Act
    const day = caseDateOf(openedAt);
    // Assert
    assert.equal(day, '2026-09-23');
  });

  it('should judge a case opened after the reference date on the reference date', () => {
    // Arrange
    const openedAt = '2026-10-11T09:00:00.000Z';
    // Act
    const day = caseDateOf(openedAt);
    // Assert
    assert.equal(day, '2026-09-24');
  });
});
