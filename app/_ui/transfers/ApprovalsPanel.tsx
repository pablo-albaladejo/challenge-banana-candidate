import type { AnyRecord } from '../lib/api';
import { money, time } from '../lib/format';
import { describeParty, destinationNote } from '../lib/parties';
import { PreflightChecks } from './PreflightChecks';
/**
 * Proposals awaiting the customer's confirmation; shown on every tab. Each side is named from
 * `parties` (label, holder, masked IBAN), never the internal account id; a contact destination is
 * marked "another person" and one the bank does not list "account not found" (readiness P0-6). A blocker
 * check relabels the button but keeps it enabled: the bank, not the card, decides on funds.
 */
export function ApprovalsPanel({
  approvals,
  onConfirm,
}: {
  approvals: AnyRecord[];
  onConfirm: (id: string) => void;
}) {
  return (
    <section className="panel approvals" aria-live="polite">
      <h2>Proposals awaiting confirmation</h2>
      {approvals.map((a: AnyRecord) => {
        const checks: AnyRecord[] = a.checks ?? [];
        const blocked = checks.some((c) => c.severity === 'blocker');
        return (
          <div key={a.id}>
            <p>
              <strong>{money(a.payload.amountCents)}</strong> · From {describeParty(a.parties.from)}{' '}
              → To {describeParty(a.parties.to)}
              {destinationNote(a.parties.to)}
            </p>
            <p>Description (free text, not checked by the bank): {a.payload.concept}</p>
            <p>Valid until {time(a.expires_at)}</p>
            <PreflightChecks checks={checks} />
            <button className="primary-button" onClick={() => onConfirm(a.id)}>
              {blocked ? 'Confirm these details anyway' : 'Confirm these details'}
            </button>
          </div>
        );
      })}
    </section>
  );
}
