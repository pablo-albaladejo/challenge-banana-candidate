import { HttpError } from '../../../platform/http/http-error';
import { json } from '../../../platform/http/respond';
import { knowledge } from '../dependencies';
import type { Handler } from '../../../platform/http/context';
export const runIngestion: Handler = async ({ actor }) => {
  if (actor.role !== 'operator') throw new HttpError(403, 'Operator role required.');
  return json(await knowledge().ingestDocuments({}));
};
