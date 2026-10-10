import type { AnyRecord } from '../lib/api';
import { money } from '../lib/format';
/** Transfers still being checked with the bank, or recently not executed; shown on every tab. */
export function TransferChecksPanel({ transfers }: { transfers: AnyRecord[] }) {
  return (
    <section className="panel approvals" role="status" aria-live="polite">
      <h2>Recent transfer checks</h2>
      {transfers.map((t: AnyRecord) => (
        <div key={t.id}>
          <p>
            <strong>{money(t.payload.amountCents)}</strong> · {t.payload.fromAccountId} →{' '}
            {t.payload.toAccountId}
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
