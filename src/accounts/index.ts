// Public surface of the accounts feature: other features import only from here.
export { accounts, type AccountsApp } from './entry-points/dependencies';
export { listAccountsTool } from './entry-points/tools/list-accounts.tool';
export { dashboard } from './entry-points/http/dashboard';
