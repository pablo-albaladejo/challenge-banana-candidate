import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { people, person } from './people';
describe('people', () => {
  it('should list eight customers and two operators with unique ids', () => {
    // Arrange
    // Act
    const customers = people.filter((p) => p.role === 'customer').map((p) => p.id);
    const operators = people.filter((p) => p.role === 'operator').map((p) => p.id);
    // Assert
    assert.deepEqual(customers, [
      'lucia',
      'bruno',
      'carla',
      'diego',
      'elena',
      'hugo',
      'ines',
      'omar',
    ]);
    assert.deepEqual(operators, ['marta', 'pablo']);
    assert.equal(new Set(people.map((p) => p.id)).size, people.length);
  });
});
describe('person', () => {
  it('should resolve a known id to its roster entry', () => {
    // Arrange
    // Act
    const found = person('marta');
    // Assert
    assert.equal(found?.name, 'Marta Sanz');
    assert.equal(found?.role, 'operator');
  });
  it('should return undefined for an unknown id', () => {
    // Arrange
    // Act
    const found = person('mallory');
    // Assert
    assert.equal(found, undefined);
  });
});
