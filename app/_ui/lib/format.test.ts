import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { date, money } from './format';

describe('money', () => {
  it('should format integer cents as euros with two decimals', () => {
    // Arrange
    const cents = 1234;
    // Act
    const text = money(cents);
    // Assert
    assert.equal(text, '€12.34');
  });
  it('should group thousands', () => {
    // Arrange
    const cents = 1234567;
    // Act
    const text = money(cents);
    // Assert
    assert.equal(text, '€12,345.67');
  });
  it('should keep the minus sign of a debit', () => {
    // Arrange
    const cents = -850;
    // Act
    const text = money(cents);
    // Assert
    assert.equal(text, '-€8.50');
  });
});

describe('date', () => {
  it('should show the day, short month and 24-hour time of a timestamp', () => {
    // Arrange
    const localTimestamp = '2026-09-24T09:05:00';
    // Act
    const text = date(localTimestamp);
    // Assert
    assert.match(text, /^24 Sept?, 09:05$/);
  });
});
