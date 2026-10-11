import type { AnyRecord } from './api';
/**
 * One side of a transfer as the dashboard names it (`parties`, readiness P0-6): "holder · label
 * (masked IBAN)", each part only when present. Never the internal account id.
 */
export const describeParty = (p: AnyRecord) =>
  `${p.holder ? `${p.holder} · ` : ''}${p.label}${p.iban ? ` (${p.iban})` : ''}`;
/**
 * What a card adds after the destination: " · another person" for a contact (`own: false`),
 * " · account not found" when the bank lists neither (`own: null`), nothing for an own account.
 */
export const destinationNote = (p: AnyRecord) =>
  p.own === false ? ' · another person' : p.own === null ? ' · account not found' : '';
