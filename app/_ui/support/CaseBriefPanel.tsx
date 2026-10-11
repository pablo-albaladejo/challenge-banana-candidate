import type { AnyRecord } from '../lib/api';
import { date, time } from '../lib/format';

/** Each finding in words, with its severity: what the operator must act on. */
const FINDINGS: Record<string, { severity: 'blocker' | 'warning' | 'info'; label: string }> = {
  unlinked_operation: {
    severity: 'blocker',
    label: 'Bank operation with no recorded request or approval in the app',
  },
  retry_advice: { severity: 'blocker', label: 'Retry advice on a completed payment' },
  false_status_claim: { severity: 'warning', label: 'Status claim contradicted by the evidence' },
  unsettled_intent: {
    severity: 'warning',
    label: "Transfer still waiting for the bank's confirmation",
  },
  pending_twin: { severity: 'warning', label: 'Several unsettled requests for the same payment' },
  false_other_claim: { severity: 'warning', label: 'Amount claim contradicted by the evidence' },
  policy_claim: { severity: 'info', label: 'The assistant quoted a policy value' },
  bank_unreachable: {
    severity: 'warning',
    label: 'The bank could not be reached: nothing that needs it was verified',
  },
  missing_agent_activity: {
    severity: 'info',
    label: 'No agent activity was recorded for this conversation',
  },
};
/** The `bank_unreachable` finding when the bank answered, but with an error. */
const BANK_REFUSED = {
  severity: 'warning' as const,
  label: 'The bank answered with an error: nothing that needs it was verified',
};
const SEVERITY_ICON = { blocker: '⛔', warning: '⚠', info: 'ⓘ' };
const SEVERITY_SPOKEN = { blocker: 'Blocker:', warning: 'Warning:', info: 'Note:' };
const VERDICT_ICON: Record<string, string> = {
  verified: '✅',
  contradicted: '❌',
  unverifiable: '⚪',
};
const VERDICT_SPOKEN: Record<string, string> = {
  verified: 'Verified:',
  contradicted: 'Contradicted:',
  unverifiable: 'Could not be verified:',
};
const ACTOR: Record<string, string> = {
  customer: 'Customer',
  assistant: 'Assistant',
  operator: 'Support',
  bank: 'Bank',
  system: 'App',
};
const FLAG: Record<string, string> = {
  contradicted: '❌',
  retry_advice: '⛔',
  unlinked_operation: '⛔',
};
/** What a send-time flag means, for the operator who must acknowledge it. */
const FLAG_KIND: Record<string, string> = {
  amount: 'an amount no verified fact backs',
  reference: 'a reference no verified fact backs',
  status: 'a transfer status no verified fact backs',
  ambiguous_status: 'a status that can be read both ways',
  commitment: 'a commitment (refund, reversal, waiver, retry, deadline)',
};
const words = (reason: string) => reason.replaceAll('_', ' ');
const citations = (evidence: AnyRecord[]) => evidence.map((e) => e.citation).join(' · ');

/** One claim of the assistant, its verdict and what it rests on. */
function Verdict({ brief, verdict }: { brief: AnyRecord; verdict: AnyRecord }) {
  const claim = brief.claims.find((c: AnyRecord) => c.id === verdict.claimId);
  const correct = brief.facts.find((f: AnyRecord) => f.id === verdict.correctFactId);
  return (
    <li className={`brief-verdict ${verdict.verdict}`}>
      <span aria-hidden="true">{VERDICT_ICON[verdict.verdict]}</span>
      <p>
        <span className="visually-hidden">{VERDICT_SPOKEN[verdict.verdict]} </span>“{claim?.quote}”
        <small>
          {words(verdict.reason)}
          {verdict.verdict === 'unverifiable' && verdict.detail ? ` · ${verdict.detail}` : ''}
          {verdict.verdict === 'verified' ? ` · ${citations(verdict.evidence)}` : ''}
        </small>
        {correct && (
          <small>
            Holds instead: {correct.statement} · {citations(correct.evidence)}
          </small>
        )}
      </p>
    </li>
  );
}

/**
 * The verified case brief (plan Part 2 §6.2-6.3), deterministic path: every claim was found by
 * pattern matching and judged by code. Presentational: the page owns the brief and the request.
 */
