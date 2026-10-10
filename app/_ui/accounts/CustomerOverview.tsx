import type { Person } from '../../../src/types';
import type { AnyRecord } from '../lib/api';
import { date, money } from '../lib/format';
import { Icon } from '../shell/Icon';
export function CustomerOverview({
  current,
  dashboard,
  onTab,
}: {
  current: Person;
  dashboard: AnyRecord;
  onTab: (tab: string) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR DAY, A LITTLE BRIGHTER</div>
          <h1>
            Hello, {current.name.split(' ')[0]}
            <span className="hello-dot">.</span>
          </h1>
          <p>Your accounts at a glance. A helping hand when you need one.</p>
        </div>
        <span className="date-chip">24 September 2026</span>
      </div>
      <div className="account-grid">
        {dashboard.accounts?.map((a: AnyRecord, i: number) => (
          <section className={`account-card ${i === 0 ? 'primary-account' : ''}`} key={a.id}>
            <div className="account-top">
              <span>{a.label}</span>
              <span className="account-icon">↗</span>
            </div>
            <div className="balance-label">AVAILABLE BALANCE</div>
            <div className="balance">{money(a.balanceCents)}</div>
            <div className="account-bottom">
              <span>
                {a.iban.slice(0, 9)} ···· {a.iban.slice(-4)}
              </span>
              <span>EUR</span>
            </div>
          </section>
        ))}
        <section className="assistant-card">
          <div className="sparkle">✧</div>
          <h2>
            Your bank speaks <br />
            your language.
          </h2>
          <p>Check the details, move your money, or ask for help.</p>
          <button
            className="text-button"
            onClick={() => {
              onTab('chat');
            }}
          >
            Talk to the assistant <Icon name="arrow" />
          </button>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel movements">
          <div className="section-title">
            <h2>Recent activity</h2>
            <span>Latest transactions</span>
          </div>
          {dashboard.movements?.slice(0, 7).map((m: AnyRecord) => (
            <div className="movement" key={m.id}>
              <span className={`movement-icon ${m.amountCents > 0 ? 'positive' : ''}`}>
                {m.amountCents > 0 ? '↙' : '↗'}
              </span>
              <div>
                <strong>{m.description}</strong>
                <small>{date(m.createdAt)}</small>
              </div>
              <b className={m.amountCents > 0 ? 'credit' : ''}>
                {m.amountCents > 0 ? '+' : ''}
                {money(m.amountCents)}
              </b>
            </div>
          ))}
        </section>
        <div className="right-stack">
          <section className="quick-action">
            <span className="eyebrow">STRAIGHT TO IT</span>
            <h2>
              A transfer,
              <br />
              when you need one.
            </h2>
            <button className="primary-button" onClick={() => onTab('transfer')}>
              Make a transfer <Icon name="arrow" />
            </button>
          </section>
          <section className="support-card">
            <Icon name="help" />
            <h3>Here when you need us</h3>
            <p>Pick up a conversation or ask a person for help.</p>
            <button className="text-button" onClick={() => onTab('chat')}>
              Open my conversations <span>↗</span>
            </button>
          </section>
        </div>
      </div>
    </>
  );
}
