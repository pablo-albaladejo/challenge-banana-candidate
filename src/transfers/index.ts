// Public surface of the transfers feature: other features import only from here.
export { transfers, type TransfersApp } from './entry-points/dependencies';
export { confirmApproval } from './entry-points/http/confirm-approval';
export { transferMoneyTool } from './entry-points/tools/transfer-money.tool';
export { operationStatusTool } from './entry-points/tools/operation-status.tool';
export { transferMoney, transferSchema } from './entry-points/legacy';
