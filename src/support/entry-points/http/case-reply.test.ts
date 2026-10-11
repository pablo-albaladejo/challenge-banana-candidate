import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { replyAndClose } from './case-reply';
import { seedApp } from '../../../server/seed';
import { HttpError } from '../../../platform/http/http-error';
import { incidentRow } from '../../../../tests/support/db';
import { cases, operators } from '../../../../tests/fixtures/world';
import type { Person } from '../../../types';

// A session that says customer for an operator's id passes `ReplyAndCloseCase`'s own person check,
// so only the handler gate rejects it.
const customerSession: Person = {
  id: operators.marta,
  name: 'Marta',
  role: 'customer',
  initials: 'MA',
  color: '#000000',
};
const operatorRequired = (e: unknown) =>
  e instanceof HttpError && e.status === 403 && e.message === 'Operator role required.';

describe('replyAndClose handler', () => {
  beforeEach(() => seedApp());

  it('should reject a customer session before the body or the case is read', async () => {
    // Arrange
    const request = new Request('http://127.0.0.1/api/incidents/x/reply', {
      method: 'POST',
      body: 'not json',
    });
    const context = { request, params: { id: cases.lucia }, actor: customerSession };
    // Act & Assert
    await assert.rejects(async () => replyAndClose(context), operatorRequired);
  });

  it('should keep the case open when a customer session sends a valid acknowledged reply', async () => {
    // Arrange
    const request = new Request('http://127.0.0.1/api/incidents/x/reply', {
      method: 'POST',
      body: JSON.stringify({ content: 'Closing this.', acknowledgeUnverified: true }),
    });
    const context = { request, params: { id: cases.lucia }, actor: customerSession };
    // Act
    await Promise.resolve()
      .then(() => replyAndClose(context))
      .catch(() => undefined);
    // Assert
    assert.equal(incidentRow(cases.lucia)?.status, 'open');
  });
});
