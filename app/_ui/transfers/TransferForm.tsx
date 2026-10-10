import type { AnyRecord } from '../lib/api';
import { money } from '../lib/format';
import { Icon } from '../shell/Icon';
export function TransferForm({
  dashboard,
  from,
  to,
  amount,
  concept,
  busy,
  onFromChange,
  onToChange,
  onAmountChange,
  onConceptChange,
  onSubmit,
  onTab,
}: {
  dashboard: AnyRecord;
  from: string;
  to: string;
  amount: string;
  concept: string;
  busy: boolean;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onConceptChange: (value: string) => void;
  onSubmit: () => void;
  onTab: (tab: string) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">FROM ONE ACCOUNT TO ANOTHER</div>
          <h1>Transfers</h1>
          <p>Send money to another account in this environment.</p>
        </div>
      </div>
      <div className="transfer-layout">
        <form
          className="panel transfer-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <h2>Your transfer details</h2>
          <label>
            From account
            <select value={from} onChange={(e) => onFromChange(e.target.value)} required>
              {dashboard.accounts?.map((a: AnyRecord) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.id} · {money(a.balanceCents)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Recipient
            <select value={to} onChange={(e) => onToChange(e.target.value)} required>
              <option value="">Select an account</option>
              {dashboard.contacts?.map((a: AnyRecord) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.label} · {a.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount in euros
            <div className="amount-input">
              <input
                aria-label="Amount in euros"
                type="number"
                step="0.01"
                min="0.01"
                max="100000"
                required
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                placeholder="0.00"
              />
              <span>EUR</span>
            </div>
          </label>
          <label>
            Description
            <input
              value={concept}
              onChange={(e) => onConceptChange(e.target.value)}
              placeholder="What is this transfer for?"
              maxLength={200}
              required
            />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Processing…' : 'Send transfer'}
            <Icon name="arrow" />
          </button>
        </form>
        <aside className="transfer-note">
          <Icon name="transfer" />
          <h2>
            It is all in
            <br />
            your activity.
          </h2>
          <p>
            Check your activity to see the status of your transfers. If you have any questions, the
            assistant can help.
          </p>
          <button className="text-button" onClick={() => onTab('overview')}>
            View my accounts ↗
          </button>
        </aside>
      </div>
    </>
  );
}
