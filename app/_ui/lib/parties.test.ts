import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeParty, destinationNote } from './parties';

describe('describeParty', () => {
  it('should name a contact by holder, label and masked IBAN', () => {
    // Arrange
    const party = { holder: 'Bruno Vidal', label: 'Horizon account', iban: 'ES91 ···· 0002' };
    // Act
    const text = describeParty(party);
    // Assert
    assert.equal(text, 'Bruno Vidal · Horizon account (ES91 ···· 0002)');
  });

  it('should name an own account by label and masked IBAN', () => {
    // Arrange
    const party = { label: 'Aurora account', iban: 'ES91 ···· 0001', own: true };
    // Act
    const text = describeParty(party);
    // Assert
    assert.equal(text, 'Aurora account (ES91 ···· 0001)');
  });

  it('should name an account with no IBAN by its label alone', () => {
    // Arrange
    const party = { label: 'Unknown account', iban: null, own: null };
    // Act
    const text = describeParty(party);
    // Assert
    assert.equal(text, 'Unknown account');
  });
});

describe('destinationNote', () => {
  it('should mark a contact as another person', () => {
    // Arrange
    const party = { label: 'Horizon account', iban: null, own: false };
    // Act
    const note = destinationNote(party);
    // Assert
    assert.equal(note, ' · another person');
  });

  it('should mark an account the bank does not list as not found', () => {
    // Arrange
    const party = { label: 'Unknown account', iban: null, own: null };
    // Act
    const note = destinationNote(party);
    // Assert
    assert.equal(note, ' · account not found');
  });

  it("should add nothing for one of the customer's own accounts", () => {
    // Arrange
    const party = { label: 'Personal savings', iban: null, own: true };
    // Act
    const note = destinationNote(party);
    // Assert
    assert.equal(note, '');
  });
});
