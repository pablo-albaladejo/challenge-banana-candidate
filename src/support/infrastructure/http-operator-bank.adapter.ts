import { contacts, movements, operatorCustomer } from '../../platform/bank/bank';
import { withBankFailure } from '../../platform/bank/with-bank-failure';
import type { OperatorBank } from '../application/ports/operator-bank';
/**
 * `GET /v1/operator/customer` signed as the operator (the bank answers it to operators only), and
 * the customer's contacts and movements with the server's credential. A bank error becomes a
 * `BankFailure`; anything else propagates.
 */
export const httpOperatorBank: OperatorBank = {
  customer: (operatorId, customerId) => withBankFailure(operatorCustomer(operatorId, customerId)),
  contactsOf: (customerId) => withBankFailure(contacts(customerId)),
  movementsOf: (customerId) => withBankFailure(movements(customerId)),
};
