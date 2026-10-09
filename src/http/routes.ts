// The API route table. Order mirrors the original if-chain; the first match wins. Every route that
// is not POST-only is `ANY` on purpose: today's endpoints answer any method the catch-all exports.
import type { Route } from './router';
import type { Handler, PublicHandler } from './context';
import { health } from './handlers/health';
import { listPeople } from './handlers/people';
import { currentSession, selectPerson } from './handlers/session';
import { dashboard } from './handlers/dashboard';
import {
  conversationDetail,
  createConversation,
  listConversations,
  postMessage,
} from './handlers/conversations';
import { runAction } from './handlers/actions';
import { confirmApproval } from './handlers/approvals';
import { incidentDetail, listIncidents } from './handlers/incidents';
import { documentChunks, documentDetail, listDocuments } from './handlers/documents';
import { previewAnswer } from './handlers/preview-answer';
import { search } from './handlers/search';
import { runIngestion } from './handlers/ingestion';
/** Answered before the actor is resolved: no session needed. */
export const publicRoutes: Route<PublicHandler>[] = [
  { method: 'ANY', pattern: 'health', handler: health },
  { method: 'ANY', pattern: 'people', handler: listPeople },
  { method: 'POST', pattern: 'session', handler: selectPerson },
];
export const routes: Route<Handler>[] = [
  { method: 'ANY', pattern: 'session', handler: currentSession },
  { method: 'ANY', pattern: 'dashboard', handler: dashboard },
  { method: 'POST', pattern: 'conversations', handler: createConversation },
  { method: 'ANY', pattern: 'conversations', handler: listConversations },
  { method: 'POST', pattern: 'conversations/:id/messages/*rest', handler: postMessage },
  { method: 'ANY', pattern: 'conversations/:id/*rest', handler: conversationDetail },
  { method: 'POST', pattern: 'actions', handler: runAction },
  { method: 'POST', pattern: 'approvals/:id/confirm/*rest', handler: confirmApproval },
  { method: 'ANY', pattern: 'incidents', handler: listIncidents },
  { method: 'ANY', pattern: 'incidents/:id/*rest', handler: incidentDetail },
  { method: 'ANY', pattern: 'documents', handler: listDocuments },
  { method: 'ANY', pattern: 'documents/:id/chunks/*rest', handler: documentChunks },
  { method: 'ANY', pattern: 'documents/:id/*rest', handler: documentDetail },
  { method: 'POST', pattern: 'preview-answer', handler: previewAnswer },
  { method: 'POST', pattern: 'search', handler: search },
  { method: 'POST', pattern: 'ingestion', handler: runIngestion },
];
