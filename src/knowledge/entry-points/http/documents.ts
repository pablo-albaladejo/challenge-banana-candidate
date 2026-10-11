import { json } from '../../../platform/http/respond';
import { knowledge } from '../dependencies';
import type { Handler } from '../../../platform/http/context';
/** Operators see every document; anyone else only the public ones (an invisible one is a 404). */
export const listDocuments: Handler = ({ actor }) =>
  json(knowledge().listDocuments({ role: actor.role }));
export const documentChunks: Handler = ({ params, actor }) =>
  json(knowledge().getDocumentChunks({ role: actor.role, id: params.id }));
export const documentDetail: Handler = ({ params, actor }) =>
  json(knowledge().getDocument({ role: actor.role, id: params.id }));
