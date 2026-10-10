import type { AnyRecord } from './api';
import { Icon } from './Icon';
export function DocumentsView({
  operator,
  busy,
  query,
  sources,
  docs,
  document,
  onUpdateIndex,
  onQueryChange,
  onSearch,
  onCloseSources,
  onOpenDocument,
}: {
  operator: boolean;
  busy: boolean;
  query: string;
  sources: AnyRecord[] | null;
  docs: AnyRecord[];
  document: AnyRecord | null;
  onUpdateIndex: () => void;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onCloseSources: () => void;
  onOpenDocument: (id: string) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SOURCES AND POLICIES</div>
          <h1>The details, at hand.</h1>
          <p>Read original sources and the excerpts retrieved by the assistant.</p>
        </div>
        {operator && (
          <button className="secondary-button" disabled={busy} onClick={onUpdateIndex}>
            {busy ? 'Updating…' : 'Update index'}
          </button>
        )}
      </div>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <Icon name="document" />
        <input
          aria-label="Search documents"
          placeholder="Ask about a policy or search for a product…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <button className="primary-button" disabled={busy || !query.trim()}>
          Search
        </button>
      </form>
      {sources && (
        <section className="search-results">
          <div className="section-title">
            <h2>Retrieved excerpts</h2>
            <button className="text-button" onClick={() => onCloseSources()}>
              Close results ×
            </button>
          </div>
          {sources.map((s) => (
            <article key={s.id}>
              <span className="subtle-tag">Similarity {s.score.toFixed(3)}</span>
              <h3>{s.title || 'No title in the index'}</h3>
              <small>
                {s.documentId} · Version {s.version ?? '—'}
              </small>
              <p>{s.text}</p>
            </article>
          ))}
        </section>
      )}
      <div className="documents-layout">
        <section className="panel document-list">
          <div className="section-title">
            <h2>Documents</h2>
            <span>{docs.length} sources</span>
          </div>
          {docs.map((d) => (
            <button
              key={d.id}
              className={document?.id === d.id ? 'selected' : ''}
              onClick={() => onOpenDocument(d.id)}
            >
              <Icon name="document" />
              <span>
                <strong>{d.title}</strong>
                <small>
                  v{d.version} ·{' '}
                  {d.validTo ? 'Archive' : d.audience === 'internal' ? 'Internal' : 'Current'}
                </small>
              </span>
              <span>↗</span>
            </button>
          ))}
        </section>
        <section className="panel document-reader">
          {document ? (
            <>
              <div className="eyebrow">ORIGINAL SOURCE · V{document.version}</div>
              <h2>{document.title}</h2>
              <p className="muted">
                Effective: {document.validFrom}
                {document.validTo ? ` — ${document.validTo}` : ''}
              </p>
              <pre>{document.text}</pre>
            </>
          ) : (
            <div className="case-empty">
              <Icon name="document" />
              <h2>Open a source</h2>
              <p>Check policies, exceptions, and dates in the original document.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
