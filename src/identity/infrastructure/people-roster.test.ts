import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { people, person } from './people-roster';
import { identity } from '../entry-points/dependencies';
import { customers } from '../../../tests/fixtures/world';
import type { Person } from '../../types';
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
  it('should keep every person with the same name, role, initials and color, in order', () => {
    // Arrange
    // Act
    const roster = people;
    // Assert
    assert.deepEqual(roster, [
      { id: 'lucia', name: 'Lucía Martín', role: 'customer', initials: 'LM', color: '#a6b5fa' },
      { id: 'bruno', name: 'Bruno Vidal', role: 'customer', initials: 'BV', color: '#a4d9bc' },
      { id: 'carla', name: 'Carla Ríos', role: 'customer', initials: 'CR', color: '#edc18e' },
      { id: 'diego', name: 'Diego Salas', role: 'customer', initials: 'DS', color: '#bcb0ea' },
      { id: 'elena', name: 'Elena Costa', role: 'customer', initials: 'EC', color: '#99cbd7' },
      { id: 'hugo', name: 'Hugo Pérez', role: 'customer', initials: 'HP', color: '#dbb3bf' },
      { id: 'ines', name: 'Inés López', role: 'customer', initials: 'IL', color: '#c2d49d' },
      { id: 'omar', name: 'Omar León', role: 'customer', initials: 'OL', color: '#c0c7ce' },
      { id: 'marta', name: 'Marta Sanz', role: 'operator', initials: 'MS', color: '#acd5cc' },
      { id: 'pablo', name: 'Pablo Gil', role: 'operator', initials: 'PG', color: '#c3b8e6' },
    ]);
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
describe('roster immutability', () => {
  it('should reject changing a person or the roster, keeping every lookup intact', () => {
    // Arrange
    const lucia = person(customers.lucia) as Person;
    // Act & Assert
    assert.throws(() => {
      lucia.role = 'operator';
    }, TypeError);
    assert.throws(() => (people as Person[]).push({ ...lucia, id: 'mallory' }), TypeError);
    assert.throws(() => {
      (people as Person[])[0] = { ...lucia, role: 'operator' };
    }, TypeError);
    assert.equal(identity().findPerson({ id: customers.lucia })?.role, 'customer');
    assert.equal(identity().listPeople().length, 10);
  });
});
