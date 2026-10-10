import type { AnyRecord } from '../lib/api';
/** The error banner and the notice; a held transfer (`review`) adds "Send anyway". */
export function Alerts({
  error,
  notice,
  review,
  busy,
  onDismissError,
  onSendAnyway,
  onDismissNotice,
}: {
  error: string;
  notice: string;
  review: AnyRecord | null;
  busy: boolean;
  onDismissError: () => void;
  onSendAnyway: () => void;
  onDismissNotice: () => void;
}) {
  return (
    <>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={onDismissError} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="alert notice" role="status">
          {notice}
          {review && (
            <button className="text-button" disabled={busy} onClick={onSendAnyway}>
              Send anyway
            </button>
          )}
          <button onClick={onDismissNotice} aria-label="Dismiss notice">
            ×
          </button>
        </div>
      )}
    </>
  );
}
