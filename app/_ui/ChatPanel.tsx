import type { RefObject } from 'react';
import type { Person } from '../../src/types';
import type { AnyRecord } from './api';
import { date } from './format';
import { Icon } from './Icon';
export function ChatPanel({
  current,
  conversations,
  conversationId,
  messages,
  text,
  busy,
  endRef,
  onNewConversation,
  onOpenConversation,
  onSend,
  onTextChange,
}: {
  current: Person;
  conversations: AnyRecord[];
  conversationId: string | null;
  messages: AnyRecord[];
  text: string;
  busy: boolean;
  /** Scrolled into view by `Home` when messages change. */
  endRef: RefObject<HTMLDivElement | null>;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  /** Sends `value`, or the composer text when called without one. */
  onSend: (value?: string) => void;
  onTextChange: (text: string) => void;
}) {
  return (
    <div className="chat-layout">
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">ONE CONVERSATION, PLENTY OF POSSIBILITIES</div>
          <h1>Your assistant</h1>
          <p>Ask, plan, and get things done here.</p>
        </div>
        <button className="secondary-button" onClick={onNewConversation}>
          + New conversation
        </button>
      </div>
      <label className="conversation-picker">
        Conversation
        <select
          aria-label="Conversation"
          value={conversationId || ''}
          onChange={(e) => onOpenConversation(e.target.value)}
        >
          <option value="">New conversation</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <section className="chat-panel">
        <div className="chat-header">
          <span className="assistant-avatar">✧</span>
          <div>
            <strong>Banana Bank assistant</strong>
            <small>
              <span className="live-dot" /> Here to help
            </small>
          </div>
          <span className="subtle-tag">{current.name.split(' ')[0]}</span>
        </div>
        <div className="messages">
          {!messages.length && (
            <div className="chat-empty">
              <span className="big-sparkle">✧</span>
              <h2>What do you need today?</h2>
              <p>Start with your accounts or a question.</p>
              <div className="suggestions">
                {[
                  'What are the balances of my accounts?',
                  'When is the Aurora account fee waived?',
                  'I want to speak to a person',
                ].map((s) => (
                  <button key={s} disabled={busy} onClick={() => onSend(s)}>
                    {s}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div className={`message ${m.role}`} key={m.id || i}>
              {m.role === 'assistant' && <span className="message-avatar">✧</span>}
              <div className="bubble">
                <div>
                  {String(m.content)
                    .split(/(\*\*[^*]+\*\*)/g)
                    .map((part, j) =>
                      part.startsWith('**') && part.endsWith('**') ? (
                        <strong key={j}>{part.slice(2, -2)}</strong>
                      ) : (
                        part
                      ),
                    )}
                </div>
                <small>{date(m.created_at)}</small>
              </div>
            </div>
          ))}
          {busy && (
            <div className="message assistant">
              <span className="message-avatar">✧</span>
              <div className="thinking">
                <i />
                <i />
                <i />
                <span>Checking…</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <textarea
            aria-label="Message the assistant"
            placeholder="What can we help with?"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={2}
          />
          <button aria-label="Send message" disabled={busy || !text.trim()}>
            <Icon name="arrow" />
          </button>
        </form>
        <div className="chat-footnote">
          AI assistant · Check important details before taking action.
        </div>
      </section>
    </div>
  );
}
