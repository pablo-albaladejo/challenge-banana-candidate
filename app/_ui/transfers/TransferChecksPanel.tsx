import type { AnyRecord } from '../lib/api';
import { money } from '../lib/format';
import { describeParty, destinationNote } from '../lib/parties';
/**
 * Transfers still being checked with the bank, or recently not executed; shown on every tab. Each
 * side is named from the dashboard's `parties`, never the internal account id (readiness P0-6).
 */
export function TransferChecksPanel({ transfers }: { transfers: AnyRecord[] }) {
  return (
    <section className="panel approvals" role="status" aria-live="polite">
      <h2>Recent transfer checks</h2>
      {transfers.map((t: AnyRecord) => (
        <div key={t.id}>
          <p>
            <strong>{money(t.payload.amountCents)}</strong> · From {describeParty(t.parties.from)} →
            To {describeParty(t.parties.to)}
            {destinationNote(t.parties.to)}
          </p>
          <p>{t.payload.concept}</p>
          <p>
            {t.status === 'completed'
              ? 'Completed'
              : t.status === 'failed'
                ? 'Not executed'
                : 'Checking with the bank'}
          </p>
        </div>
      ))}
    </section>
  );
}
