'use client';
import { useEffect, useRef, useState } from 'react';
import type { Person } from '../src/types';
import { Alerts } from './_ui/shell/Alerts';
import { api, type AnyRecord } from './_ui/lib/api';
import { ApprovalsPanel } from './_ui/transfers/ApprovalsPanel';
import { ChatPanel } from './_ui/assistant/ChatPanel';
import { CustomerOverview } from './_ui/accounts/CustomerOverview';
import { DocumentsView } from './_ui/knowledge/DocumentsView';
import { OperatorCases } from './_ui/support/OperatorCases';
import { Sidebar } from './_ui/shell/Sidebar';
import { Topbar } from './_ui/shell/Topbar';
import { TransferChecksPanel } from './_ui/transfers/TransferChecksPanel';
import { TransferForm } from './_ui/transfers/TransferForm';
export default function Home() {
  const [people, setPeople] = useState<Person[]>([]),
    [current, setCurrent] = useState<Person | null>(null),
    [switcherOff, setSwitcherOff] = useState(false),
    [tab, setTab] = useState('overview');
  const [dashboard, setDashboard] = useState<AnyRecord | null>(null),
    [conversations, setConversations] = useState<AnyRecord[]>([]),
    [conversationId, setConversationId] = useState<string | null>(null),
    [messages, setMessages] = useState<AnyRecord[]>([]);
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [review, setReview] = useState<AnyRecord | null>(null);
  const [docs, setDocs] = useState<AnyRecord[]>([]),
    [document, setDocument] = useState<AnyRecord | null>(null),
    [query, setQuery] = useState(''),
    [sources, setSources] = useState<AnyRecord[] | null>(null),
    [searchMode, setSearchMode] = useState<'semantic' | 'lexical'>('semantic');
  const [selectedCase, setSelectedCase] = useState<AnyRecord | null>(null),
    [brief, setBrief] = useState<AnyRecord | null>(null),
    [briefsBusy, setBriefsBusy] = useState<ReadonlySet<string>>(new Set()),
    [draft, setDraft] = useState(''),
    [refused, setRefused] = useState<{ error: string; flags: AnyRecord[] } | null>(null),
    [acknowledged, setAcknowledged] = useState(false),
    [sendingFor, setSendingFor] = useState<string | null>(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [amount, setAmount] = useState(''),
    [concept, setConcept] = useState('');
  const activeConversation = useRef<string | null>(null),
    openCaseId = useRef<string | null>(null);
  const generation = useRef(0),
    messagesEnd = useRef<HTMLDivElement>(null);
  async function refresh(g = generation.current) {
    const data = await api('dashboard');
    if (g !== generation.current) return;
    setDashboard(data);
    if (data.accounts?.length)
      setFrom((v) => (data.accounts.some((a: AnyRecord) => a.id === v) ? v : data.accounts[0].id));
  }
  async function selectPerson(id: string) {
    const g = ++generation.current;
    setCurrent(null);
    setDashboard(null);
    setConversations([]);
    activeConversation.current = null;
    setConversationId(null);
    setMessages([]);
    setSelectedCase(null);
    openCaseId.current = null;
    setBrief(null);
    setDraft('');
    setRefused(null);
    setAcknowledged(false);
    setDocument(null);
    setDocs([]);
    setSources(null);
    setError('');
    setNotice('');
    setReview(null);
    setBusy(false);
    setText('');
    setFrom('');
    setTo('');
    setAmount('');
    setConcept('');
    setTab('overview');
    try {
      const result = await api('session', { userId: id });
      if (g !== generation.current) return;
      setCurrent(result.person);
      await refresh(g);
      if (result.person.role === 'customer') {
        const cs = await api('conversations');
        if (g === generation.current) setConversations(cs);
      }
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    // With DEMO_PERSONA_SWITCHER off the server has no `people` route: it answers 401 without a
    // session and 404 with one. Nobody can be selected, so say why; any other failure is an error.
    api('people')
      .then((list) => {
        setPeople(list);
        return api('session')
          .then((x) => selectPerson(x.person.id))
          .catch(() => selectPerson('lucia'));
      })
      .catch((e: Error & { status?: number }) => {
        if (e.status === 401 || e.status === 404) setSwitcherOff(true);
        else setError(e.message);
      });
  }, []);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);
  async function openConversation(id: string) {
    const g = generation.current;
    activeConversation.current = id;
    setConversationId(id);
    setTab('chat');
    setMessages([]);
    setError('');
    try {
      const c = await api(`conversations/${id}`);
      if (g === generation.current && activeConversation.current === id) setMessages(c.messages);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  async function newConversation() {
    const g = generation.current;
    try {
      const c = await api('conversations', {});
      if (g !== generation.current) return;
      const cs = await api('conversations');
      if (g !== generation.current) return;
      setConversations(cs);
      activeConversation.current = c.id;
      setConversationId(c.id);
      setMessages([]);
      setTab('chat');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(value = text) {
    if (!value.trim() || busy || !current) return;
    const g = generation.current;
    setBusy(true);
    setError('');
    setText('');
    let id = conversationId;
    try {
      if (!id) {
        const c = await api('conversations', {});
        if (g !== generation.current) return;
        id = c.id;
        activeConversation.current = id;
        setConversationId(id);
      }
      setTab('chat');
      setMessages((m) => [
        ...m,
        { id: 'pending-user', role: 'user', content: value, created_at: new Date().toISOString() },
      ]);
      await api(`conversations/${id}/messages`, { content: value });
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) {
        try {
          if (id) {
            const c = await api(`conversations/${id}`);
            if (g === generation.current && activeConversation.current === id)
              setMessages(c.messages);
          }
          const cs = await api('conversations');
          if (g === generation.current) setConversations(cs);
          await refresh(g);
        } catch {}
        if (g === generation.current) setBusy(false);
      }
    }
  }
  async function openLibrary() {
    const g = generation.current;
    setTab('documents');
    setDocument(null);
    try {
      const result = await api('documents');
      if (g === generation.current) setDocs(result.documents);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  /** Sends the form; `held` resends a transfer held for review past its pending match. */
  async function submitTransfer(held?: AnyRecord) {
    const g = generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    setReview(null);
    const args = held?.arguments ?? {
      fromAccountId: from,
      toAccountId: to,
      amountCents: Math.round(Number(amount.replace(',', '.')) * 100),
      concept,
    };
    try {
      const result = await api('actions', {
        name: 'transfer_money',
        arguments: args,
        conversationId,
        ...(held ? { intentId: held.intentId, overridePendingIntentId: held.pendingIntentId } : {}),
      });
      if (g !== generation.current) return;
      if (result.status === 'requires_review')
        setReview({
          arguments: args,
          intentId: result.intentId,
          pendingIntentId: result.pendingIntentId,
        });
      setNotice(
        result.status === 'completed'
          ? 'Transfer completed. You can check it in your activity.'
          : result.status === 'requires_confirmation'
            ? 'Review the proposal to confirm the transfer.'
            : result.error || 'The operation is still pending.',
      );
      await refresh(g);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  /** Confirms a proposal; `overridePendingIntentId` is the customer's "send anyway". */
  async function confirm(id: string, overridePendingIntentId?: string) {
    const g = generation.current;
    setReview(null);
    try {
      const result = await api(
        `approvals/${id}/confirm`,
        overridePendingIntentId ? { overridePendingIntentId } : {},
      );
      if (g !== generation.current) return;
      if (result.status === 'requires_review')
        setReview({ approvalId: id, pendingIntentId: result.pendingIntentId });
      setNotice(
        result.status === 'completed'
          ? 'Transfer confirmed and completed.'
          : result.error || result.status,
      );
      await refresh(g);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  /** Resends a held transfer, or re-confirms a held proposal, past its pending match. */
  function sendAnyway() {
    if (!review) return;
    if (review.approvalId) confirm(review.approvalId, review.pendingIntentId);
    else submitTransfer(review);
  }
  function dismissNotice() {
    setNotice('');
    setReview(null);
  }
  function navigate(id: string) {
    if (id === 'documents') openLibrary();
    else setTab(id);
  }
  async function openCase(id: string) {
    const g = generation.current;
    openCaseId.current = id;
    setBrief(null);
    setDraft('');
    setRefused(null);
    setAcknowledged(false);
    try {
      const d = await api(`incidents/${id}`);
      if (g === generation.current) setSelectedCase(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  /**
   * The verified brief of the open case. Its answer and its error belong to that case: dropped if
   * the person or the case changed meanwhile. Busy is kept per case, so a case still generating
   * shows busy again when the operator returns to it.
   */
  async function generateBrief() {
    const g = generation.current;
    const id = selectedCase?.incident.id;
    if (!id) return;
    setBriefsBusy((busy) => new Set(busy).add(id));
    const stillOpen = () => g === generation.current && openCaseId.current === id;
    try {
      const b = await api(`incidents/${id}/brief`, {});
      if (stillOpen()) {
        setBrief(b);
        setDraft(b.templateReply ?? b.prose?.draftReply ?? '');
        setRefused(null);
        setAcknowledged(false);
      }
    } catch (e) {
      if (stillOpen()) setError((e as Error).message);
    } finally {
      setBriefsBusy((busy) => {
        const next = new Set(busy);
        next.delete(id);
        return next;
      });
    }
  }
  /** Any edit invalidates a refusal and its acknowledgment: the server rechecks what is sent. */
  function changeDraft(value: string) {
    setDraft(value);
    setRefused(null);
    setAcknowledged(false);
  }
  /**
   * Sends the edited reply to the customer and closes the case. Unverified statements come back as a
   * refusal with their flags; sending again needs the operator's acknowledgment.
   */
  async function sendReply() {
    const g = generation.current;
    const id = selectedCase?.incident.id;
    if (!id) return;
    setSendingFor(id);
    setError('');
    const stillOpen = () => g === generation.current && openCaseId.current === id;
    try {
      await api(`incidents/${id}/reply`, {
        content: draft,
        ...(acknowledged ? { acknowledgeUnverified: true } : {}),
      });
      if (!stillOpen()) return;
      setRefused(null);
      setAcknowledged(false);
      setNotice('Reply sent. The case is closed.');
      const d = await api(`incidents/${id}`);
      if (stillOpen()) setSelectedCase(d);
      await refresh(g);
    } catch (e) {
      if (!stillOpen()) return;
      const body = (e as Error & { body?: AnyRecord }).body;
      if (Array.isArray(body?.flags)) {
        setRefused({ error: body.error, flags: body.flags });
        setAcknowledged(false);
      } else setError((e as Error).message);
    } finally {
      setSendingFor((sending) => (sending === id ? null : sending));
    }
  }
  async function updateIndex() {
    const g = generation.current;
    setBusy(true);
    try {
      const r = await api('ingestion', {});
      if (g !== generation.current) return;
      setNotice(`Index updated: ${r.documents} documents, ${r.chunks} excerpts.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function search() {
    const g = generation.current;
    setBusy(true);
    try {
      const result = await api('search', { query });
      if (g === generation.current) {
        setSearchMode(result.mode === 'lexical' ? 'lexical' : 'semantic');
        setSources(result.sources);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openDocument(id: string) {
    const g = generation.current;
    try {
      const result = await api(`documents/${id}`);
      if (g === generation.current) setDocument(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const operator = current?.role === 'operator';
  return (
    <div className="app-shell">
      <Sidebar
        operator={operator}
        tab={tab}
        conversations={conversations}
        conversationId={conversationId}
        onNavigate={navigate}
        onNewConversation={newConversation}
        onOpenConversation={openConversation}
      />
      <div className="main-shell">
        <Topbar
          operator={operator}
          current={current}
          people={people}
          switcherOff={switcherOff}
          onSelectPerson={selectPerson}
        />
        <main>
          <Alerts
            error={error}
            notice={notice}
            review={review}
            busy={busy}
            onDismissError={() => setError('')}
            onSendAnyway={sendAnyway}
            onDismissNotice={dismissNotice}
          />
          {switcherOff ? (
            <div className="loading" role="status">
              Choosing a person is turned off on this production server. Run{' '}
              <code>npm run dev</code> to try the demo.
            </div>
          ) : !current || !dashboard ? (
            <div className="loading">
              <span className="spinner" /> Getting things ready…
            </div>
          ) : (
            <>
              {tab === 'overview' && !operator && (
                <CustomerOverview current={current} dashboard={dashboard} onTab={setTab} />
              )}
              {tab === 'chat' && !operator && (
                <ChatPanel
                  current={current}
                  people={people}
                  conversations={conversations}
                  conversationId={conversationId}
                  messages={messages}
                  text={text}
                  busy={busy}
                  endRef={messagesEnd}
                  onNewConversation={newConversation}
                  onOpenConversation={openConversation}
                  onSend={send}
                  onTextChange={setText}
                />
              )}
              {tab === 'transfer' && !operator && (
                <TransferForm
                  dashboard={dashboard}
                  from={from}
                  to={to}
                  amount={amount}
                  concept={concept}
                  busy={busy}
                  onFromChange={setFrom}
                  onToChange={setTo}
                  onAmountChange={setAmount}
                  onConceptChange={setConcept}
                  onSubmit={() => submitTransfer()}
                  onTab={setTab}
                />
              )}
              {dashboard.approvals?.length > 0 && (
                <ApprovalsPanel approvals={dashboard.approvals} onConfirm={(id) => confirm(id)} />
              )}
              {dashboard.pendingTransfers?.length > 0 && (
                <TransferChecksPanel transfers={dashboard.pendingTransfers} />
              )}
              {tab === 'overview' && operator && (
                <OperatorCases
                  current={current}
                  dashboard={dashboard}
                  people={people}
                  selectedCase={selectedCase}
                  onOpenCase={openCase}
                  brief={brief}
                  briefBusy={briefsBusy.has(selectedCase?.incident.id)}
                  onGenerateBrief={generateBrief}
                  reply={{
                    draft,
                    refused,
                    acknowledged,
                    sending: sendingFor !== null && sendingFor === selectedCase?.incident.id,
                    closed: selectedCase?.incident.status === 'closed',
                    onDraftChange: changeDraft,
                    onAcknowledgeChange: setAcknowledged,
                    onSend: sendReply,
                  }}
                />
              )}
              {tab === 'documents' && (
                <DocumentsView
                  operator={operator}
                  busy={busy}
                  query={query}
                  sources={sources}
                  searchMode={searchMode}
                  docs={docs}
                  document={document}
                  onUpdateIndex={updateIndex}
                  onQueryChange={setQuery}
                  onSearch={search}
                  onCloseSources={() => setSources(null)}
                  onOpenDocument={openDocument}
                />
              )}
            </>
          )}
        </main>
        <footer>
          banana<span>A simulated environment for building better experiences.</span>
          <span>banana · 2026</span>
        </footer>
      </div>
    </div>
  );
}
