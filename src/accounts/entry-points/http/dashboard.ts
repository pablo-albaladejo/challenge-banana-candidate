import { support } from '../../../support';
import { json } from '../../../platform/http/respond';
import { accounts } from '../dependencies';
import type { Handler } from '../../../platform/http/context';
/**
 * `GET dashboard`: an operator gets the support workspace and the bank is never asked; a customer
 * gets their own overview. Both read the session actor only, never the request.
 */
export const dashboard: Handler = async ({ actor }) =>
  json(
    actor.role === 'operator'
      ? support().getOperatorWorkspace()
      : await accounts().getCustomerOverview({ userId: actor.id }),
  );
