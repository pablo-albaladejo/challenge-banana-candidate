import { HttpError } from '../../platform/http/http-error';
import { ingest } from '../ingestion/pipeline';
import { json } from '../../platform/http/respond';
import type { Handler } from '../../platform/http/context';
export const runIngestion: Handler = async ({ actor }) => {
  if (actor.role !== 'operator') throw new HttpError(403, 'Operator role required.');
  return json(await ingest());
};
