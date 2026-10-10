import type { Person } from '../../src/types';
import type { AnyRecord } from './api';
import { date, money } from './format';
import { Icon } from './Icon';
export function OperatorCases({
  current,
  dashboard,
  people,
  selectedCase,
  onOpenCase,
}: {
  current: Person;
  dashboard: AnyRecord;
  people: Person[];
  selectedCase: AnyRecord | null;
  onOpenCase: (id: string) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CUSTOMER SUPPORT</div>
          <h1>Every case, a person.</h1>
          <p>Hello, {current.name.split(' ')[0]}. Here are your customer support cases.</p>
        </div>
        <div className="case-count">
          <strong>
            {dashboard.incidents?.filter((c: AnyRecord) => c.status === 'open').length || 0}
          </strong>
          <span>open cases</span>
        </div>
      </div>
      <div className="operator-grid">
        <section className="panel case-list">
          <div className="section-title">
            <h2>Inbox</h2>
            <span className="subtle-tag">All cases</span>
          </div>
          {dashboard.incidents?.map((c: AnyRecord) => (
            <button
              key={c.id}
              className={`case-item ${selectedCase?.incident.id === c.id ? 'selected' : ''}`}
              onClick={() => onOpenCase(c.id)}
            >
              <span
                className="avatar"
                style={{ background: people.find((p) => p.id === c.user_id)?.color }}
              >
                {people.find((p) => p.id === c.user_id)?.initials}
              </span>
              <div>
                <strong>{people.find((p) => p.id === c.user_id)?.name}</strong>
                <p>{c.summary}</p>
                <small>
                  {date(c.created_at)} · {c.status === 'closed' ? 'Resolved' : 'Open'}
                </small>
              </div>
              <span>↗</span>
            </button>
          ))}
        </section>
        <section className="panel case-detail">
          {selectedCase ? (
            <>
              <div className="eyebrow">CASE {selectedCase.incident.id.slice(0, 12)}</div>
              <h2>{selectedCase.customer.name}</h2>
              <span className="status-pill">
                {selectedCase.incident.status === 'closed' ? 'Resolved' : 'Awaiting support'}
              </span>
              <h3>Latest message</h3>
              <blockquote>{selectedCase.lastMessage?.content}</blockquote>
              <p className="muted">Received {date(selectedCase.incident.created_at)}</p>
              {selectedCase.history?.length > 0 && (
                <>
                  <h3>Conversation</h3>
                  {selectedCase.history.map((m: AnyRecord) => (
                    <p key={m.id}>
                      <b>{m.role === 'user' ? 'Customer' : 'Assistant'}:</b> {m.content}
                    </p>
                  ))}
                </>
              )}
              {selectedCase.events?.length > 0 && (
                <>
                  <h3>Agent activity</h3>
                  {selectedCase.events.map((e: AnyRecord) => (
                    <details key={e.id}>
                      <summary>
                        {e.kind} · {date(e.created_at)}
                      </summary>
                      <pre>{JSON.stringify(e.data, null, 2)}</pre>
                    </details>
                  ))}
                </>
              )}
              {selectedCase.bank && (
                <>
                  <h3>Bank operations</h3>
                  {selectedCase.bank.operations.map((o: AnyRecord) => (
                    <div className="evidence-row" key={o.id}>
                      {money(o.amountCents)} · {o.status}
                      <small>{o.reference}</small>
                    </div>
                  ))}
                </>
              )}
              {selectedCase.gaps && <p className="muted">{selectedCase.gaps}</p>}
            </>
          ) : (
            <div className="case-empty">
              <Icon name="chat" />
              <h2>Open a case</h2>
              <p>Select a case to see the available information.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