export function CaseBriefPanel({
  brief,
  busy,
  onGenerate,
  reply,
}: {
  brief: AnyRecord | null;
  busy: boolean;
  onGenerate: () => void;
  /** Send and close (Part 2 commit 5): the editable reply and its send-time recheck. */
  reply: {
    draft: string;
    /** The flags of the last 409 recheck, with its sentence; `null` before a refused send. */
    refused: { error: string; flags: AnyRecord[] } | null;
    acknowledged: boolean;
    sending: boolean;
    /** The case is closed: the brief is a read-only review and nothing can be sent. */
    closed: boolean;
    onDraftChange: (text: string) => void;
    onAcknowledgeChange: (acknowledged: boolean) => void;
    onSend: () => void;
  };
}) {
  const placeholder = reply.draft.includes('[check:');
  const statements = brief
    ? brief.facts.filter(
        (f: AnyRecord, i: number) =>
          brief.facts.findIndex((g: AnyRecord) => g.statement === f.statement) === i,
      )
    : [];
  return (
    <section className="case-brief" aria-label="Verified brief" aria-live="polite" aria-busy={busy}>
      <div className="case-brief-heading">
        <h3>Verified brief</h3>
        {brief && <small>generated {time(brief.generatedAt)}</small>}
        <button type="button" className="secondary-button" disabled={busy} onClick={onGenerate}>
          {busy ? 'Checking…' : brief ? 'Regenerate' : 'Generate brief'}
        </button>
      </div>
      {!brief && (
        <p className="muted">
          Checks what the assistant told the customer against the bank and the documents.
        </p>
      )}
      {brief && (
        <>
          <p className="brief-notice" role="note">
            ⓘ Facts below are checked by code; claims were found by pattern matching.
          </p>
          {brief.previousCases.map((c: AnyRecord) => (
            <p className="muted" key={c.id}>
              Previous case {c.id}, closed{c.closedAt ? ` ${date(c.closedAt)}` : ''}
            </p>
          ))}
          <h4>Findings</h4>
          {brief.findings.length ? (
            <ul role="list">
              {brief.findings.map((f: AnyRecord, i: number) => {
                const finding =
                  f.kind === 'bank_unreachable' && f.cause === 'refused'
                    ? BANK_REFUSED
                    : FINDINGS[f.kind];
                return (
                  <li key={`${f.kind}-${i}`} className={`preflight-check ${finding.severity}`}>
                    <span aria-hidden="true">{SEVERITY_ICON[finding.severity]}</span>
                    <p>
                      <span className="visually-hidden">{SEVERITY_SPOKEN[finding.severity]} </span>
                      {finding.label}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">Nothing to act on.</p>
          )}
          <h4>What the assistant said (pattern matching)</h4>
          {brief.verdicts.length ? (
            <ul role="list">
              {brief.verdicts.map((v: AnyRecord) => (
                <Verdict key={v.claimId} brief={brief} verdict={v} />
              ))}
            </ul>
          ) : (
            <p className="muted">No amount, reference or transfer status was found.</p>
          )}
          <h4>Procedures</h4>
          <p className="brief-procedures">
            {brief.procedures.map((p: AnyRecord) => (
              <span key={p.documentId}>
                {p.citation} {p.title}
              </span>
            ))}
          </p>
          <h4>Verified facts</h4>
          <ul role="list" className="brief-facts">
            {statements.map((f: AnyRecord) => (
              <li key={f.id}>
                {f.statement}
                <small>{citations(f.evidence)}</small>
              </li>
            ))}
          </ul>
          <h4>Timeline</h4>
          <ol className="brief-timeline">
            {brief.timeline.map((e: AnyRecord) => (
              <li key={`${e.kind}-${e.sourceId}`}>
                <time dateTime={e.at}>{time(e.at)}</time>
                <b>{ACTOR[e.actor]}</b>
                <span>{e.label}</span>
                {e.flag && (
                  <span title={words(e.flag)}>
                    <span aria-hidden="true">{FLAG[e.flag]}</span>
                    <span className="visually-hidden">{words(e.flag)}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
          <h4>Reply to customer (template)</h4>
          <pre className="brief-reply">{brief.templateReply}</pre>
          {reply.closed ? (
            <p className="muted">This case is closed: the brief is a read-only review.</p>
          ) : (
            <div className="brief-send">
              <h4>
                <label htmlFor="brief-draft">Reply to send</label>
              </h4>
              <textarea
                id="brief-draft"
                value={reply.draft}
                rows={7}
                onChange={(e) => reply.onDraftChange(e.target.value)}
              />
              <small>
                The customer sees it signed with your first name. Amounts, references, statuses and
                promises are checked again against the bank when you send.
              </small>
              {placeholder && (
                <p className="brief-send-warning" role="alert">
                  Replace every [check: …] placeholder before sending.
                </p>
              )}
              {reply.refused && (
                <div className="brief-send-warning" role="alert">
                  <p>⚠ {reply.refused.error}</p>
                  <ul role="list">
                    {reply.refused.flags.map((f: AnyRecord, i: number) => (
                      <li key={`${f.start}-${i}`}>
                        “{f.found}” — {FLAG_KIND[f.kind] ?? words(f.kind)}
                      </li>
                    ))}
                  </ul>
                  <label className="brief-send-ack">
                    <input
                      type="checkbox"
                      checked={reply.acknowledged}
                      onChange={(e) => reply.onAcknowledgeChange(e.target.checked)}
                    />
                    I have checked these statements and take responsibility for them
                  </label>
                </div>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={
                  reply.sending ||
                  !reply.draft.trim() ||
                  placeholder ||
                  (reply.refused !== null && !reply.acknowledged)
                }
                onClick={reply.onSend}
              >
                {reply.sending ? 'Sending…' : 'Send and close'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
