import type { AnyRecord } from '../lib/api';
import { time } from '../lib/format';
const rank: Record<string, number> = { blocker: 0, warning: 1, info: 2 };
const icon: Record<string, string> = { blocker: '⛔', warning: '⚠', info: 'ⓘ' };
/** Where a check's fact comes from, as a small caption. */
function caption(source: AnyRecord) {
  if (source.kind === 'bank') return `as of ${time(source.asOf)}`;
  if (source.what === 'outgoing_movements') return `based on ${source.sampleSize} recent payments`;
  if (source.what === 'completed_transfers')
    return `based on ${source.sampleSize} completed transfers in the app`;
  return 'duplicate-payment safeguard';
}
/** The code-written pre-flight checks of a proposal, blockers first. */
export function PreflightChecks({ checks }: { checks: AnyRecord[] }) {
  if (!checks.length) return null;
  const ordered = [...checks].sort((a, b) => rank[a.severity] - rank[b.severity]);
  return (
    <div className="preflight">
      <h3>Pre-flight checks</h3>
      <ul>
        {ordered.map((c) => (
          <li key={c.id} className={`preflight-check ${c.severity}`}>
            <span aria-hidden="true">{icon[c.severity]}</span>
            <p>
              {c.message}
              <small>{caption(c.source)}</small>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
