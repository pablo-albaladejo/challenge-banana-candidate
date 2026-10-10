// The API route table. Order mirrors the original if-chain; the first match wins. Every route has
// an explicit method (reads are GET, writes POST) and an exact path: no trailing segments.
import type { Route } from '../platform/http/router';
import type { Handler, PublicHandler } from '../platform/http/context';
import { health } from '../platform/http/health';
import { listPeople } from '../identity/http/people';
import { currentSession, selectPerson } from '../identity/http/session';
import { dashboard } from '../accounts/http/dashboard';
import {
  conversationDetail,
  createConversation,
  listConversations,
  postMessage,
} from '../conversations/http/conversations';
import { runAction } from '../transfers/http/actions';
import { confirmApproval } from '../transfers/http/approvals';
import { incidentDetail, listIncidents } from '../support/http/incidents';
import { documentChunks, documentDetail, listDocuments } from '../knowledge/http/documents';
import { previewAnswer } from '../assistant/http/preview-answer';
import { search } from '../knowledge/http/search';
import { runIngestion } from '../knowledge/http/ingestion';
/** Answered before the actor is resolved: no session needed. */
export const publicRoutes: Route<PublicHandler>[] = [
  { method: 'GET', pattern: 'health', handler: health },
  { method: 'GET', pattern: 'people', handler: listPeople },
  { method: 'POST', pattern: 'session', handler: selectPerson },
];
export const routes: Route<Handler>[] = [
  { method: 'GET', pattern: 'session', handler: currentSession },
  { method: 'GET', pattern: 'dashboard', handler: dashboard },
  { method: 'POST', pattern: 'conversations', handler: createConversation },
  { method: 'GET', pattern: 'conversations', handler: listConversations },
  { method: 'POST', pattern: 'conversations/:id/messages', handler: postMessage },
  { method: 'GET', pattern: 'conversations/:id', handler: conversationDetail },
  { method: 'POST', pattern: 'actions', handler: runAction },
  { method: 'POST', pattern: 'approvals/:id/confirm', handler: confirmApproval },
  { method: 'GET', pattern: 'incidents', handler: listIncidents },
  { method: 'GET', pattern: 'incidents/:id', handler: incidentDetail },
  { method: 'GET', pattern: 'documents', handler: listDocuments },
  { method: 'GET', pattern: 'documents/:id/chunks', handler: documentChunks },
  { method: 'GET', pattern: 'documents/:id', handler: documentDetail },
  { method: 'POST', pattern: 'preview-answer', handler: previewAnswer },
  { method: 'POST', pattern: 'search', handler: search },
  { method: 'POST', pattern: 'ingestion', handler: runIngestion },
];
