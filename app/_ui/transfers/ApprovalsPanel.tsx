import type { AnyRecord } from '../lib/api';
import { money } from '../lib/format';
import { PreflightChecks } from './PreflightChecks';
/**
 * Proposals awaiting the customer's confirmation; shown on every tab. A blocker check relabels the
 * button but keeps it enabled: the bank, not the card, decides on funds.
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
              <strong>{money(a.payload.amountCents)}</strong> · {a.payload.fromAccountId} →{' '}
              {a.payload.toAccountId}
            </p>
            <p>{a.payload.concept}</p>
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
