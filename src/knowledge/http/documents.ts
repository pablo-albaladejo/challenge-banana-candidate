import { HttpError } from '../../platform/http/http-error';
import { documents, readDocument } from '../ingestion/pipeline';
import { allChunks, chunkCount } from '../search/store';
import { json } from '../../platform/http/respond';
import type { Handler } from '../../platform/http/context';
import type { Person } from '../../types';
/** Operators see every document; anyone else only the public ones. */
const visibleTo = (actor: Person) =>
  documents().filter((d) => actor.role === 'operator' || d.audience === 'public');
function visibleDocument(actor: Person, id: string) {
  const doc = visibleTo(actor).find((d) => d.id === id);
  if (!doc) throw new HttpError(404, 'Document not found.');
  return doc;
}
export const listDocuments: Handler = ({ actor }) =>
  json({ documents: visibleTo(actor), index: chunkCount() });
export const documentChunks: Handler = ({ params, actor }) => {
  const doc = visibleDocument(actor, params.id);
  return json(
    allChunks()
      .filter((c) => c.documentId === doc.id)
      .map(({ vector, ...c }) => c),
  );
};
export const documentDetail: Handler = ({ params, actor }) => {
  const doc = visibleDocument(actor, params.id);
  return json({ ...doc, text: readDocument(doc) });
};
