import type { AnyRecord } from './api';
import { money } from './format';
/** Proposals awaiting the customer's confirmation; shown on every tab. */
export function ApprovalsPanel({
  approvals,
  onConfirm,
}: {
  approvals: AnyRecord[];
  onConfirm: (id: string) => void;
}) {
  return (
    <section className="panel approvals">
      <h2>Proposals awaiting confirmation</h2>
      {approvals.map((a: AnyRecord) => (
        <div key={a.id}>
          <p>
            <strong>{money(a.payload.amountCents)}</strong> · {a.payload.fromAccountId} →{' '}
            {a.payload.toAccountId}
          </p>
          <p>{a.payload.concept}</p>
          <button className="primary-button" onClick={() => onConfirm(a.id)}>
            Confirm these details
          </button>
        </div>
      ))}
    </section>
  );
}
