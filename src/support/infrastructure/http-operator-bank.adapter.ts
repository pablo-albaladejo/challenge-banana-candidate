import { operatorCustomer } from '../../platform/bank/bank';
import type { OperatorBank } from '../application/ports/operator-bank';
/** `GET /v1/operator/customer`, signed as the operator; the bank answers it to operators only. */
export const httpOperatorBank: OperatorBank = { customer: operatorCustomer };
