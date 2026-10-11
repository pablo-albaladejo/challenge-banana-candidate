import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toolDefinitions } from '../legacy';
import { goldenToolDefinitions } from '../../../../tests/fixtures/tool-definitions';

describe('toolDefinitions', () => {
  it('should expose the core strict agent tools', () => {
    // Arrange
    const expected = [
      'list_accounts',
      'search_documents',
      'transfer_money',
      'operation_status',
      'request_human',
    ];
    // Act
    const names = toolDefinitions.map((t) => t.name);
    // Assert
    assert.ok(expected.every((name) => names.includes(name)));
    assert.ok(toolDefinitions.every((t) => t.strict === true && t.type === 'function'));
  });

  it('should keep the customer identity out of every tool parameter list', () => {
    // Arrange
    const identityFields = ['userId', 'user', 'actor', 'customerId'];
    // Act
    const parameterNames = toolDefinitions.flatMap((t) =>
      Object.keys((t.parameters as { properties: Record<string, unknown> }).properties),
    );
    // Assert
    assert.ok(parameterNames.every((name) => !identityFields.includes(name)));
  });

  it('should serialize exactly as the definitions the model received before the registry', () => {
    // Arrange
    const expected = JSON.stringify(goldenToolDefinitions);
    // Act
    const actual = JSON.stringify(toolDefinitions);
    // Assert
    assert.equal(actual, expected);
  });
});
