import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { incidentDetail, listIncidents } from './incidents';
import { seedApp } from '../../server/seed';
import { HttpError } from '../../platform/http/http-error';
import { cases, operators } from '../../../tests/fixtures/world';
import type { Person } from '../../types';

// The session role is what the handler gates on. An actor whose session says customer but whose id
// is an operator's passes `caseDetail`'s own person check, so only the handler gate rejects it.
const customerSession: Person = {
  id: operators.marta,
  name: 'Marta',
  role: 'customer',
  initials: 'MA',
  color: '#000000',
};
const request = new Request('http://127.0.0.1/api/incidents');
const operatorRequired = (e: unknown) =>
  e instanceof HttpError && e.status === 403 && e.message === 'Operator role required.';

describe('incidents handlers', () => {
  beforeEach(() => seedApp());

  it('should reject a customer session on the case detail before the case is read', async () => {
    // Arrange
    const context = { request, params: { id: cases.lucia }, actor: customerSession };
    // Act & Assert
    await assert.rejects(async () => incidentDetail(context), operatorRequired);
  });

  it('should reject a customer session on the case list', () => {
    // Arrange
    const context = { request, params: {}, actor: customerSession };
    // Act & Assert
    assert.throws(() => listIncidents(context), operatorRequired);
  });
});
